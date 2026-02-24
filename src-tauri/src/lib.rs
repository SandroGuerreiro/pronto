pub mod auth;
pub mod github;
pub mod tray;

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
use tauri_plugin_notification::NotificationExt;

pub struct AppState {
    pub cached_prs: Mutex<Option<github::FetchResult>>,
    pub seen_prs: Mutex<HashMap<String, String>>,
    pub cached_token: Mutex<Option<String>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            cached_prs: Mutex::new(None),
            seen_prs: Mutex::new(HashMap::new()),
            cached_token: Mutex::new(None),
        }
    }
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
async fn fetch_prs(app: tauri::AppHandle) -> Result<github::FetchResult, String> {
    let state = app.state::<AppState>();
    let token = get_token(&state)?;
    let result = github::fetch_prs(&token).await.map_err(|e| e.to_string())?;
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
        tokio::time::sleep(Duration::from_secs(60)).await;

        let Some(state) = app.try_state::<AppState>() else {
            continue;
        };
        let token = match get_token(&state) {
            Ok(t) => t,
            Err(_) => continue,
        };

        match github::fetch_prs(&token).await {
            Ok(result) => {
                process_result(&app, result, true);
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
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            fetch_prs,
            dismiss_pr,
            check_auth,
            start_login,
            poll_login,
            login_with_pat,
            logout,
        ])
        .setup(|app| {
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
                        let token = match get_token(&state) {
                            Ok(t) => t,
                            Err(_) => return,
                        };
                        if let Ok(result) = github::fetch_prs(&token).await {
                            process_result(&h, result, true);
                            let _ = h.emit("prs-updated", ());
                        }
                    });
                })?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
