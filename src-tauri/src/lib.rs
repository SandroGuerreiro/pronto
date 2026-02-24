pub mod auth;
pub mod github;
pub mod tray;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
use tauri_plugin_notification::NotificationExt;

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
    app.path().app_data_dir().expect("no app data dir").join("settings.json")
}

pub struct AppState {
    pub cached_prs: Mutex<Option<github::FetchResult>>,
    pub seen_prs: Mutex<HashMap<String, String>>,
    pub cached_token: Mutex<Option<String>>,
    pub settings: Mutex<Settings>,
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

fn send_attention_notification(app: &tauri::AppHandle, result: &github::FetchResult) {
    let titles: Vec<&str> = result
        .open
        .iter()
        .filter(|pr| result.attention_urls.contains(&pr.url))
        .map(|pr| pr.title.as_str())
        .collect();

    if titles.is_empty() {
        return;
    }

    let body = if titles.len() == 1 {
        titles[0].to_string()
    } else {
        format!("{} and {} other", titles[0], titles.len() - 1)
    };

    let _ = app
        .notification()
        .builder()
        .title("PRs need attention")
        .body(body)
        .show();
}

fn process_result(
    app: &tauri::AppHandle,
    mut result: github::FetchResult,
    notify: bool,
) -> github::FetchResult {
    if let Some(state) = app.try_state::<AppState>() {
        {
            let mut seen = state.seen_prs.lock().unwrap();
            result.attention_urls = tray::attention_urls(&result, &seen);

            for pr in &result.open {
                if !seen.contains_key(&pr.url) {
                    seen.insert(pr.url.clone(), tray::attention_fingerprint(pr));
                }
            }
        }

        tray::update_tray_icon(app, !result.attention_urls.is_empty());
        if notify {
            send_attention_notification(app, &result);
        }

        let mut cache = state.cached_prs.lock().unwrap();
        *cache = Some(result.clone());
    }
    result
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

#[tauri::command]
async fn fetch_prs(app: tauri::AppHandle) -> Result<github::FetchResult, String> {
    let state = app.state::<AppState>();
    let token = get_token(&state)?;
    let (merged_hours, show_merged) = {
        let s = state.settings.lock().unwrap();
        (s.merged_window_hours, s.show_recently_merged)
    };
    let result = github::fetch_prs(&token, merged_hours, show_merged)
        .await
        .map_err(|e| e.to_string())?;
    Ok(process_result(&app, result, false))
}

#[tauri::command]
fn dismiss_pr(app: tauri::AppHandle, url: String) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };

    let (fingerprint, result_clone) = {
        let cache = state.cached_prs.lock().unwrap();
        let Some(result) = cache.as_ref() else { return };
        let Some(pr) = result.open.iter().find(|p| p.url == url) else {
            return;
        };
        (tray::attention_fingerprint(pr), result.clone())
    };

    let mut seen = state.seen_prs.lock().unwrap();
    seen.insert(url, fingerprint);
    let has_attention = !tray::attention_urls(&result_clone, &seen).is_empty();
    drop(seen);

    tray::update_tray_icon(&app, has_attention);
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
        let (notify, merged_hours, show_merged) = {
            let s = state.settings.lock().unwrap();
            (s.notifications_enabled, s.merged_window_hours, s.show_recently_merged)
        };
        let token = match get_token(&state) {
            Ok(t) => t,
            Err(_) => continue,
        };

        match github::fetch_prs(&token, merged_hours, show_merged).await {
            Ok(result) => {
                process_result(&app, result, notify);
                let _ = app.emit("prs-updated", ());
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
            fetch_prs,
            dismiss_pr,
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

            let shortcut = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyP);
            let handle = app.handle().clone();
            app.global_shortcut()
                .on_shortcut(shortcut, move |_app, _shortcut, _event| {
                    let h = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        let Some(state) = h.try_state::<AppState>() else {
                            return;
                        };
                        let (notify, merged_hours, show_merged) = {
                            let s = state.settings.lock().unwrap();
                            (s.notifications_enabled, s.merged_window_hours, s.show_recently_merged)
                        };
                        let token = match get_token(&state) {
                            Ok(t) => t,
                            Err(_) => return,
                        };
                        if let Ok(result) = github::fetch_prs(&token, merged_hours, show_merged).await {
                            process_result(&h, result, notify);
                            let _ = h.emit("prs-updated", ());
                        }
                    });
                })?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
