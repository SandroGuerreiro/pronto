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
pub struct Data {
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
pub struct Comments {
    #[serde(rename = "totalCount")]
    pub total_count: i32,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ReviewThreads {
    pub nodes: Vec<ReviewThread>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ReviewThread {
    #[serde(rename = "isResolved")]
    pub is_resolved: bool,
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
    pub approvals: bool,
    pub comments: bool,
    pub resolved: bool,
    pub review_decision: bool,
    pub checks: bool,
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
) -> Result<(Vec<PullRequest>, Vec<PullRequest>, Vec<PullRequest>), Box<dyn std::error::Error + Send + Sync>> {
    let merged_cutoff = (chrono::Utc::now() - chrono::Duration::hours(merged_window_hours as i64))
        .format("%Y-%m-%d")
        .to_string();
    let closed_cutoff = (chrono::Utc::now() - chrono::Duration::hours(closed_window_hours as i64))
        .format("%Y-%m-%d")
        .to_string();

    let query = GraphQLQuery {
        query: format!(
            r#"{{
  open: search(query: "author:{author} type:pr state:open{exclusions}", type: ISSUE, first: 20) {{
    nodes {{
      ... on PullRequest {{
        title
        url
        state
        merged
        createdAt
        repository {{ name owner {{ login }} }}
        mergeQueueEntry {{ position }}
        reviewDecision
        reviews(states: APPROVED) {{ totalCount }}
        comments {{ totalCount }}
        reviewThreads(first: 100) {{ nodes {{ isResolved }} }}
        commits(last: 1) {{ nodes {{ commit {{ statusCheckRollup {{ state }} }} }} }}
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
        repository {{ name owner {{ login }} }}
        mergeQueueEntry {{ position }}
        reviewDecision
        reviews(states: APPROVED) {{ totalCount }}
        comments {{ totalCount }}
        reviewThreads(first: 100) {{ nodes {{ isResolved }} }}
        commits(last: 1) {{ nodes {{ commit {{ statusCheckRollup {{ state }} }} }} }}
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
        repository {{ name owner {{ login }} }}
        mergeQueueEntry {{ position }}
        reviewDecision
        reviews(states: APPROVED) {{ totalCount }}
        comments {{ totalCount }}
        reviewThreads(first: 100) {{ nodes {{ isResolved }} }}
        commits(last: 1) {{ nodes {{ commit {{ statusCheckRollup {{ state }} }} }} }}
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

    let open = response.data.open.nodes;
    let recently_merged = if show_recently_merged {
        response.data.recently_merged.nodes
    } else {
        vec![]
    };
    let recently_closed = if show_recently_closed {
        response.data.recently_closed.nodes
    } else {
        vec![]
    };

    Ok((open, recently_merged, recently_closed))
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
) -> Result<FetchResult, Box<dyn std::error::Error + Send + Sync>> {
    let exclusions = build_exclusions(hidden_orgs, hidden_repos);

    // Fetch PRs authored by the current user.
    let (my_open, my_recently_merged, my_recently_closed) = fetch_prs_for_author(
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

    // Fetch PRs authored by followed users.
    let mut followed_open: Vec<PullRequest> = Vec::new();
    let mut followed_recently_merged: Vec<PullRequest> = Vec::new();
    let mut followed_recently_closed: Vec<PullRequest> = Vec::new();

    for user in followed_users {
        if user.trim().is_empty() {
            continue;
        }
        let author = user.trim();
        if let Ok((open, recent, closed)) = fetch_prs_for_author(
            &client,
            token,
            author,
            merged_window_hours,
            show_recently_merged,
            closed_window_hours,
            show_recently_closed,
            &exclusions,
        )
        .await
        {
            followed_open.extend(open);
            followed_recently_merged.extend(recent);
            followed_recently_closed.extend(closed);
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
