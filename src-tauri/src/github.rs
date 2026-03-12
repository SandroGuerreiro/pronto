use reqwest::header::{AUTHORIZATION, USER_AGENT};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct GraphQLQuery {
    pub query: String,
}

#[derive(Debug, Deserialize)]
pub struct GraphQLResponse {
    pub data: Option<Data>,
    pub errors: Option<Vec<GraphQLError>>,
}

#[derive(Debug, Deserialize)]
pub struct GraphQLError {
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct Viewer {
    pub login: String,
}

#[derive(Debug, Deserialize)]
pub struct Data {
    pub viewer: Viewer,
    pub open: SearchResult,
    #[serde(rename = "recentlyMerged")]
    pub recently_merged: SearchResult,
    #[serde(rename = "recentlyClosed")]
    pub recently_closed: SearchResult,
}

#[derive(Debug, Deserialize)]
pub struct SearchResult {
    pub nodes: Vec<PullRequest>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PullRequest {
    pub title: String,
    pub url: String,
    pub state: String,
    pub merged: bool,
    pub repository: Repository,
    #[serde(rename = "mergeQueueEntry")]
    pub merge_queue_entry: Option<MergeQueueEntry>,
    #[serde(rename = "reviewDecision")]
    pub review_decision: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "mergedAt")]
    pub merged_at: Option<String>,
    #[serde(rename = "closedAt")]
    pub closed_at: Option<String>,
    #[serde(rename = "mergeStateStatus")]
    pub merge_state_status: Option<String>,
    pub reviews: Reviews,
    pub comments: Comments,
    #[serde(rename = "reviewThreads")]
    pub review_threads: ReviewThreads,
    pub commits: CommitConnection,
    pub author: Owner,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Owner {
    pub login: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Repository {
    pub name: String,
    pub owner: Owner,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct MergeQueueEntry {
    pub position: i32,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Reviews {
    #[serde(rename = "totalCount")]
    pub total_count: i32,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CommentAuthor {
    pub login: String,
    #[serde(rename = "__typename")]
    pub type_name: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CommentNode {
    pub author: CommentAuthor,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Comments {
    #[serde(rename = "totalCount")]
    pub total_count: i32,
    #[serde(skip_serializing)]
    pub nodes: Vec<CommentNode>,
}

impl Comments {
    /// Adjusts `total_count` to exclude bot comments, using the fetched nodes as a sample.
    /// Accurate when all comments fit within the fetch window (last 100); conservative otherwise.
    pub fn subtract_bots(&mut self) {
        let bot_count = self.nodes.iter().filter(|n| n.author.type_name == "Bot").count() as i32;
        self.total_count = (self.total_count - bot_count).max(0);
    }

    /// Returns the most recent comment author who is not a bot, if any.
    pub fn last_human_commenter(&self) -> Option<&str> {
        self.nodes
            .iter()
            .rev()
            .find(|n| n.author.type_name != "Bot")
            .map(|n| n.author.login.as_str())
    }
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ReviewThreads {
    pub nodes: Vec<ReviewThread>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ReviewThread {
    #[serde(rename = "isResolved")]
    pub is_resolved: bool,
    pub comments: ReviewThreadComments,
    /// First comment in the thread (the thread author). GraphQL alias: `firstComment: comments(first: 1)`.
    #[serde(rename = "firstComment")]
    pub first_comment: Option<ReviewThreadComments>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ReviewThreadComments {
    #[serde(rename = "totalCount")]
    pub total_count: i32,
    pub nodes: Vec<ReviewThreadComment>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ReviewThreadComment {
    pub author: Option<Owner>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CommitConnection {
    pub nodes: Vec<CommitNode>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CommitNode {
    pub commit: Commit,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Commit {
    pub oid: String,
    #[serde(rename = "statusCheckRollup")]
    pub status_check_rollup: Option<StatusCheckRollup>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct StatusCheckRollup {
    pub state: String,
}

pub enum PrStatus {
    Open,
    Merged,
    Closed,
    InQueue,
}

impl PullRequest {
    pub fn status(&self) -> PrStatus {
        if self.merge_queue_entry.is_some() {
            PrStatus::InQueue
        } else if self.state == "OPEN" {
            PrStatus::Open
        } else if self.merged {
            PrStatus::Merged
        } else {
            PrStatus::Closed
        }
    }

    pub fn status_icon(&self) -> &str {
        match self.status() {
            PrStatus::Open => "●",
            PrStatus::Merged => "✓",
            PrStatus::Closed => "✗",
            PrStatus::InQueue => "◎",
        }
    }

    pub fn review_label(&self) -> String {
        let approvals = self.reviews.total_count;
        match self.review_decision.as_deref() {
            Some("APPROVED") => format!("{} approved", approvals),
            Some("CHANGES_REQUESTED") => "changes requested".to_string(),
            Some("REVIEW_REQUIRED") => {
                if approvals > 0 {
                    format!("{} / needs reviews", approvals)
                } else {
                    "needs reviews".to_string()
                }
            }
            _ => String::new(),
        }
    }
}

/// Which individual elements changed on a PR since the last poll.
/// Only populated for PRs that are in `attention_urls`.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct PrElementChanges {
    pub became_review_required: bool,
    pub became_changes_requested: bool,
    pub became_approved: bool,
    pub checks_failed: bool,
    pub checks_recovered: bool,
    pub kicked_from_queue: bool,
    pub new_comment: bool,
    pub new_comment_participated: bool,
}

impl PrElementChanges {
    /// Produces a human-readable description of what changed, for use in notifications.
    pub fn describe(&self, is_merged: bool) -> String {
        if is_merged {
            return "PR was merged".to_string();
        }

        let mut parts = Vec::new();
        if self.became_approved { parts.push("PR was approved"); }
        if self.became_changes_requested { parts.push("Changes requested"); }
        if self.became_review_required { parts.push("Review required"); }
        if self.checks_failed { parts.push("Checks failed"); }
        if self.checks_recovered { parts.push("Checks passed"); }
        if self.kicked_from_queue { parts.push("Removed from merge queue"); }
        if self.new_comment_participated {
            parts.push("Reply to your comment");
        } else if self.new_comment {
            parts.push("New comments");
        }

        if parts.is_empty() {
            "State changed".to_string()
        } else {
            parts.join(", ")
        }
    }
}

#[derive(Serialize, Clone)]
pub struct FetchResult {
    pub open: Vec<PullRequest>,
    pub recently_merged: Vec<PullRequest>,
    pub recently_closed: Vec<PullRequest>,
    pub followed_open: Vec<PullRequest>,
    pub followed_recently_merged: Vec<PullRequest>,
    pub followed_recently_closed: Vec<PullRequest>,
    pub attention_urls: Vec<String>,
    pub element_changes: std::collections::HashMap<String, PrElementChanges>,
    pub workflow_status: Option<WorkflowStatus>,
    pub expired_followed_prs: Vec<String>,
    pub viewer_login: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkflowStatus {
    pub conclusion: String,
    pub status: String,
    pub workflow_name: String,
    pub repo: String,
    pub updated_at: String,
    pub html_url: String,
}

#[derive(Debug, Deserialize)]
struct WorkflowRunsResponse {
    workflow_runs: Vec<WorkflowRun>,
}

#[derive(Debug, Deserialize)]
struct WorkflowRun {
    status: String,
    conclusion: Option<String>,
    updated_at: String,
    html_url: String,
}

async fn fetch_prs_for_author(
    client: &reqwest::Client,
    token: &str,
    author: &str,
    merged_window_hours: u64,
    show_recently_merged: bool,
    closed_window_hours: u64,
    show_recently_closed: bool,
    exclusions: &str,
) -> Result<
    (Vec<PullRequest>, Vec<PullRequest>, Vec<PullRequest>, String),
    Box<dyn std::error::Error + Send + Sync>,
> {
    let merged_cutoff = (chrono::Utc::now() - chrono::Duration::hours(merged_window_hours as i64))
        .format("%Y-%m-%d")
        .to_string();
    let closed_cutoff = (chrono::Utc::now() - chrono::Duration::hours(closed_window_hours as i64))
        .format("%Y-%m-%d")
        .to_string();

    let query = GraphQLQuery {
        query: format!(
            r#"{{
  viewer {{ login }}
  open: search(query: "author:{author} type:pr state:open{exclusions}", type: ISSUE, first: 20) {{
    nodes {{
      ... on PullRequest {{
        title
        url
        state
        merged
        createdAt
        mergedAt
        closedAt
        repository {{ name owner {{ login }} }}
        mergeQueueEntry {{ position }}
        mergeStateStatus
        reviewDecision
        reviews(states: APPROVED) {{ totalCount }}
        comments(last: 5) {{ totalCount nodes {{ author {{ login __typename }} }} }}
        reviewThreads(first: 20) {{ nodes {{ isResolved comments(last: 1) {{ totalCount nodes {{ author {{ login }} }} }} firstComment: comments(first: 1) {{ totalCount nodes {{ author {{ login }} }} }} }} }}
        commits(last: 1) {{ nodes {{ commit {{ oid statusCheckRollup {{ state }} }} }} }}
        author {{ login }}
      }}
    }}
  }}
  recentlyMerged: search(query: "author:{author} type:pr is:merged merged:>{merged_cutoff}{exclusions}", type: ISSUE, first: 10) {{
    nodes {{
      ... on PullRequest {{
        title
        url
        state
        merged
        createdAt
        mergedAt
        closedAt
        repository {{ name owner {{ login }} }}
        mergeQueueEntry {{ position }}
        mergeStateStatus
        reviewDecision
        reviews(states: APPROVED) {{ totalCount }}
        comments(last: 5) {{ totalCount nodes {{ author {{ login __typename }} }} }}
        reviewThreads(first: 20) {{ nodes {{ isResolved comments(last: 1) {{ totalCount nodes {{ author {{ login }} }} }} firstComment: comments(first: 1) {{ totalCount nodes {{ author {{ login }} }} }} }} }}
        commits(last: 1) {{ nodes {{ commit {{ oid statusCheckRollup {{ state }} }} }} }}
        author {{ login }}
      }}
    }}
  }}
  recentlyClosed: search(query: "author:{author} type:pr is:unmerged is:closed closed:>{closed_cutoff}{exclusions}", type: ISSUE, first: 10) {{
    nodes {{
      ... on PullRequest {{
        title
        url
        state
        merged
        createdAt
        mergedAt
        closedAt
        repository {{ name owner {{ login }} }}
        mergeQueueEntry {{ position }}
        mergeStateStatus
        reviewDecision
        reviews(states: APPROVED) {{ totalCount }}
        comments(last: 5) {{ totalCount nodes {{ author {{ login __typename }} }} }}
        reviewThreads(first: 20) {{ nodes {{ isResolved comments(last: 1) {{ totalCount nodes {{ author {{ login }} }} }} firstComment: comments(first: 1) {{ totalCount nodes {{ author {{ login }} }} }} }} }}
        commits(last: 1) {{ nodes {{ commit {{ oid statusCheckRollup {{ state }} }} }} }}
        author {{ login }}
      }}
    }}
  }}
}}"#
        ),
    };

    let http_response = client
        .post("https://api.github.com/graphql")
        .header(AUTHORIZATION, format!("Bearer {}", token))
        .header(USER_AGENT, "pronto")
        .json(&query)
        .send()
        .await?;

    let status = http_response.status();
    let raw = http_response.text().await?;

    if !status.is_success() {
        let msg = format!("GitHub API returned {status}: {raw}");
        eprintln!("[pronto] {msg}");
        return Err(msg.into());
    }

    let response: GraphQLResponse = serde_json::from_str(&raw).map_err(|e| {
        eprintln!("[pronto] GraphQL parse error: {e}\n[pronto] Response body: {raw}");
        e
    })?;

    if let Some(errors) = &response.errors {
        let msgs: Vec<&str> = errors.iter().map(|e| e.message.as_str()).collect();
        eprintln!("[pronto] GraphQL errors: {}", msgs.join("; "));
    }

    let data = response.data.ok_or_else(|| {
        format!("GitHub GraphQL returned no data: {raw}")
    })?;

    let viewer_login = data.viewer.login.clone();
    let mut open = data.open.nodes;
    let mut recently_merged = if show_recently_merged {
        data.recently_merged.nodes
    } else {
        vec![]
    };
    let mut recently_closed = if show_recently_closed {
        data.recently_closed.nodes
    } else {
        vec![]
    };

    for pr in open.iter_mut().chain(recently_merged.iter_mut()).chain(recently_closed.iter_mut()) {
        pr.comments.subtract_bots();
        apply_merge_state(pr);
    }

    Ok((open, recently_merged, recently_closed, viewer_login))
}

const PR_FIELDS: &str = r#"title
      url
      state
      merged
      createdAt
      mergedAt
      closedAt
      repository { name owner { login } }
      mergeQueueEntry { position }
      mergeStateStatus
      reviewDecision
      reviews(states: APPROVED) { totalCount }
      comments(last: 5) { totalCount nodes { author { login __typename } } }
      reviewThreads(first: 20) { nodes { isResolved comments(last: 1) { totalCount nodes { author { login } } } firstComment: comments(first: 1) { totalCount nodes { author { login } } } } }
      commits(last: 1) { nodes { commit { oid statusCheckRollup { state } } } }
      author { login }"#;

/// Fetch PRs for multiple followed users in a single GraphQL request using aliases.
async fn fetch_followed_users_prs(
    client: &reqwest::Client,
    token: &str,
    users: &[String],
    merged_window_hours: u64,
    show_recently_merged: bool,
    closed_window_hours: u64,
    show_recently_closed: bool,
    exclusions: &str,
) -> Result<
    (Vec<PullRequest>, Vec<PullRequest>, Vec<PullRequest>),
    Box<dyn std::error::Error + Send + Sync>,
> {
    let users: Vec<&str> = users.iter().map(|u| u.trim()).filter(|u| !u.is_empty()).collect();
    if users.is_empty() {
        return Ok((vec![], vec![], vec![]));
    }

    let merged_cutoff = (chrono::Utc::now() - chrono::Duration::hours(merged_window_hours as i64))
        .format("%Y-%m-%d")
        .to_string();
    let closed_cutoff = (chrono::Utc::now() - chrono::Duration::hours(closed_window_hours as i64))
        .format("%Y-%m-%d")
        .to_string();

    // Use {{ and }} for literal braces in format strings, { and } for interpolation
    let pr_fragment = PR_FIELDS
        .replace('{', "{{")
        .replace('}', "}}");

    let mut query_parts = String::from("{");
    for (i, user) in users.iter().enumerate() {
        query_parts.push_str(&format!(
            r#"
  u{i}_open: search(query: "author:{user} type:pr state:open{exclusions}", type: ISSUE, first: 20) {{
    nodes {{ ... on PullRequest {{ {pr_fragment} }} }}
  }}"#
        ));
        if show_recently_merged {
            query_parts.push_str(&format!(
                r#"
  u{i}_merged: search(query: "author:{user} type:pr is:merged merged:>{merged_cutoff}{exclusions}", type: ISSUE, first: 10) {{
    nodes {{ ... on PullRequest {{ {pr_fragment} }} }}
  }}"#
            ));
        }
        if show_recently_closed {
            query_parts.push_str(&format!(
                r#"
  u{i}_closed: search(query: "author:{user} type:pr is:unmerged is:closed closed:>{closed_cutoff}{exclusions}", type: ISSUE, first: 10) {{
    nodes {{ ... on PullRequest {{ {pr_fragment} }} }}
  }}"#
            ));
        }
    }
    query_parts.push_str("\n}");

    let query = GraphQLQuery { query: query_parts };

    let http_response = client
        .post("https://api.github.com/graphql")
        .header(AUTHORIZATION, format!("Bearer {}", token))
        .header(USER_AGENT, "pronto")
        .json(&query)
        .send()
        .await?;

    let status = http_response.status();
    let raw = http_response.text().await?;

    if !status.is_success() {
        eprintln!("[pronto] GitHub API returned {status} for followed users: {raw}");
        return Ok((vec![], vec![], vec![]));
    }

    let parsed: serde_json::Value = serde_json::from_str(&raw).map_err(|e| {
        eprintln!("[pronto] Followed users parse error: {e}\n[pronto] Response body: {raw}");
        e
    })?;

    if let Some(errors) = parsed.get("errors") {
        eprintln!("[pronto] Followed users GraphQL errors: {errors}");
    }

    let mut all_open = Vec::new();
    let mut all_merged = Vec::new();
    let mut all_closed = Vec::new();

    if let Some(data) = parsed.get("data") {
        for i in 0..users.len() {
            for (prefix, target) in [
                (format!("u{i}_open"), &mut all_open),
                (format!("u{i}_merged"), &mut all_merged),
                (format!("u{i}_closed"), &mut all_closed),
            ] {
                if let Some(search) = data.get(&prefix) {
                    if let Some(nodes) = search.get("nodes") {
                        if let Ok(prs) = serde_json::from_value::<Vec<PullRequest>>(nodes.clone()) {
                            target.extend(prs);
                        }
                    }
                }
            }
        }
    }

    for pr in all_open.iter_mut().chain(all_merged.iter_mut()).chain(all_closed.iter_mut()) {
        pr.comments.subtract_bots();
        apply_merge_state(pr);
    }

    Ok((all_open, all_merged, all_closed))
}

/// Uses `mergeStateStatus` to correct the checks rollup state.
/// GitHub's `statusCheckRollup` can be misleading (e.g. reporting FAILURE for
/// non-required checks, or SUCCESS before checks register). `mergeStateStatus`
/// reflects the actual merge readiness as shown in GitHub's UI.
fn apply_merge_state(pr: &mut PullRequest) {
    let Some(merge_state) = pr.merge_state_status.as_deref() else {
        return;
    };
    let Some(node) = pr.commits.nodes.first_mut() else {
        return;
    };
    match merge_state {
        // CLEAN / HAS_HOOKS = all required checks pass → force SUCCESS
        "CLEAN" | "HAS_HOOKS" => {
            if let Some(rollup) = &mut node.commit.status_check_rollup {
                if rollup.state != "SUCCESS" {
                    rollup.state = "SUCCESS".into();
                }
            }
        }
        // UNSTABLE = non-required checks failing, but mergeable → still SUCCESS
        "UNSTABLE" => {
            if let Some(rollup) = &mut node.commit.status_check_rollup {
                if rollup.state == "FAILURE" || rollup.state == "ERROR" {
                    rollup.state = "SUCCESS".into();
                }
            }
        }
        // BLOCKED + rollup SUCCESS = checks haven't registered yet → PENDING
        "BLOCKED" => {
            if let Some(rollup) = &mut node.commit.status_check_rollup {
                if rollup.state == "SUCCESS" {
                    // Could be blocked by reviews (not checks), so check reviewDecision
                    let blocked_by_reviews = matches!(
                        pr.review_decision.as_deref(),
                        Some("REVIEW_REQUIRED") | Some("CHANGES_REQUESTED")
                    );
                    if !blocked_by_reviews {
                        rollup.state = "PENDING".into();
                    }
                }
            }
        }
        _ => {}
    }
}

fn build_exclusions(hidden_orgs: &[String], hidden_repos: &[String]) -> String {
    let mut s = String::new();
    for org in hidden_orgs {
        s.push_str(&format!(" -org:{}", org));
    }
    for repo in hidden_repos {
        s.push_str(&format!(" -repo:{}", repo));
    }
    s
}

fn is_pr_older_than_48h(pr: &PullRequest) -> bool {
    let now = chrono::Utc::now();
    let cutoff = now - chrono::Duration::hours(48);

    // Check merged timestamp
    if let Some(merged_at) = &pr.merged_at {
        if let Ok(merged_time) = chrono::DateTime::parse_from_rfc3339(merged_at) {
            if merged_time < cutoff {
                return true;
            }
        }
    }

    // Check closed timestamp
    if let Some(closed_at) = &pr.closed_at {
        if let Ok(closed_time) = chrono::DateTime::parse_from_rfc3339(closed_at) {
            if closed_time < cutoff {
                return true;
            }
        }
    }

    false
}

async fn fetch_prs_by_url(
    client: &reqwest::Client,
    token: &str,
    pr_urls: &[String],
) -> Result<
    (Vec<PullRequest>, Vec<PullRequest>, Vec<PullRequest>),
    Box<dyn std::error::Error + Send + Sync>,
> {
    if pr_urls.is_empty() {
        return Ok((vec![], vec![], vec![]));
    }

    // Parse URLs and group by repo: owner/repo -> vec of (owner, repo, pr_number)
    let mut repos: std::collections::HashMap<String, Vec<(String, String, String)>> =
        Default::default();
    for url in pr_urls {
        let parts: Vec<&str> = url.trim_end_matches('/').split('/').collect();
        if parts.len() < 5 || parts[parts.len() - 2] != "pull" {
            continue; // Skip invalid URLs
        }
        let owner = parts[parts.len() - 4].to_string();
        let repo = parts[parts.len() - 3].to_string();
        let pr_number = parts[parts.len() - 1].to_string();
        let repo_key = format!("{}/{}", owner, repo);
        repos
            .entry(repo_key)
            .or_insert_with(Vec::new)
            .push((owner, repo, pr_number));
    }

    if repos.is_empty() {
        return Ok((vec![], vec![], vec![]));
    }

    // Build a query with aliases for each PR
    let mut query_parts = String::from("{");
    let mut alias_index = 0;

    for pr_specs in repos.values() {
        for (owner, repo, pr_number) in pr_specs {
            query_parts.push_str(&format!(
                r#"
  pr{alias_index}: repository(owner: "{owner}", name: "{repo}") {{
    pullRequest(number: {pr_number}) {{
      title
      url
      state
      merged
      createdAt
      mergedAt
      closedAt
      mergeQueueEntry {{ position }}
      mergeStateStatus
      reviewDecision
      reviews(states: APPROVED) {{ totalCount }}
      comments(last: 5) {{ totalCount nodes {{ author {{ login __typename }} }} }}
      reviewThreads(first: 20) {{ nodes {{ isResolved comments(last: 1) {{ totalCount nodes {{ author {{ login }} }} }} firstComment: comments(first: 1) {{ totalCount nodes {{ author {{ login }} }} }} }} }}
      commits(last: 1) {{ nodes {{ commit {{ oid statusCheckRollup {{ state }} }} }} }}
      author {{ login }}
      repository {{ name owner {{ login }} }}
    }}
  }}"#
            ));
            alias_index += 1;
        }
    }
    query_parts.push_str("\n}");

    let query = GraphQLQuery { query: query_parts };

    let response = client
        .post("https://api.github.com/graphql")
        .header(AUTHORIZATION, format!("Bearer {}", token))
        .header(USER_AGENT, "pronto")
        .json(&query)
        .send()
        .await?
        .json::<serde_json::Value>()
        .await?;

    let mut open_prs = Vec::new();
    let mut merged_prs = Vec::new();
    let mut closed_prs = Vec::new();

    if let Some(data) = response.get("data") {
        for i in 0..alias_index {
            if let Some(repo_data) = data.get(&format!("pr{}", i)) {
                if let Some(pr_data) = repo_data.get("pullRequest") {
                    if let Ok(pr) = serde_json::from_value::<PullRequest>(pr_data.clone()) {
                        // Categorize PR
                        let mut pr = pr;
                        pr.comments.subtract_bots();
                        apply_merge_state(&mut pr);
                        match pr.status() {
                            PrStatus::Open | PrStatus::InQueue => open_prs.push(pr),
                            PrStatus::Merged => merged_prs.push(pr),
                            PrStatus::Closed => closed_prs.push(pr),
                        }
                    }
                }
            }
        }
    }

    Ok((open_prs, merged_prs, closed_prs))
}

pub async fn fetch_all_prs(
    client: &reqwest::Client,
    token: &str,
    merged_window_hours: u64,
    show_recently_merged: bool,
    closed_window_hours: u64,
    show_recently_closed: bool,
    hidden_orgs: &[String],
    hidden_repos: &[String],
    followed_users: &[String],
    followed_prs: &[String],
) -> Result<FetchResult, Box<dyn std::error::Error + Send + Sync>> {
    let exclusions = build_exclusions(hidden_orgs, hidden_repos);

    // Fetch PRs authored by the current user (also retrieves viewer login).
    let (my_open, my_recently_merged, my_recently_closed, viewer_login) = fetch_prs_for_author(
        &client,
        token,
        "@me",
        merged_window_hours,
        show_recently_merged,
        closed_window_hours,
        show_recently_closed,
        &exclusions,
    )
    .await?;

    // Fetch PRs authored by followed users (single batched query).
    let (mut followed_open, mut followed_recently_merged, mut followed_recently_closed) =
        fetch_followed_users_prs(
            &client,
            token,
            followed_users,
            merged_window_hours,
            show_recently_merged,
            closed_window_hours,
            show_recently_closed,
            &exclusions,
        )
        .await
        .unwrap_or_default();

    // Fetch specifically followed PRs
    let (followed_pr_open, followed_pr_merged, followed_pr_closed) =
        fetch_prs_by_url(&client, token, followed_prs)
            .await
            .unwrap_or_default();

    followed_open.extend(followed_pr_open);
    followed_recently_merged.extend(followed_pr_merged.clone());
    followed_recently_closed.extend(followed_pr_closed.clone());

    // Identify followed PRs that are older than 48h and should be removed
    let mut expired_followed_prs = Vec::new();
    for pr in followed_pr_merged.iter().chain(followed_pr_closed.iter()) {
        if is_pr_older_than_48h(pr) {
            expired_followed_prs.push(pr.url.clone());
        }
    }

    Ok(FetchResult {
        open: my_open,
        recently_merged: my_recently_merged,
        recently_closed: my_recently_closed,
        followed_open,
        followed_recently_merged,
        followed_recently_closed,
        attention_urls: vec![],
        element_changes: std::collections::HashMap::new(),
        workflow_status: None,
        expired_followed_prs,
        viewer_login,
    })
}

pub async fn fetch_workflow_status(
    client: &reqwest::Client,
    token: &str,
    org: &str,
    repo: &str,
    workflow_name: &str,
) -> Result<Option<WorkflowStatus>, Box<dyn std::error::Error + Send + Sync>> {
    let url = format!(
        "https://api.github.com/repos/{}/{}/actions/workflows/{}/runs?per_page=10",
        org, repo, workflow_name
    );

    let response = client
        .get(&url)
        .header(AUTHORIZATION, format!("Bearer {}", token))
        .header(USER_AGENT, "pronto")
        .send()
        .await?;

    if !response.status().is_success() {
        return Ok(None);
    }

    let runs: WorkflowRunsResponse = response.json().await?;

    // Find the latest successful or failed run for the status indicator (dot)
    let indicator_run = runs
        .workflow_runs
        .iter()
        .find(|r| matches!(r.conclusion.as_deref(), Some("success") | Some("failure")));

    // Find the latest run overall for the text (success, failure, or in_progress)
    let text_run = runs.workflow_runs.first();

    let Some(run) = indicator_run.or(text_run) else {
        return Ok(None);
    };

    let conclusion = indicator_run
        .and_then(|r| r.conclusion.as_deref())
        .unwrap_or("unknown");

    let status = text_run
        .map(|r| {
            if let Some(c) = &r.conclusion {
                c.clone()
            } else {
                r.status.clone()
            }
        })
        .unwrap_or_default();

    Ok(Some(WorkflowStatus {
        conclusion: conclusion.to_string(),
        status,
        workflow_name: workflow_name.to_string(),
        repo: format!("{}/{}", org, repo),
        updated_at: run.updated_at.clone(),
        html_url: run.html_url.clone(),
    }))
}
