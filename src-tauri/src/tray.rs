use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use tauri::{image::Image, tray::TrayIconBuilder, AppHandle, Manager};
use tauri_plugin_positioner::{Position, WindowExt};

use crate::github::{FetchResult, PrElementChanges, PullRequest};
use crate::types::{NotificationPreferences, Settings};

const TRAY_ID: &str = "main-tray";
const TRAY_ICON: &[u8] = include_bytes!("../icons/tray.png");

// Caches for the base and badged icons to avoid re-decoding the PNG on every update
static BASE_ICON_CACHE: Mutex<Option<(Vec<u8>, u32, u32)>> = Mutex::new(None);
static INVERTED_ICON_CACHE: Mutex<Option<(Vec<u8>, u32, u32)>> = Mutex::new(None);
static BADGED_ICON_CACHE: Mutex<Option<Vec<u8>>> = Mutex::new(None);

pub fn is_dark_mode() -> bool {
    std::process::Command::new("defaults")
        .args(["read", "-g", "AppleInterfaceStyle"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "Dark")
        .unwrap_or(false)
}

fn load_tray_icon() -> Image<'static> {
    if let Ok(cache) = BASE_ICON_CACHE.lock() {
        if let Some((pixels, w, h)) = cache.as_ref() {
            return Image::new_owned(pixels.clone(), *w, *h);
        }
    }
    let img = image::load_from_memory(TRAY_ICON).expect("failed to decode tray icon");
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let pixels = rgba.into_raw();
    if let Ok(mut cache) = BASE_ICON_CACHE.lock() {
        *cache = Some((pixels.clone(), w, h));
    }
    Image::new_owned(pixels, w, h)
}

fn load_tray_icon_inverted() -> Image<'static> {
    if let Ok(cache) = INVERTED_ICON_CACHE.lock() {
        if let Some((pixels, w, h)) = cache.as_ref() {
            return Image::new_owned(pixels.clone(), *w, *h);
        }
    }
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
    let pixels = rgba.into_raw();
    if let Ok(mut cache) = INVERTED_ICON_CACHE.lock() {
        *cache = Some((pixels.clone(), w, h));
    }
    Image::new_owned(pixels, w, h)
}

/// Captures the full PR state so we can detect actual changes between polls.
/// Format: review|checks|comments|unresolved|in_queue|last_commenter|oid|thread_comments|thread_comments_by_others|thread_comments_by_others_participated
pub fn attention_fingerprint(pr: &PullRequest, viewer_login: &str) -> String {
    let review = pr.review_decision.as_deref().unwrap_or("");
    let head = pr.commits.nodes.first();
    let checks = head
        .and_then(|n| n.commit.status_check_rollup.as_ref())
        .map(|r| r.state.as_str())
        .unwrap_or("");
    let oid = head.map(|n| n.commit.oid.as_str()).unwrap_or("");
    let unresolved = pr.review_threads.nodes.iter().filter(|t| !t.is_resolved).count();
    let thread_comments: i32 = pr.review_threads.nodes.iter().map(|t| t.comments.total_count).sum();
    let thread_comments_by_others: i32 = pr.review_threads.nodes.iter()
        .filter(|t| t.comments.nodes.last()
            .and_then(|c| c.author.as_ref())
            .map(|a| a.login != viewer_login)
            .unwrap_or(true))
        .map(|t| t.comments.total_count)
        .sum();
    // Sum comment counts only from threads where the viewer is the author (first commenter)
    // AND the last commenter is someone else (i.e. someone replied to viewer's thread).
    let thread_comments_by_others_participated: i32 = pr.review_threads.nodes.iter()
        .filter(|t| {
            let viewer_started = t.first_comment.as_ref()
                .and_then(|fc| fc.nodes.first())
                .and_then(|c| c.author.as_ref())
                .map(|a| a.login == viewer_login)
                .unwrap_or(false);
            let other_replied = t.comments.nodes.last()
                .and_then(|c| c.author.as_ref())
                .map(|a| a.login != viewer_login)
                .unwrap_or(true);
            viewer_started && other_replied
        })
        .map(|t| t.comments.total_count)
        .sum();
    let in_queue = pr.merge_queue_entry.is_some();
    let last_human_commenter = pr.comments.last_human_commenter().unwrap_or("");
    format!("{}|{}|{}|{}|{}|{}|{}|{}|{}|{}", review, checks, pr.comments.total_count, unresolved, in_queue, last_human_commenter, oid, thread_comments, thread_comments_by_others, thread_comments_by_others_participated)
}


/// Computes which individual elements changed on a PR by comparing against the old fingerprint.
pub fn compute_element_changes(pr: &PullRequest, old_fp: &str, viewer_login: &str) -> PrElementChanges {
    let parts: Vec<&str> = old_fp.split('|').collect();
    if parts.len() < 5 {
        return PrElementChanges::default();
    }
    let old_review = parts[0];
    let old_checks = parts[1];
    let old_comment_count = parts[2].parse::<i32>().unwrap_or(0);
    let old_in_queue = parts[4] == "true";
    let old_thread_comments_by_others = parts.get(8).and_then(|s| s.parse::<i32>().ok()).unwrap_or(0);

    let new_review = pr.review_decision.as_deref().unwrap_or("");
    let new_checks = pr
        .commits
        .nodes
        .first()
        .and_then(|n| n.commit.status_check_rollup.as_ref())
        .map(|r| r.state.as_str())
        .unwrap_or("");
    let new_in_queue = pr.merge_queue_entry.is_some();

    // Sum comment counts only from threads where the last commenter is NOT the viewer.
    let new_thread_comments_by_others: i32 = pr.review_threads.nodes.iter()
        .filter(|t| t.comments.nodes.last()
            .and_then(|c| c.author.as_ref())
            .map(|a| a.login != viewer_login)
            .unwrap_or(true))
        .map(|t| t.comments.total_count)
        .sum();
    let has_new_thread_comment_by_other = new_thread_comments_by_others > old_thread_comments_by_others;

    // Sum comment counts only from threads the viewer started AND someone else replied.
    let old_thread_comments_by_others_participated = parts.get(9).and_then(|s| s.parse::<i32>().ok()).unwrap_or(0);
    let new_thread_comments_by_others_participated: i32 = pr.review_threads.nodes.iter()
        .filter(|t| {
            let viewer_started = t.first_comment.as_ref()
                .and_then(|fc| fc.nodes.first())
                .and_then(|c| c.author.as_ref())
                .map(|a| a.login == viewer_login)
                .unwrap_or(false);
            let other_replied = t.comments.nodes.last()
                .and_then(|c| c.author.as_ref())
                .map(|a| a.login != viewer_login)
                .unwrap_or(true);
            viewer_started && other_replied
        })
        .map(|t| t.comments.total_count)
        .sum();
    let has_new_comment_participated = new_thread_comments_by_others_participated > old_thread_comments_by_others_participated;

    // Only notify when new non-bot comments exist and the last human commenter is not the viewer.
    // total_count is already bot-free (adjusted at fetch time), so no bot check needed here.
    let last_human_commenter = pr.comments.last_human_commenter().unwrap_or("");
    let has_new_comment = pr.comments.total_count > old_comment_count
        && last_human_commenter != viewer_login;

    PrElementChanges {
        became_review_required: old_review != "REVIEW_REQUIRED" && new_review == "REVIEW_REQUIRED",
        became_changes_requested: old_review != "CHANGES_REQUESTED" && new_review == "CHANGES_REQUESTED",
        became_approved: old_review != "APPROVED" && new_review == "APPROVED",
        checks_failed: !matches!(old_checks, "FAILURE" | "ERROR") && matches!(new_checks, "FAILURE" | "ERROR"),
        checks_recovered: old_checks != "SUCCESS" && new_checks == "SUCCESS",
        kicked_from_queue: old_in_queue && !new_in_queue,
        new_comment: has_new_comment || has_new_thread_comment_by_other,
        new_comment_participated: has_new_comment_participated,
    }
}

/// Check if element changes match the notification preferences.
fn should_notify_for_changes(
    changes: &PrElementChanges,
    prefs: &NotificationPreferences,
) -> bool {
    (changes.became_review_required && prefs.review_required)
        || (changes.became_changes_requested && prefs.changes_requested)
        || (changes.became_approved && prefs.approved)
        || (changes.checks_failed && prefs.checks_failed)
        || (changes.checks_recovered && prefs.checks_recovered)
        || (changes.kicked_from_queue && prefs.kicked_from_queue)
        || (changes.new_comment && prefs.new_comment)
        || (changes.new_comment_participated && prefs.new_comment_participated)
}

/// Returns URLs of PRs whose state changed since last seen.
/// PRs not yet in `seen` are treated as new baselines -- no attention on first encounter.
/// Also flags recently merged PRs that were previously tracked (e.g. left the merge queue).
pub fn attention_urls(
    result: &FetchResult,
    seen: &HashMap<String, String>,
    settings: &Settings,
    viewer_login: &str,
) -> Vec<String> {
    let owned_urls: HashSet<&str> = result.open.iter().map(|p| p.url.as_str()).collect();

    let mut urls: Vec<String> = result
        .open
        .iter()
        .chain(result.followed_open.iter())
        .filter(|pr| {
            let fp = attention_fingerprint(pr, viewer_login);
            if let Some(last_fp) = seen.get(&pr.url) {
                if last_fp != &fp {
                    let changes = compute_element_changes(pr, last_fp, viewer_login);
                    let is_owned = owned_urls.contains(pr.url.as_str());
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
        if seen.contains_key(&pr.url) && settings.notify_on_merged {
            urls.push(pr.url.clone());
        }
    }

    // Handle closed PRs (state change from open to closed)
    for pr in result
        .recently_closed
        .iter()
        .chain(result.followed_recently_closed.iter())
    {
        if seen.contains_key(&pr.url) && settings.notify_on_closed {
            urls.push(pr.url.clone());
        }
    }

    urls
}

/// Pure computation: given a fetch result and seen state, compute attention URLs
/// and element changes, then update the seen fingerprints for the next poll cycle.
///
/// This function is free of Tauri/AppHandle dependencies and can be tested in isolation.
pub fn process_attention(
    result: &FetchResult,
    seen: &mut HashMap<String, String>,
    settings: &Settings,
    viewer_login: &str,
) -> (Vec<String>, HashMap<String, PrElementChanges>) {
    let attention = attention_urls(result, seen, settings, viewer_login);

    let all_prs: Vec<&PullRequest> = result
        .open
        .iter()
        .chain(result.followed_open.iter())
        .collect();

    let element_changes: HashMap<String, PrElementChanges> = attention
        .iter()
        .filter_map(|url| {
            let old_fp = seen.get(url)?;
            let pr = all_prs.iter().find(|p| &p.url == url)?;
            Some((url.clone(), compute_element_changes(pr, old_fp, viewer_login)))
        })
        .collect();

    // Update fingerprints for non-attention PRs so we track intermediate states
    // (e.g. PENDING) for future change detection. Attention PRs keep their old
    // fingerprint until dismissed.
    let attention_set: HashSet<&str> = attention.iter().map(|s| s.as_str()).collect();
    for pr in result.open.iter().chain(result.followed_open.iter()) {
        if !attention_set.contains(pr.url.as_str()) {
            seen.insert(pr.url.clone(), attention_fingerprint(pr, viewer_login));
        }
    }

    // Remove merged/closed PRs from seen
    for pr in result
        .recently_merged
        .iter()
        .chain(result.followed_recently_merged.iter())
        .chain(result.recently_closed.iter())
        .chain(result.followed_recently_closed.iter())
    {
        seen.remove(&pr.url);
    }

    // Remove stale entries for PRs that are no longer open (hidden, org-hidden,
    // unfollowed users, etc.) to prevent seen_prs from growing unboundedly.
    let current_open_urls: HashSet<&str> = result
        .open
        .iter()
        .chain(result.followed_open.iter())
        .map(|p| p.url.as_str())
        .collect();
    seen.retain(|url, _| current_open_urls.contains(url.as_str()));

    (attention, element_changes)
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
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                tauri_plugin_positioner::on_tray_event(tray_handle.app_handle(), &event);
            }));

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
            // Dismiss any notification banner when opening the popup
            if let Some(notify) = app.get_webview_window("notify") {
                let _ = notify.destroy();
            }
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let _ = window.move_window(Position::TrayCenter);
            }));
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

#[cfg(test)]
#[path = "tray_tests.rs"]
mod tray_tests;

pub fn update_tray_icon(app: &AppHandle, attention: bool) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if attention {
            // Clear badge cache to regenerate with current appearance (dark/light mode)
            if let Ok(mut cache) = BADGED_ICON_CACHE.lock() {
                *cache = None;
            }
            let base = if is_dark_mode() {
                load_tray_icon_inverted()
            } else {
                load_tray_icon()
            };
            let badged = generate_badge_icon(&base);
            let _ = tray.set_icon_as_template(false);
            let _ = tray.set_icon(Some(badged));
        } else {
            let _ = tray.set_icon(Some(load_tray_icon()));
            let _ = tray.set_icon_as_template(true);
        }
    }
}
