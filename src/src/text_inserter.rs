use std::process::Command;
use std::thread;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use serde::Serialize;

use crate::permissions;

const ACCESSIBILITY_PERMISSION_REQUIRED_CODE: &str = "accessibility-permission-required";
const AUTOMATION_PERMISSION_REQUIRED_CODE: &str = "automation-permission-required";
const AUTOMATION_PERMISSION_REQUIRED_MESSAGE: &str = "Automation permission is required to control System Events for paste/Enter. Allow Voice to Text when macOS asks, then try again.";

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

    let operation_result = perform_insertion(&text, enter_mode);
    if let Some(snapshot_to_restore) = snapshot {
        let _ = restore_clipboard(&snapshot_to_restore);
    }

    match operation_result {
        Ok(()) => InsertTextResult {
            success: true,
            error: None,
            code: None,
            opened_settings: None,
        },
        Err(error) => InsertTextResult {
            success: false,
            error: Some(error),
            code: None,
            opened_settings: None,
        },
    }
}

pub fn copy_to_clipboard(text: String) -> Result<(), String> {
    write_plain_text_clipboard(&text)
}

pub fn ensure_text_insertion_permission() -> TextInsertionPermissionResult {
    match run_system_events_osascript(r#"tell application "System Events" to count processes"#) {
        Ok(()) => TextInsertionPermissionResult {
            granted: true,
            code: None,
            opened_settings: None,
            message: None,
        },
        Err(error) => TextInsertionPermissionResult {
            granted: false,
            code: Some(AUTOMATION_PERMISSION_REQUIRED_CODE.to_string()),
            opened_settings: None,
            message: Some(error),
        },
    }
}

fn perform_insertion(text: &str, enter_mode: bool) -> Result<(), String> {
    write_plain_text_clipboard(text)?;
    run_system_events_osascript(
        r#"tell application "System Events" to keystroke "v" using command down"#,
    )?;

    let insertion_delay_ms = if text.len() > 200 { 700 } else { 200 };
    thread::sleep(Duration::from_millis(insertion_delay_ms));

    if enter_mode {
        run_system_events_osascript(r#"tell application "System Events" to key code 36"#)?;
    }

    thread::sleep(Duration::from_millis(100));
    Ok(())
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
    error.contains("Not authorized to send Apple events") || error.contains("(-1743)")
}

#[cfg(test)]
mod tests {
    use super::{
        format_system_events_error_message, is_system_events_automation_denied,
        AUTOMATION_PERMISSION_REQUIRED_MESSAGE,
    };

    #[test]
    fn detects_system_events_automation_denial() {
        assert!(is_system_events_automation_denied(
            "Not authorized to send Apple events to System Events. (-1743)"
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
            });
        };
        obj
    };

    let count: usize = unsafe { msg_send![&*types, count] };
    let had_formats = count > 0;
    let mut formats = Vec::new();

    for index in 0..count {
        let type_id: Retained<NSString> = unsafe {
            let obj: Option<Retained<NSString>> = msg_send![&*types, objectAtIndex: index];
            let Some(obj) = obj else {
                continue;
            };
            obj
        };

        let data: Retained<NSData> = unsafe {
            let obj: Option<Retained<NSData>> = msg_send![&*pasteboard, dataForType: &*type_id];
            let Some(obj) = obj else {
                continue;
            };
            obj
        };

        let bytes: *const u8 = unsafe { msg_send![&*data, bytes] };
        let len: usize = unsafe { msg_send![&*data, length] };
        if bytes.is_null() || len == 0 {
            continue;
        }

        let type_utf8: *const std::ffi::c_char = unsafe { msg_send![&*type_id, UTF8String] };
        if type_utf8.is_null() {
            continue;
        }

        let format = unsafe { std::ffi::CStr::from_ptr(type_utf8) }
            .to_string_lossy()
            .to_string();

        let bytes_slice = unsafe { std::slice::from_raw_parts(bytes, len) };
        formats.push(ClipboardFormatData {
            format,
            data_base64: BASE64_STANDARD.encode(bytes_slice),
        });
    }

    Some(ClipboardSnapshot {
        had_formats,
        formats,
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

    let pasteboard: Retained<NSPasteboard> = unsafe {
        let cls = NSPasteboard::class();
        let obj: Option<Retained<NSPasteboard>> = msg_send![cls, generalPasteboard];
        let Some(obj) = obj else {
            return Err("Clipboard unavailable".to_string());
        };
        obj
    };

    let _: bool = unsafe { msg_send![&*pasteboard, clearContents] };
    if !snapshot.had_formats || snapshot.formats.is_empty() {
        return Ok(());
    }

    // Note: We don't need to declare types first - setData:forType: auto-declares
    // We just need to set the data for each format

    for item in &snapshot.formats {
        let Ok(decoded) = BASE64_STANDARD.decode(&item.data_base64) else {
            continue;
        };

        let ns_data = NSData::from_vec(decoded);
        let ns_type = NSString::from_str(&item.format);
        let _: bool = unsafe { msg_send![&*pasteboard, setData: &*ns_data, forType: &*ns_type] };
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

    let _: bool = unsafe { msg_send![&*pasteboard, clearContents] };

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
