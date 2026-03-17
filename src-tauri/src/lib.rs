pub mod auth;
pub mod github;
pub mod homebrew;
#[cfg(target_os = "macos")]
pub mod macos_notify;
pub mod notification;
pub mod tray;
pub mod types;

pub use types::*;

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

// Module-level functions for ProntoPanel ObjC class overrides.
// Defined here (not inside a block) so Rust gives them higher-ranked
// lifetime bounds required by objc2's MethodImplementation trait.
#[cfg(target_os = "macos")]
extern "C-unwind" fn pronto_panel_can_become_key(
    _this: &objc2::runtime::AnyObject,
    _sel: objc2::runtime::Sel,
) -> objc2::runtime::Bool {
    objc2::runtime::Bool::YES
}


fn load_settings(path: &PathBuf) -> Settings {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_settings(path: &PathBuf, settings: &Settings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

fn settings_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("no app data dir")
        .join("settings.json")
}

pub struct AppState {
    pub cached_prs: Mutex<Option<github::FetchResult>>,
    pub seen_prs: Mutex<HashMap<String, String>>,
    pub cached_token: Mutex<Option<String>>,
    pub settings: Mutex<Settings>,
    pub last_workflow_status: Mutex<Option<github::WorkflowStatus>>,
    pub notified_prs: Mutex<HashSet<String>>,
    pub http_client: reqwest::Client,
    pub last_tray_attention: Mutex<Option<bool>>,
    pub viewer_login: Mutex<String>,
    pub viewer_avatar_url: Mutex<String>,
    pub pending_notifications: Mutex<Vec<NotifyData>>,
    pub notify_close_tx: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
    pub last_brew_status: Mutex<Option<homebrew::HomebrewStatus>>,
    pub last_notified_brew_update: Mutex<bool>,
    pub cached_releases: Mutex<Option<Vec<github::Release>>>,
}

fn get_token(state: &AppState) -> Result<String, String> {
    let cache = state.cached_token.lock().unwrap();
    if let Some(ref token) = *cache {
        return Ok(token.clone());
    }
    drop(cache);

    match auth::load_token() {
        Some(token) => {
            let mut cache = state.cached_token.lock().unwrap();
            *cache = Some(token.clone());
            Ok(token)
        }
        None => Err("not_authenticated".to_string()),
    }
}

fn send_attention_notification(
    app: &tauri::AppHandle,
    result: &github::FetchResult,
    send_native: bool,
) {
    let already_notified = app.try_state::<AppState>()
        .map(|state| state.notified_prs.lock().unwrap().clone())
        .unwrap_or_default();

    let info = match notification::build_attention_notification(result, &already_notified) {
        Some(info) => info,
        None => return,
    };

    // Mark these PRs as notified
    if let Some(state) = app.try_state::<AppState>() {
        let mut notified = state.notified_prs.lock().unwrap();
        for pr in result.open.iter().chain(result.recently_merged.iter()) {
            if result.attention_urls.contains(&pr.url) {
                notified.insert(pr.url.clone());
            }
        }
    }

    // Always show popup notification
    show_tray_notification(app, "attention", &info.title, &info.body);

    // Only send macOS native notification if enabled
    if send_native {
        macos_notify::send(&info);
    }
}

pub(crate) fn set_tray_attention(app: &tauri::AppHandle, attention: bool) {
    if let Some(state) = app.try_state::<AppState>() {
        let mut last = state.last_tray_attention.lock().unwrap();
        // When not in attention mode, skip if nothing changed.
        // When in attention mode, always update to pick up dark/light mode changes.
        if !attention && *last == Some(false) {
            return;
        }
        *last = Some(attention);
    }
    tray::update_tray_icon(app, attention);
}

fn process_result(
    app: &tauri::AppHandle,
    mut result: github::FetchResult,
    notify: bool,
) -> (github::FetchResult, bool) {
    let mut changed = true;
    if let Some(state) = app.try_state::<AppState>() {
        let (prev_attention, prev_open_len) = {
            let cache = state.cached_prs.lock().unwrap();
            let prev = cache.as_ref();
            (
                prev.map(|r| r.attention_urls.clone()).unwrap_or_default(),
                prev.map(|r| r.open.len()).unwrap_or(0),
            )
        };

        {
            let mut seen = state.seen_prs.lock().unwrap();
            let settings = state.settings.lock().unwrap().clone();

            if !result.viewer_login.is_empty() {
                *state.viewer_login.lock().unwrap() = result.viewer_login.clone();
            }
            if !result.viewer_avatar_url.is_empty() {
                *state.viewer_avatar_url.lock().unwrap() = result.viewer_avatar_url.clone();
            }
            let viewer_login = state.viewer_login.lock().unwrap().clone();

            let (attention, element_changes) = tray::process_attention(
                &result,
                &mut seen,
                &settings,
                &viewer_login,
            );
            result.attention_urls = attention;
            result.element_changes = element_changes;
        }

        // Drop entries from notified_prs that are no longer in attention so they
        // can trigger a fresh notification if they re-enter attention later.
        {
            let attention_set: HashSet<&str> =
                result.attention_urls.iter().map(|s| s.as_str()).collect();
            state
                .notified_prs
                .lock()
                .unwrap()
                .retain(|url| attention_set.contains(url.as_str()));
        }

        // Always show popup notifications; only send macOS native if enabled
        send_attention_notification(app, &result, notify);

        changed = result.attention_urls != prev_attention || result.open.len() != prev_open_len;
        set_tray_attention(app, !result.attention_urls.is_empty());

        let mut cache = state.cached_prs.lock().unwrap();
        *cache = Some(result.clone());
    }
    (result, changed)
}

#[tauri::command]
async fn check_auth(app: tauri::AppHandle) -> Result<bool, String> {
    let state = app.state::<AppState>();
    Ok(get_token(&state).is_ok())
}

#[tauri::command]
fn get_app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
fn check_version_update(app: tauri::AppHandle) -> bool {
    let current = app.package_info().version.to_string();
    let path = settings_path(&app);
    let mut settings = load_settings(&path);
    match &settings.last_seen_version {
        Some(v) if v == &current => false,
        None => {
            // First install — save version, no cue
            settings.last_seen_version = Some(current);
            let _ = save_settings(&path, &settings);
            false
        }
        Some(_) => {
            // Version changed — update and signal new
            settings.last_seen_version = Some(current);
            let _ = save_settings(&path, &settings);
            true
        }
    }
}

#[tauri::command]
fn fetch_releases(app: tauri::AppHandle) -> Vec<github::Release> {
    let state = app.state::<AppState>();
    let cache = state.cached_releases.lock().unwrap();
    cache.clone().unwrap_or_default()
}

#[tauri::command]
async fn start_login() -> Result<auth::DeviceCodeResponse, String> {
    auth::start_device_flow().await
}

#[tauri::command]
async fn poll_login(app: tauri::AppHandle, device_code: String) -> Result<bool, String> {
    match auth::poll_for_token(&device_code).await? {
        Some(token) => {
            auth::save_token(&token)?;
            let state = app.state::<AppState>();
            let mut cache = state.cached_token.lock().unwrap();
            *cache = Some(token);
            Ok(true)
        }
        None => Ok(false),
    }
}

#[tauri::command]
async fn login_with_pat(app: tauri::AppHandle, token: String) -> Result<(), String> {
    auth::validate_token(&token).await?;
    auth::save_token(&token)?;
    let state = app.state::<AppState>();
    let mut cache = state.cached_token.lock().unwrap();
    *cache = Some(token);
    Ok(())
}

#[tauri::command]
async fn logout(app: tauri::AppHandle) -> Result<(), String> {
    auth::delete_token()?;
    let state = app.state::<AppState>();
    let mut cache = state.cached_token.lock().unwrap();
    *cache = None;
    Ok(())
}

#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> Settings {
    let state = app.state::<AppState>();
    let s = state.settings.lock().unwrap().clone();
    s
}

#[tauri::command]
fn update_settings(app: tauri::AppHandle, settings: Settings) -> Result<(), String> {
    let state = app.state::<AppState>();
    save_settings(&settings_path(&app), &settings)?;

    let toggle = settings.global_toggle_shortcut.clone();
    let reload = settings.global_reload_shortcut.clone();
    let follow = settings.global_follow_shortcut.clone();

    *state.settings.lock().unwrap() = settings;

    if let Err(e) = update_global_shortcuts(app.clone(), toggle, reload, follow) {
        eprintln!("[pronto] Failed to update global shortcuts: {}", e);
    }

    Ok(())
}

/// Snapshot of settings needed for a fetch + process cycle.
struct FetchSettings {
    notify: bool,
    merged_hours: u64,
    show_merged: bool,
    closed_hours: u64,
    show_closed: bool,
    hidden_orgs: Vec<String>,
    hidden_repos: Vec<String>,
    hidden_prs: Vec<HiddenPr>,
    followed_users: Vec<String>,
    followed_prs: Vec<String>,
    workflow_settings: Settings,
}

fn snapshot_fetch_settings(settings: &Settings) -> FetchSettings {
    FetchSettings {
        notify: settings.notifications_enabled,
        merged_hours: settings.merged_window_hours,
        show_merged: settings.show_recently_merged,
        closed_hours: settings.closed_window_hours,
        show_closed: settings.show_closed,
        hidden_orgs: settings.hidden_orgs.clone(),
        hidden_repos: settings.hidden_repos.clone(),
        hidden_prs: settings.hidden_prs.clone(),
        followed_users: settings.followed_users.clone(),
        followed_prs: settings.followed_prs.clone(),
        workflow_settings: Settings {
            workflow_monitor_enabled: settings.workflow_monitor_enabled,
            workflow_org: settings.workflow_org.clone(),
            workflow_repo: settings.workflow_repo.clone(),
            workflow_name: settings.workflow_name.clone(),
            ..Default::default()
        },
    }
}

/// Remove expired followed PRs from settings and persist to disk.
fn cleanup_expired_followed_prs(
    state: &AppState,
    app: &tauri::AppHandle,
    expired: &[String],
) {
    if expired.is_empty() {
        return;
    }
    let mut settings = state.settings.lock().unwrap();
    settings.followed_prs.retain(|url| !expired.contains(url));
    let settings_to_save = settings.clone();
    drop(settings);
    let _ = save_settings(&settings_path(app), &settings_to_save);
}

fn filter_hidden_prs(
    mut result: github::FetchResult,
    hidden_prs: &[HiddenPr],
) -> github::FetchResult {
    if !hidden_prs.is_empty() {
        let hidden_urls: std::collections::HashSet<&str> =
            hidden_prs.iter().map(|h| h.url.as_str()).collect();
        result
            .open
            .retain(|pr| !hidden_urls.contains(pr.url.as_str()));
        result
            .recently_merged
            .retain(|pr| !hidden_urls.contains(pr.url.as_str()));
        result
            .recently_closed
            .retain(|pr| !hidden_urls.contains(pr.url.as_str()));
        result
            .followed_open
            .retain(|pr| !hidden_urls.contains(pr.url.as_str()));
        result
            .followed_recently_merged
            .retain(|pr| !hidden_urls.contains(pr.url.as_str()));
        result
            .followed_recently_closed
            .retain(|pr| !hidden_urls.contains(pr.url.as_str()));
    }
    result
}

#[tauri::command]
async fn fetch_all_prs(app: tauri::AppHandle) -> Result<github::FetchResult, String> {
    let state = app.state::<AppState>();
    let token = get_token(&state)?;
    let fs = {
        let s = state.settings.lock().unwrap();
        snapshot_fetch_settings(&s)
    };
    let mut result = github::fetch_all_prs(
        &state.http_client,
        &token,
        fs.merged_hours,
        fs.show_merged,
        fs.closed_hours,
        fs.show_closed,
        &fs.hidden_orgs,
        &fs.hidden_repos,
        &fs.followed_users,
        &fs.followed_prs,
    )
    .await
    .map_err(|e| e.to_string())?;

    cleanup_expired_followed_prs(&state, &app, &result.expired_followed_prs);
    result = filter_hidden_prs(result, &fs.hidden_prs);

    if let Some(wf) = fetch_workflow_if_enabled(&state.http_client, &token, &fs.workflow_settings).await {
        check_workflow_attention(&app, &wf, false);
        result.workflow_status = Some(wf);
    }

    Ok(process_result(&app, result, false).0)
}

#[tauri::command]
fn dismiss_pr(app: tauri::AppHandle, url: String) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };

    let (is_open, fingerprint, result_clone, viewer_login) = {
        let cache = state.cached_prs.lock().unwrap();
        let Some(result) = cache.as_ref() else { return };
        let is_open = result
            .open
            .iter()
            .chain(result.followed_open.iter())
            .any(|p| p.url == url);
        let pr_opt = result
            .open
            .iter()
            .chain(result.followed_open.iter())
            .chain(result.recently_merged.iter())
            .chain(result.followed_recently_merged.iter())
            .chain(result.recently_closed.iter())
            .chain(result.followed_recently_closed.iter())
            .find(|p| p.url == url);
        let Some(pr) = pr_opt else { return };
        let viewer_login = state.viewer_login.lock().unwrap().clone();
        (is_open, tray::attention_fingerprint(pr, &viewer_login), result.clone(), viewer_login)
    };

    {
        let mut seen = state.seen_prs.lock().unwrap();
        if is_open {
            // For open PRs: update fingerprint so the current state is no longer "new"
            seen.insert(url.clone(), fingerprint);
        } else {
            // For merged/closed PRs: remove from seen so contains_key() returns false
            seen.remove(&url);
        }
        let settings = state.settings.lock().unwrap().clone();
        let has_attention = !tray::attention_urls(&result_clone, &seen, &settings, &viewer_login).is_empty();
        drop(seen);
        set_tray_attention(&app, has_attention);
    }

    {
        let mut notified = state.notified_prs.lock().unwrap();
        notified.remove(&url);
    }
}

fn check_workflow_attention(
    app: &tauri::AppHandle,
    new_status: &github::WorkflowStatus,
    notify: bool,
) -> bool {
    let Some(state) = app.try_state::<AppState>() else {
        return false;
    };
    let mut last = state.last_workflow_status.lock().unwrap();

    // If workflow is in_progress, don't notify and don't update last status
    // This allows us to detect conclusion changes even if in_progress occurs in between
    if new_status.conclusion == "unknown" {
        return false;
    }

    let changed = match last.as_ref() {
        Some(prev) => {
            // Only notify if the actual conclusion changed (not in_progress)
            // e.g., failure -> success or success -> failure
            prev.conclusion != new_status.conclusion && prev.conclusion != "unknown"
        }
        None => false,
    };

    if changed {
        let info = notification::build_workflow_notification(
            &new_status.repo,
            &new_status.workflow_name,
            &new_status.conclusion,
            Some(&new_status.html_url),
        );

        // Always show popup notification
        show_tray_notification(app, "workflow", &info.title, &info.body);

        // Only send macOS native notification if enabled
        if notify {
            macos_notify::send(&info);
        }
    }

    // Only update last status if it's an actual conclusion, not in_progress
    *last = Some(new_status.clone());
    changed
}

async fn fetch_workflow_if_enabled(
    client: &reqwest::Client,
    token: &str,
    settings: &Settings,
) -> Option<github::WorkflowStatus> {
    if !settings.workflow_monitor_enabled
        || settings.workflow_org.is_empty()
        || settings.workflow_repo.is_empty()
        || settings.workflow_name.is_empty()
    {
        return None;
    }
    github::fetch_workflow_status(
        client,
        token,
        &settings.workflow_org,
        &settings.workflow_repo,
        &settings.workflow_name,
    )
    .await
    .ok()
    .flatten()
}

/// Parse a shortcut string like "Super+Ctrl+P" into (Modifiers, Code)
fn parse_shortcut_string(s: &str) -> Result<Shortcut, String> {
    let parts: Vec<&str> = s.split('+').collect();
    if parts.is_empty() {
        return Err("Empty shortcut string".to_string());
    }

    let mut modifiers = Modifiers::empty();
    let mut key_part = "";

    for part in &parts {
        match *part {
            "Super" => modifiers |= Modifiers::SUPER,
            "Ctrl" => modifiers |= Modifiers::CONTROL,
            "Shift" => modifiers |= Modifiers::SHIFT,
            "Alt" => modifiers |= Modifiers::ALT,
            k => key_part = k,
        }
    }

    let code = match key_part.to_uppercase().as_str() {
        "P" => Code::KeyP,
        "R" => Code::KeyR,
        "A" => Code::KeyA,
        "B" => Code::KeyB,
        "C" => Code::KeyC,
        "D" => Code::KeyD,
        "E" => Code::KeyE,
        "F" => Code::KeyF,
        "G" => Code::KeyG,
        "H" => Code::KeyH,
        "I" => Code::KeyI,
        "J" => Code::KeyJ,
        "K" => Code::KeyK,
        "L" => Code::KeyL,
        "M" => Code::KeyM,
        "N" => Code::KeyN,
        "O" => Code::KeyO,
        "Q" => Code::KeyQ,
        "S" => Code::KeyS,
        "T" => Code::KeyT,
        "U" => Code::KeyU,
        "V" => Code::KeyV,
        "W" => Code::KeyW,
        "X" => Code::KeyX,
        "Y" => Code::KeyY,
        "Z" => Code::KeyZ,
        "0" => Code::Digit0,
        "1" => Code::Digit1,
        "2" => Code::Digit2,
        "3" => Code::Digit3,
        "4" => Code::Digit4,
        "5" => Code::Digit5,
        "6" => Code::Digit6,
        "7" => Code::Digit7,
        "8" => Code::Digit8,
        "9" => Code::Digit9,
        " " | "SPACE" => Code::Space,
        "ENTER" => Code::Enter,
        _ => return Err(format!("Unknown key: {}", key_part)),
    };

    Ok(Shortcut::new(Some(modifiers), code))
}

fn normalize_github_pr_url(url: &str) -> Option<String> {
    let url = url.trim();
    // Support URLs with or without scheme — Chromium browsers hide "https://" in the address bar
    let after_domain = url.strip_prefix("https://github.com/")
        .or_else(|| url.strip_prefix("http://github.com/"))
        .or_else(|| url.strip_prefix("github.com/"))?;
    let parts: Vec<&str> = after_domain.splitn(4, '/').collect();
    if parts.len() < 4 || parts[2] != "pull" {
        return None;
    }
    // Strip sub-paths, query strings, fragments from the PR number segment
    let pr_num_str = parts[3].split(&['/', '?', '#'][..]).next()?;
    pr_num_str.parse::<u64>().ok()?; // validate it's a number
    Some(format!(
        "https://github.com/{}/{}/pull/{}",
        parts[0], parts[1], pr_num_str
    ))
}

/// Read the clipboard contents. No permissions required.
fn get_text_for_follow() -> Option<String> {
    use std::process::Command;
    Command::new("pbpaste").output().ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .filter(|s| !s.is_empty())
}

fn create_notify_window(app: &tauri::AppHandle) {
    #[cfg(debug_assertions)]
    let url = tauri::WebviewUrl::External("http://localhost:1420/".parse().unwrap());
    #[cfg(not(debug_assertions))]
    let url = tauri::WebviewUrl::App("index.html".into());

    // Capture the frontmost app before creating the notification window,
    // so we can restore focus if our window steals it.
    #[cfg(target_os = "macos")]
    let prev_app = {
        use objc2_app_kit::NSWorkspace;
        NSWorkspace::sharedWorkspace().frontmostApplication()
    };

    let win = tauri::WebviewWindowBuilder::new(app, "notify", url)
        .title("")
        .inner_size(340.0, 80.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .focused(false)
        .build();

    if let Ok(win) = win {
        use tauri_plugin_positioner::{Position, WindowExt};
        // Try to position at tray; if tray not ready, fall back to top-right
        let old_hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {})); // Suppress panic output
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            win.move_window(Position::TrayBottomCenter)
        }));
        std::panic::set_hook(old_hook); // Restore original hook

        if result.is_err() {
            // Tray position not available (e.g., after restart), use top-right fallback
            let _ = win.move_window(Position::TopRight);
        }

        #[cfg(target_os = "macos")]
        if let Some(prev) = prev_app {
            use objc2_app_kit::NSApplicationActivationOptions;
            prev.activateWithOptions(NSApplicationActivationOptions::empty());
        }
    }
}

fn schedule_notify_close(app: &tauri::AppHandle, timeout_ms: u64) {
    let Some(state) = app.try_state::<AppState>() else { return };

    // Cancel any previous timer
    if let Some(tx) = state.notify_close_tx.lock().unwrap().take() {
        let _ = tx.send(());
    }

    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    *state.notify_close_tx.lock().unwrap() = Some(tx);

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_millis(timeout_ms)) => {
                let h = handle.clone();
                let _ = handle.run_on_main_thread(move || {
                    if let Some(win) = h.get_webview_window("notify") {
                        let _ = win.destroy();
                    }
                });
            }
            _ = rx => {}
        }
    });
}

fn render_notify_js(data: &NotifyData) -> String {
    let kind = data.kind.replace('\'', "\\'");
    let title = data.title.replace('\'', "\\'");
    let message = data.message.replace('\'', "\\'");
    format!(
        "document.body.innerHTML = '<div class=\"notify-popup notify-{kind}\"><div class=\"notify-content\"><div class=\"notify-title\">{title}</div><div class=\"notify-message\">{message}</div></div><button class=\"notify-dismiss\" onclick=\"window.__TAURI__.core.invoke(\\x27dismiss_notification\\x27)\">✕</button></div>';"
    )
}

fn show_tray_notification(app: &tauri::AppHandle, kind: &str, title: &str, message: &str) {
    let data = NotifyData {
        kind: kind.to_string(),
        title: title.to_string(),
        message: message.to_string(),
    };

    let timeout_ms: u64 = match kind {
        "error" => 7000,
        "brew_update" => 8000,
        _ => 3000,
    };

    // If the window already exists, just update its content in place
    if let Some(win) = app.get_webview_window("notify") {
        let _ = win.eval(&render_notify_js(&data));
        schedule_notify_close(app, timeout_ms);
        return;
    }

    // Store data for the new window to read on init
    if let Some(state) = app.try_state::<AppState>() {
        state.pending_notifications.lock().unwrap().clear();
        state.pending_notifications.lock().unwrap().push(data);
    }

    create_notify_window(app);
    schedule_notify_close(app, timeout_ms);
}

#[tauri::command]
fn get_notification_data(app: tauri::AppHandle) -> Vec<NotifyData> {
    app.try_state::<AppState>()
        .map(|s| std::mem::take(&mut *s.pending_notifications.lock().unwrap()))
        .unwrap_or_default()
}

#[tauri::command]
fn get_brew_status(app: tauri::AppHandle) -> Option<homebrew::HomebrewStatus> {
    app.try_state::<AppState>()
        .and_then(|state| {
            state.last_brew_status.lock()
                .ok()
                .map(|guard| guard.clone())
                .flatten()
        })
}

#[tauri::command]
async fn update_brew(app: tauri::AppHandle) -> Result<(), String> {
    use std::process::Command;

    let brew_path = homebrew::find_brew_binary()
        .ok_or_else(|| "Homebrew not found".to_string())?;

    Command::new(&brew_path)
        .args(&["update"])
        .output()
        .map_err(|e| e.to_string())?;

    Command::new(&brew_path)
        .args(&["upgrade", "--cask", "pronto"])
        .output()
        .map_err(|e| e.to_string())?;

    // Restart the app
    tokio::time::sleep(Duration::from_millis(500)).await;
    app.restart()
}

#[tauri::command]
fn dismiss_notification(app: tauri::AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        if let Some(tx) = state.notify_close_tx.lock().unwrap().take() {
            let _ = tx.send(());
        }
    }
    if let Some(win) = app.get_webview_window("notify") {
        let _ = win.destroy();
    }
}

fn toggle_followed_pr(app: &tauri::AppHandle, pr_url: String) {
    let Some(state) = app.try_state::<AppState>() else { return };
    let path = settings_path(app);

    let added = {
        let mut settings = state.settings.lock().unwrap();
        if settings.followed_prs.contains(&pr_url) {
            settings.followed_prs.retain(|u| u != &pr_url);
            let _ = save_settings(&path, &settings);
            false
        } else {
            settings.followed_prs.push(pr_url.clone());
            let _ = save_settings(&path, &settings);
            true
        }
    };

    let _ = app.emit("pr-follow-toggled", serde_json::json!({ "url": pr_url, "added": added }));
    let short = pr_url.strip_prefix("https://github.com/").unwrap_or(&pr_url).to_string();
    let (title, kind) = if added { ("Following PR", "success") } else { ("Unfollowed PR", "removed") };

    // Only show tray notification if the main window is not visible
    let main_visible = app.get_webview_window("main")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);
    if !main_visible {
        show_tray_notification(app, kind, title, &short);
    }
}

#[tauri::command]
fn dismiss_workflow(app: tauri::AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let last = state.last_workflow_status.lock().unwrap();
    if last.is_none() {
        return;
    }
    drop(last);

    let has_pr_attention = {
        let cache = state.cached_prs.lock().unwrap();
        cache
            .as_ref()
            .map(|r| !r.attention_urls.is_empty())
            .unwrap_or(false)
    };
    set_tray_attention(&app, has_pr_attention);
}

#[tauri::command]
fn update_global_shortcuts(
    app: tauri::AppHandle,
    toggle: String,
    reload: String,
    follow: String,
) -> Result<(), String> {
    // Unregister all existing shortcuts
    app.global_shortcut().unregister_all().map_err(|e| e.to_string())?;

    // Parse and register toggle shortcut
    let toggle_shortcut = parse_shortcut_string(&toggle)?;
    let handle = app.clone();
    app.global_shortcut()
        .on_shortcut(toggle_shortcut, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                let h = handle.clone();
                let _ = handle.run_on_main_thread(move || {
                    tray::toggle_window(&h, tray::ToggleSource::GlobalShortcut);
                });
            }
        })
        .map_err(|e| e.to_string())?;

    // Parse and register reload shortcut
    let reload_shortcut = parse_shortcut_string(&reload)?;
    let handle = app.clone();
    app.global_shortcut()
        .on_shortcut(reload_shortcut, move |_app, _shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            let h = handle.clone();
            tauri::async_runtime::spawn(async move {
                let Some(state) = h.try_state::<AppState>() else {
                    return;
                };
                let _ = h.emit("polling-started", ());
                let fs = {
                    let s = state.settings.lock().unwrap();
                    snapshot_fetch_settings(&s)
                };
                let token = match get_token(&state) {
                    Ok(t) => t,
                    Err(_) => return,
                };

                let pr_fetch = github::fetch_all_prs(
                    &state.http_client,
                    &token,
                    fs.merged_hours,
                    fs.show_merged,
                    fs.closed_hours,
                    fs.show_closed,
                    &fs.hidden_orgs,
                    &fs.hidden_repos,
                    &fs.followed_users,
                    &fs.followed_prs,
                )
                .await;
                if let Ok(result) = pr_fetch {
                    cleanup_expired_followed_prs(&state, &h, &result.expired_followed_prs);
                    let result = filter_hidden_prs(result, &fs.hidden_prs);

                    if let Some(wf) =
                        fetch_workflow_if_enabled(&state.http_client, &token, &fs.workflow_settings).await
                    {
                        let mut result_with_wf = result;
                        result_with_wf.workflow_status = Some(wf.clone());
                        let _wf_attention = check_workflow_attention(&h, &wf, fs.notify);
                        let (pr_result, _changed) = process_result(&h, result_with_wf, fs.notify);
                        let _ = h.emit("prs-updated", pr_result);
                    } else {
                        let (pr_result, _changed) = process_result(&h, result, fs.notify);
                        let _ = h.emit("prs-updated", pr_result);
                    }
                }
                let _ = h.emit("polling-complete", ());
            });
        })
        .map_err(|e| e.to_string())?;

    // Parse and register follow-PR shortcut
    let follow_shortcut = parse_shortcut_string(&follow)?;
    let handle = app.clone();
    app.global_shortcut()
        .on_shortcut(follow_shortcut, move |_app, _shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            let h = handle.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let clipboard_text = get_text_for_follow();
                let h2 = h.clone();
                let _ = h.run_on_main_thread(move || {
                    match clipboard_text {
                        Some(text) => {
                            let trimmed = text.trim();
                            match normalize_github_pr_url(trimmed) {
                                Some(pr_url) => toggle_followed_pr(&h2, pr_url),
                                None => show_tray_notification(
                                    &h2, "error",
                                    "Not a PR URL",
                                    "Copy a GitHub PR URL and try again",
                                ),
                            }
                        }
                        None => show_tray_notification(
                            &h2, "error",
                            "No URL Found",
                            "Copy a GitHub PR URL first",
                        ),
                    }
                });
            });
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}

async fn poll_prs(app: tauri::AppHandle) {
    loop {
        let interval = app
            .try_state::<AppState>()
            .map(|s| s.settings.lock().unwrap().poll_interval_secs)
            .unwrap_or(60);
        tokio::time::sleep(Duration::from_secs(interval)).await;
        let _ = app.emit("polling-started", ());

        let Some(state) = app.try_state::<AppState>() else {
            continue;
        };
        let fs = {
            let s = state.settings.lock().unwrap();
            snapshot_fetch_settings(&s)
        };
        let token = match get_token(&state) {
            Ok(t) => t,
            Err(_) => continue,
        };

        let pr_fetch = github::fetch_all_prs(
            &state.http_client,
            &token,
            fs.merged_hours,
            fs.show_merged,
            fs.closed_hours,
            fs.show_closed,
            &fs.hidden_orgs,
            &fs.hidden_repos,
            &fs.followed_users,
            &fs.followed_prs,
        )
        .await;
        match pr_fetch {
            Ok(mut result) => {
                cleanup_expired_followed_prs(&state, &app, &result.expired_followed_prs);
                result = filter_hidden_prs(result, &fs.hidden_prs);

                let (changed, pr_result) = if let Some(wf) =
                    fetch_workflow_if_enabled(&state.http_client, &token, &fs.workflow_settings).await
                {
                    let wf_attention = check_workflow_attention(&app, &wf, fs.notify);
                    result.workflow_status = Some(wf);
                    let (pr_result, changed) = process_result(&app, result, fs.notify);

                    if wf_attention && pr_result.attention_urls.is_empty() {
                        set_tray_attention(&app, true);
                    }
                    (changed || wf_attention, pr_result)
                } else {
                    let (pr_result, changed) = process_result(&app, result, fs.notify);
                    (changed, pr_result)
                };

                if changed {
                    let _ = app.emit("prs-updated", pr_result);
                }
            }
            Err(e) => {
                eprintln!("[pronto] Poll failed: {}", e);
            }
        }
        let _ = app.emit("polling-complete", ());
    }
}

async fn poll_brew(app: tauri::AppHandle) {
    use std::time::Instant;

    // Exit early if brew binary not found
    if homebrew::find_brew_binary().is_none() {
        return;
    }

    let mut last_checked = Instant::now() - Duration::from_secs(14400); // check on first pass

    loop {
        let (enabled, interval) = {
            let state = app.try_state::<AppState>();
            let s = state.map(|st| {
                let settings = st.settings.lock().unwrap();
                (settings.homebrew_check_enabled, settings.homebrew_check_interval_secs)
            });
            match s {
                Some((e, i)) => (e, i),
                None => {
                    tokio::time::sleep(Duration::from_secs(60)).await;
                    continue;
                }
            }
        };

        if enabled && last_checked.elapsed() >= Duration::from_secs(interval) {
            let status = tokio::task::spawn_blocking(homebrew::check_pronto_update_sync)
                .await
                .unwrap_or_else(|_| homebrew::HomebrewStatus {
                    available: false,
                    update_available: false,
                    installed_version: String::new(),
                    latest_version: String::new(),
                    checked_at: chrono::Utc::now().to_rfc3339(),
                });

            let Some(state) = app.try_state::<AppState>() else {
                tokio::time::sleep(Duration::from_secs(60)).await;
                continue;
            };

            // Check if we should notify
            let should_notify = {
                let prev_status = state.last_brew_status.lock().unwrap();
                let prev_update_available = prev_status.as_ref().map(|s| s.update_available).unwrap_or(false);
                let prev_notified = *state.last_notified_brew_update.lock().unwrap();

                // Notify if transitioning from up-to-date to update-available
                !prev_notified && status.update_available && !prev_update_available
            };

            if should_notify {
                show_tray_notification(
                    &app,
                    "brew_update",
                    "Homebrew Update Available",
                    &format!("Pronto {} is available", status.latest_version),
                );
                *state.last_notified_brew_update.lock().unwrap() = true;
            }

            // Reset notification flag if update no longer available
            if !status.update_available {
                *state.last_notified_brew_update.lock().unwrap() = false;
            }

            // Store the status and emit update event
            {
                let mut last_status = state.last_brew_status.lock().unwrap();
                *last_status = Some(status.clone());
            }
            let _ = app.emit("brew-updated", status);
            last_checked = Instant::now();
        }

        tokio::time::sleep(Duration::from_secs(60)).await;
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            fetch_all_prs,
            dismiss_pr,
            dismiss_workflow,
            check_auth,
            get_app_version,
            start_login,
            poll_login,
            login_with_pat,
            logout,
            get_settings,
            update_settings,
            update_global_shortcuts,
            get_notification_data,
            dismiss_notification,
            get_brew_status,
            update_brew,
            fetch_releases,
            check_version_update,
        ])
        .setup(|app| {
            let settings = load_settings(&settings_path(app.handle()));
            app.manage(AppState {
                cached_prs: Mutex::new(None),
                seen_prs: Mutex::new(HashMap::new()),
                cached_token: Mutex::new(None),
                settings: Mutex::new(settings),
                last_workflow_status: Mutex::new(None),
                notified_prs: Mutex::new(HashSet::new()),
                http_client: reqwest::Client::new(),
                last_tray_attention: Mutex::new(None),
                viewer_login: Mutex::new(String::new()),
                viewer_avatar_url: Mutex::new(String::new()),
                pending_notifications: Mutex::new(Vec::new()),
                notify_close_tx: Mutex::new(None),
                last_brew_status: Mutex::new(None),
                last_notified_brew_update: Mutex::new(false),
                cached_releases: Mutex::new(None),
            });
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            tray::setup_tray(app)?;
            #[cfg(target_os = "macos")]
            macos_notify::init(app.handle());

            if let Some(window) = app.get_webview_window("main") {
                // Convert the window to NSPanel so it can float above fullscreen apps.
                // NSPanel is the standard AppKit mechanism for auxiliary windows (pickers,
                // HUDs, menu-bar popups) that need to appear on every Space and over
                // fullscreen apps.  Plain NSWindow cannot do this reliably.
                #[cfg(target_os = "macos")]
                if let Ok(ptr) = window.ns_window() {
                    use objc2::runtime::{AnyClass, AnyObject, ClassBuilder};
                    use objc2_app_kit::{
                        NSFloatingWindowLevel, NSPanel,
                        NSWindowCollectionBehavior, NSWindowStyleMask,
                    };

                    // Register ProntoPanel (subclass of NSPanel) with
                    // canBecomeKeyWindow → YES so WKWebView receives keyboard events.
                    let panel_superclass =
                        AnyClass::get(c"NSPanel").expect("NSPanel class not found");
                    let pronto_class =
                        if let Some(existing) = AnyClass::get(c"ProntoPanel") {
                            existing
                        } else {
                            let mut builder =
                                ClassBuilder::new(c"ProntoPanel", panel_superclass)
                                    .expect("failed to create ProntoPanel class");
                            unsafe {
                                builder.add_method(
                                    objc2::sel!(canBecomeKeyWindow),
                                    pronto_panel_can_become_key
                                        as extern "C-unwind" fn(_, _) -> _,
                                );
                            }
                            builder.register()
                        };

                    // Isa-swap to ProntoPanel.
                    unsafe { AnyObject::set_class(&*ptr.cast::<AnyObject>(), pronto_class) };

                    let panel: &NSPanel = unsafe { &*ptr.cast::<NSPanel>() };
                    panel.setFloatingPanel(true);
                    panel.setBecomesKeyOnlyIfNeeded(false);

                    // NonactivatingPanel is CRITICAL for fullscreen overlay.
                    // Without it, showing the panel activates the app and macOS
                    // pulls the user out of the fullscreen Space.  With it, the
                    // panel overlays without activation.  Keyboard events still
                    // reach WKWebView because canBecomeKeyWindow returns YES and
                    // the panel becomes the key window via makeKeyWindow().
                    let mask = panel.styleMask();
                    panel.setStyleMask(mask | NSWindowStyleMask::NonactivatingPanel);

                    panel.setCollectionBehavior(
                        panel.collectionBehavior()
                            | NSWindowCollectionBehavior::CanJoinAllSpaces
                            | NSWindowCollectionBehavior::FullScreenAuxiliary,
                    );
                    panel.setLevel(NSFloatingWindowLevel);
                    panel.setHidesOnDeactivate(false);
                }

                // Park the window off-screen so the first show() doesn't
                // flash briefly at the default center position before the
                // real positioning takes effect.
                let _ = window.set_position(tauri::PhysicalPosition::new(-9999_i32, -9999_i32));

                let w = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(false) = event {
                        let _ = w.hide();
                    }
                });
            }

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                poll_prs(handle).await;
            });

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                poll_brew(handle).await;
            });

            // Fetch releases once at startup
            let releases_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match github::fetch_releases_from_github(
                    &releases_handle.state::<AppState>().http_client,
                ).await {
                    Ok(releases) => {
                        let state = releases_handle.state::<AppState>();
                        let mut cache = state.cached_releases.lock().unwrap();
                        *cache = Some(releases);
                    }
                    Err(e) => eprintln!("[pronto] Failed to fetch releases: {e}"),
                }
            });

            // Setup global shortcuts from settings
            let (toggle, reload, follow) = {
                let state = app.state::<AppState>();
                let settings = state.settings.lock().unwrap();
                (
                    settings.global_toggle_shortcut.clone(),
                    settings.global_reload_shortcut.clone(),
                    settings.global_follow_shortcut.clone(),
                )
            };
            update_global_shortcuts(app.handle().clone(), toggle, reload, follow)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
