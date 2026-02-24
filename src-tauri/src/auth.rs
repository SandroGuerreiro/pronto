use reqwest::header::{ACCEPT, USER_AGENT};
use serde::{Deserialize, Serialize};

const CLIENT_ID: &str = "Ov23ctX89W5ascyt1PIe";
const KEYCHAIN_SERVICE: &str = "com.pronto.desktop";
const KEYCHAIN_USER: &str = "github-token";

#[derive(Serialize)]
struct DeviceCodeRequest {
    client_id: String,
    scope: String,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    error: Option<String>,
}

pub async fn start_device_flow() -> Result<DeviceCodeResponse, String> {
    let client = reqwest::Client::new();
    let response = client
        .post("https://github.com/login/device/code")
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "pronto")
        .json(&DeviceCodeRequest {
            client_id: CLIENT_ID.to_string(),
            scope: "repo".to_string(),
        })
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let body = response.text().await.map_err(|e| e.to_string())?;
    serde_json::from_str::<DeviceCodeResponse>(&body)
        .map_err(|e| format!("{} (response: {})", e, body))
}

pub async fn poll_for_token(device_code: &str) -> Result<Option<String>, String> {
    let client = reqwest::Client::new();

    #[derive(Serialize)]
    struct TokenRequest {
        client_id: String,
        device_code: String,
        grant_type: String,
    }

    let response = client
        .post("https://github.com/login/oauth/access_token")
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "pronto")
        .json(&TokenRequest {
            client_id: CLIENT_ID.to_string(),
            device_code: device_code.to_string(),
            grant_type: "urn:ietf:params:oauth:grant-type:device_code".to_string(),
        })
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let body = response.text().await.map_err(|e| e.to_string())?;
    let resp: TokenResponse = serde_json::from_str(&body).map_err(|e| e.to_string())?;

    if let Some(token) = resp.access_token {
        return Ok(Some(token));
    }

    match resp.error.as_deref() {
        Some("authorization_pending") | Some("slow_down") => Ok(None),
        Some(err) => Err(err.to_string()),
        None => Err("unexpected response".to_string()),
    }
}

pub fn save_token(token: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER)
        .map_err(|e| e.to_string())?;
    entry.set_password(token).map_err(|e| e.to_string())
}

pub fn load_token() -> Option<String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER).ok()?;
    entry.get_password().ok()
}

pub fn delete_token() -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER)
        .map_err(|e| e.to_string())?;
    entry.delete_credential().map_err(|e| e.to_string())
}
