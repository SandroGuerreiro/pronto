use std::collections::HashMap;

use tauri::{image::Image, tray::TrayIconBuilder, AppHandle, Manager};
use tauri_plugin_positioner::{Position, WindowExt};

use crate::github::{FetchResult, PullRequest};

const TRAY_ID: &str = "main-tray";

fn pr_needs_attention(pr: &PullRequest) -> bool {
    match pr.review_decision.as_deref() {
        Some("REVIEW_REQUIRED") | Some("CHANGES_REQUESTED") | Some("APPROVED") => return true,
        _ => {}
    }

    let checks_state = pr
        .commits
        .nodes
        .first()
        .and_then(|n| n.commit.status_check_rollup.as_ref())
        .map(|r| r.state.as_str());

    matches!(checks_state, Some("FAILURE") | Some("ERROR"))
}

/// Captures the PR state that causes attention so we can detect actual changes.
pub fn attention_fingerprint(pr: &PullRequest) -> String {
    let review = pr.review_decision.as_deref().unwrap_or("");
    let checks = pr
        .commits
        .nodes
        .first()
        .and_then(|n| n.commit.status_check_rollup.as_ref())
        .map(|r| r.state.as_str())
        .unwrap_or("");
    format!(
        "{}|{}|{}|{}",
        review, checks, pr.comments.total_count, pr.reviews.total_count
    )
}

/// Returns URLs of open PRs that need attention.
/// - PR seen before: attention if fingerprint changed (any state change).
/// - PR never seen: attention only if in a "bad" state (review needed, checks failed).
pub fn attention_urls(result: &FetchResult, seen: &HashMap<String, String>) -> Vec<String> {
    result
        .open
        .iter()
        .filter(|pr| {
            let fp = attention_fingerprint(pr);
            match seen.get(&pr.url) {
                Some(last_fp) => last_fp != &fp,
                None => pr_needs_attention(pr),
            }
        })
        .map(|pr| pr.url.clone())
        .collect()
}

pub fn generate_badge_icon(base: &Image<'_>) -> Image<'static> {
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

    Image::new_owned(pixels, width, height)
}

pub fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(app.default_window_icon().unwrap().clone())
        .on_tray_icon_event(|tray_handle, event| {
            tauri_plugin_positioner::on_tray_event(tray_handle.app_handle(), &event);

            if let tauri::tray::TrayIconEvent::Click {
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray_handle.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.move_window(Position::TrayCenter);
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}

pub fn update_tray_icon(app: &AppHandle, attention: bool) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let base = app.default_window_icon().unwrap().clone();
        if attention {
            let badged = generate_badge_icon(&base);
            let _ = tray.set_icon(Some(badged));
        } else {
            let _ = tray.set_icon(Some(base));
        }
    }
}
