pub mod auth;
pub mod github;
pub mod tray;

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

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub poll_interval_secs: u64,
    pub notifications_enabled: bool,
    pub show_recently_merged: bool,
    pub merged_window_hours: u64,
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
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            poll_interval_secs: 60,
            notifications_enabled: true,
            show_recently_merged: true,
            merged_window_hours: 24,
            favorite_orgs: vec![],
            favorite_repos: vec![],
            collapsed_accordions: vec![],
            hidden_orgs: vec![],
            hidden_repos: vec![],
            hidden_prs: vec![],
            followed_users: vec![],
            group_by_repository: false,
            workflow_monitor_enabled: false,
            workflow_org: String::new(),
            workflow_repo: String::new(),
            workflow_name: String::new(),
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

pub struct AppState {
    pub cached_prs: Mutex<Option<github::FetchResult>>,
    pub seen_prs: Mutex<HashMap<String, String>>,
    pub cached_token: Mutex<Option<String>>,
    pub settings: Mutex<Settings>,
    pub last_workflow_status: Mutex<Option<github::WorkflowStatus>>,
    pub notified_prs: Mutex<HashSet<String>>,
    pub http_client: reqwest::Client,
    pub last_tray_attention: Mutex<Option<bool>>,
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

fn describe_change(pr: &github::PullRequest, old_fp: Option<&str>) -> String {
    if pr.merged {
        return "PR was merged".to_string();
    }

    let Some(old) = old_fp else {
        return "State changed".to_string();
    };

    let parts: Vec<&str> = old.split('|').collect();
    if parts.len() < 7 {
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

    let new_comments: i32 = pr.comments.total_count;
    if parts[2].parse::<i32>().unwrap_or(0) != new_comments {
        changes.push("New comments");
    }

    let new_reviews: i32 = pr.reviews.total_count;
    if parts[3].parse::<i32>().unwrap_or(0) != new_reviews {
        changes.push("New reviews");
    }

    let new_unresolved = pr
        .review_threads
        .nodes
        .iter()
        .filter(|t| !t.is_resolved)
        .count();
    let new_resolved = pr
        .review_threads
        .nodes
        .iter()
        .filter(|t| t.is_resolved)
        .count();
    if parts[4].parse::<usize>().unwrap_or(0) != new_unresolved
        || parts[5].parse::<usize>().unwrap_or(0) != new_resolved
    {
        changes.push("Threads updated");
    }

    let new_in_queue = pr.merge_queue_entry.is_some();
    let old_in_queue = parts[6] == "true";
    if old_in_queue != new_in_queue {
        if new_in_queue {
            changes.push("Added to merge queue");
        } else {
            changes.push("Removed from merge queue");
        }
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

    for pr in &attention_prs {
        let old_fp = seen.get(&pr.url).map(|s| s.as_str());
        let body = describe_change(pr, old_fp);
        let title = pr.title.clone();
        let url = pr.url.clone();
        let fingerprint = tray::attention_fingerprint(pr);
        let app_handle = app.clone();

        std::thread::spawn(move || {
            let response = mac_notification_sys::Notification::new()
                .title(&title)
                .message(&body)
                .main_button(mac_notification_sys::MainButton::SingleAction("Open PR"))
                .wait_for_click(true)
                .send();

            if let Ok(response) = response {
                match response {
                    mac_notification_sys::NotificationResponse::Click
                    | mac_notification_sys::NotificationResponse::ActionButton(_) => {
                        let _ = open::that(&url);
                        if let Some(state) = app_handle.try_state::<AppState>() {
                            {
                                let mut seen = state.seen_prs.lock().unwrap();
                                seen.insert(url.clone(), fingerprint.clone());
                                let has_attention = {
                                    let cache = state.cached_prs.lock().unwrap();
                                    cache
                                        .as_ref()
                                        .map(|r| !tray::attention_urls(r, &seen).is_empty())
                                        .unwrap_or(false)
                                };
                                drop(seen);
                                set_tray_attention(&app_handle, has_attention);
                            }
                            {
                                let mut notified = state.notified_prs.lock().unwrap();
                                notified.remove(&url);
                            }
                            let _ = app_handle.emit("prs-updated", ());
                        }
                    }
                    _ => {}
                }
            }
        });
    }
}

fn set_tray_attention(app: &tauri::AppHandle, attention: bool) {
    if let Some(state) = app.try_state::<AppState>() {
        let mut last = state.last_tray_attention.lock().unwrap();
        if *last == Some(attention) {
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
            result.attention_urls = tray::attention_urls(&result, &seen);

            if notify {
                send_attention_notification(app, &result, &seen);
            }

            for pr in result.open.iter().chain(result.followed_open.iter()) {
                if !seen.contains_key(&pr.url) {
                    seen.insert(pr.url.clone(), tray::attention_fingerprint(pr));
                }
            }

            for pr in result
                .recently_merged
                .iter()
                .chain(result.followed_recently_merged.iter())
            {
                seen.remove(&pr.url);
            }
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
    *state.settings.lock().unwrap() = settings;
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
            .followed_open
            .retain(|pr| !hidden_urls.contains(pr.url.as_str()));
        result
            .followed_recently_merged
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
        hidden_orgs,
        hidden_repos,
        hidden_prs,
        followed_users,
        settings_clone,
    ) = {
        let s = state.settings.lock().unwrap();
        (
            s.merged_window_hours,
            s.show_recently_merged,
            s.hidden_orgs.clone(),
            s.hidden_repos.clone(),
            s.hidden_prs.clone(),
            s.followed_users.clone(),
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
        &hidden_orgs,
        &hidden_repos,
        &followed_users,
    )
    .await
    .map_err(|e| e.to_string())?;
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
        let has_attention = !tray::attention_urls(&result_clone, &seen).is_empty();
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
    let changed = match last.as_ref() {
        Some(prev) => prev.conclusion != new_status.conclusion,
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
        let url = new_status.html_url.clone();
        let app_handle = app.clone();

        std::thread::spawn(move || {
            let response = mac_notification_sys::Notification::new()
                .title(&title)
                .message(&body)
                .main_button(mac_notification_sys::MainButton::SingleAction("Open"))
                .wait_for_click(true)
                .send();

            if let Ok(response) = response {
                match response {
                    mac_notification_sys::NotificationResponse::Click
                    | mac_notification_sys::NotificationResponse::ActionButton(_) => {
                        let _ = open::that(&url);
                        let _ = app_handle.emit("prs-updated", ());
                    }
                    _ => {}
                }
            }
        });
    }

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

async fn poll_prs(app: tauri::AppHandle) {
    loop {
        let interval = app
            .try_state::<AppState>()
            .map(|s| s.settings.lock().unwrap().poll_interval_secs)
            .unwrap_or(60);
        tokio::time::sleep(Duration::from_secs(interval)).await;

        let Some(state) = app.try_state::<AppState>() else {
            continue;
        };
        let (
            notify,
            merged_hours,
            show_merged,
            hidden_orgs,
            hidden_repos,
            hidden_prs,
            followed_users,
            settings_clone,
        ) = {
            let s = state.settings.lock().unwrap();
            (
                s.notifications_enabled,
                s.merged_window_hours,
                s.show_recently_merged,
                s.hidden_orgs.clone(),
                s.hidden_repos.clone(),
                s.hidden_prs.clone(),
                s.followed_users.clone(),
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
            &hidden_orgs,
            &hidden_repos,
            &followed_users,
        )
        .await;
        match pr_fetch {
            Ok(mut result) => {
                result = filter_hidden_prs(result, &hidden_prs);

                let changed = if let Some(wf) =
                    fetch_workflow_if_enabled(&state.http_client, &token, &settings_clone).await
                {
                    let wf_attention = check_workflow_attention(&app, &wf, notify);
                    result.workflow_status = Some(wf);
                    let (pr_result, changed) = process_result(&app, result, notify);

                    if wf_attention && pr_result.attention_urls.is_empty() {
                        set_tray_attention(&app, true);
                    }
                    changed || wf_attention
                } else {
                    process_result(&app, result, notify).1
                };

                if changed {
                    let _ = app.emit("prs-updated", ());
                }
            }
            Err(e) => {
                eprintln!("[pronto] Poll failed: {}", e);
            }
        }
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
            start_login,
            poll_login,
            login_with_pat,
            logout,
            get_settings,
            update_settings,
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

            let toggle_shortcut =
                Shortcut::new(Some(Modifiers::SUPER | Modifiers::CONTROL), Code::KeyP);
            let handle = app.handle().clone();
            app.global_shortcut()
                .on_shortcut(toggle_shortcut, move |_app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        tray::toggle_window(&handle);
                    }
                })?;

            let reload_shortcut =
                Shortcut::new(Some(Modifiers::SUPER | Modifiers::CONTROL), Code::KeyR);
            let handle = app.handle().clone();
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
                        let (
                            notify,
                            merged_hours,
                            show_merged,
                            hidden_orgs,
                            hidden_repos,
                            followed_users,
                        ) = {
                            let s = state.settings.lock().unwrap();
                            (
                                s.notifications_enabled,
                                s.merged_window_hours,
                                s.show_recently_merged,
                                s.hidden_orgs.clone(),
                                s.hidden_repos.clone(),
                                s.followed_users.clone(),
                            )
                        };
                        let token = match get_token(&state) {
                            Ok(t) => t,
                            Err(_) => return,
                        };
                        if let Ok(result) = github::fetch_all_prs(
                            &state.http_client,
                            &token,
                            merged_hours,
                            show_merged,
                            &hidden_orgs,
                            &hidden_repos,
                            &followed_users,
                        )
                        .await
                        {
                            process_result(&h, result, notify).0;
                            let _ = h.emit("prs-updated", ());
                        }
                    });
                })?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
