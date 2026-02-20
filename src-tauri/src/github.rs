use reqwest::header::{AUTHORIZATION, USER_AGENT};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct SearchResponse {
    pub items: Vec<PullRequest>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct PullRequest {
    pub id: u64,
    pub title: String,
    pub html_url: String,
    pub repository_url: String,
}

pub async fn fetch_open_prs(token: &str) -> Result<Vec<PullRequest>, Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();

    let response = client
        .get("https://api.github.com/search/issues?q=author:@me+type:pr+state:open")
        .header(AUTHORIZATION, format!("Bearer {}", token))
        .header(USER_AGENT, "pronto")
        .send()
        .await?
        .json::<SearchResponse>()
        .await?;

    Ok(response.items)
}
