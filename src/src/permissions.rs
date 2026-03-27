use serde::Serialize;
use std::process::Command;

const MICROPHONE_PRIVACY_PANE_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
const ACCESSIBILITY_PRIVACY_PANE_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
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
    if is_accessibility_enabled() {
        return AccessibilityPermissionResult {
            granted: true,
            code: None,
            opened_settings: None,
            message: None,
        };
    }

    let opened_settings = open_privacy_pane(ACCESSIBILITY_PRIVACY_PANE_URL);
    AccessibilityPermissionResult {
        granted: false,
        code: Some(ACCESSIBILITY_PERMISSION_REQUIRED_CODE.to_string()),
        opened_settings: Some(opened_settings),
        message: Some(
            "Accessibility permission is required to insert text. Enable Voice to Text in System Settings → Privacy & Security → Accessibility, then try again.".to_string(),
        ),
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

fn is_accessibility_enabled() -> bool {
    let script = r#"tell application \"System Events\" to return UI elements enabled"#;
    let Ok(output) = Command::new("osascript").args(["-e", script]).output() else {
        return false;
    };

    if !output.status.success() {
        return false;
    }

    String::from_utf8_lossy(&output.stdout).trim() == "true"
}

fn open_privacy_pane(url: &str) -> bool {
    Command::new("open")
        .arg(url)
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}
