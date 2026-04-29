use std::collections::HashMap;

use super::{attention_fingerprint, attention_urls, compute_element_changes, process_attention};
use crate::github::github_tests::{make_fetch_result, make_pr, with_checks};
use crate::github::{MergeQueueEntry, PrElementChanges};
use crate::types::{NotificationPreferences, Settings};

fn all_prefs() -> NotificationPreferences {
    NotificationPreferences {
        review_required: true,
        changes_requested: true,
        approved: true,
        checks_failed: true,
        checks_recovered: true,
        kicked_from_queue: true,
        new_comment: true,
        new_comment_participated: true,
    }
}

fn settings_with_prefs(owned: NotificationPreferences) -> Settings {
    Settings {
        notification_prefs_owned: owned,
        ..Default::default()
    }
}

// ── attention_fingerprint ─────────────────────────────────────────────────────

#[test]
fn fingerprint_changes_when_review_decision_changes() {
    let mut pr = make_pr("url");
    let fp1 = attention_fingerprint(&pr, "viewer");
    pr.review_decision = Some("APPROVED".to_string());
    let fp2 = attention_fingerprint(&pr, "viewer");
    assert_ne!(fp1, fp2);
}

#[test]
fn fingerprint_changes_when_checks_change() {
    let pr_no_checks = make_pr("url");
    let pr_passing = with_checks(make_pr("url"), "SUCCESS");
    let fp1 = attention_fingerprint(&pr_no_checks, "viewer");
    let fp2 = attention_fingerprint(&pr_passing, "viewer");
    assert_ne!(fp1, fp2);
}

#[test]
fn fingerprint_stable_when_nothing_changes() {
    let pr = make_pr("url");
    assert_eq!(
        attention_fingerprint(&pr, "viewer"),
        attention_fingerprint(&pr, "viewer"),
    );
}

#[test]
fn fingerprint_changes_when_merge_queue_entry_changes() {
    let mut pr = make_pr("url");
    let fp1 = attention_fingerprint(&pr, "viewer");
    pr.merge_queue_entry = Some(MergeQueueEntry { position: 1 });
    let fp2 = attention_fingerprint(&pr, "viewer");
    assert_ne!(fp1, fp2);
}

// ── compute_element_changes ───────────────────────────────────────────────────

fn old_fp(pr: &crate::github::PullRequest) -> String {
    attention_fingerprint(pr, "viewer")
}

#[test]
fn detects_became_approved() {
    let pr_before = make_pr("url");
    let fp = old_fp(&pr_before);
    let mut pr_after = pr_before.clone();
    pr_after.review_decision = Some("APPROVED".to_string());
    let changes = compute_element_changes(&pr_after, &fp, "viewer");
    assert!(changes.became_approved);
    assert!(!changes.became_changes_requested);
}

#[test]
fn detects_became_changes_requested() {
    let pr_before = make_pr("url");
    let fp = old_fp(&pr_before);
    let mut pr_after = pr_before.clone();
    pr_after.review_decision = Some("CHANGES_REQUESTED".to_string());
    let changes = compute_element_changes(&pr_after, &fp, "viewer");
    assert!(changes.became_changes_requested);
}

#[test]
fn detects_checks_failed() {
    let pr_before = with_checks(make_pr("url"), "SUCCESS");
    let fp = old_fp(&pr_before);
    let pr_after = with_checks(pr_before, "FAILURE");
    let changes = compute_element_changes(&pr_after, &fp, "viewer");
    assert!(changes.checks_failed);
}

#[test]
fn detects_checks_recovered() {
    let pr_before = with_checks(make_pr("url"), "FAILURE");
    let fp = old_fp(&pr_before);
    let pr_after = with_checks(pr_before, "SUCCESS");
    let changes = compute_element_changes(&pr_after, &fp, "viewer");
    assert!(changes.checks_recovered);
}

#[test]
fn detects_kicked_from_queue() {
    let mut pr_before = make_pr("url");
    pr_before.merge_queue_entry = Some(MergeQueueEntry { position: 1 });
    let fp = old_fp(&pr_before);
    let mut pr_after = pr_before.clone();
    pr_after.merge_queue_entry = None;
    let changes = compute_element_changes(&pr_after, &fp, "viewer");
    assert!(changes.kicked_from_queue);
}

#[test]
fn no_changes_when_fingerprint_same() {
    let pr = make_pr("url");
    let fp = old_fp(&pr);
    let changes = compute_element_changes(&pr, &fp, "viewer");
    assert!(!changes.became_approved);
    assert!(!changes.became_changes_requested);
    assert!(!changes.became_review_required);
    assert!(!changes.checks_failed);
    assert!(!changes.checks_recovered);
    assert!(!changes.kicked_from_queue);
    assert!(!changes.new_comment);
}

#[test]
fn short_fingerprint_returns_default() {
    let pr = make_pr("url");
    let changes = compute_element_changes(&pr, "bad|fp", "viewer");
    assert_eq!(
        changes.became_approved,
        PrElementChanges::default().became_approved
    );
}

// ── attention_urls ────────────────────────────────────────────────────────────

#[test]
fn new_pr_not_in_seen_gets_no_attention() {
    let pr = make_pr("https://github.com/org/repo/pull/1");
    let result = make_fetch_result(vec![pr]);
    let seen = HashMap::new();
    let settings = settings_with_prefs(all_prefs());
    let urls = attention_urls(&result, &seen, &settings, "viewer");
    assert!(urls.is_empty());
}

#[test]
fn changed_pr_in_seen_gets_attention() {
    let pr_before = make_pr("https://github.com/org/repo/pull/1");
    let fp = attention_fingerprint(&pr_before, "viewer");

    let mut pr_after = pr_before.clone();
    pr_after.review_decision = Some("APPROVED".to_string());

    let result = make_fetch_result(vec![pr_after]);
    let mut seen = HashMap::new();
    seen.insert("https://github.com/org/repo/pull/1".to_string(), fp);

    let settings = settings_with_prefs(all_prefs());
    let urls = attention_urls(&result, &seen, &settings, "viewer");
    assert_eq!(urls, vec!["https://github.com/org/repo/pull/1"]);
}

#[test]
fn unchanged_pr_in_seen_gets_no_attention() {
    let pr = make_pr("https://github.com/org/repo/pull/1");
    let fp = attention_fingerprint(&pr, "viewer");

    let result = make_fetch_result(vec![pr]);
    let mut seen = HashMap::new();
    seen.insert("https://github.com/org/repo/pull/1".to_string(), fp);

    let settings = settings_with_prefs(all_prefs());
    let urls = attention_urls(&result, &seen, &settings, "viewer");
    assert!(urls.is_empty());
}

#[test]
fn pref_disabled_blocks_notification() {
    let pr_before = make_pr("https://github.com/org/repo/pull/1");
    let fp = attention_fingerprint(&pr_before, "viewer");

    let mut pr_after = pr_before.clone();
    pr_after.review_decision = Some("APPROVED".to_string());

    let result = make_fetch_result(vec![pr_after]);
    let mut seen = HashMap::new();
    seen.insert("https://github.com/org/repo/pull/1".to_string(), fp);

    let prefs = NotificationPreferences {
        approved: false,
        ..all_prefs()
    };
    let settings = settings_with_prefs(prefs);
    let urls = attention_urls(&result, &seen, &settings, "viewer");
    assert!(urls.is_empty());
}

#[test]
fn merged_pr_gets_attention_when_setting_enabled() {
    let pr = make_pr("https://github.com/org/repo/pull/1");
    let mut result = make_fetch_result(vec![]);
    result.recently_merged = vec![pr];

    let mut seen = HashMap::new();
    seen.insert(
        "https://github.com/org/repo/pull/1".to_string(),
        "old_fp".to_string(),
    );

    let mut settings = settings_with_prefs(all_prefs());
    settings.notify_on_merged = true;
    let urls = attention_urls(&result, &seen, &settings, "viewer");
    assert!(urls.contains(&"https://github.com/org/repo/pull/1".to_string()));
}

#[test]
fn merged_pr_no_attention_when_setting_disabled() {
    let pr = make_pr("https://github.com/org/repo/pull/1");
    let mut result = make_fetch_result(vec![]);
    result.recently_merged = vec![pr];

    let mut seen = HashMap::new();
    seen.insert(
        "https://github.com/org/repo/pull/1".to_string(),
        "old_fp".to_string(),
    );

    let mut settings = settings_with_prefs(all_prefs());
    settings.notify_on_merged = false;
    let urls = attention_urls(&result, &seen, &settings, "viewer");
    assert!(urls.is_empty());
}

// ── process_attention ─────────────────────────────────────────────────────────

#[test]
fn process_attention_updates_fingerprints_for_unchanged_prs() {
    let pr = make_pr("https://github.com/org/repo/pull/1");
    let result = make_fetch_result(vec![pr.clone()]);
    let mut seen = HashMap::new();
    seen.insert(
        "https://github.com/org/repo/pull/1".to_string(),
        "old_fp".to_string(),
    );

    let settings = settings_with_prefs(all_prefs());
    let (attention, _) = process_attention(&result, &mut seen, &settings, "viewer");
    let _ = attention;
    assert!(seen.contains_key("https://github.com/org/repo/pull/1"));
}

#[test]
fn process_attention_removes_merged_from_seen() {
    let pr = make_pr("https://github.com/org/repo/pull/1");
    let mut result = make_fetch_result(vec![]);
    result.recently_merged = vec![pr];

    let mut seen = HashMap::new();
    seen.insert(
        "https://github.com/org/repo/pull/1".to_string(),
        "fp".to_string(),
    );

    let mut settings = settings_with_prefs(all_prefs());
    settings.notify_on_merged = true;
    process_attention(&result, &mut seen, &settings, "viewer");
    assert!(!seen.contains_key("https://github.com/org/repo/pull/1"));
}

#[test]
fn process_attention_removes_stale_entries() {
    let mut seen = HashMap::new();
    seen.insert(
        "https://github.com/org/repo/pull/999".to_string(),
        "fp".to_string(),
    );

    let result = make_fetch_result(vec![]);
    let settings = settings_with_prefs(all_prefs());
    process_attention(&result, &mut seen, &settings, "viewer");
    assert!(!seen.contains_key("https://github.com/org/repo/pull/999"));
}

#[test]
fn process_attention_returns_element_changes_for_attention_prs() {
    let pr_before = make_pr("https://github.com/org/repo/pull/1");
    let fp = attention_fingerprint(&pr_before, "viewer");
    let mut pr_after = pr_before.clone();
    pr_after.review_decision = Some("APPROVED".to_string());

    let result = make_fetch_result(vec![pr_after]);
    let mut seen = HashMap::new();
    seen.insert("https://github.com/org/repo/pull/1".to_string(), fp);

    let settings = settings_with_prefs(all_prefs());
    let (attention, element_changes) = process_attention(&result, &mut seen, &settings, "viewer");

    assert!(!attention.is_empty());
    let url = &attention[0];
    assert!(element_changes.contains_key(url));
    assert!(element_changes[url].became_approved);
}

// ── Helper ───────────────────────────────────────────────────────────────────

use crate::github::{Owner, ReviewThread, ReviewThreadComment, ReviewThreadComments};

fn make_review_thread(
    total_count: i32,
    last_author: Option<&str>,
    first_author: Option<&str>,
) -> ReviewThread {
    ReviewThread {
        is_resolved: false,
        comments: ReviewThreadComments {
            total_count,
            nodes: last_author
                .map(|login| {
                    vec![ReviewThreadComment {
                        author: Some(Owner {
                            login: login.to_string(),
                        }),
                    }]
                })
                .unwrap_or_default(),
        },
        first_comment: first_author.map(|login| ReviewThreadComments {
            total_count: 1,
            nodes: vec![ReviewThreadComment {
                author: Some(Owner {
                    login: login.to_string(),
                }),
            }],
        }),
    }
}

// ── thread_comments_by_others ────────────────────────────────────────────────

#[test]
fn thread_comments_by_others_empty_threads() {
    assert_eq!(super::thread_comments_by_others(&[], "viewer"), 0);
}

#[test]
fn thread_comments_by_others_last_comment_by_viewer() {
    let threads = vec![make_review_thread(3, Some("viewer"), None)];
    assert_eq!(super::thread_comments_by_others(&threads, "viewer"), 0);
}

#[test]
fn thread_comments_by_others_last_comment_by_other() {
    let threads = vec![make_review_thread(5, Some("alice"), None)];
    assert_eq!(super::thread_comments_by_others(&threads, "viewer"), 5);
}

#[test]
fn thread_comments_by_others_mixed_authors() {
    let threads = vec![
        make_review_thread(3, Some("viewer"), None), // viewer last → excluded
        make_review_thread(4, Some("alice"), None),  // other last → included
        make_review_thread(2, Some("bob"), None),    // other last → included
    ];
    assert_eq!(super::thread_comments_by_others(&threads, "viewer"), 6);
}

#[test]
fn thread_comments_by_others_no_author_on_last_comment() {
    let thread = ReviewThread {
        is_resolved: false,
        comments: ReviewThreadComments {
            total_count: 7,
            nodes: vec![ReviewThreadComment { author: None }],
        },
        first_comment: None,
    };
    // unwrap_or(true) → counts thread when author is missing
    assert_eq!(super::thread_comments_by_others(&[thread], "viewer"), 7);
}

// ── thread_comments_by_others_participated ───────────────────────────────────

#[test]
fn participated_empty_threads() {
    assert_eq!(
        super::thread_comments_by_others_participated(&[], "viewer"),
        0
    );
}

#[test]
fn participated_viewer_started_other_replied() {
    let threads = vec![make_review_thread(5, Some("alice"), Some("viewer"))];
    assert_eq!(
        super::thread_comments_by_others_participated(&threads, "viewer"),
        5
    );
}

#[test]
fn participated_viewer_started_viewer_replied_last() {
    let threads = vec![make_review_thread(3, Some("viewer"), Some("viewer"))];
    // viewer is last commenter → other_replied = false
    assert_eq!(
        super::thread_comments_by_others_participated(&threads, "viewer"),
        0
    );
}

#[test]
fn participated_other_started_other_replied() {
    let threads = vec![make_review_thread(4, Some("bob"), Some("alice"))];
    // viewer didn't start → viewer_started = false
    assert_eq!(
        super::thread_comments_by_others_participated(&threads, "viewer"),
        0
    );
}

#[test]
fn participated_no_first_comment() {
    let threads = vec![make_review_thread(2, Some("alice"), None)];
    // no first_comment → viewer_started = false
    assert_eq!(
        super::thread_comments_by_others_participated(&threads, "viewer"),
        0
    );
}

#[test]
fn participated_mixed_threads() {
    let threads = vec![
        make_review_thread(3, Some("alice"), Some("viewer")), // match: viewer started, alice replied
        make_review_thread(2, Some("viewer"), Some("viewer")), // no: viewer replied last
        make_review_thread(4, Some("bob"), Some("alice")),    // no: viewer didn't start
        make_review_thread(6, Some("charlie"), Some("viewer")), // match: viewer started, charlie replied
    ];
    assert_eq!(
        super::thread_comments_by_others_participated(&threads, "viewer"),
        9
    );
}

// ── should_notify_for_changes with new_comment_participated ──────────────────

#[test]
fn notify_participated_true_pref_enabled() {
    let changes = PrElementChanges {
        new_comment_participated: true,
        ..Default::default()
    };
    let prefs = all_prefs();
    assert!(super::should_notify_for_changes(&changes, &prefs));
}

#[test]
fn notify_participated_true_pref_disabled() {
    let changes = PrElementChanges {
        new_comment_participated: true,
        ..Default::default()
    };
    let prefs = NotificationPreferences {
        new_comment_participated: false,
        ..all_prefs()
    };
    assert!(!super::should_notify_for_changes(&changes, &prefs));
}

#[test]
fn notify_only_participated_pref_enabled() {
    // All other changes false, only participated is true
    let changes = PrElementChanges {
        new_comment_participated: true,
        ..Default::default()
    };
    let prefs = NotificationPreferences {
        review_required: false,
        changes_requested: false,
        approved: false,
        checks_failed: false,
        checks_recovered: false,
        kicked_from_queue: false,
        new_comment: false,
        new_comment_participated: true,
    };
    assert!(super::should_notify_for_changes(&changes, &prefs));
}

// ── compute_element_changes with thread participation ────────────────────────

#[test]
fn compute_changes_detects_new_comment_participated() {
    // Build a PR where viewer started a thread and someone else replied
    let mut pr = make_pr("url");
    pr.review_threads.nodes = vec![make_review_thread(3, Some("alice"), Some("viewer"))];

    // Old fingerprint had 0 participated comments
    let mut base_pr = make_pr("url");
    base_pr.review_threads.nodes = vec![];
    let fp = attention_fingerprint(&base_pr, "viewer");

    let changes = compute_element_changes(&pr, &fp, "viewer");
    assert!(changes.new_comment_participated);
}

#[test]
fn compute_changes_no_new_comment_participated_when_unchanged() {
    // Both old and new have the same thread state
    let mut pr = make_pr("url");
    pr.review_threads.nodes = vec![make_review_thread(3, Some("alice"), Some("viewer"))];

    let fp = attention_fingerprint(&pr, "viewer");
    let changes = compute_element_changes(&pr, &fp, "viewer");
    assert!(!changes.new_comment_participated);
}
