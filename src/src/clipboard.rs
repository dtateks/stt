//! Cross-platform clipboard snapshot/restore + plain-text write.
//!
//! Used by `text_inserter` to preserve the user's clipboard contents around
//! the paste-driven insertion: snapshot before the paste, write the transcript,
//! then restore the snapshot.
//!
//! macOS notes:
//! - `NSPasteboard.clearContents` returns the post-clear change count, NOT a
//!   BOOL. `0` is a valid value (clipboard was already empty); only negative
//!   values are errors. See `validate_pasteboard_change_count`.
//! - Autoreleased pasteboard objects keep their native ownership semantics
//!   (`generalPasteboard`, `types`, `objectAtIndex:`, `dataForType:`); do not
//!   wrap them in `Retained::from_raw`.

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};

#[cfg(target_os = "windows")]
use crate::text_inserter::windows_inserter;

#[derive(Debug, Clone)]
pub struct ClipboardSnapshot {
    pub had_formats: bool,
    pub formats: Vec<ClipboardFormatData>,
}

#[derive(Debug, Clone)]
pub struct ClipboardFormatData {
    pub format: String,
    pub data_base64: String,
}

pub(crate) fn validate_pasteboard_change_count(change_count: isize) -> Result<(), String> {
    if change_count >= 0 {
        return Ok(());
    }

    Err(format!(
        "Clipboard clear returned invalid change count: {change_count}"
    ))
}

#[cfg(target_os = "macos")]
pub fn snapshot() -> Option<ClipboardSnapshot> {
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

        let type_utf8: *const std::ffi::c_char = unsafe { msg_send![&*type_id, UTF8String] };
        if type_utf8.is_null() {
            continue;
        }

        let format = unsafe { std::ffi::CStr::from_ptr(type_utf8) }
            .to_string_lossy()
            .to_string();

        let data: Retained<NSData> = unsafe {
            let obj: Option<Retained<NSData>> = msg_send![&*pasteboard, dataForType: &*type_id];
            let Some(obj) = obj else {
                continue;
            };
            obj
        };

        let bytes: *const u8 = unsafe { msg_send![&*data, bytes] };
        let len: usize = unsafe { msg_send![&*data, length] };
        if len > 0 && bytes.is_null() {
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
    })
}

#[cfg(target_os = "windows")]
pub fn snapshot() -> Option<ClipboardSnapshot> {
    windows_inserter::snapshot_clipboard()
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
pub fn snapshot() -> Option<ClipboardSnapshot> {
    None
}

#[cfg(target_os = "macos")]
pub fn restore(snapshot: &ClipboardSnapshot) -> Result<(), String> {
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::ClassType;
    use objc2_app_kit::NSPasteboard;
    use objc2_foundation::{NSData, NSString};

    if !snapshot.had_formats {
        return write_plain_text("");
    }

    if snapshot.formats.is_empty() {
        return Ok(());
    }

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
pub fn restore(snapshot: &ClipboardSnapshot) -> Result<(), String> {
    windows_inserter::restore_clipboard(snapshot)
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
pub fn restore(_snapshot: &ClipboardSnapshot) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn write_plain_text(text: &str) -> Result<(), String> {
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
pub fn write_plain_text(text: &str) -> Result<(), String> {
    windows_inserter::write_plain_text_clipboard(text)
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
pub fn write_plain_text(_text: &str) -> Result<(), String> {
    Err("Clipboard is only supported on macOS".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn restore_keeps_inserted_text_when_original_clipboard_had_no_preservable_formats() {
        let snapshot = ClipboardSnapshot {
            had_formats: true,
            formats: Vec::new(),
        };

        let result = restore(&snapshot);

        assert!(result.is_ok());
    }
}
