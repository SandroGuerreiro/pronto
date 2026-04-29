use core_foundation::base::{CFType, TCFType};
use core_foundation::data::CFData;
use core_foundation::dictionary::CFDictionary;
use core_foundation::string::CFString;
use core_foundation::string::CFStringRef;
use reqwest::header::{ACCEPT, USER_AGENT};
use security_framework::passwords;
use security_framework_sys::access_control::kSecAttrAccessibleAfterFirstUnlock;
use security_framework_sys::base::errSecSuccess;
use security_framework_sys::item::{
    kSecAttrAccount, kSecAttrService, kSecClass, kSecClassGenericPassword, kSecValueData,
};
use security_framework_sys::keychain_item::SecItemAdd;
use serde::{Deserialize, Serialize};

// Not exported by security-framework-sys 2.x. Declared here so we can set
// per-item accessibility without using kSecAttrAccessControl, which requires
// a keychain-access-groups entitlement and fails on unsigned/dev builds with
// errSecMissingEntitlement (-34018).
#[link(name = "Security", kind = "framework")]
extern "C" {
    static kSecAttrAccessible: CFStringRef;
}

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

    // SAFETY: kSecClass, kSecAttrService, kSecAttrAccount, kSecAttrAccessible,
    // kSecAttrAccessibleAfterFirstUnlock, and kSecValueData are non-null CFStringRefs
    // exported as statics by Security.framework and are valid for the lifetime of
    // the process. wrap_under_get_rule does not transfer ownership. CFData::from_buffer
    // copies the token bytes, so the &str reference is not retained past this block.
    // All values are moved into the CFDictionary before SecItemAdd.
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
                CFString::wrap_under_get_rule(kSecAttrAccessible).into_CFType(),
                CFString::wrap_under_get_rule(kSecAttrAccessibleAfterFirstUnlock).into_CFType(),
            ),
            (
                CFString::wrap_under_get_rule(kSecValueData).into_CFType(),
                CFData::from_buffer(token.as_bytes()).into_CFType(),
            ),
        ]
    };

    let dict: CFDictionary<CFType, CFType> = CFDictionary::from_CFType_pairs(&pairs);
    let status: i32 = unsafe { SecItemAdd(dict.as_concrete_TypeRef() as _, std::ptr::null_mut()) };

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
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER).map_err(|e| e.to_string())?;
    entry.delete_credential().map_err(|e| e.to_string())
}

#[cfg(test)]
mod auth_keychain_tests {
    use super::*;

    // Use a test-only service so we don't clobber a real user token.
    // Each test passes a distinct suffix so parallel runs don't share state.
    fn with_test_service<R>(suffix: &str, f: impl FnOnce(&str, &str) -> R) -> R {
        let service = format!("com.pronto.desktop.test.{suffix}");
        let user = format!("github-token-test-{suffix}");
        let _ = passwords::delete_generic_password(&service, &user);
        let r = f(&service, &user);
        let _ = passwords::delete_generic_password(&service, &user);
        r
    }

    /// Mirror save_token() but against a test-only keychain item, to verify
    /// the SecItemAdd dictionary shape works on unsigned/dev builds.
    fn save_test_token(service: &str, user: &str, token: &str) -> Result<(), String> {
        let _ = passwords::delete_generic_password(service, user);
        let pairs: Vec<(CFType, CFType)> = unsafe {
            vec![
                (
                    CFString::wrap_under_get_rule(kSecClass).into_CFType(),
                    CFString::wrap_under_get_rule(kSecClassGenericPassword).into_CFType(),
                ),
                (
                    CFString::wrap_under_get_rule(kSecAttrService).into_CFType(),
                    CFString::new(service).into_CFType(),
                ),
                (
                    CFString::wrap_under_get_rule(kSecAttrAccount).into_CFType(),
                    CFString::new(user).into_CFType(),
                ),
                (
                    CFString::wrap_under_get_rule(kSecAttrAccessible).into_CFType(),
                    CFString::wrap_under_get_rule(kSecAttrAccessibleAfterFirstUnlock).into_CFType(),
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

    #[test]
    fn save_with_accessible_succeeds_on_unsigned_builds() {
        with_test_service("save_basic", |service, user| {
            save_test_token(service, user, "hello").expect("save should succeed");
            let read = passwords::get_generic_password(service, user).expect("read after save");
            assert_eq!(read, b"hello");
        });
    }

    #[test]
    fn save_overwrites_existing_item() {
        with_test_service("save_overwrite", |service, user| {
            save_test_token(service, user, "first").expect("first save");
            save_test_token(service, user, "second")
                .expect("second save should overwrite, not duplicate");
            let read =
                passwords::get_generic_password(service, user).expect("read after overwrite");
            assert_eq!(read, b"second");
        });
    }
}
