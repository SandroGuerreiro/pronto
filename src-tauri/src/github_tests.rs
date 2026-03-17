use super::*;

// ── Fixtures ──────────────────────────────────────────────────────────────────
// These are `pub` so tray_tests.rs can reuse them.

pub fn make_pr(url: &str) -> PullRequest {
    PullRequest {
        title: "Test PR".to_string(),
        url: url.to_string(),
        state: "OPEN".to_string(),
        merged: false,
        is_draft: false,
        repository: Repository {
            name: "repo".to_string(),
            owner: Owner { login: "org".to_string() },
        },
        merge_queue_entry: None,
        review_decision: None,
        created_at: "2024-01-01T00:00:00Z".to_string(),
        merged_at: None,
        closed_at: None,
        merge_state_status: None,
        reviews: Reviews { total_count: 0 },
        comments: Comments { total_count: 0, nodes: vec![] },
        review_threads: ReviewThreads { nodes: vec![] },
        commits: CommitConnection { nodes: vec![] },
        author: Owner { login: "author".to_string() },
    }
}

pub fn with_checks(mut pr: PullRequest, state: &str) -> PullRequest {
    pr.commits = CommitConnection {
        nodes: vec![CommitNode {
            commit: Commit {
                oid: "abc123".to_string(),
                status_check_rollup: Some(StatusCheckRollup { state: state.to_string() }),
            },
        }],
    };
    pr
}

pub fn with_merge_state(mut pr: PullRequest, merge_state: &str) -> PullRequest {
    pr.merge_state_status = Some(merge_state.to_string());
    pr
}

pub fn make_fetch_result(open: Vec<PullRequest>) -> FetchResult {
    FetchResult {
        open,
        recently_merged: vec![],
        recently_closed: vec![],
        followed_open: vec![],
        followed_recently_merged: vec![],
        followed_recently_closed: vec![],
        attention_urls: vec![],
        element_changes: std::collections::HashMap::new(),
        workflow_status: None,
        expired_followed_prs: vec![],
        viewer_login: "viewer".to_string(),
        viewer_avatar_url: String::new(),
    }
}

// ── PrElementChanges::describe ────────────────────────────────────────────────

#[test]
fn describe_merged() {
    let changes = PrElementChanges::default();
    assert_eq!(changes.describe(true), "PR was merged");
}

#[test]
fn describe_approved() {
    let changes = PrElementChanges { became_approved: true, ..Default::default() };
    assert_eq!(changes.describe(false), "PR was approved");
}

#[test]
fn describe_changes_requested() {
    let changes = PrElementChanges { became_changes_requested: true, ..Default::default() };
    assert_eq!(changes.describe(false), "Changes requested");
}

#[test]
fn describe_review_required() {
    let changes = PrElementChanges { became_review_required: true, ..Default::default() };
    assert_eq!(changes.describe(false), "Review required");
}

#[test]
fn describe_checks_failed() {
    let changes = PrElementChanges { checks_failed: true, ..Default::default() };
    assert_eq!(changes.describe(false), "Checks failed");
}

#[test]
fn describe_checks_recovered() {
    let changes = PrElementChanges { checks_recovered: true, ..Default::default() };
    assert_eq!(changes.describe(false), "Checks passed");
}

#[test]
fn describe_kicked_from_queue() {
    let changes = PrElementChanges { kicked_from_queue: true, ..Default::default() };
    assert_eq!(changes.describe(false), "Removed from merge queue");
}

#[test]
fn describe_new_comment() {
    let changes = PrElementChanges { new_comment: true, ..Default::default() };
    assert_eq!(changes.describe(false), "New comments");
}

#[test]
fn describe_new_comment_participated() {
    let changes = PrElementChanges { new_comment_participated: true, ..Default::default() };
    assert_eq!(changes.describe(false), "Reply to your comment");
}

#[test]
fn describe_participated_takes_priority_over_new_comment() {
    let changes = PrElementChanges {
        new_comment: true,
        new_comment_participated: true,
        ..Default::default()
    };
    assert!(changes.describe(false).contains("Reply to your comment"));
    assert!(!changes.describe(false).contains("New comments"));
}

#[test]
fn describe_multiple_changes_joined() {
    let changes = PrElementChanges {
        became_approved: true,
        checks_failed: true,
        ..Default::default()
    };
    let desc = changes.describe(false);
    assert!(desc.contains("PR was approved"));
    assert!(desc.contains("Checks failed"));
}

#[test]
fn describe_empty_returns_state_changed() {
    let changes = PrElementChanges::default();
    assert_eq!(changes.describe(false), "State changed");
}

// ── PullRequest::status ───────────────────────────────────────────────────────

#[test]
fn status_open() {
    let pr = make_pr("url");
    assert!(matches!(pr.status(), PrStatus::Open));
}

#[test]
fn status_merged() {
    let mut pr = make_pr("url");
    pr.state = "MERGED".to_string();
    pr.merged = true;
    assert!(matches!(pr.status(), PrStatus::Merged));
}

#[test]
fn status_closed() {
    let mut pr = make_pr("url");
    pr.state = "CLOSED".to_string();
    assert!(matches!(pr.status(), PrStatus::Closed));
}

#[test]
fn status_in_queue() {
    let mut pr = make_pr("url");
    pr.merge_queue_entry = Some(MergeQueueEntry { position: 1 });
    assert!(matches!(pr.status(), PrStatus::InQueue));
}

#[test]
fn status_draft() {
    let mut pr = make_pr("url");
    pr.is_draft = true;
    assert!(matches!(pr.status(), PrStatus::Draft));
}

// ── PullRequest::review_label ─────────────────────────────────────────────────

#[test]
fn review_label_approved() {
    let mut pr = make_pr("url");
    pr.review_decision = Some("APPROVED".to_string());
    pr.reviews.total_count = 2;
    assert_eq!(pr.review_label(), "2 approved");
}

#[test]
fn review_label_changes_requested() {
    let mut pr = make_pr("url");
    pr.review_decision = Some("CHANGES_REQUESTED".to_string());
    assert_eq!(pr.review_label(), "changes requested");
}

#[test]
fn review_label_review_required_no_approvals() {
    let mut pr = make_pr("url");
    pr.review_decision = Some("REVIEW_REQUIRED".to_string());
    assert_eq!(pr.review_label(), "needs reviews");
}

#[test]
fn review_label_review_required_with_approvals() {
    let mut pr = make_pr("url");
    pr.review_decision = Some("REVIEW_REQUIRED".to_string());
    pr.reviews.total_count = 1;
    assert_eq!(pr.review_label(), "1 / needs reviews");
}

#[test]
fn review_label_no_decision() {
    let pr = make_pr("url");
    assert_eq!(pr.review_label(), "");
}

// ── Comments::subtract_bots ───────────────────────────────────────────────────

#[test]
fn subtract_bots_removes_bot_count() {
    let mut comments = Comments {
        total_count: 5,
        nodes: vec![
            CommentNode { author: CommentAuthor { login: "human".to_string(), type_name: "User".to_string() } },
            CommentNode { author: CommentAuthor { login: "bot".to_string(), type_name: "Bot".to_string() } },
            CommentNode { author: CommentAuthor { login: "bot2".to_string(), type_name: "Bot".to_string() } },
        ],
    };
    comments.subtract_bots();
    assert_eq!(comments.total_count, 3);
}

#[test]
fn subtract_bots_clamps_to_zero() {
    let mut comments = Comments {
        total_count: 1,
        nodes: vec![
            CommentNode { author: CommentAuthor { login: "bot".to_string(), type_name: "Bot".to_string() } },
            CommentNode { author: CommentAuthor { login: "bot2".to_string(), type_name: "Bot".to_string() } },
        ],
    };
    comments.subtract_bots();
    assert_eq!(comments.total_count, 0);
}

#[test]
fn subtract_bots_no_bots_unchanged() {
    let mut comments = Comments {
        total_count: 3,
        nodes: vec![
            CommentNode { author: CommentAuthor { login: "human".to_string(), type_name: "User".to_string() } },
        ],
    };
    comments.subtract_bots();
    assert_eq!(comments.total_count, 3);
}

// ── Comments::last_human_commenter ────────────────────────────────────────────

#[test]
fn last_human_commenter_finds_last_non_bot() {
    let comments = Comments {
        total_count: 2,
        nodes: vec![
            CommentNode { author: CommentAuthor { login: "alice".to_string(), type_name: "User".to_string() } },
            CommentNode { author: CommentAuthor { login: "bot".to_string(), type_name: "Bot".to_string() } },
        ],
    };
    assert_eq!(comments.last_human_commenter(), Some("alice"));
}

#[test]
fn last_human_commenter_none_when_all_bots() {
    let comments = Comments {
        total_count: 1,
        nodes: vec![
            CommentNode { author: CommentAuthor { login: "bot".to_string(), type_name: "Bot".to_string() } },
        ],
    };
    assert_eq!(comments.last_human_commenter(), None);
}

#[test]
fn last_human_commenter_none_when_empty() {
    let comments = Comments { total_count: 0, nodes: vec![] };
    assert_eq!(comments.last_human_commenter(), None);
}

// ── apply_merge_state ─────────────────────────────────────────────────────────

#[test]
fn apply_merge_state_clean_forces_success() {
    let mut pr = with_checks(with_merge_state(make_pr("url"), "CLEAN"), "FAILURE");
    apply_merge_state(&mut pr);
    let state = pr.commits.nodes[0].commit.status_check_rollup.as_ref().unwrap().state.as_str();
    assert_eq!(state, "SUCCESS");
}

#[test]
fn apply_merge_state_unstable_converts_failure_to_success() {
    let mut pr = with_checks(with_merge_state(make_pr("url"), "UNSTABLE"), "FAILURE");
    apply_merge_state(&mut pr);
    let state = pr.commits.nodes[0].commit.status_check_rollup.as_ref().unwrap().state.as_str();
    assert_eq!(state, "SUCCESS");
}

#[test]
fn apply_merge_state_blocked_success_becomes_pending() {
    let mut pr = with_checks(with_merge_state(make_pr("url"), "BLOCKED"), "SUCCESS");
    apply_merge_state(&mut pr);
    let state = pr.commits.nodes[0].commit.status_check_rollup.as_ref().unwrap().state.as_str();
    assert_eq!(state, "PENDING");
}

#[test]
fn apply_merge_state_blocked_success_with_review_stays_success() {
    let mut pr = with_checks(with_merge_state(make_pr("url"), "BLOCKED"), "SUCCESS");
    pr.review_decision = Some("REVIEW_REQUIRED".to_string());
    apply_merge_state(&mut pr);
    let state = pr.commits.nodes[0].commit.status_check_rollup.as_ref().unwrap().state.as_str();
    assert_eq!(state, "SUCCESS");
}

#[test]
fn apply_merge_state_clean_keeps_pending() {
    let mut pr = with_checks(with_merge_state(make_pr("url"), "CLEAN"), "PENDING");
    apply_merge_state(&mut pr);
    let state = pr.commits.nodes[0].commit.status_check_rollup.as_ref().unwrap().state.as_str();
    assert_eq!(state, "PENDING");
}

#[test]
fn apply_merge_state_has_hooks_keeps_pending() {
    let mut pr = with_checks(with_merge_state(make_pr("url"), "HAS_HOOKS"), "PENDING");
    apply_merge_state(&mut pr);
    let state = pr.commits.nodes[0].commit.status_check_rollup.as_ref().unwrap().state.as_str();
    assert_eq!(state, "PENDING");
}

#[test]
fn apply_merge_state_no_merge_state_noop() {
    let mut pr = with_checks(make_pr("url"), "FAILURE");
    apply_merge_state(&mut pr);
    let state = pr.commits.nodes[0].commit.status_check_rollup.as_ref().unwrap().state.as_str();
    assert_eq!(state, "FAILURE");
}
