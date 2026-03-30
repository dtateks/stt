use std::env;
use std::ffi::OsString;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use voice_to_text_lib::permissions::{
    build_accessibility_permission_required_result, build_microphone_denied_result,
};
use voice_to_text_lib::text_inserter::{
    build_insert_text_result, build_text_insertion_permission_result,
};

const AUTOMATION_PERMISSION_REQUIRED_MESSAGE: &str = "Automation permission is required to control System Events for paste/Enter. Allow Voice to Text when macOS asks, then try again.";

static ENVIRONMENT_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[test]
fn automation_denial_mapping_is_case_insensitive() {
    let result = build_text_insertion_permission_result(Err(
        "not authorized to send Apple events to System Events.".to_string(),
    ));

    assert!(!result.granted);
    assert_eq!(
        result.code.as_deref(),
        Some("automation-permission-required")
    );
    assert_eq!(
        result.message.as_deref(),
        Some(AUTOMATION_PERMISSION_REQUIRED_MESSAGE)
    );
}

#[test]
fn unexpected_system_events_error_is_preserved_for_permission_result() {
    let result = build_text_insertion_permission_result(Err("Execution error: foo".to_string()));

    assert!(!result.granted);
    assert_eq!(result.code.as_deref(), Some("automation-check-failed"));
    assert_eq!(
        result.message.as_deref(),
        Some("Could not control System Events: Execution error: foo")
    );
}

#[test]
fn windows_helper_unavailable_error_maps_to_windows_specific_permission_result() {
    let result = build_text_insertion_permission_result(Err(
        "windows-helper-unavailable: helper missing".to_string(),
    ));

    assert!(!result.granted);
    assert_eq!(result.code.as_deref(), Some("windows-helper-unavailable"));
    assert_eq!(result.opened_settings, Some(false));
    assert_eq!(result.message.as_deref(), Some("helper missing"));
}

#[test]
fn windows_helper_required_error_uses_default_message_when_suffix_is_blank() {
    let result =
        build_text_insertion_permission_result(Err("windows-helper-required:   ".to_string()));

    assert!(!result.granted);
    assert_eq!(result.code.as_deref(), Some("windows-helper-required"));
    assert_eq!(result.opened_settings, Some(false));
    assert_eq!(
        result.message.as_deref(),
        Some(
            "Text insertion into elevated Windows apps requires the Voice to Text helper. Allow the helper elevation prompt, then try again."
        )
    );
}

#[test]
fn microphone_denial_reports_when_settings_cannot_be_opened() {
    let _guard = ENVIRONMENT_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let temp_dir = create_temp_test_dir("microphone-settings-open-failure");
    write_executable_script(
        &temp_dir.join("open"),
        r#"#!/bin/sh
exit 1
"#,
    );
    let _path_override = PathEnvironmentOverride::prepend(&temp_dir);

    let result = build_microphone_denied_result("denied".to_string());

    assert!(!result.granted);
    assert_eq!(result.status.as_deref(), Some("denied"));
    assert_eq!(
        result.code.as_deref(),
        Some("microphone-permission-required")
    );
    assert_eq!(result.opened_settings, Some(false));
}

#[test]
fn accessibility_denial_message_tells_user_to_open_settings_manually_when_prompt_fails() {
    let result = build_accessibility_permission_required_result(false);

    assert!(!result.granted);
    assert_eq!(
        result.code.as_deref(),
        Some("accessibility-permission-required")
    );
    assert_eq!(result.opened_settings, Some(false));
    assert_eq!(
        result.message.as_deref(),
        Some("Accessibility permission is required to insert text. Open System Settings → Privacy & Security → Accessibility manually, enable Voice to Text, then try again.")
    );
}

#[test]
fn insert_result_reports_clipboard_restore_failure_after_successful_insert() {
    let result = build_insert_text_result(Ok(()), Err("Clipboard unavailable".to_string()));

    assert!(!result.success);
    assert_eq!(result.code.as_deref(), Some("clipboard-restore-failed"));
    assert_eq!(
        result.error.as_deref(),
        Some("Text was inserted, but previous clipboard contents could not be restored: Clipboard unavailable")
    );
}

#[test]
fn insert_result_surfaces_both_insertion_and_restore_failures() {
    let result = build_insert_text_result(
        Err("Could not control System Events: paste failed".to_string()),
        Err("Clipboard unavailable".to_string()),
    );

    assert!(!result.success);
    assert_eq!(result.code.as_deref(), Some("clipboard-restore-failed"));
    assert_eq!(
        result.error.as_deref(),
        Some("Could not control System Events: paste failed Also failed to restore previous clipboard contents: Clipboard unavailable")
    );
}

struct PathEnvironmentOverride {
    previous_path: Option<OsString>,
}

impl PathEnvironmentOverride {
    fn prepend(path: &Path) -> Self {
        let previous_path = env::var_os("PATH");
        let mut paths = vec![path.to_path_buf()];
        if let Some(existing_path) = previous_path.as_ref() {
            paths.extend(env::split_paths(existing_path));
        }

        let updated_path = env::join_paths(paths).expect("PATH should be valid");
        unsafe {
            env::set_var("PATH", &updated_path);
        }

        Self { previous_path }
    }
}

impl Drop for PathEnvironmentOverride {
    fn drop(&mut self) {
        if let Some(previous_path) = &self.previous_path {
            unsafe {
                env::set_var("PATH", previous_path);
            }
            return;
        }

        unsafe {
            env::remove_var("PATH");
        }
    }
}

fn write_executable_script(path: &Path, script: &str) {
    fs::write(path, script).expect("script should be written");
    let mut permissions = fs::metadata(path)
        .expect("script metadata should be readable")
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions).expect("script should be executable");
}

fn create_temp_test_dir(prefix: &str) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after unix epoch")
        .as_nanos();
    let directory = env::temp_dir().join(format!(
        "voice-to-text-{prefix}-{}-{timestamp}",
        std::process::id()
    ));
    fs::create_dir_all(&directory).expect("temp directory should be created");
    directory
}
