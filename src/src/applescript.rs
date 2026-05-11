//! AppleScript driver for the macOS insertion path.
//!
//! Provides:
//! - `run(script)` — execute an arbitrary script and surface the structured
//!   error if any.
//! - `run_system_events(script)` — wrapper that classifies errors and retries
//!   transient System Events failures once before giving up. Automation-denied
//!   errors short-circuit immediately; only unexpected execution errors retry.
//! - `format_system_events_error_message` / `is_system_events_automation_denied` /
//!   `is_system_events_accessibility_denied` — error classifiers used by the
//!   text_inserter to surface user-actionable TCC permission messages.
//! - `run_double_enter_sequence` — sends the System Events return key twice
//!   with the configured repeat delay, used by enter-mode insertion on macOS.
//!
//! Permission semantics live next to the call sites in `text_inserter`; this
//! module is only concerned with executing scripts and classifying errors.

#[cfg(target_os = "macos")]
use std::thread;
use std::time::Duration;

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

pub(crate) const SYSTEM_EVENTS_RETRY_DELAY_MS: u64 = 75;
pub(crate) const SYSTEM_EVENTS_RETRY_ATTEMPTS: usize = 2;
pub(crate) const DOUBLE_ENTER_REPEAT_DELAY_MS: u64 = 230;
pub(crate) const SYSTEM_EVENTS_RETURN_KEY_SCRIPT: &str =
    r#"tell application "System Events" to key code 36"#;

pub(crate) const AUTOMATION_PERMISSION_REQUIRED_MESSAGE: &str =
    "Automation permission is required to control System Events for paste/Enter. Allow Voice to Text when macOS asks, then try again.";
pub(crate) const ACCESSIBILITY_PERMISSION_REQUIRED_MESSAGE: &str =
    "Accessibility permission is required to insert text. Enable Voice to Text in System Settings → Privacy & Security → Accessibility, then try again.";

#[cfg(target_os = "macos")]
pub(crate) fn run(script: &str) -> Result<(), String> {
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
pub(crate) fn run(script: &str) -> Result<(), String> {
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

pub(crate) fn run_system_events(script: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        run_system_events_with(script, run, || {
            thread::sleep(Duration::from_millis(SYSTEM_EVENTS_RETRY_DELAY_MS));
        })
    }

    #[cfg(not(target_os = "macos"))]
    {
        run_system_events_with(script, run, || {
            std::thread::sleep(Duration::from_millis(SYSTEM_EVENTS_RETRY_DELAY_MS));
        })
    }
}

pub(crate) fn run_system_events_with<RunScript, SleepBeforeRetry>(
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

pub(crate) fn format_system_events_error_message(error: &str) -> String {
    if is_system_events_automation_denied(error) {
        return AUTOMATION_PERMISSION_REQUIRED_MESSAGE.to_string();
    }

    if is_system_events_accessibility_denied(error) {
        return ACCESSIBILITY_PERMISSION_REQUIRED_MESSAGE.to_string();
    }

    format!("Could not control System Events: {error}")
}

pub(crate) fn is_system_events_automation_denied(error: &str) -> bool {
    let normalized_error = error.to_ascii_lowercase();
    normalized_error.contains("not authorized to send apple events") || error.contains("(-1743)")
}

pub(crate) fn is_system_events_accessibility_denied(error: &str) -> bool {
    let normalized_error = error.to_ascii_lowercase();

    normalized_error.contains("assistive access")
        || normalized_error.contains("not allowed to send keystrokes")
        || normalized_error.contains("a privilege error has occurred")
        || (error.contains("(-1719)") && normalized_error.contains("system events"))
}

pub(crate) fn run_double_enter_sequence() -> Result<(), String> {
    run_double_enter_sequence_with(run_system_events, |delay| {
        std::thread::sleep(delay);
    })
}

pub(crate) fn run_double_enter_sequence_with<RunScript, SleepBeforeRepeat>(
    mut run_script: RunScript,
    mut sleep_before_repeat: SleepBeforeRepeat,
) -> Result<(), String>
where
    RunScript: FnMut(&str) -> Result<(), String>,
    SleepBeforeRepeat: FnMut(Duration),
{
    run_script(SYSTEM_EVENTS_RETURN_KEY_SCRIPT)?;
    sleep_before_repeat(Duration::from_millis(DOUBLE_ENTER_REPEAT_DELAY_MS));
    run_script(SYSTEM_EVENTS_RETURN_KEY_SCRIPT)
}

#[cfg(test)]
mod tests {
    use super::*;

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

        let result = run_system_events_with(
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

        let result = run_system_events_with(
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

        let result = run_system_events_with(
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
    fn double_enter_sequence_sends_return_twice_with_repeat_delay() {
        let mut scripts = Vec::new();
        let mut delays = Vec::new();

        let result = run_double_enter_sequence_with(
            |script| {
                scripts.push(script.to_string());
                Ok(())
            },
            |delay| {
                delays.push(delay);
            },
        );

        assert!(result.is_ok());
        assert_eq!(
            scripts.as_slice(),
            [
                SYSTEM_EVENTS_RETURN_KEY_SCRIPT,
                SYSTEM_EVENTS_RETURN_KEY_SCRIPT
            ]
        );
        assert_eq!(
            delays.as_slice(),
            [Duration::from_millis(DOUBLE_ENTER_REPEAT_DELAY_MS)]
        );
    }

    #[test]
    fn double_enter_sequence_stops_when_first_return_fails() {
        let mut attempts = 0;
        let mut delays = Vec::new();

        let result = run_double_enter_sequence_with(
            |_script| {
                attempts += 1;
                Err("first enter failed".to_string())
            },
            |delay| {
                delays.push(delay);
            },
        );

        assert_eq!(result.err().as_deref(), Some("first enter failed"));
        assert_eq!(attempts, 1);
        assert!(delays.is_empty());
    }
}
