pub mod github;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Manager,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenv::dotenv().ok();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let token = std::env::var("TOKEN").expect("TOKEN must be set in .env");

            let rt = tokio::runtime::Runtime::new().unwrap();
            let prs = rt
                .block_on(github::fetch_open_prs(&token))
                .unwrap_or_else(|e| {
                    eprintln!("Failed to fetch PRs: {}", e);
                    vec![]
                });

            let mut menu_items: Vec<MenuItem<tauri::Wry>> = Vec::new();
            for pr in &prs {
                let repo_name = pr.repository_url.split('/').last().unwrap_or("unknown");
                let label = format!("{} — {}", pr.title, repo_name);
                let item = MenuItem::with_id(app, &pr.html_url, &label, true, None::<&str>)?;
                menu_items.push(item);
            }

            let mut refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = menu_items
                .iter()
                .map(|i| i as &dyn tauri::menu::IsMenuItem<tauri::Wry>)
                .collect();

            let separator = PredefinedMenuItem::separator(app)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            refs.push(&separator);
            refs.push(&quit_i);

            let menu = Menu::with_items(app, &refs)?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| {
                    let id = event.id.as_ref();
                    if id == "quit" {
                        app.exit(0);
                    } else if id.starts_with("http") {
                        let _ = open::that(id);
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
