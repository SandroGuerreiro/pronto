pub mod auth;
pub mod github;
pub mod tray;
pub mod homebrew;

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HiddenPr {
    pub url: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationPreferences {
    #[serde(default)]
    pub review_required: bool,
    #[serde(default)]
    pub changes_requested: bool,
    #[serde(default)]
    pub approved: bool,
    #[serde(default)]
    pub checks_failed: bool,
    #[serde(default)]
    pub checks_recovered: bool,
    #[serde(default)]
    pub kicked_from_queue: bool,
    #[serde(default)]
    pub new_comment: bool,
}

impl Default for NotificationPreferences {
    fn default() -> Self {
        Self {
            review_required: false,
            changes_requested: false,
            approved: false,
            checks_failed: false,
            checks_recovered: false,
            kicked_from_queue: false,
            new_comment: false,
        }
    }
}

fn default_true() -> bool {
    true
}

fn default_poll_interval() -> u64 {
    60
}

fn default_merged_window() -> u64 {
    24
}

fn default_global_toggle() -> String {
    "Super+Ctrl+P".to_string()
}

fn default_global_reload() -> String {
    "Super+Ctrl+R".to_string()
}

fn default_global_follow() -> String {
    "Super+Ctrl+L".to_string()
}

fn default_homebrew_check_interval() -> u64 {
    14400  // 4 hours
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default = "default_poll_interval")]
    pub poll_interval_secs: u64,
    #[serde(default = "default_true")]
    pub notifications_enabled: bool,
    #[serde(default = "default_true")]
    pub show_recently_merged: bool,
    #[serde(default = "default_merged_window")]
    pub merged_window_hours: u64,
    #[serde(default)]
    pub show_closed: bool,
    #[serde(default)]
    pub closed_window_hours: u64,
    #[serde(default)]
    pub favorite_orgs: Vec<String>,
    #[serde(default)]
    pub favorite_repos: Vec<String>,
    #[serde(default)]
    pub collapsed_accordions: Vec<String>,
    #[serde(default)]
    pub hidden_orgs: Vec<String>,
    #[serde(default)]
    pub hidden_repos: Vec<String>,
    #[serde(default)]
    pub hidden_prs: Vec<HiddenPr>,
    #[serde(default)]
    pub followed_users: Vec<String>,
    #[serde(default)]
    pub followed_prs: Vec<String>,
    #[serde(default = "default_true")]
    pub group_by_repository: bool,
    #[serde(default)]
    pub workflow_monitor_enabled: bool,
    #[serde(default)]
    pub workflow_org: String,
    #[serde(default)]
    pub workflow_repo: String,
    #[serde(default)]
    pub workflow_name: String,
    #[serde(default)]
    pub keybindings: HashMap<String, String>,
    #[serde(default = "default_global_toggle")]
    pub global_toggle_shortcut: String,
    #[serde(default = "default_global_reload")]
    pub global_reload_shortcut: String,
    #[serde(default = "default_global_follow")]
    pub global_follow_shortcut: String,
    #[serde(default)]
    pub notification_prefs_owned: NotificationPreferences,
    #[serde(default)]
    pub notification_prefs_followed: NotificationPreferences,
    #[serde(default = "default_true")]
    pub notify_on_merged: bool,
    #[serde(default)]
    pub notify_on_closed: bool,
    #[serde(default)]
    pub homebrew_check_enabled: bool,
    #[serde(default = "default_homebrew_check_interval")]
    pub homebrew_check_interval_secs: u64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            poll_interval_secs: 60,
            notifications_enabled: true,
            show_recently_merged: true,
            merged_window_hours: 24,
            show_closed: false,
            closed_window_hours: 24,
            favorite_orgs: vec![],
            favorite_repos: vec![],
            collapsed_accordions: vec![],
            hidden_orgs: vec![],
            hidden_repos: vec![],
            hidden_prs: vec![],
            followed_users: vec![],
            followed_prs: vec![],
            group_by_repository: false,
            workflow_monitor_enabled: false,
            workflow_org: String::new(),
            workflow_repo: String::new(),
            workflow_name: String::new(),
            keybindings: HashMap::new(),
            global_toggle_shortcut: default_global_toggle(),
            global_reload_shortcut: default_global_reload(),
            global_follow_shortcut: default_global_follow(),
            notification_prefs_owned: NotificationPreferences {
                review_required: true,
                changes_requested: true,
                approved: true,
                checks_failed: true,
                checks_recovered: true,
                kicked_from_queue: true,
                new_comment: true,
            },
            notification_prefs_followed: NotificationPreferences {
                review_required: true,
                ..Default::default()
            },
            notify_on_merged: true,
            notify_on_closed: false,
            homebrew_check_enabled: true,
            homebrew_check_interval_secs: 14400,
        }
    }
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotifyData {
    pub kind: String,
    pub title: String,
    pub message: String,
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
    pub pending_notifications: Mutex<Vec<NotifyData>>,
    pub notify_close_tx: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
    pub last_brew_status: Mutex<Option<homebrew::HomebrewStatus>>,
    pub last_notified_brew_update: Mutex<bool>,
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

fn describe_change(pr: &github::PullRequest, old_fp: Option<&str>, viewer_login: &str) -> String {
    if pr.merged {
        return "PR was merged".to_string();
    }

    let Some(old) = old_fp else {
        return "State changed".to_string();
    };

    let parts: Vec<&str> = old.split('|').collect();
    if parts.len() < 5 {
        return "State changed".to_string();
    }

    let mut changes = Vec::new();

    let new_review = pr.review_decision.as_deref().unwrap_or("");
    if parts[0] != new_review {
        match new_review {
            "APPROVED" => changes.push("PR was approved"),
            "CHANGES_REQUESTED" => changes.push("Changes requested"),
            "REVIEW_REQUIRED" => changes.push("Review required"),
            _ => changes.push("Review status changed"),
        }
    }

    let new_checks = pr
        .commits
        .nodes
        .first()
        .and_then(|n| n.commit.status_check_rollup.as_ref())
        .map(|r| r.state.as_str())
        .unwrap_or("");
    if parts[1] != new_checks {
        match new_checks {
            "SUCCESS" => changes.push("Checks passed"),
            "FAILURE" | "ERROR" => changes.push("Checks failed"),
            "PENDING" | "EXPECTED" => changes.push("Checks running"),
            _ => changes.push("Check status changed"),
        }
    }

    let new_unresolved = pr
        .review_threads
        .nodes
        .iter()
        .filter(|t| !t.is_resolved)
        .count();
    let last_human_commenter = pr.comments.last_human_commenter().unwrap_or("");
    let comment_count_changed = parts[2].parse::<i32>().unwrap_or(0) != pr.comments.total_count;
    if (comment_count_changed && last_human_commenter != viewer_login)
        || parts[3].parse::<usize>().unwrap_or(0) != new_unresolved
    {
        changes.push("New comments");
    }

    let old_in_queue = parts[4] == "true";
    let new_in_queue = pr.merge_queue_entry.is_some();
    if old_in_queue && !new_in_queue {
        changes.push("Removed from merge queue");
    }

    if changes.is_empty() {
        "State changed".to_string()
    } else {
        changes.join(", ")
    }
}

fn ensure_notification_app(app: &tauri::AppHandle) {
    use std::sync::Once;
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        let bundle_id = &app.config().identifier;
        let id = if tauri::is_dev() {
            "com.apple.Terminal"
        } else {
            bundle_id
        };
        let _ = mac_notification_sys::set_application(id);
    });
}

fn send_attention_notification(
    app: &tauri::AppHandle,
    result: &github::FetchResult,
    seen: &HashMap<String, String>,
) {
    let mut attention_prs: Vec<&github::PullRequest> = result
        .open
        .iter()
        .chain(result.recently_merged.iter())
        .filter(|pr| result.attention_urls.contains(&pr.url))
        .collect();

    if let Some(state) = app.try_state::<AppState>() {
        let mut notified = state.notified_prs.lock().unwrap();
        attention_prs.retain(|pr| {
            if notified.contains(&pr.url) {
                false
            } else {
                notified.insert(pr.url.clone());
                true
            }
        });
    }

    if attention_prs.is_empty() {
        return;
    }

    ensure_notification_app(app);

    let (title, body) = if attention_prs.len() == 1 {
        let pr = attention_prs[0];
        let old_fp = seen.get(&pr.url).map(|s| s.as_str());
        (pr.title.clone(), describe_change(pr, old_fp, &result.viewer_login))
    } else {
        let count = attention_prs.len();
        let names: Vec<String> = attention_prs.iter().map(|pr| pr.title.clone()).collect();
        (
            format!("{} PRs need attention", count),
            names.join("\n"),
        )
    };

    tauri::async_runtime::spawn_blocking(move || {
        let _ = mac_notification_sys::Notification::new()
            .title(&title)
            .message(&body)
            .send();
    });
}

fn set_tray_attention(app: &tauri::AppHandle, attention: bool) {
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

            // Update viewer_login from the latest fetch result.
            if !result.viewer_login.is_empty() {
                *state.viewer_login.lock().unwrap() = result.viewer_login.clone();
            }
            let viewer_login = state.viewer_login.lock().unwrap().clone();

            result.attention_urls = tray::attention_urls(&result, &seen, &settings, &viewer_login);

            // Compute per-element changes for every PR in attention_urls
            let all_prs: Vec<&github::PullRequest> = result
                .open
                .iter()
                .chain(result.followed_open.iter())
                .collect();
            result.element_changes = result
                .attention_urls
                .iter()
                .filter_map(|url| {
                    let old_fp = seen.get(url)?;
                    let pr = all_prs.iter().find(|p| &p.url == url)?;
                    Some((url.clone(), tray::compute_element_changes(pr, old_fp, &viewer_login)))
                })
                .collect();

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

            if notify {
                send_attention_notification(app, &result, &seen);
            }

            let attention_set: HashSet<&str> =
                result.attention_urls.iter().map(|s| s.as_str()).collect();
            for pr in result.open.iter().chain(result.followed_open.iter()) {
                // Update fingerprint for PRs not in attention, so we track
                // intermediate states (e.g. PENDING) for future change detection.
                // Attention PRs keep their old fingerprint until dismissed.
                if !attention_set.contains(pr.url.as_str()) {
                    seen.insert(pr.url.clone(), tray::attention_fingerprint(pr));
                }
            }

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
        }

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
    let (
        merged_hours,
        show_merged,
        closed_hours,
        show_closed,
        hidden_orgs,
        hidden_repos,
        hidden_prs,
        followed_users,
        followed_prs,
        settings_clone,
    ) = {
        let s = state.settings.lock().unwrap();
        (
            s.merged_window_hours,
            s.show_recently_merged,
            s.closed_window_hours,
            s.show_closed,
            s.hidden_orgs.clone(),
            s.hidden_repos.clone(),
            s.hidden_prs.clone(),
            s.followed_users.clone(),
            s.followed_prs.clone(),
            Settings {
                workflow_monitor_enabled: s.workflow_monitor_enabled,
                workflow_org: s.workflow_org.clone(),
                workflow_repo: s.workflow_repo.clone(),
                workflow_name: s.workflow_name.clone(),
                ..Default::default()
            },
        )
    };
    let mut result = github::fetch_all_prs(
        &state.http_client,
        &token,
        merged_hours,
        show_merged,
        closed_hours,
        show_closed,
        &hidden_orgs,
        &hidden_repos,
        &followed_users,
        &followed_prs,
    )
    .await
    .map_err(|e| e.to_string())?;

    // Clean up expired followed PRs (merged/closed > 48h ago)
    if !result.expired_followed_prs.is_empty() {
        let mut settings = state.settings.lock().unwrap();
        settings.followed_prs.retain(|url| !result.expired_followed_prs.contains(url));
        let settings_to_save = settings.clone();
        drop(settings);
        let path = settings_path(&app);
        let _ = save_settings(&path, &settings_to_save);
    }

    result = filter_hidden_prs(result, &hidden_prs);

    if let Some(wf) = fetch_workflow_if_enabled(&state.http_client, &token, &settings_clone).await {
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

    let (fingerprint, result_clone) = {
        let cache = state.cached_prs.lock().unwrap();
        let Some(result) = cache.as_ref() else { return };
        let pr_opt = result
            .open
            .iter()
            .chain(result.followed_open.iter())
            .find(|p| p.url == url);
        let Some(pr) = pr_opt else { return };
        (tray::attention_fingerprint(pr), result.clone())
    };

    {
        let mut seen = state.seen_prs.lock().unwrap();
        seen.insert(url.clone(), fingerprint);
        let settings = state.settings.lock().unwrap().clone();
        let viewer_login = state.viewer_login.lock().unwrap().clone();
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

    if changed && notify {
        ensure_notification_app(app);
        let title = format!("{} — {}", new_status.repo, new_status.workflow_name);
        let body = if new_status.conclusion == "success" {
            "Workflow succeeded".to_string()
        } else {
            format!("Workflow {}", new_status.conclusion)
        };
        tauri::async_runtime::spawn_blocking(move || {
            let _ = mac_notification_sys::Notification::new()
                .title(&title)
                .message(&body)
                .send();
        });
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
    let after_domain = url.strip_prefix("https://github.com/")?;
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

fn is_accessibility_trusted() -> bool {
    use std::ffi::c_void;
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrustedWithOptions(options: *const c_void) -> u8;
    }
    unsafe { AXIsProcessTrustedWithOptions(std::ptr::null()) != 0 }
}

fn simulate_cmd_c() {
    use std::ffi::c_void;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceCreate(state_id: i32) -> *mut c_void;
        fn CGEventCreateKeyboardEvent(source: *mut c_void, virtual_key: u16, key_down: bool) -> *mut c_void;
        fn CGEventSetFlags(event: *mut c_void, flags: u64);
        fn CGEventPost(tap: i32, event: *mut c_void);
        fn CFRelease(cf: *mut c_void);
    }

    const HID_SYSTEM_STATE: i32 = 1;
    const HID_EVENT_TAP: i32 = 0;
    const CMD_FLAG: u64 = 0x00100000;
    const KEY_C: u16 = 8;

    unsafe {
        let source = CGEventSourceCreate(HID_SYSTEM_STATE);
        if source.is_null() { return; }

        let down = CGEventCreateKeyboardEvent(source, KEY_C, true);
        CGEventSetFlags(down, CMD_FLAG);
        CGEventPost(HID_EVENT_TAP, down);
        CFRelease(down);

        let up = CGEventCreateKeyboardEvent(source, KEY_C, false);
        CGEventSetFlags(up, CMD_FLAG);
        CGEventPost(HID_EVENT_TAP, up);
        CFRelease(up);

        CFRelease(source);
    }
}

/// Try to get a GitHub PR URL — first via selected text (if Accessibility is granted),
/// otherwise fall back to whatever is currently on the clipboard.
fn get_text_for_follow() -> Option<String> {
    use std::io::Write;
    use std::process::{Command, Stdio};

    if is_accessibility_trusted() {
        // Save current clipboard
        let original = Command::new("pbpaste").output().ok()
            .and_then(|o| String::from_utf8(o.stdout).ok());

        // Clear clipboard so we can detect if nothing was selected
        if let Ok(mut child) = Command::new("pbcopy").stdin(Stdio::piped()).spawn() {
            if let Some(stdin) = child.stdin.as_mut() {
                let _ = stdin.write_all(b"");
            }
            let _ = child.wait();
        }

        std::thread::sleep(Duration::from_millis(50));
        simulate_cmd_c();
        std::thread::sleep(Duration::from_millis(150));

        let selected = Command::new("pbpaste").output().ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .unwrap_or_default();

        // Restore original clipboard
        let restore_text = original.unwrap_or_default();
        if let Ok(mut child) = Command::new("pbcopy").stdin(Stdio::piped()).spawn() {
            if let Some(stdin) = child.stdin.as_mut() {
                let _ = stdin.write_all(restore_text.as_bytes());
            }
            let _ = child.wait();
        }

        if !selected.is_empty() {
            return Some(selected);
        }
    }

    // Fallback: just read current clipboard contents
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
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = win.move_window(Position::TrayBottomCenter);
        }));

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

    let timeout_ms: u64 = if kind == "error" { 7000 } else { 3000 };

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

    Command::new("brew")
        .args(&["update"])
        .output()
        .map_err(|e| e.to_string())?;

    Command::new("brew")
        .args(&["upgrade", "--cask", "pronto"])
        .output()
        .map_err(|e| e.to_string())?;

    // Restart the app
    tokio::time::sleep(Duration::from_millis(500)).await;
    app.restart();

    Ok(())
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
                tray::toggle_window(&handle);
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
                let (
                    notify,
                    merged_hours,
                    show_merged,
                    closed_hours,
                    show_closed,
                    hidden_orgs,
                    hidden_repos,
                    hidden_prs,
                    followed_users,
                    followed_prs,
                    settings_clone,
                ) = {
                    let s = state.settings.lock().unwrap();
                    (
                        s.notifications_enabled,
                        s.merged_window_hours,
                        s.show_recently_merged,
                        s.closed_window_hours,
                        s.show_closed,
                        s.hidden_orgs.clone(),
                        s.hidden_repos.clone(),
                        s.hidden_prs.clone(),
                        s.followed_users.clone(),
                        s.followed_prs.clone(),
                        Settings {
                            workflow_monitor_enabled: s.workflow_monitor_enabled,
                            workflow_org: s.workflow_org.clone(),
                            workflow_repo: s.workflow_repo.clone(),
                            workflow_name: s.workflow_name.clone(),
                            ..Default::default()
                        },
                    )
                };
                let token = match get_token(&state) {
                    Ok(t) => t,
                    Err(_) => return,
                };

                let pr_fetch = github::fetch_all_prs(
                    &state.http_client,
                    &token,
                    merged_hours,
                    show_merged,
                    closed_hours,
                    show_closed,
                    &hidden_orgs,
                    &hidden_repos,
                    &followed_users,
                    &followed_prs,
                )
                .await;
                if let Ok(result) = pr_fetch {
                    // Clean up expired followed PRs (merged/closed > 48h ago)
                    if !result.expired_followed_prs.is_empty() {
                        let mut settings = state.settings.lock().unwrap();
                        settings.followed_prs.retain(|url| !result.expired_followed_prs.contains(url));
                        let settings_to_save = settings.clone();
                        drop(settings);
                        let path = settings_path(&h);
                        let _ = save_settings(&path, &settings_to_save);
                    }

                    let result = filter_hidden_prs(result, &hidden_prs);

                    if let Some(wf) =
                        fetch_workflow_if_enabled(&state.http_client, &token, &settings_clone).await
                    {
                        let mut result_with_wf = result;
                        result_with_wf.workflow_status = Some(wf.clone());
                        let _wf_attention = check_workflow_attention(&h, &wf, notify);
                        let (pr_result, _changed) = process_result(&h, result_with_wf, notify);
                        let _ = h.emit("prs-updated", pr_result);
                    } else {
                        let (pr_result, _changed) = process_result(&h, result, notify);
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
                            match normalize_github_pr_url(text.trim()) {
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
        let (
            notify,
            merged_hours,
            show_merged,
            closed_hours,
            show_closed,
            hidden_orgs,
            hidden_repos,
            hidden_prs,
            followed_users,
            followed_prs,
            settings_clone,
        ) = {
            let s = state.settings.lock().unwrap();
            (
                s.notifications_enabled,
                s.merged_window_hours,
                s.show_recently_merged,
                s.closed_window_hours,
                s.show_closed,
                s.hidden_orgs.clone(),
                s.hidden_repos.clone(),
                s.hidden_prs.clone(),
                s.followed_users.clone(),
                s.followed_prs.clone(),
                Settings {
                    workflow_monitor_enabled: s.workflow_monitor_enabled,
                    workflow_org: s.workflow_org.clone(),
                    workflow_repo: s.workflow_repo.clone(),
                    workflow_name: s.workflow_name.clone(),
                    ..Default::default()
                },
            )
        };
        let token = match get_token(&state) {
            Ok(t) => t,
            Err(_) => continue,
        };

        let pr_fetch = github::fetch_all_prs(
            &state.http_client,
            &token,
            merged_hours,
            show_merged,
            closed_hours,
            show_closed,
            &hidden_orgs,
            &hidden_repos,
            &followed_users,
            &followed_prs,
        )
        .await;
        match pr_fetch {
            Ok(mut result) => {
                // Clean up expired followed PRs (merged/closed > 48h ago)
                if !result.expired_followed_prs.is_empty() {
                    let mut settings = state.settings.lock().unwrap();
                    settings.followed_prs.retain(|url| !result.expired_followed_prs.contains(url));
                    let settings_to_save = settings.clone();
                    drop(settings);
                    let path = settings_path(&app);
                    let _ = save_settings(&path, &settings_to_save);
                }

                result = filter_hidden_prs(result, &hidden_prs);

                let (changed, pr_result) = if let Some(wf) =
                    fetch_workflow_if_enabled(&state.http_client, &token, &settings_clone).await
                {
                    let wf_attention = check_workflow_attention(&app, &wf, notify);
                    result.workflow_status = Some(wf);
                    let (pr_result, changed) = process_result(&app, result, notify);

                    if wf_attention && pr_result.attention_urls.is_empty() {
                        set_tray_attention(&app, true);
                    }
                    (changed || wf_attention, pr_result)
                } else {
                    let (pr_result, changed) = process_result(&app, result, notify);
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

            eprintln!("[brew-check] available: {}, update_available: {}, {} → {}",
                status.available, status.update_available, status.installed_version, status.latest_version);

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
                pending_notifications: Mutex::new(Vec::new()),
                notify_close_tx: Mutex::new(None),
                last_brew_status: Mutex::new(None),
                last_notified_brew_update: Mutex::new(false),
            });
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            tray::setup_tray(app)?;

            if let Some(window) = app.get_webview_window("main") {
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
