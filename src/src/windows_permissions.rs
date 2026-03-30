use std::process::Command;

use crate::text_inserter;

use super::{AccessibilityPermissionResult, MicrophonePermissionResult, PermissionsStatus};

const MICROPHONE_PERMISSION_REQUIRED_CODE: &str = "microphone-permission-required";
const POWERSHELL_EXECUTABLE: &str = "powershell";
const WINDOWS_MICROPHONE_REGISTRY_QUERY: &str = "(Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone' -Name Value -ErrorAction SilentlyContinue).Value";
const WINDOWS_MICROPHONE_DENIED_VALUE: &str = "deny";

const MICROPHONE_PERMISSION_REQUIRED_MESSAGE: &str = "Microphone access is disabled for desktop apps in Windows Privacy settings. Enable microphone access in Settings → Privacy & security → Microphone, then try again.";
const MICROPHONE_PERMISSION_UNKNOWN_MESSAGE: &str = "Voice to Text could not read Windows microphone privacy state. Verify Settings → Privacy & security → Microphone allows desktop apps.";
const ACCESSIBILITY_EQUIVALENT_ADVISORY_MESSAGE: &str = "Windows accessibility-equivalent readiness has not been fully validated yet. Voice to Text will continue insertion while VM hardening is in progress.";

enum WindowsMicrophonePrivacyState {
    Allowed,
    Denied,
    Unknown,
}

pub(super) fn check_permissions_status() -> PermissionsStatus {
    PermissionsStatus {
        microphone: is_microphone_authorized(),
        accessibility: is_accessibility_equivalent_ready(),
        automation: text_inserter::check_automation_status(),
    }
}

pub(super) fn is_microphone_authorized() -> bool {
    !matches!(
        read_windows_microphone_privacy_state(),
        WindowsMicrophonePrivacyState::Denied
    )
}

pub(super) fn ensure_microphone_permission() -> MicrophonePermissionResult {
    match read_windows_microphone_privacy_state() {
        WindowsMicrophonePrivacyState::Allowed => MicrophonePermissionResult {
            granted: true,
            status: Some("authorized".to_string()),
            code: None,
            opened_settings: None,
            message: None,
        },
        WindowsMicrophonePrivacyState::Denied => MicrophonePermissionResult {
            granted: false,
            status: Some("denied".to_string()),
            code: Some(MICROPHONE_PERMISSION_REQUIRED_CODE.to_string()),
            opened_settings: Some(false),
            message: Some(MICROPHONE_PERMISSION_REQUIRED_MESSAGE.to_string()),
        },
        WindowsMicrophonePrivacyState::Unknown => MicrophonePermissionResult {
            granted: true,
            status: Some("unknown".to_string()),
            code: None,
            opened_settings: Some(false),
            message: Some(MICROPHONE_PERMISSION_UNKNOWN_MESSAGE.to_string()),
        },
    }
}

pub(super) fn ensure_accessibility_permission() -> AccessibilityPermissionResult {
    AccessibilityPermissionResult {
        granted: true,
        code: None,
        opened_settings: Some(false),
        message: Some(ACCESSIBILITY_EQUIVALENT_ADVISORY_MESSAGE.to_string()),
    }
}

pub(super) fn is_accessibility_equivalent_ready() -> bool {
    // VM hardening has not yet validated the Windows UIA/UIPI probe path.
    // Keep readiness non-blocking so insertion can proceed on Windows.
    true
}

pub(super) fn prompt_accessibility_equivalent() -> bool {
    false
}

fn read_windows_microphone_privacy_state() -> WindowsMicrophonePrivacyState {
    let output = Command::new(POWERSHELL_EXECUTABLE)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            WINDOWS_MICROPHONE_REGISTRY_QUERY,
        ])
        .output();

    let Ok(output) = output else {
        return WindowsMicrophonePrivacyState::Unknown;
    };

    if !output.status.success() {
        return WindowsMicrophonePrivacyState::Unknown;
    }

    let value = String::from_utf8_lossy(&output.stdout)
        .trim()
        .to_ascii_lowercase();
    if value.is_empty() {
        return WindowsMicrophonePrivacyState::Unknown;
    }

    if value == WINDOWS_MICROPHONE_DENIED_VALUE {
        return WindowsMicrophonePrivacyState::Denied;
    }

    WindowsMicrophonePrivacyState::Allowed
}
