use std::collections::HashMap;
use std::sync::Mutex;

use tauri::{image::Image, tray::TrayIconBuilder, AppHandle, Manager};
use tauri_plugin_positioner::{Position, WindowExt};

use crate::github::{FetchResult, PrElementChanges, PullRequest};
use crate::{NotificationPreferences, Settings};

const TRAY_ID: &str = "main-tray";
const TRAY_ICON: &[u8] = include_bytes!("../icons/tray.png");

// Cache for the badged icon to avoid regenerating it every time
static BADGED_ICON_CACHE: Mutex<Option<Vec<u8>>> = Mutex::new(None);

fn load_tray_icon() -> Image<'static> {
    let img = image::load_from_memory(TRAY_ICON).expect("failed to decode tray icon");
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    Image::new_owned(rgba.into_raw(), w, h)
}

/// Inverts black content to white for use as a non-template icon in dark mode.
fn load_tray_icon_white() -> Image<'static> {
    let img = image::load_from_memory(TRAY_ICON).expect("failed to decode tray icon");
    let mut rgba = img.to_rgba8();
    for pixel in rgba.pixels_mut() {
        if pixel[3] > 0 {
            pixel[0] = 255 - pixel[0];
            pixel[1] = 255 - pixel[1];
            pixel[2] = 255 - pixel[2];
        }
    }
    let (w, h) = rgba.dimensions();
    Image::new_owned(rgba.into_raw(), w, h)
}

/// Captures the full PR state so we can detect actual changes between polls.
pub fn attention_fingerprint(pr: &PullRequest) -> String {
    let review = pr.review_decision.as_deref().unwrap_or("");
    let checks = pr
        .commits
        .nodes
        .first()
        .and_then(|n| n.commit.status_check_rollup.as_ref())
        .map(|r| r.state.as_str())
        .unwrap_or("");
    let unresolved = pr.review_threads.nodes.iter().filter(|t| !t.is_resolved).count();
    let resolved = pr.review_threads.nodes.iter().filter(|t| t.is_resolved).count();
    let in_queue = pr.merge_queue_entry.is_some();
    format!(
        "{}|{}|{}|{}|{}|{}|{}",
        review,
        checks,
        pr.comments.total_count,
        pr.reviews.total_count,
        unresolved,
        resolved,
        in_queue
    )
}

/// Computes which individual elements changed on a PR by comparing against the old fingerprint.
pub fn compute_element_changes(pr: &PullRequest, old_fp: &str) -> PrElementChanges {
    let parts: Vec<&str> = old_fp.split('|').collect();
    if parts.len() < 6 {
        return PrElementChanges::default();
    }
    let new_checks = pr
        .commits
        .nodes
        .first()
        .and_then(|n| n.commit.status_check_rollup.as_ref())
        .map(|r| r.state.as_str())
        .unwrap_or("");
    let new_unresolved = pr.review_threads.nodes.iter().filter(|t| !t.is_resolved).count();
    let new_resolved = pr.review_threads.nodes.iter().filter(|t| t.is_resolved).count();
    PrElementChanges {
        review_decision: parts[0] != pr.review_decision.as_deref().unwrap_or(""),
        checks: parts[1] != new_checks,
        approvals: parts[3].parse::<i32>().unwrap_or(0) != pr.reviews.total_count,
        // comments element shows comments + unresolved combined, so highlight on either change
        comments: parts[2].parse::<i32>().unwrap_or(0) != pr.comments.total_count
            || parts[4].parse::<usize>().unwrap_or(0) != new_unresolved,
        resolved: parts[5].parse::<usize>().unwrap_or(0) != new_resolved,
    }
}

/// Check if element changes match the notification preferences.
fn should_notify_for_changes(
    changes: &PrElementChanges,
    prefs: &NotificationPreferences,
) -> bool {
    (changes.review_decision && (prefs.needs_review || prefs.changes_requested))
        || (changes.checks && prefs.checks_failed)
        || (changes.approvals && prefs.new_reviews)
        || ((changes.comments || changes.resolved) && prefs.threads_updated)
}

/// Returns URLs of PRs whose state changed since last seen.
/// PRs not yet in `seen` are treated as new baselines -- no attention on first encounter.
/// Also flags recently merged PRs that were previously tracked (e.g. left the merge queue).
pub fn attention_urls(
    result: &FetchResult,
    seen: &HashMap<String, String>,
    settings: &Settings,
) -> Vec<String> {
    let mut urls: Vec<String> = result
        .open
        .iter()
        .chain(result.followed_open.iter())
        .filter(|pr| {
            let fp = attention_fingerprint(pr);
            if let Some(last_fp) = seen.get(&pr.url) {
                if last_fp != &fp {
                    let changes = compute_element_changes(pr, last_fp);
                    // Determine if owned or followed
                    let is_owned = result.open.iter().any(|p| p.url == pr.url);
                    let prefs = if is_owned {
                        &settings.notification_prefs_owned
                    } else {
                        &settings.notification_prefs_followed
                    };
                    should_notify_for_changes(&changes, prefs)
                } else {
                    false
                }
            } else {
                false
            }
        })
        .map(|pr| pr.url.clone())
        .collect();

    // Handle merged PRs (state change from open to merged)
    for pr in result
        .recently_merged
        .iter()
        .chain(result.followed_recently_merged.iter())
    {
        if seen.contains_key(&pr.url) {
            let prefs = &settings.notification_prefs_merged;
            if prefs.needs_review {
                urls.push(pr.url.clone());
            }
        }
    }

    // Handle closed PRs (state change from open to closed)
    for pr in result
        .recently_closed
        .iter()
        .chain(result.followed_recently_closed.iter())
    {
        if seen.contains_key(&pr.url) {
            let prefs = &settings.notification_prefs_closed;
            if prefs.needs_review {
                urls.push(pr.url.clone());
            }
        }
    }

    urls
}

pub fn generate_badge_icon(base: &Image<'_>) -> Image<'static> {
    // Check if we have a cached badge already
    if let Ok(cache) = BADGED_ICON_CACHE.lock() {
        if let Some(cached_pixels) = cache.as_ref() {
            let width = base.width();
            let height = base.height();
            return Image::new_owned(cached_pixels.clone(), width, height);
        }
    }

    let width = base.width();
    let height = base.height();
    let rgba = base.rgba();

    let mut pixels = rgba.to_vec();

    let badge_radius = (width.min(height) as f32 * 0.2) as i32;
    let cx = width as i32 - badge_radius - 1;
    let cy = badge_radius + 1;

    for y in 0..height as i32 {
        for x in 0..width as i32 {
            let dx = x - cx;
            let dy = y - cy;
            if dx * dx + dy * dy <= badge_radius * badge_radius {
                let idx = ((y as u32 * width + x as u32) * 4) as usize;
                pixels[idx] = 255; // R
                pixels[idx + 1] = 59; // G
                pixels[idx + 2] = 48; // B
                pixels[idx + 3] = 255; // A
            }
        }
    }

    // Cache the result
    if let Ok(mut cache) = BADGED_ICON_CACHE.lock() {
        *cache = Some(pixels.clone());
    }

    Image::new_owned(pixels, width, height)
}

pub fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .icon(load_tray_icon())
        .icon_as_template(true);

    if cfg!(debug_assertions) {
        builder = builder.title("DEV");
    }

    builder.on_tray_icon_event(|tray_handle, event| {
            tauri_plugin_positioner::on_tray_event(tray_handle.app_handle(), &event);

            if let tauri::tray::TrayIconEvent::Click {
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray_handle.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

pub fn toggle_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let _ = window.move_window(Position::TrayCenter);
            }));
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

pub fn update_tray_icon(app: &AppHandle, attention: bool) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if attention {
            let white = load_tray_icon_white();
            let badged = generate_badge_icon(&white);
            let _ = tray.set_icon_as_template(false);
            let _ = tray.set_icon(Some(badged));
        } else {
            let _ = tray.set_icon(Some(load_tray_icon()));
            let _ = tray.set_icon_as_template(true);
        }
    }
}
