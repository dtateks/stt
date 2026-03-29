use std::process::Command;
use std::thread;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use serde::Serialize;

use crate::permissions;

const ACCESSIBILITY_PERMISSION_REQUIRED_CODE: &str = "accessibility-permission-required";
const AUTOMATION_PERMISSION_REQUIRED_CODE: &str = "automation-permission-required";
const AUTOMATION_CHECK_FAILED_CODE: &str = "automation-check-failed";
const AUTOMATION_PERMISSION_REQUIRED_MESSAGE: &str = "Automation permission is required to control System Events for paste/Enter. Allow Voice to Text when macOS asks, then try again.";
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

pub fn insert_text(text: String, enter_mode: bool) -> InsertTextResult {
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
    match run_osascript(r#"tell application "System Events" to count processes"#) {
        Ok(()) => TextInsertionPermissionResult {
            granted: true,
            code: None,
            opened_settings: None,
            message: None,
        },
        Err(error) => {
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

fn perform_insertion(text: &str, enter_mode: bool) -> Result<(), String> {
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
    run_osascript(r#"tell application "System Events" to count processes"#).is_ok()
}

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
    run_osascript(script).map_err(|error| format_system_events_error_message(&error))
}

fn format_system_events_error_message(error: &str) -> String {
    if is_system_events_automation_denied(error) {
        return AUTOMATION_PERMISSION_REQUIRED_MESSAGE.to_string();
    }

    format!("Could not control System Events: {error}")
}

fn is_system_events_automation_denied(error: &str) -> bool {
    let normalized_error = error.to_ascii_lowercase();
    normalized_error.contains("not authorized to send apple events") || error.contains("(-1743)")
}

#[cfg(test)]
mod tests {
    use super::{
        build_insert_text_result, format_system_events_error_message,
        is_system_events_automation_denied, validate_clipboard_snapshot,
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
    fn preserves_unexpected_system_events_errors() {
        assert_eq!(
            format_system_events_error_message("Execution error: foo"),
            "Could not control System Events: Execution error: foo"
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

#[cfg(not(target_os = "macos"))]
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

    let did_clear: bool = unsafe { msg_send![&*pasteboard, clearContents] };
    if !did_clear {
        return Err("Failed to clear clipboard before restore".to_string());
    }

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

#[cfg(not(target_os = "macos"))]
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

    let did_clear: bool = unsafe { msg_send![&*pasteboard, clearContents] };
    if !did_clear {
        return Err("Failed to clear clipboard before insertion".to_string());
    }

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

#[cfg(not(target_os = "macos"))]
fn write_plain_text_clipboard(_text: &str) -> Result<(), String> {
    Err("Clipboard is only supported on macOS".to_string())
}
