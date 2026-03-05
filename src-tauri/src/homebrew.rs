use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HomebrewStatus {
    pub available: bool,         // false = brew binary not found
    pub update_available: bool,  // true = pronto cask is outdated
    pub installed_version: String,
    pub latest_version: String,
    pub checked_at: String,      // RFC3339
}

#[derive(Debug, Deserialize)]
struct BrewOutdatedResponse {
    casks: Vec<BrewCaskInfo>,
}

#[derive(Debug, Deserialize)]
struct BrewCaskInfo {
    name: String,
    installed_versions: Vec<String>,
    current_version: String,
}

/// Find brew binary in standard locations
pub fn find_brew_binary() -> Option<PathBuf> {
    let paths = [
        "/opt/homebrew/bin/brew",
        "/usr/local/bin/brew",
    ];

    for path in &paths {
        let p = PathBuf::from(path);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

/// Check if pronto cask is outdated via `brew outdated --cask pronto --json=v2`
pub fn check_pronto_update_sync() -> HomebrewStatus {
    let Some(brew_path) = find_brew_binary() else {
        return HomebrewStatus {
            available: false,
            update_available: false,
            installed_version: String::new(),
            latest_version: String::new(),
            checked_at: chrono::Utc::now().to_rfc3339(),
        };
    };

    let output = Command::new(&brew_path)
        .env("HOMEBREW_NO_AUTO_UPDATE", "1")
        .args(&["outdated", "--cask", "pronto", "--json=v2"])
        .output();

    match output {
        Ok(out) => {
            if !out.status.success() {
                return HomebrewStatus {
                    available: true,
                    update_available: false,
                    installed_version: String::new(),
                    latest_version: String::new(),
                    checked_at: chrono::Utc::now().to_rfc3339(),
                };
            }

            match serde_json::from_slice::<BrewOutdatedResponse>(&out.stdout) {
                Ok(resp) => {
                    if let Some(cask) = resp.casks.iter().find(|c| c.name == "pronto") {
                        let installed = cask.installed_versions.first()
                            .cloned()
                            .unwrap_or_default();
                        HomebrewStatus {
                            available: true,
                            update_available: true,
                            installed_version: installed,
                            latest_version: cask.current_version.clone(),
                            checked_at: chrono::Utc::now().to_rfc3339(),
                        }
                    } else {
                        // Pronto not outdated (up to date)
                        HomebrewStatus {
                            available: true,
                            update_available: false,
                            installed_version: String::new(),
                            latest_version: String::new(),
                            checked_at: chrono::Utc::now().to_rfc3339(),
                        }
                    }
                }
                Err(_) => {
                    HomebrewStatus {
                        available: true,
                        update_available: false,
                        installed_version: String::new(),
                        latest_version: String::new(),
                        checked_at: chrono::Utc::now().to_rfc3339(),
                    }
                }
            }
        }
        Err(_) => {
            HomebrewStatus {
                available: true,
                update_available: false,
                installed_version: String::new(),
                latest_version: String::new(),
                checked_at: chrono::Utc::now().to_rfc3339(),
            }
        }
    }
}
