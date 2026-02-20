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

#[derive(Debug, Deserialize, Clone)]
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
    pub reviews: Reviews,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Repository {
    pub name: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct MergeQueueEntry {
    pub position: i32,
}
#[derive(Debug, Deserialize, Clone)]
pub struct Reviews {
    #[serde(rename = "totalCount")]
    pub total_count: i32,
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
            Some("APPROVED") => format!("{} ✓", approvals),
            Some("CHANGES_REQUESTED") => "✗ changes requested".to_string(),
            Some("REVIEW_REQUIRED") => format!("{} ✓ (needs review)", approvals),
            _ => String::new(),
        }
    }
}
pub struct FetchResult {
    pub open: Vec<PullRequest>,
    pub recently_merged: Vec<PullRequest>,
}

pub async fn fetch_prs(token: &str) -> Result<FetchResult, Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();

    let cutoff = (chrono::Utc::now() - chrono::Duration::hours(24))
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
        repository {{ name }}
        mergeQueueEntry {{ position }}
        reviewDecision
        reviews(states: APPROVED) {{ totalCount }}
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
        repository {{ name }}
        mergeQueueEntry {{ position }}
        reviewDecision
        reviews(states: APPROVED) {{ totalCount }}
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
        recently_merged: response.data.recently_merged.nodes,
    })
}
