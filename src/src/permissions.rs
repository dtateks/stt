use serde::Serialize;
use std::process::Command;

#[cfg(target_os = "macos")]
use block2::RcBlock;
#[cfg(target_os = "macos")]
use objc2::runtime::Bool;
#[cfg(target_os = "macos")]
use objc2_av_foundation::{AVCaptureDevice, AVMediaTypeAudio};

const MICROPHONE_PRIVACY_PANE_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
const MICROPHONE_PERMISSION_REQUIRED_CODE: &str = "microphone-permission-required";
const ACCESSIBILITY_PERMISSION_REQUIRED_CODE: &str = "accessibility-permission-required";

#[derive(Debug, Clone, Serialize)]
pub struct MicrophonePermissionResult {
    pub granted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "openedSettings")]
    pub opened_settings: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AccessibilityPermissionResult {
    pub granted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "openedSettings")]
    pub opened_settings: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// AVAuthorizationStatus raw values:
/// 0 = notDetermined, 1 = restricted, 2 = denied, 3 = authorized
const AV_AUTH_STATUS_NOT_DETERMINED: isize = 0;
const AV_AUTH_STATUS_RESTRICTED: isize = 1;
const AV_AUTH_STATUS_AUTHORIZED: isize = 3;

#[cfg(target_os = "macos")]
pub fn ensure_microphone_permission() -> MicrophonePermissionResult {
    let media_type = unsafe { AVMediaTypeAudio };
    let Some(media_type) = media_type else {
        return MicrophonePermissionResult {
            granted: false,
            status: Some("unavailable".to_string()),
            code: Some(MICROPHONE_PERMISSION_REQUIRED_CODE.to_string()),
            opened_settings: None,
            message: Some("Audio capture is not available on this system.".to_string()),
        };
    };

    let status = unsafe { AVCaptureDevice::authorizationStatusForMediaType(media_type) };

    match status.0 {
        AV_AUTH_STATUS_AUTHORIZED => MicrophonePermissionResult {
            granted: true,
            status: Some("authorized".to_string()),
            code: None,
            opened_settings: None,
            message: None,
        },
        AV_AUTH_STATUS_NOT_DETERMINED => {
            let handler = RcBlock::new(|_granted: Bool| {});
            unsafe {
                AVCaptureDevice::requestAccessForMediaType_completionHandler(media_type, &handler);
            }
            MicrophonePermissionResult {
                granted: false,
                status: Some("not_determined".to_string()),
                code: Some(MICROPHONE_PERMISSION_REQUIRED_CODE.to_string()),
                opened_settings: None,
                message: Some(
                    "Microphone permission is required. Please allow access in the dialog that appeared, then try again.".to_string(),
                ),
            }
        }
        raw => build_microphone_denied_result(
            if raw == AV_AUTH_STATUS_RESTRICTED {
                "restricted"
            } else {
                "denied"
            }
            .to_string(),
        ),
    }
}

#[cfg(not(target_os = "macos"))]
pub fn ensure_microphone_permission() -> MicrophonePermissionResult {
    MicrophonePermissionResult {
        granted: true,
        status: Some("granted".to_string()),
        code: None,
        opened_settings: None,
        message: None,
    }
}

pub fn ensure_accessibility_permission() -> AccessibilityPermissionResult {
    if is_accessibility_trusted() {
        return AccessibilityPermissionResult {
            granted: true,
            code: None,
            opened_settings: None,
            message: None,
        };
    }

    // AXIsProcessTrustedWithOptions with kAXTrustedCheckOptionPrompt=true
    // both registers the app in TCC and shows the system prompt.
    let prompted = prompt_accessibility_trust();
    AccessibilityPermissionResult {
        granted: false,
        code: Some(ACCESSIBILITY_PERMISSION_REQUIRED_CODE.to_string()),
        opened_settings: Some(prompted),
        message: Some(
            "Accessibility permission is required to insert text. Enable Voice to Text in System Settings → Privacy & Security → Accessibility, then try again.".to_string(),
        ),
    }
}

/// Check if this process is trusted for accessibility via AXIsProcessTrusted.
fn is_accessibility_trusted() -> bool {
    #[cfg(target_os = "macos")]
    {
        extern "C" {
            fn AXIsProcessTrusted() -> bool;
        }
        unsafe { AXIsProcessTrusted() }
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// Prompt the user to trust this process for accessibility.
/// Calls AXIsProcessTrustedWithOptions with kAXTrustedCheckOptionPrompt=true,
/// which registers the app in TCC and shows the macOS system dialog.
fn prompt_accessibility_trust() -> bool {
    #[cfg(target_os = "macos")]
    {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;
        use objc2_foundation::NSString;

        extern "C" {
            fn AXIsProcessTrustedWithOptions(options: *const AnyObject) -> bool;
        }

        let key = NSString::from_str("AXTrustedCheckOptionPrompt");
        let val = objc2_foundation::NSNumber::new_bool(true);

        // Build a single-entry NSDictionary via msg_send to avoid NSCopying bounds.
        let dict: *mut AnyObject = unsafe {
            msg_send![
                objc2::class!(NSDictionary),
                dictionaryWithObject: &*val,
                forKey: &*key
            ]
        };

        unsafe { AXIsProcessTrustedWithOptions(dict) }
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

pub fn build_microphone_denied_result(status: String) -> MicrophonePermissionResult {
    let opened_settings = open_privacy_pane(MICROPHONE_PRIVACY_PANE_URL);
    MicrophonePermissionResult {
        granted: false,
        status: Some(status),
        code: Some(MICROPHONE_PERMISSION_REQUIRED_CODE.to_string()),
        opened_settings: Some(opened_settings),
        message: Some(
            "Microphone permission is required. Enable Voice to Text in System Settings → Privacy & Security → Microphone, then restart Voice to Text and try again.".to_string(),
        ),
    }
}

fn open_privacy_pane(url: &str) -> bool {
    Command::new("open")
        .arg(url)
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}
