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
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            cached_prs: Mutex::new(None),
            seen_prs: Mutex::new(HashMap::new()),
        }
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

/// Populates `attention_urls` on the result, updates the tray icon, and caches.
/// PRs that don't need attention are auto-recorded so future changes are detected.
fn process_result(app: &tauri::AppHandle, mut result: github::FetchResult) -> github::FetchResult {
    if let Some(state) = app.try_state::<AppState>() {
        {
            let mut seen = state.seen_prs.lock().unwrap();
            result.attention_urls = tray::attention_urls(&result, &seen);

            for pr in &result.open {
                if !result.attention_urls.contains(&pr.url) && !seen.contains_key(&pr.url) {
                    seen.insert(pr.url.clone(), tray::attention_fingerprint(pr));
                }
            }
        }

        tray::update_tray_icon(app, !result.attention_urls.is_empty());
        send_attention_notification(app, &result);

        let mut cache = state.cached_prs.lock().unwrap();
        *cache = Some(result.clone());
    }
    result
}

#[tauri::command]
async fn fetch_prs(app: tauri::AppHandle) -> Result<github::FetchResult, String> {
    let token = std::env::var("TOKEN").map_err(|e| e.to_string())?;
    let result = github::fetch_prs(&token).await.map_err(|e| e.to_string())?;
    Ok(process_result(&app, result))
}

#[tauri::command]
fn dismiss_pr(app: tauri::AppHandle, url: String) {
    let Some(state) = app.try_state::<AppState>() else { return };

    let (fingerprint, result_clone) = {
        let cache = state.cached_prs.lock().unwrap();
        let Some(result) = cache.as_ref() else { return };
        let Some(pr) = result.open.iter().find(|p| p.url == url) else { return };
        (tray::attention_fingerprint(pr), result.clone())
    };

    let mut seen = state.seen_prs.lock().unwrap();
    seen.insert(url, fingerprint);
    let has_attention = !tray::attention_urls(&result_clone, &seen).is_empty();
    drop(seen);

    tray::update_tray_icon(&app, has_attention);
}

async fn poll_prs(app: tauri::AppHandle) {
    let token = match std::env::var("TOKEN") {
        Ok(t) => t,
        Err(_) => {
            eprintln!("[pronto] TOKEN not set, polling disabled");
            return;
        }
    };

    loop {
        tokio::time::sleep(Duration::from_secs(300)).await;

        match github::fetch_prs(&token).await {
            Ok(result) => {
                process_result(&app, result);
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
    dotenv::dotenv().ok();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![fetch_prs, dismiss_pr])
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
            app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, _event| {
                let h = handle.clone();
                tauri::async_runtime::spawn(async move {
                    eprintln!("[pronto] Manual refresh triggered via Cmd+Shift+P");
                    let token = match std::env::var("TOKEN") {
                        Ok(t) => t,
                        Err(_) => return,
                    };
                    if let Ok(result) = github::fetch_prs(&token).await {
                        process_result(&h, result);
                        let _ = h.emit("prs-updated", ());
                    }
                });
            })?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
