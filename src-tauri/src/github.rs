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

#[derive(Serialize, Clone)]
pub struct FetchResult {
    pub open: Vec<PullRequest>,
    pub recently_merged: Vec<PullRequest>,
    pub attention_urls: Vec<String>,
}

pub async fn fetch_prs(
    token: &str,
    merged_window_hours: u64,
    show_recently_merged: bool,
) -> Result<FetchResult, Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();

    let cutoff = (chrono::Utc::now() - chrono::Duration::hours(merged_window_hours as i64))
        .format("%Y-%m-%d")
        .to_string();

    let query = GraphQLQuery {
        query: format!(
            r#"{{
  open: search(query: "author:@me type:pr state:open", type: ISSUE, first: 20) {{
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
      }}
    }}
  }}
  recentlyMerged: search(query: "author:@me type:pr is:merged merged:>{cutoff}", type: ISSUE, first: 10) {{
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

    Ok(FetchResult {
        open: response.data.open.nodes,
        recently_merged: if show_recently_merged {
            response.data.recently_merged.nodes
        } else {
            vec![]
        },
        attention_urls: vec![],
    })
}
