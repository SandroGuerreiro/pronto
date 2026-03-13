use crate::github::{FetchResult, PullRequest};

/// Information needed to display and handle a macOS notification.
#[derive(Debug, Clone, PartialEq)]
pub struct NotificationInfo {
    pub title: String,
    pub body: String,
    /// URL to open when the user clicks the notification.
    /// `None` for multi-PR notifications (opens the popup instead).
    pub url: Option<String>,
    /// PR URLs to dismiss from attention when the notification is clicked.
    pub attention_urls: Vec<String>,
}

/// Build notification info from attention PRs in a fetch result.
/// Returns `None` if there are no attention PRs.
pub fn build_attention_notification(
    result: &FetchResult,
    already_notified: &std::collections::HashSet<String>,
) -> Option<NotificationInfo> {
    let attention_prs: Vec<&PullRequest> = result
        .open
        .iter()
        .chain(result.recently_merged.iter())
        .filter(|pr| result.attention_urls.contains(&pr.url))
        .filter(|pr| !already_notified.contains(&pr.url))
        .collect();

    if attention_prs.is_empty() {
        return None;
    }

    let all_urls: Vec<String> = attention_prs.iter().map(|pr| pr.url.clone()).collect();

    if attention_prs.len() == 1 {
        let pr = attention_prs[0];
        let changes = result
            .element_changes
            .get(&pr.url)
            .cloned()
            .unwrap_or_default();
        Some(NotificationInfo {
            title: pr.title.clone(),
            body: changes.describe(pr.merged),
            url: Some(pr.url.clone()),
            attention_urls: all_urls,
        })
    } else {
        let count = attention_prs.len();
        let names: Vec<String> = attention_prs.iter().map(|pr| pr.title.clone()).collect();
        Some(NotificationInfo {
            title: format!("{} PRs need attention", count),
            body: names.join("\n"),
            url: None,
            attention_urls: all_urls,
        })
    }
}

/// Build notification info for a workflow status change.
pub fn build_workflow_notification(
    repo: &str,
    workflow_name: &str,
    conclusion: &str,
    html_url: Option<&str>,
) -> NotificationInfo {
    let title = format!("{} — {}", repo, workflow_name);
    let body = if conclusion == "success" {
        "Workflow succeeded".to_string()
    } else {
        format!("Workflow {}", conclusion)
    };
    NotificationInfo {
        title,
        body,
        url: html_url.map(|u| u.to_string()),
        attention_urls: vec![],
    }
}

/// Handle notification click by opening the URL in the default browser.
pub fn open_notification_url(url: &str) {
    let _ = open::that(url);
}

#[cfg(test)]
#[path = "notification_tests.rs"]
mod tests;
