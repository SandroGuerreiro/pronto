use std::collections::HashSet;

use super::*;
use crate::github::github_tests::{make_fetch_result, make_pr};
use crate::github::PrElementChanges;

// ── build_attention_notification ─────────────────────────────────────────────

#[test]
fn returns_none_when_no_attention_prs() {
    let result = make_fetch_result(vec![make_pr("https://github.com/org/repo/pull/1")]);
    // No attention URLs → no notification
    let info = build_attention_notification(&result, &HashSet::new());
    assert!(info.is_none());
}

#[test]
fn single_pr_returns_title_body_and_url() {
    let pr = make_pr("https://github.com/org/repo/pull/1");
    let mut result = make_fetch_result(vec![pr]);
    result.attention_urls = vec!["https://github.com/org/repo/pull/1".to_string()];
    result.element_changes.insert(
        "https://github.com/org/repo/pull/1".to_string(),
        PrElementChanges {
            became_approved: true,
            ..Default::default()
        },
    );

    let info = build_attention_notification(&result, &HashSet::new()).unwrap();
    assert_eq!(info.title, "Test PR");
    assert_eq!(info.body, "PR was approved");
    assert_eq!(
        info.url,
        Some("https://github.com/org/repo/pull/1".to_string())
    );
}

#[test]
fn single_merged_pr_shows_merged_body() {
    let mut pr = make_pr("https://github.com/org/repo/pull/1");
    pr.merged = true;
    let mut result = make_fetch_result(vec![]);
    result.recently_merged = vec![pr];
    result.attention_urls = vec!["https://github.com/org/repo/pull/1".to_string()];

    let info = build_attention_notification(&result, &HashSet::new()).unwrap();
    assert_eq!(info.body, "PR was merged");
    assert!(info.url.is_some());
}

#[test]
fn multiple_prs_returns_count_title_and_no_url() {
    let pr1 = make_pr("https://github.com/org/repo/pull/1");
    let pr2 = make_pr("https://github.com/org/repo/pull/2");
    let mut result = make_fetch_result(vec![pr1, pr2]);
    result.attention_urls = vec![
        "https://github.com/org/repo/pull/1".to_string(),
        "https://github.com/org/repo/pull/2".to_string(),
    ];

    let info = build_attention_notification(&result, &HashSet::new()).unwrap();
    assert_eq!(info.title, "2 PRs need attention");
    assert!(info.url.is_none());
}

#[test]
fn filters_already_notified_prs() {
    let pr = make_pr("https://github.com/org/repo/pull/1");
    let mut result = make_fetch_result(vec![pr]);
    result.attention_urls = vec!["https://github.com/org/repo/pull/1".to_string()];

    let mut notified = HashSet::new();
    notified.insert("https://github.com/org/repo/pull/1".to_string());

    let info = build_attention_notification(&result, &notified);
    assert!(info.is_none());
}

#[test]
fn single_pr_no_changes_shows_state_changed() {
    let pr = make_pr("https://github.com/org/repo/pull/1");
    let mut result = make_fetch_result(vec![pr]);
    result.attention_urls = vec!["https://github.com/org/repo/pull/1".to_string()];
    // No element_changes entry

    let info = build_attention_notification(&result, &HashSet::new()).unwrap();
    assert_eq!(info.body, "State changed");
}

// ── attention_urls in NotificationInfo ───────────────────────────────────────

#[test]
fn single_pr_attention_urls_contains_the_pr() {
    let pr = make_pr("https://github.com/org/repo/pull/1");
    let mut result = make_fetch_result(vec![pr]);
    result.attention_urls = vec!["https://github.com/org/repo/pull/1".to_string()];

    let info = build_attention_notification(&result, &HashSet::new()).unwrap();
    assert_eq!(
        info.attention_urls,
        vec!["https://github.com/org/repo/pull/1".to_string()]
    );
}

#[test]
fn multiple_prs_attention_urls_contains_all() {
    let pr1 = make_pr("https://github.com/org/repo/pull/1");
    let pr2 = make_pr("https://github.com/org/repo/pull/2");
    let mut result = make_fetch_result(vec![pr1, pr2]);
    result.attention_urls = vec![
        "https://github.com/org/repo/pull/1".to_string(),
        "https://github.com/org/repo/pull/2".to_string(),
    ];

    let info = build_attention_notification(&result, &HashSet::new()).unwrap();
    assert_eq!(info.attention_urls.len(), 2);
    assert!(info
        .attention_urls
        .contains(&"https://github.com/org/repo/pull/1".to_string()));
    assert!(info
        .attention_urls
        .contains(&"https://github.com/org/repo/pull/2".to_string()));
}

#[test]
fn workflow_notification_has_empty_attention_urls() {
    let info =
        build_workflow_notification("org/repo", "CI", "success", Some("https://example.com"));
    assert!(info.attention_urls.is_empty());
}

// ── build_workflow_notification ──────────────────────────────────────────────

#[test]
fn workflow_success_notification() {
    let info = build_workflow_notification(
        "org/repo",
        "CI",
        "success",
        Some("https://github.com/org/repo/actions/runs/123"),
    );
    assert_eq!(info.title, "org/repo — CI");
    assert_eq!(info.body, "Workflow succeeded");
    assert_eq!(
        info.url,
        Some("https://github.com/org/repo/actions/runs/123".to_string())
    );
}

#[test]
fn workflow_failure_notification() {
    let info = build_workflow_notification("org/repo", "CI", "failure", None);
    assert_eq!(info.title, "org/repo — CI");
    assert_eq!(info.body, "Workflow failure");
    assert!(info.url.is_none());
}

#[test]
fn workflow_notification_with_url() {
    let info = build_workflow_notification(
        "org/repo",
        "Deploy",
        "success",
        Some("https://example.com/run/1"),
    );
    assert_eq!(info.url, Some("https://example.com/run/1".to_string()));
}
