use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HomebrewStatus {
    pub available: bool,        // false = brew binary not found
    pub update_available: bool, // true = pronto cask is outdated
    pub installed_version: String,
    pub latest_version: String,
    pub checked_at: String, // RFC3339
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
    let paths = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"];

    for path in &paths {
        let p = PathBuf::from(path);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

/// Refresh only the sandroguerreiro/tap so `brew outdated` sees the latest cask version
/// without running a full `brew update` that touches all taps + core.
fn refresh_tap(brew_path: &std::path::Path) {
    let output = Command::new(brew_path)
        .args(&["--repository", "sandroguerreiro/tap"])
        .output();

    if let Ok(out) = output {
        let tap_path = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !tap_path.is_empty() {
            let _ = Command::new("git")
                .args(&["-C", &tap_path, "fetch", "origin"])
                .output();
            let _ = Command::new("git")
                .args(&["-C", &tap_path, "reset", "--hard", "origin/master"])
                .output();
        }
    }
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

    // Refresh only our tap before checking for updates
    refresh_tap(&brew_path);

    let output = Command::new(&brew_path)
        .env("HOMEBREW_NO_AUTO_UPDATE", "1")
        .args(&["outdated", "--cask", "pronto", "--json=v2"])
        .output();

    match output {
        Ok(out) => {
            // Try to parse JSON regardless of exit code (brew may return non-zero but valid JSON)
            match serde_json::from_slice::<BrewOutdatedResponse>(&out.stdout) {
                Ok(resp) => {
                    if let Some(cask) = resp.casks.iter().find(|c| c.name == "pronto") {
                        let installed =
                            cask.installed_versions.first().cloned().unwrap_or_default();
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
                Err(_) => HomebrewStatus {
                    available: true,
                    update_available: false,
                    installed_version: String::new(),
                    latest_version: String::new(),
                    checked_at: chrono::Utc::now().to_rfc3339(),
                },
            }
        }
        Err(_) => HomebrewStatus {
            available: true,
            update_available: false,
            installed_version: String::new(),
            latest_version: String::new(),
            checked_at: chrono::Utc::now().to_rfc3339(),
        },
    }
}
