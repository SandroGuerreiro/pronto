use std::collections::HashMap;

use serde::{Deserialize, Serialize};

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
    #[serde(default = "default_true")]
    pub new_comment_participated: bool,
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
            new_comment_participated: true,
        }
    }
}

pub fn default_notification_prefs_owned() -> NotificationPreferences {
    NotificationPreferences {
        review_required: true,
        changes_requested: true,
        approved: true,
        checks_failed: true,
        checks_recovered: true,
        kicked_from_queue: true,
        new_comment: true,
        new_comment_participated: false,
    }
}

pub fn default_true() -> bool {
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
    14400 // 4 hours
}

fn default_popup_screen() -> String {
    "primary".to_string()
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
    #[serde(default = "default_notification_prefs_owned")]
    pub notification_prefs_owned: NotificationPreferences,
    #[serde(default)]
    pub notification_prefs_followed: NotificationPreferences,
    #[serde(default = "default_true")]
    pub notify_on_merged: bool,
    #[serde(default)]
    pub notify_on_closed: bool,
    #[serde(default = "default_true")]
    pub homebrew_check_enabled: bool,
    #[serde(default = "default_homebrew_check_interval")]
    pub homebrew_check_interval_secs: u64,
    #[serde(default = "default_popup_screen")]
    pub popup_screen: String,
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
            notification_prefs_owned: default_notification_prefs_owned(),
            notification_prefs_followed: NotificationPreferences {
                review_required: true,
                ..Default::default()
            },
            notify_on_merged: true,
            notify_on_closed: false,
            homebrew_check_enabled: true,
            homebrew_check_interval_secs: 14400,
            popup_screen: default_popup_screen(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotifyData {
    pub kind: String,
    pub title: String,
    pub message: String,
}
