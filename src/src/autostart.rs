//! macOS launch-at-login autostart setup + initial-launch flag handling.
//!
//! Two responsibilities, one cohesive concern (the autostart lifecycle):
//!   - register the app for login-launch via `tauri-plugin-autostart`
//!     (`MacosLauncher::LaunchAgent`), only when running from a real
//!     `.app` bundle so dev/CLI runs do not pollute the user's Login
//!     Items
//!   - decide whether the initial launch should reveal the main window:
//!     when the OS launches the app via the autostart shim it passes
//!     `--launch-at-login`, which keeps the main window hidden so the
//!     menubar app starts dockless without flashing the settings panel
//!
//! Non-macOS platforms get a no-op `setup_launch_at_login` stub so the
//! call site in `lib.rs` does not need a `#[cfg]` guard.
//!
//! Tests for both the bundle-path detection and the lifecycle flow live
//! at the bottom of this file (RefCell-backed execution log per the
//! project convention for verifying multi-step ordering).

#[cfg(target_os = "macos")]
use tauri::App;

pub(crate) const AUTOSTART_LAUNCH_FLAG: &str = "--launch-at-login";

pub(crate) fn should_show_main_window_on_current_launch<Args, Arg>(args: Args) -> bool
where
    Args: IntoIterator<Item = Arg>,
    Arg: AsRef<str>,
{
    !args
        .into_iter()
        .skip(1)
        .any(|arg| arg.as_ref() == AUTOSTART_LAUNCH_FLAG)
}

#[cfg(target_os = "macos")]
fn is_running_from_macos_app_bundle_path(executable_path: &std::path::Path) -> bool {
    let Some(macos_directory) = executable_path.parent() else {
        return false;
    };
    let Some(contents_directory) = macos_directory.parent() else {
        return false;
    };
    let Some(app_bundle_directory) = contents_directory.parent() else {
        return false;
    };

    macos_directory.file_name() == Some(std::ffi::OsStr::new("MacOS"))
        && contents_directory.file_name() == Some(std::ffi::OsStr::new("Contents"))
        && app_bundle_directory.extension() == Some(std::ffi::OsStr::new("app"))
}

#[cfg(target_os = "macos")]
fn run_launch_at_login_setup_flow<
    ResolveCurrentExecutable,
    InitializeAutostart,
    ReadAutostartStatus,
    EnableAutostart,
>(
    resolve_current_executable: ResolveCurrentExecutable,
    initialize_autostart: InitializeAutostart,
    read_autostart_status: ReadAutostartStatus,
    enable_autostart: EnableAutostart,
) -> Result<(), String>
where
    ResolveCurrentExecutable: FnOnce() -> Result<std::path::PathBuf, String>,
    InitializeAutostart: FnOnce() -> Result<(), String>,
    ReadAutostartStatus: FnOnce() -> Result<bool, String>,
    EnableAutostart: FnOnce() -> Result<(), String>,
{
    let executable_path = resolve_current_executable()?;
    if !is_running_from_macos_app_bundle_path(executable_path.as_path()) {
        return Ok(());
    }

    initialize_autostart()?;
    if read_autostart_status()? {
        return Ok(());
    }

    enable_autostart()
}

#[cfg(target_os = "macos")]
pub(crate) fn setup_launch_at_login(app: &App) -> Result<(), String> {
    use tauri_plugin_autostart::{MacosLauncher, ManagerExt as AutostartManagerExt};

    run_launch_at_login_setup_flow(
        || {
            std::env::current_exe().map_err(|error| {
                format!("Could not resolve current executable for autostart: {error}")
            })
        },
        || {
            app.handle()
                .plugin(tauri_plugin_autostart::init(
                    MacosLauncher::LaunchAgent,
                    Some(vec![AUTOSTART_LAUNCH_FLAG]),
                ))
                .map_err(|error| format!("Could not initialize autostart plugin: {error}"))
        },
        || {
            app.autolaunch()
                .is_enabled()
                .map_err(|error| format!("Could not read autostart status: {error}"))
        },
        || {
            app.autolaunch()
                .enable()
                .map_err(|error| format!("Could not enable launch-at-login: {error}"))
        },
    )
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn setup_launch_at_login(_app: &tauri::App) -> Result<(), String> {
    Ok(())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::{
        is_running_from_macos_app_bundle_path, run_launch_at_login_setup_flow,
        should_show_main_window_on_current_launch, AUTOSTART_LAUNCH_FLAG,
    };
    use std::cell::RefCell;
    use std::path::{Path, PathBuf};

    #[test]
    fn launch_at_login_only_enables_for_standard_macos_app_bundles() {
        assert!(is_running_from_macos_app_bundle_path(Path::new(
            "/Applications/Voice to Text.app/Contents/MacOS/Voice to Text"
        )));
        assert!(!is_running_from_macos_app_bundle_path(Path::new(
            "/Users/dta.teks/dev/stt/src/target/debug/voice_to_text"
        )));
        assert!(!is_running_from_macos_app_bundle_path(Path::new(
            "/Users/dta.teks/dev/stt/Fake.app/cache/voice_to_text"
        )));
    }

    #[test]
    fn launch_at_login_skips_non_bundled_executables_before_initializing_plugin() {
        let executed_steps: RefCell<Vec<&str>> = RefCell::new(Vec::new());

        let result = run_launch_at_login_setup_flow(
            || {
                Ok(PathBuf::from(
                    "/Users/dta.teks/dev/stt/src/target/debug/voice_to_text",
                ))
            },
            || {
                executed_steps.borrow_mut().push("init");
                Ok(())
            },
            || {
                executed_steps.borrow_mut().push("is-enabled");
                Ok(false)
            },
            || {
                executed_steps.borrow_mut().push("enable");
                Ok(())
            },
        );

        assert!(result.is_ok());
        assert!(executed_steps.borrow().is_empty());
    }

    #[test]
    fn launch_at_login_enables_bundled_apps_only_when_disabled() {
        let executed_steps: RefCell<Vec<&str>> = RefCell::new(Vec::new());

        let result = run_launch_at_login_setup_flow(
            || {
                Ok(PathBuf::from(
                    "/Applications/Voice to Text.app/Contents/MacOS/Voice to Text",
                ))
            },
            || {
                executed_steps.borrow_mut().push("init");
                Ok(())
            },
            || {
                executed_steps.borrow_mut().push("is-enabled");
                Ok(false)
            },
            || {
                executed_steps.borrow_mut().push("enable");
                Ok(())
            },
        );

        assert!(result.is_ok());
        assert_eq!(
            executed_steps.into_inner(),
            vec!["init", "is-enabled", "enable"]
        );
    }

    #[test]
    fn launch_at_login_skips_enable_when_autostart_is_already_active() {
        let executed_steps: RefCell<Vec<&str>> = RefCell::new(Vec::new());

        let result = run_launch_at_login_setup_flow(
            || {
                Ok(PathBuf::from(
                    "/Applications/Voice to Text.app/Contents/MacOS/Voice to Text",
                ))
            },
            || {
                executed_steps.borrow_mut().push("init");
                Ok(())
            },
            || {
                executed_steps.borrow_mut().push("is-enabled");
                Ok(true)
            },
            || {
                executed_steps.borrow_mut().push("enable");
                Ok(())
            },
        );

        assert!(result.is_ok());
        assert_eq!(executed_steps.into_inner(), vec!["init", "is-enabled"]);
    }

    #[test]
    fn launch_at_login_flag_keeps_initial_launch_hidden() {
        assert!(should_show_main_window_on_current_launch([
            "voice_to_text",
            "--some-other-arg",
        ]));
        assert!(!should_show_main_window_on_current_launch([
            "voice_to_text",
            AUTOSTART_LAUNCH_FLAG,
        ]));
    }
}
