use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::permissions;

#[cfg(target_os = "macos")]
use crate::applescript;
use crate::clipboard;

#[cfg(target_os = "windows")]
#[path = "windows_inserter.rs"]
pub(crate) mod windows_inserter;

const ACCESSIBILITY_PERMISSION_REQUIRED_CODE: &str = "accessibility-permission-required";
const AUTOMATION_PERMISSION_REQUIRED_CODE: &str = "automation-permission-required";
const AUTOMATION_CHECK_FAILED_CODE: &str = "automation-check-failed";
const WINDOWS_HELPER_UNAVAILABLE_CODE: &str = "windows-helper-unavailable";
const WINDOWS_HELPER_REQUIRED_CODE: &str = "windows-helper-required";
const WINDOWS_HELPER_UNAVAILABLE_PREFIX: &str = "windows-helper-unavailable:";
const WINDOWS_HELPER_REQUIRED_PREFIX: &str = "windows-helper-required:";
const WINDOWS_HELPER_UNAVAILABLE_MESSAGE: &str = "Voice to Text could not prepare the Windows insertion helper required for elevated target apps. Reinstall the app or restart it from a standard user session, then try again.";
const WINDOWS_HELPER_REQUIRED_MESSAGE: &str = "Text insertion into elevated Windows apps requires the Voice to Text helper. Allow the helper elevation prompt, then try again.";
const CLIPBOARD_RESTORE_FAILED_CODE: &str = "clipboard-restore-failed";
const SHORT_INSERTION_DELAY_MS: u64 = 200;
const LONG_INSERTION_DELAY_MS: u64 = 700;
const POST_INSERTION_DELAY_MS: u64 = 100;
const LONG_INSERTION_TEXT_THRESHOLD: usize = 200;

#[derive(Debug, Clone, Serialize)]
pub struct InsertTextResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "openedSettings")]
    pub opened_settings: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TextInsertionPermissionResult {
    pub granted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "openedSettings")]
    pub opened_settings: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WindowsInsertHelperRequest {
    text: String,
    enter_mode: bool,
}

#[derive(Debug, Serialize)]
struct WindowsInsertHelperResponse {
    success: bool,
    error: Option<String>,
    code: Option<String>,
}

pub fn insert_text(text: String, enter_mode: bool) -> InsertTextResult {
    insert_text_with_pre_insertion_hook(text, enter_mode, || {})
}

pub fn insert_text_with_pre_insertion_hook<BeforeInsertion>(
    text: String,
    enter_mode: bool,
    before_insertion: BeforeInsertion,
) -> InsertTextResult
where
    BeforeInsertion: FnOnce(),
{
    let accessibility = permissions::ensure_accessibility_permission();
    if !accessibility.granted {
        return InsertTextResult {
            success: false,
            error: accessibility.message,
            code: Some(ACCESSIBILITY_PERMISSION_REQUIRED_CODE.to_string()),
            opened_settings: accessibility.opened_settings,
        };
    }

    let automation = ensure_text_insertion_permission();
    if !automation.granted {
        return InsertTextResult {
            success: false,
            error: automation.message,
            code: automation.code,
            opened_settings: automation.opened_settings,
        };
    }

    let snapshot = clipboard::snapshot();

    before_insertion();
    let operation_result = perform_insertion(&text, enter_mode);
    let restore_result = match snapshot {
        Some(snapshot_to_restore) => clipboard::restore(&snapshot_to_restore),
        None => Ok(()),
    };

    build_insert_text_result(operation_result, restore_result)
}

pub fn build_insert_text_result(
    operation_result: Result<(), String>,
    restore_result: Result<(), String>,
) -> InsertTextResult {
    match (operation_result, restore_result) {
        (Ok(()), Ok(())) => InsertTextResult {
            success: true,
            error: None,
            code: None,
            opened_settings: None,
        },
        (Ok(()), Err(restore_error)) => InsertTextResult {
            success: false,
            error: Some(format!(
                "Text was inserted, but previous clipboard contents could not be restored: {restore_error}"
            )),
            code: Some(CLIPBOARD_RESTORE_FAILED_CODE.to_string()),
            opened_settings: None,
        },
        (Err(operation_error), Ok(())) => InsertTextResult {
            success: false,
            error: Some(operation_error),
            code: None,
            opened_settings: None,
        },
        (Err(operation_error), Err(restore_error)) => InsertTextResult {
            success: false,
            error: Some(format!(
                "{operation_error} Also failed to restore previous clipboard contents: {restore_error}"
            )),
            code: Some(CLIPBOARD_RESTORE_FAILED_CODE.to_string()),
            opened_settings: None,
        },
    }
}

pub fn copy_to_clipboard(text: String) -> Result<(), String> {
    clipboard::write_plain_text(&text)
}

pub fn ensure_text_insertion_permission() -> TextInsertionPermissionResult {
    #[cfg(target_os = "windows")]
    {
        return windows_inserter::ensure_text_insertion_permission();
    }

    build_text_insertion_permission_result(applescript::run(
        r#"tell application "System Events" to count processes"#,
    ))
}

pub fn build_text_insertion_permission_result(
    automation_probe_result: Result<(), String>,
) -> TextInsertionPermissionResult {
    match automation_probe_result {
        Ok(()) => TextInsertionPermissionResult {
            granted: true,
            code: None,
            opened_settings: None,
            message: None,
        },
        Err(error) => {
            if let Some(result) = build_windows_permission_error_result(&error) {
                return result;
            }

            let code = if applescript::is_system_events_automation_denied(&error) {
                AUTOMATION_PERMISSION_REQUIRED_CODE
            } else {
                AUTOMATION_CHECK_FAILED_CODE
            };

            TextInsertionPermissionResult {
                granted: false,
                code: Some(code.to_string()),
                opened_settings: None,
                message: Some(applescript::format_system_events_error_message(&error)),
            }
        }
    }
}

fn build_windows_permission_error_result(error: &str) -> Option<TextInsertionPermissionResult> {
    if let Some(message) = error.strip_prefix(WINDOWS_HELPER_UNAVAILABLE_PREFIX) {
        let normalized_message =
            normalize_windows_helper_error_message(message, WINDOWS_HELPER_UNAVAILABLE_MESSAGE);
        return Some(TextInsertionPermissionResult {
            granted: false,
            code: Some(WINDOWS_HELPER_UNAVAILABLE_CODE.to_string()),
            opened_settings: Some(false),
            message: Some(normalized_message),
        });
    }

    if let Some(message) = error.strip_prefix(WINDOWS_HELPER_REQUIRED_PREFIX) {
        let normalized_message =
            normalize_windows_helper_error_message(message, WINDOWS_HELPER_REQUIRED_MESSAGE);
        return Some(TextInsertionPermissionResult {
            granted: false,
            code: Some(WINDOWS_HELPER_REQUIRED_CODE.to_string()),
            opened_settings: Some(false),
            message: Some(normalized_message),
        });
    }

    None
}

fn normalize_windows_helper_error_message(error: &str, default_message: &str) -> String {
    let trimmed = error.trim();
    if trimmed.is_empty() {
        return default_message.to_string();
    }

    trimmed.to_string()
}

fn perform_insertion(text: &str, enter_mode: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return windows_inserter::perform_insertion(text, enter_mode);
    }

    clipboard::write_plain_text(text)?;
    applescript::run_system_events(
        r#"tell application "System Events" to keystroke "v" using command down"#,
    )?;

    let insertion_delay_ms = if text.len() > LONG_INSERTION_TEXT_THRESHOLD {
        LONG_INSERTION_DELAY_MS
    } else {
        SHORT_INSERTION_DELAY_MS
    };
    thread::sleep(Duration::from_millis(insertion_delay_ms));

    if enter_mode {
        applescript::run_double_enter_sequence()?;
    }

    thread::sleep(Duration::from_millis(POST_INSERTION_DELAY_MS));
    Ok(())
}

/// Non-prompting automation status check.
/// After the initial `ensure_text_insertion_permission` call triggers the
/// macOS prompt, subsequent calls just return the stored TCC decision.
pub fn check_automation_status() -> bool {
    #[cfg(target_os = "windows")]
    {
        return windows_inserter::is_privileged_helper_available();
    }

    applescript::run(r#"tell application "System Events" to count processes"#).is_ok()
}

pub fn run_windows_insertion_helper_mode(
    request_path: Option<&str>,
    response_path: Option<&str>,
) -> i32 {
    #[cfg(target_os = "windows")]
    {
        return windows_inserter::run_windows_insertion_helper_mode(request_path, response_path);
    }

    let request = match read_windows_helper_request(request_path) {
        Ok(request) => request,
        Err(error) => {
            return write_windows_helper_response(
                response_path,
                WindowsInsertHelperResponse {
                    success: false,
                    error: Some(format!(
                        "{WINDOWS_HELPER_UNAVAILABLE_PREFIX} could not parse helper payload: {error}"
                    )),
                    code: Some(WINDOWS_HELPER_UNAVAILABLE_CODE.to_string()),
                },
            );
        }
    };

    let _ = (&request.text, request.enter_mode);
    write_windows_helper_response(
        response_path,
        WindowsInsertHelperResponse {
            success: false,
            error: Some(format!(
                "{WINDOWS_HELPER_UNAVAILABLE_PREFIX} helper mode is only available on Windows"
            )),
            code: Some(WINDOWS_HELPER_UNAVAILABLE_CODE.to_string()),
        },
    )
}

fn read_windows_helper_request(
    request_path: Option<&str>,
) -> Result<WindowsInsertHelperRequest, String> {
    let payload = if let Some(path) = request_path {
        std::fs::read_to_string(path).map_err(|error| error.to_string())?
    } else {
        use std::io::Read as _;

        let mut payload = String::new();
        std::io::stdin()
            .read_to_string(&mut payload)
            .map_err(|error| error.to_string())?;
        payload
    };

    serde_json::from_str::<WindowsInsertHelperRequest>(&payload).map_err(|error| error.to_string())
}

fn write_windows_helper_response(
    response_path: Option<&str>,
    response: WindowsInsertHelperResponse,
) -> i32 {
    if let Some(path) = response_path {
        let serialized = match serde_json::to_string(&response) {
            Ok(serialized) => serialized,
            Err(_) => return 1,
        };

        if std::fs::write(path, serialized).is_ok() {
            return 0;
        }

        return 1;
    }

    if serde_json::to_writer(std::io::stdout(), &response).is_ok() {
        return 0;
    }

    1
}

pub fn run_windows_helper_escalation_contract<WriteRequest, LaunchHelper, ReadResponse>(
    write_request: WriteRequest,
    launch_helper: LaunchHelper,
    read_response: ReadResponse,
) -> Result<(), String>
where
    WriteRequest: FnOnce() -> Result<(), String>,
    LaunchHelper: FnOnce() -> Result<(), String>,
    ReadResponse: FnOnce() -> Result<(bool, Option<String>), String>,
{
    write_request()?;
    launch_helper()?;
    let (success, error) = read_response()?;
    if success {
        return Ok(());
    }

    if let Some(error) = error {
        return Err(error);
    }

    Err(format!(
        "{WINDOWS_HELPER_REQUIRED_PREFIX} {WINDOWS_HELPER_REQUIRED_MESSAGE}"
    ))
}

#[cfg(test)]
mod tests {
    use super::{build_insert_text_result, build_text_insertion_permission_result};
    use crate::applescript::AUTOMATION_PERMISSION_REQUIRED_MESSAGE;
    use crate::text_inserter::AUTOMATION_PERMISSION_REQUIRED_CODE;

    #[test]
    fn permission_result_maps_automation_denial_to_expected_code() {
        let result = build_text_insertion_permission_result(Err(
            "Not authorized to send Apple events to System Events. (-1743)".to_string(),
        ));

        assert!(!result.granted);
        assert_eq!(
            result.code.as_deref(),
            Some(AUTOMATION_PERMISSION_REQUIRED_CODE)
        );
        assert_eq!(
            result.message.as_deref(),
            Some(AUTOMATION_PERMISSION_REQUIRED_MESSAGE)
        );
    }

    #[test]
    fn permission_result_preserves_unexpected_system_events_error() {
        let result =
            build_text_insertion_permission_result(Err("Execution error: foo".to_string()));

        assert!(!result.granted);
        assert_eq!(result.code.as_deref(), Some("automation-check-failed"));
        assert_eq!(
            result.message.as_deref(),
            Some("Could not control System Events: Execution error: foo")
        );
    }

    #[test]
    fn reports_restore_failure_when_insertion_succeeds() {
        let result = build_insert_text_result(Ok(()), Err("Clipboard unavailable".to_string()));

        assert!(!result.success);
        assert_eq!(result.code.as_deref(), Some("clipboard-restore-failed"));
        assert_eq!(
            result.error.as_deref(),
            Some(
                "Text was inserted, but previous clipboard contents could not be restored: Clipboard unavailable"
            )
        );
    }

    #[test]
    fn reports_both_insertion_and_restore_failures() {
        let result = build_insert_text_result(
            Err("Could not control System Events: paste failed".to_string()),
            Err("Clipboard unavailable".to_string()),
        );

        assert!(!result.success);
        assert_eq!(result.code.as_deref(), Some("clipboard-restore-failed"));
        assert_eq!(
            result.error.as_deref(),
            Some(
                "Could not control System Events: paste failed Also failed to restore previous clipboard contents: Clipboard unavailable"
            )
        );
    }
}
