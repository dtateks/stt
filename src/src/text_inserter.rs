use std::thread;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use serde::{Deserialize, Serialize};

#[cfg(target_os = "macos")]
use objc2::rc::Retained;
#[cfg(target_os = "macos")]
use objc2::runtime::AnyObject;
#[cfg(target_os = "macos")]
use objc2::AnyThread;
#[cfg(target_os = "macos")]
use objc2_foundation::{
    NSAppleScript, NSAppleScriptErrorBriefMessage, NSAppleScriptErrorMessage,
    NSAppleScriptErrorNumber, NSDictionary, NSNumber, NSString,
};
#[cfg(not(target_os = "macos"))]
use std::process::Command;

use crate::permissions;

#[cfg(target_os = "windows")]
#[path = "windows_inserter.rs"]
mod windows_inserter;

const ACCESSIBILITY_PERMISSION_REQUIRED_CODE: &str = "accessibility-permission-required";
const ACCESSIBILITY_PERMISSION_REQUIRED_MESSAGE: &str = "Accessibility permission is required to insert text. Enable Voice to Text in System Settings → Privacy & Security → Accessibility, then try again.";
const AUTOMATION_PERMISSION_REQUIRED_CODE: &str = "automation-permission-required";
const AUTOMATION_CHECK_FAILED_CODE: &str = "automation-check-failed";
const AUTOMATION_PERMISSION_REQUIRED_MESSAGE: &str = "Automation permission is required to control System Events for paste/Enter. Allow Voice to Text when macOS asks, then try again.";
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
const SYSTEM_EVENTS_RETRY_DELAY_MS: u64 = 75;
const SYSTEM_EVENTS_RETRY_ATTEMPTS: usize = 2;

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

#[derive(Debug, Clone)]
struct ClipboardSnapshot {
    had_formats: bool,
    formats: Vec<ClipboardFormatData>,
    non_preservable_formats: Vec<String>,
}

#[derive(Debug, Clone)]
struct ClipboardFormatData {
    format: String,
    data_base64: String,
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

    let snapshot = snapshot_clipboard();
    if let Some(snapshot_to_validate) = snapshot.as_ref() {
        if let Err(error) = validate_clipboard_snapshot(snapshot_to_validate) {
            return InsertTextResult {
                success: false,
                error: Some(error),
                code: Some(CLIPBOARD_RESTORE_FAILED_CODE.to_string()),
                opened_settings: None,
            };
        }
    }

    before_insertion();
    let operation_result = perform_insertion(&text, enter_mode);
    let restore_result = match snapshot {
        Some(snapshot_to_restore) => restore_clipboard(&snapshot_to_restore),
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
    write_plain_text_clipboard(&text)
}

pub fn ensure_text_insertion_permission() -> TextInsertionPermissionResult {
    #[cfg(target_os = "windows")]
    {
        return windows_inserter::ensure_text_insertion_permission();
    }

    build_text_insertion_permission_result(run_osascript(
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

            let code = if is_system_events_automation_denied(&error) {
                AUTOMATION_PERMISSION_REQUIRED_CODE
            } else {
                AUTOMATION_CHECK_FAILED_CODE
            };

            TextInsertionPermissionResult {
                granted: false,
                code: Some(code.to_string()),
                opened_settings: None,
                message: Some(format_system_events_error_message(&error)),
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

fn validate_clipboard_snapshot(snapshot: &ClipboardSnapshot) -> Result<(), String> {
    if !snapshot.had_formats {
        return Ok(());
    }

    if !snapshot.non_preservable_formats.is_empty() {
        return Err(format!(
            "Original clipboard contained formats that could not be preserved: {}",
            snapshot.non_preservable_formats.join(", ")
        ));
    }

    if snapshot.formats.is_empty() {
        return Err("Original clipboard contained formats that could not be preserved".to_string());
    }

    Ok(())
}

fn validate_pasteboard_change_count(change_count: isize) -> Result<(), String> {
    if change_count >= 0 {
        return Ok(());
    }

    Err(format!(
        "Clipboard clear returned invalid change count: {change_count}"
    ))
}

fn perform_insertion(text: &str, enter_mode: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return windows_inserter::perform_insertion(text, enter_mode);
    }

    write_plain_text_clipboard(text)?;
    run_system_events_osascript(
        r#"tell application "System Events" to keystroke "v" using command down"#,
    )?;

    let insertion_delay_ms = if text.len() > LONG_INSERTION_TEXT_THRESHOLD {
        LONG_INSERTION_DELAY_MS
    } else {
        SHORT_INSERTION_DELAY_MS
    };
    thread::sleep(Duration::from_millis(insertion_delay_ms));

    if enter_mode {
        run_system_events_osascript(r#"tell application "System Events" to key code 36"#)?;
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

    run_osascript(r#"tell application "System Events" to count processes"#).is_ok()
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

#[cfg(target_os = "macos")]
fn run_osascript(script: &str) -> Result<(), String> {
    let source = NSString::from_str(script);
    let script = NSAppleScript::initWithSource(NSAppleScript::alloc(), &source)
        .ok_or_else(|| "AppleScript execution failed".to_string())?;

    let mut error_info: Option<Retained<NSDictionary<NSString, AnyObject>>> = None;
    let _ = unsafe { script.executeAndReturnError(Some(&mut error_info)) };

    match error_info {
        Some(error_info) => Err(format_applescript_error(&error_info)),
        None => Ok(()),
    }
}

#[cfg(target_os = "macos")]
fn format_applescript_error(error_info: &NSDictionary<NSString, AnyObject>) -> String {
    let message =
        extract_applescript_error_string(error_info, unsafe { NSAppleScriptErrorMessage })
            .or_else(|| {
                extract_applescript_error_string(error_info, unsafe {
                    NSAppleScriptErrorBriefMessage
                })
            })
            .unwrap_or_else(|| "AppleScript execution failed".to_string());

    let Some(error_number) = error_info
        .objectForKey(unsafe { NSAppleScriptErrorNumber })
        .and_then(|value| value.downcast_ref::<NSNumber>().map(NSNumber::intValue))
    else {
        return message;
    };

    let error_number_suffix = format!("({error_number})");
    if message.contains(&error_number_suffix) {
        return message;
    }

    format!("{message} {error_number_suffix}")
}

#[cfg(target_os = "macos")]
fn extract_applescript_error_string(
    error_info: &NSDictionary<NSString, AnyObject>,
    key: &NSString,
) -> Option<String> {
    error_info.objectForKey(key).and_then(|value| {
        value
            .downcast_ref::<NSString>()
            .map(|string| string.to_string())
    })
}

#[cfg(not(target_os = "macos"))]
fn run_osascript(script: &str) -> Result<(), String> {
    let output = Command::new("osascript")
        .args(["-e", script])
        .output()
        .map_err(|error| error.to_string())?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            Err("AppleScript execution failed".to_string())
        } else {
            Err(stderr)
        }
    }
}

fn run_system_events_osascript(script: &str) -> Result<(), String> {
    run_system_events_osascript_with(script, run_osascript, || {
        thread::sleep(Duration::from_millis(SYSTEM_EVENTS_RETRY_DELAY_MS));
    })
}

fn run_system_events_osascript_with<RunScript, SleepBeforeRetry>(
    script: &str,
    mut run_script: RunScript,
    mut sleep_before_retry: SleepBeforeRetry,
) -> Result<(), String>
where
    RunScript: FnMut(&str) -> Result<(), String>,
    SleepBeforeRetry: FnMut(),
{
    for attempt in 0..SYSTEM_EVENTS_RETRY_ATTEMPTS {
        match run_script(script) {
            Ok(()) => return Ok(()),
            Err(error) => {
                if is_system_events_automation_denied(&error)
                    || attempt + 1 == SYSTEM_EVENTS_RETRY_ATTEMPTS
                {
                    return Err(format_system_events_error_message(&error));
                }

                sleep_before_retry();
            }
        }
    }

    Err("AppleScript execution failed".to_string())
}

fn format_system_events_error_message(error: &str) -> String {
    if is_system_events_automation_denied(error) {
        return AUTOMATION_PERMISSION_REQUIRED_MESSAGE.to_string();
    }

    if is_system_events_accessibility_denied(error) {
        return ACCESSIBILITY_PERMISSION_REQUIRED_MESSAGE.to_string();
    }

    format!("Could not control System Events: {error}")
}

fn is_system_events_automation_denied(error: &str) -> bool {
    let normalized_error = error.to_ascii_lowercase();
    normalized_error.contains("not authorized to send apple events") || error.contains("(-1743)")
}

fn is_system_events_accessibility_denied(error: &str) -> bool {
    let normalized_error = error.to_ascii_lowercase();

    normalized_error.contains("assistive access")
        || normalized_error.contains("not allowed to send keystrokes")
        || normalized_error.contains("a privilege error has occurred")
        || (error.contains("(-1719)") && normalized_error.contains("system events"))
}

#[cfg(test)]
mod tests {
    use super::{
        build_insert_text_result, build_text_insertion_permission_result,
        format_system_events_error_message, is_system_events_accessibility_denied,
        is_system_events_automation_denied, run_system_events_osascript_with,
        validate_clipboard_snapshot, validate_pasteboard_change_count,
        ACCESSIBILITY_PERMISSION_REQUIRED_MESSAGE, AUTOMATION_PERMISSION_REQUIRED_CODE,
        AUTOMATION_PERMISSION_REQUIRED_MESSAGE,
    };
    #[cfg(target_os = "macos")]
    use super::{restore_clipboard, ClipboardSnapshot};

    #[test]
    fn detects_system_events_automation_denial() {
        assert!(is_system_events_automation_denied(
            "Not authorized to send Apple events to System Events. (-1743)"
        ));
    }

    #[test]
    fn detects_lowercase_system_events_automation_denial() {
        assert!(is_system_events_automation_denied(
            "not authorized to send Apple events to System Events."
        ));
    }

    #[test]
    fn maps_automation_denial_to_actionable_message() {
        assert_eq!(
            format_system_events_error_message(
                "Not authorized to send Apple events to System Events. (-1743)"
            ),
            AUTOMATION_PERMISSION_REQUIRED_MESSAGE
        );
    }

    #[test]
    fn detects_system_events_accessibility_denial() {
        assert!(is_system_events_accessibility_denied(
            "System Events got an error: osascript is not allowed assistive access. (-1728)"
        ));
    }

    #[test]
    fn maps_accessibility_denial_to_actionable_message() {
        assert_eq!(
            format_system_events_error_message(
                "System Events got an error: osascript is not allowed assistive access. (-1728)"
            ),
            ACCESSIBILITY_PERMISSION_REQUIRED_MESSAGE
        );
    }

    #[test]
    fn maps_exact_execution_error_shape_to_accessibility_message() {
        assert_eq!(
            format_system_events_error_message(
                "36: 68: execution error: System Events got an error: osascript is not allowed assistive access. (-1728)"
            ),
            ACCESSIBILITY_PERMISSION_REQUIRED_MESSAGE
        );
    }

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
    fn preserves_unexpected_system_events_errors() {
        assert_eq!(
            format_system_events_error_message("Execution error: foo"),
            "Could not control System Events: Execution error: foo"
        );
    }

    #[test]
    fn retries_unexpected_system_events_error_once_before_succeeding() {
        let mut attempts = 0;
        let mut sleeps = 0;

        let result = run_system_events_osascript_with(
            "paste",
            |_script| {
                attempts += 1;
                if attempts == 1 {
                    return Err("Execution error: foo".to_string());
                }

                Ok(())
            },
            || {
                sleeps += 1;
            },
        );

        assert!(result.is_ok());
        assert_eq!(attempts, 2);
        assert_eq!(sleeps, 1);
    }

    #[test]
    fn does_not_retry_automation_denial_errors() {
        let mut attempts = 0;
        let mut sleeps = 0;

        let result = run_system_events_osascript_with(
            "paste",
            |_script| {
                attempts += 1;
                Err("Not authorized to send Apple events to System Events. (-1743)".to_string())
            },
            || {
                sleeps += 1;
            },
        );

        assert_eq!(
            result.err().as_deref(),
            Some(AUTOMATION_PERMISSION_REQUIRED_MESSAGE)
        );
        assert_eq!(attempts, 1);
        assert_eq!(sleeps, 0);
    }

    #[test]
    fn preserves_unexpected_system_events_error_after_retry_exhaustion() {
        let mut attempts = 0;
        let mut sleeps = 0;

        let result = run_system_events_osascript_with(
            "paste",
            |_script| {
                attempts += 1;
                Err("Execution error: foo".to_string())
            },
            || {
                sleeps += 1;
            },
        );

        assert_eq!(
            result.err().as_deref(),
            Some("Could not control System Events: Execution error: foo")
        );
        assert_eq!(attempts, 2);
        assert_eq!(sleeps, 1);
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

    #[test]
    fn snapshot_validation_reports_non_preservable_formats() {
        let snapshot = ClipboardSnapshot {
            had_formats: true,
            formats: Vec::new(),
            non_preservable_formats: vec!["public.tiff".to_string()],
        };

        let result = validate_clipboard_snapshot(&snapshot);

        assert_eq!(
            result.err().as_deref(),
            Some("Original clipboard contained formats that could not be preserved: public.tiff")
        );
    }

    #[test]
    fn accepts_zero_change_count_when_clearing_clipboard() {
        assert!(validate_pasteboard_change_count(0).is_ok());
    }

    #[test]
    fn rejects_negative_change_count_when_clearing_clipboard() {
        assert_eq!(
            validate_pasteboard_change_count(-1).err().as_deref(),
            Some("Clipboard clear returned invalid change count: -1")
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn restore_fails_when_original_clipboard_had_formats_but_none_are_preservable() {
        let snapshot = ClipboardSnapshot {
            had_formats: true,
            formats: Vec::new(),
            non_preservable_formats: Vec::new(),
        };

        let result = restore_clipboard(&snapshot);

        assert!(result.is_err());
        assert_eq!(
            result.err().as_deref(),
            Some("Original clipboard contained formats that could not be preserved")
        );
    }
}

#[cfg(target_os = "macos")]
fn snapshot_clipboard() -> Option<ClipboardSnapshot> {
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::ClassType;
    use objc2_app_kit::NSPasteboard;
    use objc2_foundation::{NSArray, NSData, NSString};

    let pasteboard: Retained<NSPasteboard> = unsafe {
        let cls = NSPasteboard::class();
        let obj: Option<Retained<NSPasteboard>> = msg_send![cls, generalPasteboard];
        obj?
    };

    let types: Retained<NSArray<NSString>> = unsafe {
        let obj: Option<Retained<NSArray<NSString>>> = msg_send![&*pasteboard, types];
        let Some(obj) = obj else {
            return Some(ClipboardSnapshot {
                had_formats: false,
                formats: Vec::new(),
                non_preservable_formats: Vec::new(),
            });
        };
        obj
    };

    let count: usize = unsafe { msg_send![&*types, count] };
    let had_formats = count > 0;
    let mut formats = Vec::new();
    let mut non_preservable_formats = Vec::new();

    for index in 0..count {
        let type_id: Retained<NSString> = unsafe {
            let obj: Option<Retained<NSString>> = msg_send![&*types, objectAtIndex: index];
            let Some(obj) = obj else {
                non_preservable_formats.push(format!("clipboard-format-index-{index}"));
                continue;
            };
            obj
        };

        let type_utf8: *const std::ffi::c_char = unsafe { msg_send![&*type_id, UTF8String] };
        if type_utf8.is_null() {
            non_preservable_formats.push(format!("clipboard-format-index-{index}"));
            continue;
        }

        let format = unsafe { std::ffi::CStr::from_ptr(type_utf8) }
            .to_string_lossy()
            .to_string();

        let data: Retained<NSData> = unsafe {
            let obj: Option<Retained<NSData>> = msg_send![&*pasteboard, dataForType: &*type_id];
            let Some(obj) = obj else {
                non_preservable_formats.push(format);
                continue;
            };
            obj
        };

        let bytes: *const u8 = unsafe { msg_send![&*data, bytes] };
        let len: usize = unsafe { msg_send![&*data, length] };
        if len > 0 && bytes.is_null() {
            non_preservable_formats.push(format);
            continue;
        }

        let bytes_slice: &[u8] = if len == 0 {
            &[]
        } else {
            unsafe { std::slice::from_raw_parts(bytes, len) }
        };
        formats.push(ClipboardFormatData {
            format,
            data_base64: BASE64_STANDARD.encode(bytes_slice),
        });
    }

    Some(ClipboardSnapshot {
        had_formats,
        formats,
        non_preservable_formats,
    })
}

#[cfg(target_os = "windows")]
fn snapshot_clipboard() -> Option<ClipboardSnapshot> {
    windows_inserter::snapshot_clipboard()
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
fn snapshot_clipboard() -> Option<ClipboardSnapshot> {
    None
}

#[cfg(target_os = "macos")]
fn restore_clipboard(snapshot: &ClipboardSnapshot) -> Result<(), String> {
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::ClassType;
    use objc2_app_kit::NSPasteboard;
    use objc2_foundation::{NSData, NSString};

    validate_clipboard_snapshot(snapshot)?;

    let pasteboard: Retained<NSPasteboard> = unsafe {
        let cls = NSPasteboard::class();
        let obj: Option<Retained<NSPasteboard>> = msg_send![cls, generalPasteboard];
        let Some(obj) = obj else {
            return Err("Clipboard unavailable".to_string());
        };
        obj
    };

    let change_count: isize = unsafe { msg_send![&*pasteboard, clearContents] };
    validate_pasteboard_change_count(change_count)?;

    if !snapshot.had_formats {
        return Ok(());
    }

    for item in &snapshot.formats {
        let decoded = BASE64_STANDARD.decode(&item.data_base64).map_err(|error| {
            format!(
                "Failed to decode clipboard format `{}` for restore: {error}",
                item.format
            )
        })?;

        let ns_data = NSData::from_vec(decoded);
        let ns_type = NSString::from_str(&item.format);
        let did_set_data: bool =
            unsafe { msg_send![&*pasteboard, setData: &*ns_data, forType: &*ns_type] };
        if !did_set_data {
            return Err(format!(
                "Failed to restore clipboard format `{}`",
                item.format
            ));
        }
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn restore_clipboard(snapshot: &ClipboardSnapshot) -> Result<(), String> {
    windows_inserter::restore_clipboard(snapshot)
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
fn restore_clipboard(_snapshot: &ClipboardSnapshot) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn write_plain_text_clipboard(text: &str) -> Result<(), String> {
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::ClassType;
    use objc2_app_kit::NSPasteboard;
    use objc2_foundation::NSString;

    let pasteboard: Retained<NSPasteboard> = unsafe {
        let cls = NSPasteboard::class();
        let obj: Option<Retained<NSPasteboard>> = msg_send![cls, generalPasteboard];
        let Some(obj) = obj else {
            return Err("Clipboard unavailable".to_string());
        };
        obj
    };

    let change_count: isize = unsafe { msg_send![&*pasteboard, clearContents] };
    validate_pasteboard_change_count(change_count)?;

    let ns_text = NSString::from_str(text);
    let string_type = NSString::from_str("public.utf8-plain-text");
    let did_write: bool =
        unsafe { msg_send![&*pasteboard, setString: &*ns_text, forType: &*string_type] };

    if did_write {
        Ok(())
    } else {
        Err("Failed to write text to clipboard".to_string())
    }
}

#[cfg(target_os = "windows")]
fn write_plain_text_clipboard(text: &str) -> Result<(), String> {
    windows_inserter::write_plain_text_clipboard(text)
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
fn write_plain_text_clipboard(_text: &str) -> Result<(), String> {
    Err("Clipboard is only supported on macOS".to_string())
}
