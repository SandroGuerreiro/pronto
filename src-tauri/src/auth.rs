use core_foundation::base::{CFType, TCFType};
use core_foundation::data::CFData;
use core_foundation::dictionary::CFDictionary;
use core_foundation::string::CFString;
use reqwest::header::{ACCEPT, USER_AGENT};
use security_framework::access_control::{ProtectionMode, SecAccessControl};
use security_framework::passwords;
use security_framework_sys::base::errSecSuccess;
use security_framework_sys::item::{
    kSecAttrAccessControl, kSecAttrAccount, kSecAttrService, kSecClass,
    kSecClassGenericPassword, kSecValueData,
};
use security_framework_sys::keychain_item::SecItemAdd;
use serde::{Deserialize, Serialize};

const CLIENT_ID: &str = "Ov23ctX89W5ascyt1PIe";
const KEYCHAIN_SERVICE: &str = "com.pronto.desktop";
const KEYCHAIN_USER: &str = "github-token";

// The old keyring-managed item used the same service/account as the new item.
// These aliases make the migration intent explicit and allow easy removal later.

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

pub async fn validate_token(token: &str) -> Result<(), String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.github.com/user")
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {}", token))
        .header(USER_AGENT, "pronto")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if resp.status().is_success() {
        Ok(())
    } else {
        Err("Invalid token".to_string())
    }
}

/// Save the token to the keychain with AfterFirstUnlock accessibility and no
/// app-specific ACL, so it is readable after the user's first login and is
/// not invalidated when the app binary changes (i.e. on update).
pub fn save_token(token: &str) -> Result<(), String> {
    // Remove any existing item first so SecItemAdd doesn't get errSecDuplicateItem.
    // Ignore errors — the item may not exist yet.
    let _ = passwords::delete_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_USER);

    let access_control = SecAccessControl::create_with_protection(
        Some(ProtectionMode::AccessibleAfterFirstUnlock),
        0,
    )
    .map_err(|e| e.to_string())?;

    // SAFETY: kSecClass, kSecAttrService, kSecAttrAccount, kSecAttrAccessControl, and
    // kSecValueData are non-null CFStringRefs exported as statics by security_framework_sys
    // and are valid for the lifetime of the process. wrap_under_get_rule does not transfer
    // ownership. CFData::from_buffer copies the token bytes, so the &str reference is not
    // retained past this block. All values are moved into the CFDictionary before SecItemAdd.
    let pairs: Vec<(CFType, CFType)> = unsafe {
        vec![
            (
                CFString::wrap_under_get_rule(kSecClass).into_CFType(),
                CFString::wrap_under_get_rule(kSecClassGenericPassword).into_CFType(),
            ),
            (
                CFString::wrap_under_get_rule(kSecAttrService).into_CFType(),
                CFString::new(KEYCHAIN_SERVICE).into_CFType(),
            ),
            (
                CFString::wrap_under_get_rule(kSecAttrAccount).into_CFType(),
                CFString::new(KEYCHAIN_USER).into_CFType(),
            ),
            (
                CFString::wrap_under_get_rule(kSecAttrAccessControl).into_CFType(),
                access_control.into_CFType(),
            ),
            (
                CFString::wrap_under_get_rule(kSecValueData).into_CFType(),
                CFData::from_buffer(token.as_bytes()).into_CFType(),
            ),
        ]
    };

    let dict: CFDictionary<CFType, CFType> = CFDictionary::from_CFType_pairs(&pairs);
    let status: i32 =
        unsafe { SecItemAdd(dict.as_concrete_TypeRef() as _, std::ptr::null_mut()) };

    if status == errSecSuccess {
        Ok(())
    } else {
        Err(format!("SecItemAdd failed with status {status}"))
    }
}

/// Load the token, transparently migrating from the old keyring-managed item
/// if the new item is not found. This handles users who skip versions.
///
/// Migration path:
///   1. Try reading via security_framework::passwords (new item)
///   2. If not found, try reading via keyring (old item)
///   3. If found via keyring: save with new path, delete old item, return token
///   4. If neither found: return None → triggers auth flow
pub fn load_token() -> Option<String> {
    if let Some(token) = read_token_from_keychain() {
        return Some(token);
    }

    // Transparent migration: try the old keyring item
    if let Some(token) = read_token_from_keyring() {
        // Re-save with the new storage format (AfterFirstUnlock, no app ACL)
        if save_token(&token).is_ok() {
            if let Err(e) = delete_token_from_keyring() {
                // Non-fatal: old item stays until next launch; log so it surfaces in dev builds
                eprintln!("[pronto] keyring migration: failed to delete legacy item: {e}");
            }
        }
        return Some(token);
    }

    None
}

/// Delete the token from both storage locations for a clean logout.
pub fn delete_token() -> Result<(), String> {
    let new_result = passwords::delete_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_USER)
        .map_err(|e| e.to_string());
    let old_result = delete_token_from_keyring();

    match (new_result, old_result) {
        (Ok(_), _) | (_, Ok(_)) => Ok(()),
        (Err(e), Err(_)) => Err(e),
    }
}

fn read_token_from_keychain() -> Option<String> {
    passwords::get_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_USER)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
}

fn read_token_from_keyring() -> Option<String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER).ok()?;
    entry.get_password().ok()
}

fn delete_token_from_keyring() -> Result<(), String> {
    let entry =
        keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER).map_err(|e| e.to_string())?;
    entry.delete_credential().map_err(|e| e.to_string())
}
