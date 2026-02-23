pub mod github;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    App, Manager,
};

use github::PullRequest;

fn format_menu_label(pr: &PullRequest) -> String {
    let review = pr.review_label();
    if review.is_empty() {
        format!("{} {} — {}", pr.status_icon(), pr.title, pr.repository.name)
    } else {
        format!(
            "{} {} — {} ({})",
            pr.status_icon(),
            pr.title,
            pr.repository.name,
            review
        )
    }
}

fn build_pr_menu_items(
    app: &App,
    prs: &[PullRequest],
) -> Result<Vec<MenuItem<tauri::Wry>>, Box<dyn std::error::Error>> {
    let mut items = Vec::new();
    for pr in prs {
        let label = format_menu_label(pr);
        let item = MenuItem::with_id(app, &pr.url, &label, true, None::<&str>)?;
        items.push(item);
    }
    Ok(items)
}

fn setup_tray(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let token = std::env::var("TOKEN").expect("TOKEN must be set in .env");

    let rt = tokio::runtime::Runtime::new()?;
    let result = rt.block_on(github::fetch_prs(&token)).unwrap_or_else(|e| {
        eprintln!("Failed to fetch PRs: {}", e);
        github::FetchResult {
            open: vec![],
            recently_merged: vec![],
        }
    });

    let open_items = build_pr_menu_items(app, &result.open)?;
    let merged_items = build_pr_menu_items(app, &result.recently_merged)?;

    let mut refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = Vec::new();

    for item in &open_items {
        refs.push(item as &dyn tauri::menu::IsMenuItem<tauri::Wry>);
    }

    let sep = PredefinedMenuItem::separator(app)?;
    if !merged_items.is_empty() {
        refs.push(&sep);
        for item in &merged_items {
            refs.push(item as &dyn tauri::menu::IsMenuItem<tauri::Wry>);
        }
    }

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
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenv::dotenv().ok();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            setup_tray(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
