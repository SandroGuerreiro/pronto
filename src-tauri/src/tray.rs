use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use tauri::{image::Image, tray::TrayIconBuilder, AppHandle, Manager};
use tauri_plugin_positioner::{Position, WindowExt};

use crate::github::{FetchResult, PrElementChanges, PullRequest, ReviewThread};
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

/// Sum comment counts from threads where the last commenter is NOT the viewer.
fn thread_comments_by_others(threads: &[ReviewThread], viewer_login: &str) -> i32 {
    threads.iter()
        .filter(|t| t.comments.nodes.last()
            .and_then(|c| c.author.as_ref())
            .map(|a| a.login != viewer_login)
            .unwrap_or(true))
        .map(|t| t.comments.total_count)
        .sum()
}

/// Sum comment counts from threads the viewer started AND someone else replied to.
fn thread_comments_by_others_participated(threads: &[ReviewThread], viewer_login: &str) -> i32 {
    threads.iter()
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
        .sum()
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
    let by_others = thread_comments_by_others(&pr.review_threads.nodes, viewer_login);
    let by_others_participated = thread_comments_by_others_participated(&pr.review_threads.nodes, viewer_login);
    let in_queue = pr.merge_queue_entry.is_some();
    let last_human_commenter = pr.comments.last_human_commenter().unwrap_or("");
    format!("{}|{}|{}|{}|{}|{}|{}|{}|{}|{}", review, checks, pr.comments.total_count, unresolved, in_queue, last_human_commenter, oid, thread_comments, by_others, by_others_participated)
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

    let new_by_others = thread_comments_by_others(&pr.review_threads.nodes, viewer_login);
    let has_new_thread_comment_by_other = new_by_others > old_thread_comments_by_others;

    let old_by_others_participated = parts.get(9).and_then(|s| s.parse::<i32>().ok()).unwrap_or(0);
    let new_by_others_participated = thread_comments_by_others_participated(&pr.review_threads.nodes, viewer_login);
    let has_new_comment_participated = new_by_others_participated > old_by_others_participated;

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
                toggle_window(tray_handle.app_handle(), ToggleSource::TrayClick);
            }
        })
        .build(app)?;

    Ok(())
}

/// Where the toggle was triggered from — determines positioning strategy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToggleSource {
    /// User clicked the tray icon — position near the tray icon.
    TrayClick,
    /// Global keyboard shortcut — position based on `popup_screen` setting.
    GlobalShortcut,
}

pub fn toggle_window(app: &AppHandle, source: ToggleSource) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }

    // Dismiss any notification banner when opening the popup.
    if let Some(notify) = app.get_webview_window("notify") {
        let _ = notify.destroy();
    }

    // Clear workflow attention badge when opening the popup.
    if let Some(state) = app.try_state::<crate::AppState>() {
        let has_workflow = state.last_workflow_status.lock().unwrap().is_some();
        if has_workflow {
            let has_pr_attention = state
                .cached_prs
                .lock()
                .unwrap()
                .as_ref()
                .map(|r| !r.attention_urls.is_empty())
                .unwrap_or(false);
            crate::set_tray_attention(app, has_pr_attention);
        }
    }

    match source {
        ToggleSource::TrayClick => {
            let _ = window.show();
            // on_tray_event (called before toggle_window) already cached the
            // tray icon position in the positioner plugin.
            let old_hook = std::panic::take_hook();
            std::panic::set_hook(Box::new(|_| {}));
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let _ = window.move_window(Position::TrayCenter);
            }));
            std::panic::set_hook(old_hook);
        }
        ToggleSource::GlobalShortcut => {
            // Pre-position the hidden window via native AppKit (setFrame:display:)
            // so that show() renders at the correct location with no flash.
            // The primary-screen path also needs move_window after show() for
            // fine-tuning, but the pre-position prevents a visible jump.
            position_for_shortcut(app, &window);
            let _ = window.show();
        }
    }

    // Make the panel the key window for keyboard input.
    #[cfg(target_os = "macos")]
    if let Ok(ptr) = window.ns_window() {
        use objc2_app_kit::NSPanel;
        let panel: &NSPanel = unsafe { &*ptr.cast::<NSPanel>() };
        panel.makeKeyWindow();
        // For tray clicks, also activate the app — the NonactivatingPanel
        // style keeps routing keyboard events to the previously active app.
        if source == ToggleSource::TrayClick {
            use objc2::MainThreadMarker;
            use objc2_app_kit::NSApplication;
            if let Some(mtm) = MainThreadMarker::new() {
                #[allow(deprecated)]
                NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window.set_focus();
}

// ── Shortcut positioning ──────────────────────────────────────────────────

/// Position the popup for a global shortcut based on the `popup_screen` setting.
fn position_for_shortcut(app: &AppHandle, window: &tauri::WebviewWindow) {
    let popup_screen = {
        let state = app.state::<crate::AppState>();
        let settings = state.settings.lock().unwrap();
        settings.popup_screen.clone()
    };
    #[cfg(target_os = "macos")]
    position_on_screen(app, window, &popup_screen);

    #[cfg(not(target_os = "macos"))]
    {
        let _ = popup_screen;
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = window.move_window(Position::TrayCenter);
        }));
    }
}

/// Position the popup below the tray icon on the correct screen.
///
/// - `"primary"` → always below the tray icon on the primary display.
/// - `"active"`  → below the tray icon on whichever screen the cursor is on.
///
/// ## Positioning strategy
///
/// On macOS, each screen mirrors the tray icons in its own menu bar.
/// We read our tray icon's NSStatusBarWindow frame directly from AppKit
/// (Tauri's `tray.rect()` is unreliable on multi-monitor setups).
///
/// **Primary screen**: inject the tray position into the positioner plugin's
/// state, then call `move_window(TrayBottomCenter)` — the proven code path.
///
/// **Secondary screens**: Tauri's `set_position` can't move windows across
/// monitors, so we use native `NSWindow.setFrame:display:` with coordinates
/// computed from the tray icon's AppKit frame.
#[cfg(target_os = "macos")]
fn position_on_screen(app: &AppHandle, window: &tauri::WebviewWindow, mode: &str) {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSScreen;

    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let screens = NSScreen::screens(mtm);
    if screens.is_empty() {
        return;
    }

    let primary = screens.objectAtIndex(0);
    let target_screen_idx = if mode == "active" {
        find_cursor_screen(&screens)
    } else {
        0
    };
    let target_screen = screens.objectAtIndex(target_screen_idx);

    let Some(tray_frame) = read_tray_frame_on_screen(mtm, &target_screen) else {
        return;
    };

    if target_screen_idx == 0 {
        position_on_primary(app, window, &primary, tray_frame);
    } else {
        position_on_secondary(app, window, &primary, tray_frame);
    }
}

/// Find which screen the mouse cursor is on. Returns the screen index.
#[cfg(target_os = "macos")]
fn find_cursor_screen(
    screens: &objc2::rc::Retained<objc2_foundation::NSArray<objc2_app_kit::NSScreen>>,
) -> usize {
    use objc2_app_kit::NSEvent;
    let mouse = NSEvent::mouseLocation();
    for i in 0..screens.len() {
        let f = screens.objectAtIndex(i).frame();
        if mouse.x >= f.origin.x
            && mouse.x < f.origin.x + f.size.width
            && mouse.y >= f.origin.y
            && mouse.y < f.origin.y + f.size.height
        {
            return i;
        }
    }
    0
}

/// Position the popup below the tray icon on the primary screen.
///
/// Uses native `NSWindow.setFrame:display:` to place the window directly
/// below the tray icon.  This works on hidden windows, so the popup
/// appears at the correct position when `show()` is called afterward.
#[cfg(target_os = "macos")]
fn position_on_primary(
    _app: &AppHandle,
    window: &tauri::WebviewWindow,
    _primary: &objc2_app_kit::NSScreen,
    tray_frame: (f64, f64, f64, f64),
) {
    set_frame_below_tray(window, tray_frame);
}

/// Position the popup below the tray icon on a secondary screen.
///
/// After positioning, restores the real primary-screen tray position in the
/// positioner plugin's state so subsequent tray clicks still work correctly.
#[cfg(target_os = "macos")]
fn position_on_secondary(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    primary: &objc2_app_kit::NSScreen,
    tray_frame: (f64, f64, f64, f64),
) {
    set_frame_below_tray(window, tray_frame);
    restore_primary_tray_position(app, primary);
}

/// Place the popup window centered below the tray icon using native AppKit.
///
/// Uses `NSWindow.setFrame:display:` which works on both hidden and visible
/// windows, on any screen.  `tray_frame` is `(x, y, w, h)` in AppKit logical
/// points (bottom-left origin) from the tray icon's NSStatusBarWindow.
#[cfg(target_os = "macos")]
fn set_frame_below_tray(window: &tauri::WebviewWindow, tray_frame: (f64, f64, f64, f64)) {
    let (tray_x, tray_y, tray_w, _) = tray_frame;
    let win_w = 480.0_f64;
    let win_h = 520.0_f64;

    let popup_x = tray_x + tray_w / 2.0 - win_w / 2.0;
    // In AppKit coords, tray_y is the bottom of the tray window.
    // The popup's top should be at tray_y (just below the tray icon),
    // so its origin (bottom-left) is at tray_y - win_h.
    let popup_y_origin = tray_y - win_h;

    let Ok(ptr) = window.ns_window() else { return };
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    unsafe {
        let ns_win: &objc2_app_kit::NSWindow = &*ptr.cast();
        let frame = CGRect::new(
            CGPoint::new(popup_x, popup_y_origin),
            CGSize::new(win_w, win_h),
        );
        ns_win.setFrame_display(frame, true);
    }
}

/// Restore the positioner plugin's tray state to the real primary-screen
/// tray icon position, so that tray clicks position the popup correctly.
#[cfg(target_os = "macos")]
fn restore_primary_tray_position(app: &AppHandle, primary: &objc2_app_kit::NSScreen) {
    let Some(mtm) = objc2::MainThreadMarker::new() else {
        return;
    };
    let Some(tray_frame) = read_tray_frame_on_screen(mtm, primary) else {
        return;
    };
    let primary_height = primary.frame().size.height;
    let primary_scale = primary.backingScaleFactor() as f64;
    let (px, py, pw, ph) = appkit_to_tauri_phys(tray_frame, primary_height, primary_scale);
    inject_tray_position(app, px, py, pw, ph);
}

// ── Coordinate helpers ────────────────────────────────────────────────────

/// Convert an AppKit frame (logical points, bottom-left origin) to Tauri
/// physical coordinates (pixels, top-left origin).
#[cfg(target_os = "macos")]
fn appkit_to_tauri_phys(
    frame: (f64, f64, f64, f64),
    primary_height: f64,
    scale: f64,
) -> (f64, f64, f64, f64) {
    let (ax, ay, aw, ah) = frame;
    // AppKit y is the bottom edge.  Top edge = ay + ah.
    // Tauri y (top-left, y-down) = primary_height - top_edge.
    (
        ax * scale,
        (primary_height - (ay + ah)) * scale,
        aw * scale,
        ah * scale,
    )
}

/// Inject a synthetic tray icon position into the positioner plugin's state.
/// The next `move_window(TrayBottomCenter)` will use these coordinates.
fn inject_tray_position(app: &AppHandle, x: f64, y: f64, w: f64, h: f64) {
    use tauri::tray::TrayIconEvent;
    use tauri::{PhysicalPosition, PhysicalSize, Rect};

    let event = TrayIconEvent::Move {
        id: tauri::tray::TrayIconId::new(TRAY_ID),
        position: PhysicalPosition::new(x, y),
        rect: Rect {
            position: tauri::Position::Physical(PhysicalPosition::new(
                x.round() as i32,
                y.round() as i32,
            )),
            size: tauri::Size::Physical(PhysicalSize::new(
                w.round().max(0.0) as u32,
                h.round().max(0.0) as u32,
            )),
        },
    };
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        tauri_plugin_positioner::on_tray_event(app, &event);
    }));
}

// ── AppKit tray icon detection ────────────────────────────────────────────

/// Read the tray icon's NSStatusBarWindow frame on a specific screen.
///
/// On modern macOS each screen mirrors the tray icons in its own menu bar.
/// We find our icon's window by matching the `NSStatusBarWindow` class and
/// checking which screen it's on.
///
/// Returns `(x, y, width, height)` in AppKit logical points (bottom-left origin).
#[cfg(target_os = "macos")]
fn read_tray_frame_on_screen(
    mtm: objc2::MainThreadMarker,
    screen: &objc2_app_kit::NSScreen,
) -> Option<(f64, f64, f64, f64)> {
    use objc2_app_kit::NSApplication;
    use objc2_foundation::NSObjectProtocol;

    let nsapp = NSApplication::sharedApplication(mtm);
    let windows = nsapp.windows();
    let screen_frame = screen.frame();
    let status_bar_class = objc2::runtime::AnyClass::get(c"NSStatusBarWindow")?;

    for i in 0..windows.len() {
        let win = windows.objectAtIndex(i);
        if !win.isKindOfClass(status_bar_class) {
            continue;
        }
        let f = win.frame();
        let win_center_x = f.origin.x + f.size.width / 2.0;
        let on_screen = win_center_x >= screen_frame.origin.x
            && win_center_x < screen_frame.origin.x + screen_frame.size.width;
        if on_screen {
            return Some((f.origin.x, f.origin.y, f.size.width, f.size.height));
        }
    }
    None
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
