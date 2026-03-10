use futures::future;
use reqwest::header::{AUTHORIZATION, USER_AGENT};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct GraphQLQuery {
    pub query: String,
}

#[derive(Debug, Deserialize)]
pub struct GraphQLResponse {
    pub data: Data,
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
    #[serde(skip_serializing)]
    contexts: Option<serde_json::Value>,
}

impl StatusCheckRollup {
    /// Overwrites `state` by examining individual check run contexts.
    /// GitHub's rollup can report SUCCESS before all workflow stages register their checks.
    pub fn normalize(&mut self) {
        let nodes = self.contexts.as_ref()
            .and_then(|c| c.get("nodes"))
            .and_then(|n| n.as_array());
        let nodes = match nodes {
            Some(n) => n,
            None => return,
        };
        let mut has_failure = false;
        let mut has_pending = false;
        for node in nodes {
            let typename = node.get("__typename").and_then(|v| v.as_str());
            match typename {
                Some("CheckRun") => {
                    let status = node.get("status").and_then(|v| v.as_str());
                    match status {
                        Some("COMPLETED") => {
                            let conclusion = node.get("conclusion").and_then(|v| v.as_str());
                            if matches!(conclusion, Some("FAILURE" | "TIMED_OUT" | "STARTUP_FAILURE" | "ACTION_REQUIRED")) {
                                has_failure = true;
                            }
                        }
                        Some("QUEUED" | "IN_PROGRESS" | "WAITING" | "PENDING" | "REQUESTED") => {
                            has_pending = true;
                        }
                        _ => {}
                    }
                }
                Some("StatusContext") => {
                    let state = node.get("state").and_then(|v| v.as_str());
                    match state {
                        Some("PENDING" | "EXPECTED") => has_pending = true,
                        Some("FAILURE" | "ERROR") => has_failure = true,
                        _ => {}
                    }
                }
                _ => {}
            }
        }
        // Only override rollup when contexts reveal a worse state than reported.
        // We may not see all contexts (pagination), so never downgrade the rollup.
        if has_failure && self.state != "FAILURE" && self.state != "ERROR" {
            self.state = "FAILURE".into();
        } else if has_pending && self.state == "SUCCESS" {
            self.state = "PENDING".into();
        }
    }
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
        reviewDecision
        reviews(states: APPROVED) {{ totalCount }}
        comments(last: 5) {{ totalCount nodes {{ author {{ login __typename }} }} }}
        reviewThreads(first: 100) {{ nodes {{ isResolved comments(last: 1) {{ totalCount nodes {{ author {{ login }} }} }} }} }}
        commits(last: 1) {{ nodes {{ commit {{ oid statusCheckRollup {{ state contexts(first: 100) {{ nodes {{ __typename ... on CheckRun {{ status conclusion }} ... on StatusContext {{ state }} }} }} }} }} }} }}
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
        reviewDecision
        reviews(states: APPROVED) {{ totalCount }}
        comments(last: 5) {{ totalCount nodes {{ author {{ login __typename }} }} }}
        reviewThreads(first: 100) {{ nodes {{ isResolved comments(last: 1) {{ totalCount nodes {{ author {{ login }} }} }} }} }}
        commits(last: 1) {{ nodes {{ commit {{ oid statusCheckRollup {{ state contexts(first: 100) {{ nodes {{ __typename ... on CheckRun {{ status conclusion }} ... on StatusContext {{ state }} }} }} }} }} }} }}
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
        reviewDecision
        reviews(states: APPROVED) {{ totalCount }}
        comments(last: 5) {{ totalCount nodes {{ author {{ login __typename }} }} }}
        reviewThreads(first: 100) {{ nodes {{ isResolved comments(last: 1) {{ totalCount nodes {{ author {{ login }} }} }} }} }}
        commits(last: 1) {{ nodes {{ commit {{ oid statusCheckRollup {{ state contexts(first: 100) {{ nodes {{ __typename ... on CheckRun {{ status conclusion }} ... on StatusContext {{ state }} }} }} }} }} }} }}
        author {{ login }}
      }}
    }}
  }}
}}"#
        ),
    };

    let response = client
        .post("https://api.github.com/graphql")
        .header(AUTHORIZATION, format!("Bearer {}", token))
        .header(USER_AGENT, "pronto")
        .json(&query)
        .send()
        .await?
        .json::<GraphQLResponse>()
        .await?;

    let viewer_login = response.data.viewer.login.clone();
    let mut open = response.data.open.nodes;
    let mut recently_merged = if show_recently_merged {
        response.data.recently_merged.nodes
    } else {
        vec![]
    };
    let mut recently_closed = if show_recently_closed {
        response.data.recently_closed.nodes
    } else {
        vec![]
    };

    for pr in open.iter_mut().chain(recently_merged.iter_mut()).chain(recently_closed.iter_mut()) {
        pr.comments.subtract_bots();
        normalize_checks(pr);
    }

    fix_premature_success(client, token, &mut open).await;

    Ok((open, recently_merged, recently_closed, viewer_login))
}

fn normalize_checks(pr: &mut PullRequest) {
    if let Some(node) = pr.commits.nodes.first_mut() {
        if let Some(rollup) = &mut node.commit.status_check_rollup {
            rollup.normalize();
        }
    }
}

/// For open PRs whose rollup says SUCCESS, check the Actions API for pending
/// workflow runs that haven't registered check runs yet.
/// GitHub's statusCheckRollup can report SUCCESS while workflows are still queued.
///
/// Groups PRs by repo so we make only one API call per unique repo (status=pending),
/// then matches the returned SHAs against our PRs.
async fn fix_premature_success(
    client: &reqwest::Client,
    token: &str,
    prs: &mut [PullRequest],
) {
    // Collect (index, sha) for open PRs with SUCCESS rollup, grouped by "owner/repo"
    let mut repo_groups: std::collections::HashMap<String, Vec<(usize, String)>> =
        std::collections::HashMap::new();
    for (idx, pr) in prs.iter().enumerate() {
        let rollup_state = pr.state == "OPEN"
            && pr
                .commits
                .nodes
                .first()
                .and_then(|n| n.commit.status_check_rollup.as_ref())
                .map_or(false, |r| r.state == "SUCCESS" || r.state == "FAILURE" || r.state == "ERROR");
        if rollup_state {
            let key = format!("{}/{}", pr.repository.owner.login, pr.repository.name);
            let sha = pr.commits.nodes[0].commit.oid.clone();
            repo_groups.entry(key).or_default().push((idx, sha));
        }
    }

    if repo_groups.is_empty() {
        return;
    }

    // One API call per unique repo, fetched concurrently
    let futures: Vec<_> = repo_groups
        .into_iter()
        .map(|(repo_full, pr_entries)| {
            let client = client.clone();
            let token = token.to_string();
            async move {
                let pending_shas = fetch_pending_run_shas(&client, &token, &repo_full)
                    .await
                    .unwrap_or_default();
                let mut results = Vec::new();
                for (idx, sha) in pr_entries {
                    if pending_shas.contains(&sha) {
                        results.push(idx);
                    }
                }
                results
            }
        })
        .collect();

    let all_results = future::join_all(futures).await;
    for indices in all_results {
        for idx in indices {
            if let Some(node) = prs[idx].commits.nodes.first_mut() {
                if let Some(rollup) = &mut node.commit.status_check_rollup {
                    rollup.state = "PENDING".into();
                }
            }
        }
    }
}

#[derive(Deserialize)]
struct ActionsRunsResponse {
    workflow_runs: Vec<ActionsRun>,
}

#[derive(Deserialize)]
struct ActionsRun {
    head_sha: String,
    status: String,
}

/// Fetches workflow runs that are not yet completed for a repo and returns their head SHAs.
async fn fetch_pending_run_shas(
    client: &reqwest::Client,
    token: &str,
    repo_full: &str,
) -> Result<std::collections::HashSet<String>, Box<dyn std::error::Error + Send + Sync>> {
    // The Actions API only accepts a single status filter, but we can use
    // "queued" and "in_progress" in separate calls — or just omit the filter
    // and check client-side. Using no filter with a small per_page is cheapest
    // since recent runs are returned first and most repos won't have many.
    let url = format!(
        "https://api.github.com/repos/{}/actions/runs?per_page=30",
        repo_full
    );
    let response = client
        .get(&url)
        .header(AUTHORIZATION, format!("Bearer {}", token))
        .header(USER_AGENT, "pronto")
        .send()
        .await?;

    if !response.status().is_success() {
        return Ok(Default::default());
    }

    let runs: ActionsRunsResponse = response.json().await?;
    Ok(runs
        .workflow_runs
        .into_iter()
        .filter(|r| {
            matches!(
                r.status.as_str(),
                "queued" | "in_progress" | "waiting" | "pending" | "requested"
            )
        })
        .map(|r| r.head_sha)
        .collect())
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
      reviewDecision
      reviews(states: APPROVED) {{ totalCount }}
      comments(last: 5) {{ totalCount nodes {{ author {{ login __typename }} }} }}
      reviewThreads(first: 100) {{ nodes {{ isResolved comments(last: 1) {{ totalCount nodes {{ author {{ login }} }} }} }} }}
      commits(last: 1) {{ nodes {{ commit {{ oid statusCheckRollup {{ state contexts(first: 100) {{ nodes {{ __typename ... on CheckRun {{ status conclusion }} ... on StatusContext {{ state }} }} }} }} }} }} }}
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
                        normalize_checks(&mut pr);
                        match pr.status() {
                            PrStatus::Open => open_prs.push(pr),
                            PrStatus::Merged => merged_prs.push(pr),
                            PrStatus::Closed | PrStatus::InQueue => closed_prs.push(pr),
                        }
                    }
                }
            }
        }
    }

    fix_premature_success(client, token, &mut open_prs).await;

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

    // Fetch PRs authored by followed users (concurrently).
    let mut followed_open: Vec<PullRequest> = Vec::new();
    let mut followed_recently_merged: Vec<PullRequest> = Vec::new();
    let mut followed_recently_closed: Vec<PullRequest> = Vec::new();

    let futures = followed_users
        .iter()
        .filter(|u| !u.trim().is_empty())
        .map(|user| {
            fetch_prs_for_author(
                &client,
                token,
                user.trim(),
                merged_window_hours,
                show_recently_merged,
                closed_window_hours,
                show_recently_closed,
                &exclusions,
            )
        })
        .collect::<Vec<_>>();

    let results = future::join_all(futures).await;
    for result in results {
        if let Ok((open, recent, closed, _)) = result {
            followed_open.extend(open);
            followed_recently_merged.extend(recent);
            followed_recently_closed.extend(closed);
        }
    }

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
