//! Native macOS notification system using UNUserNotificationCenter.
//!
//! Event-driven: no threads blocked waiting for user interaction.
//! The delegate callback fires asynchronously when the user clicks
//! a notification or its "Open" action button.

use std::sync::OnceLock;

use block2::Block;
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel};
use objc2::{msg_send, sel};
use objc2_foundation::{
    NSArray, NSDictionary, NSError, NSObject, NSSet, NSString,
};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNMutableNotificationContent, UNNotificationAction,
    UNNotificationActionOptions, UNNotificationCategory, UNNotificationCategoryOptions,
    UNNotificationPresentationOptions, UNNotificationRequest, UNUserNotificationCenter,
    UNUserNotificationCenterDelegate,
};

use crate::notification::NotificationInfo;

const CATEGORY_PR: &str = "PR_ATTENTION";
const ACTION_OPEN: &str = "OPEN_PR";
const USERINFO_URL: &str = "pronto_url";
const USERINFO_DISMISS: &str = "pronto_dismiss_urls";

/// Global AppHandle stored so the delegate callback can call dismiss_pr.
static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

/// Wrapper to store a Retained<NSObject> in a static.
/// SAFETY: The delegate is only accessed from the main thread (macOS callback).
struct DelegateHolder(#[allow(dead_code)] Retained<NSObject>);
unsafe impl Send for DelegateHolder {}
unsafe impl Sync for DelegateHolder {}

static DELEGATE: OnceLock<DelegateHolder> = OnceLock::new();

/// Whether the native notification system was initialized successfully.
static INITIALIZED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Initialize the notification system. Call once during app setup.
/// In dev mode (no .app bundle), this silently skips initialization.
pub fn init(app: &tauri::AppHandle) {
    APP_HANDLE.set(app.clone()).ok();

    // UNUserNotificationCenter requires a proper .app bundle.
    // In dev mode (cargo run), the binary is not bundled, so skip init.
    if tauri::is_dev() {
        eprintln!("macos_notify: skipping init in dev mode (no .app bundle)");
        return;
    }

    init_inner();
    INITIALIZED.store(true, std::sync::atomic::Ordering::Relaxed);
}

fn init_inner() {
    let center = UNUserNotificationCenter::currentNotificationCenter();

    // Request authorization
    let opts = UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound;
    let handler = block2::RcBlock::new(|_granted: Bool, _error: *mut NSError| {});
    center.requestAuthorizationWithOptions_completionHandler(opts, &handler);

    // Register category with "Open" action
    let open_action = UNNotificationAction::actionWithIdentifier_title_options(
        &NSString::from_str(ACTION_OPEN),
        &NSString::from_str("Open"),
        UNNotificationActionOptions::Foreground,
    );
    let actions = NSArray::from_retained_slice(&[open_action]);
    let intents = NSArray::from_retained_slice(&[] as &[Retained<NSString>]);
    let category = UNNotificationCategory::categoryWithIdentifier_actions_intentIdentifiers_options(
        &NSString::from_str(CATEGORY_PR),
        &actions,
        &intents,
        UNNotificationCategoryOptions(0),
    );
    let categories = NSSet::from_retained_slice(&[category]);
    center.setNotificationCategories(&categories);

    // Create and set delegate.
    // We dynamically add protocol conformance via ClassBuilder, so we use
    // raw pointer cast rather than ProtocolObject::from_ref (which requires
    // compile-time trait impl).
    let delegate = create_delegate();
    unsafe {
        let proto_ptr = Retained::as_ptr(&delegate)
            as *const objc2::runtime::ProtocolObject<dyn UNUserNotificationCenterDelegate>;
        center.setDelegate(Some(&*proto_ptr));
    }
    DELEGATE.set(DelegateHolder(delegate)).ok();
}

/// Send a notification. Non-blocking — returns immediately.
/// In dev mode, falls back to tauri-plugin-notification (no click handling).
pub fn send(info: &NotificationInfo) {
    if !INITIALIZED.load(std::sync::atomic::Ordering::Relaxed) {
        send_fallback(info);
        return;
    }
    let info = info.clone();
    let result = std::panic::catch_unwind(move || {
        send_inner(&info);
    });
    if let Err(e) = result {
        eprintln!("macos_notify::send failed: {:?}", e);
    }
}

/// Dev-mode fallback using tauri-plugin-notification (no click handling).
fn send_fallback(info: &NotificationInfo) {
    let Some(app) = APP_HANDLE.get() else { return };
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification()
        .builder()
        .title(&info.title)
        .body(&info.body)
        .show();
}

fn send_inner(info: &NotificationInfo) {
    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(&info.title));
    content.setBody(&NSString::from_str(&info.body));
    content.setCategoryIdentifier(&NSString::from_str(CATEGORY_PR));

    // Store URL and dismiss URLs in userInfo
    let mut keys: Vec<&NSString> = Vec::new();
    let mut vals: Vec<Retained<NSString>> = Vec::new();

    let url_key = NSString::from_str(USERINFO_URL);
    let dismiss_key = NSString::from_str(USERINFO_DISMISS);

    if let Some(ref url) = info.url {
        keys.push(&url_key);
        vals.push(NSString::from_str(url));
    }

    if !info.attention_urls.is_empty() {
        keys.push(&dismiss_key);
        vals.push(NSString::from_str(&info.attention_urls.join("\n")));
    }

    if !keys.is_empty() {
        // Build NSDictionary<AnyObject, AnyObject> by going through msg_send
        unsafe {
            let dict_cls = AnyClass::get(c"NSMutableDictionary").unwrap();
            let dict: Retained<AnyObject> = msg_send![dict_cls, new];
            for (k, v) in keys.iter().zip(vals.iter()) {
                let _: () = msg_send![&*dict, setObject: &**v, forKey: *k];
            }
            content.setUserInfo(&*(Retained::as_ptr(&dict) as *const NSDictionary));
        }
    }

    let id = NSString::from_str(&format!("pronto-{}", unique_id()));
    let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
        &id,
        &content,
        None,
    );

    let center = UNUserNotificationCenter::currentNotificationCenter();
    center.addNotificationRequest_withCompletionHandler(&request, None);
}

fn unique_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    format!("{}-{}", t.as_secs(), t.subsec_nanos())
}

// ── Delegate ─────────────────────────────────────────────────────────────────

fn handle_notification_response(user_info: &NSDictionary) {
    let url = get_string(user_info, USERINFO_URL);
    let dismiss_raw = get_string(user_info, USERINFO_DISMISS);

    if let Some(url) = url {
        crate::notification::open_notification_url(&url);
    }

    if let Some(raw) = dismiss_raw {
        if let Some(app) = APP_HANDLE.get() {
            for pr_url in raw.split('\n').filter(|s| !s.is_empty()) {
                crate::dismiss_pr(app.clone(), pr_url.to_string());
            }
        }
    }
}

fn get_string(dict: &NSDictionary, key: &str) -> Option<String> {
    let ns_key = NSString::from_str(key);
    unsafe {
        let val: Option<Retained<AnyObject>> = msg_send![dict, objectForKey: &*ns_key];
        val.map(|obj| {
            let ptr = Retained::as_ptr(&obj) as *const NSString;
            (*ptr).to_string()
        })
    }
}

// ── Dynamic delegate class ───────────────────────────────────────────────────
//
// Module-level extern "C-unwind" functions are required by objc2's
// MethodImplementation trait (same pattern as ProntoPanel in lib.rs).

extern "C-unwind" fn did_receive_response(
    _this: &AnyObject,
    _sel: Sel,
    _center: &AnyObject,
    response: &AnyObject,
    completion: *const Block<dyn Fn()>,
) {
    unsafe {
        let notification: Retained<AnyObject> = msg_send![response, notification];
        let request: Retained<AnyObject> = msg_send![&*notification, request];
        let content: Retained<AnyObject> = msg_send![&*request, content];
        let user_info: Retained<NSDictionary> = msg_send![&*content, userInfo];
        handle_notification_response(&user_info);
    }

    unsafe {
        if !completion.is_null() {
            (*completion).call(());
        }
    }
}

extern "C-unwind" fn will_present_notification(
    _this: &AnyObject,
    _sel: Sel,
    _center: &AnyObject,
    _notification: &AnyObject,
    completion: *const Block<dyn Fn(UNNotificationPresentationOptions)>,
) {
    let opts = UNNotificationPresentationOptions::Banner | UNNotificationPresentationOptions::Sound;
    unsafe {
        if !completion.is_null() {
            (*completion).call((opts,));
        }
    }
}

fn create_delegate() -> Retained<NSObject> {
    static DELEGATE_CLASS: OnceLock<&'static AnyClass> = OnceLock::new();

    let cls = DELEGATE_CLASS.get_or_init(|| {
        let superclass = AnyClass::get(c"NSObject").unwrap();
        let mut builder = ClassBuilder::new(c"ProntoNotificationDelegate", superclass)
            .expect("failed to create ProntoNotificationDelegate class");

        if let Some(protocol) = objc2::runtime::AnyProtocol::get(c"UNUserNotificationCenterDelegate") {
            builder.add_protocol(protocol);
        }

        unsafe {
            builder.add_method(
                sel!(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:),
                did_receive_response
                    as extern "C-unwind" fn(_, _, _, _, _),
            );

            builder.add_method(
                sel!(userNotificationCenter:willPresentNotification:withCompletionHandler:),
                will_present_notification
                    as extern "C-unwind" fn(_, _, _, _, _),
            );
        }

        builder.register()
    });

    // Create an NSObject instance and isa-swap it to our delegate class
    let obj = NSObject::new();
    unsafe {
        AnyObject::set_class(&*obj, cls);
    }
    obj
}
