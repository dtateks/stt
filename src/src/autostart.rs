//! macOS launch-at-login autostart setup + initial-launch flag handling.
//!
//! Two responsibilities, one cohesive concern (the autostart lifecycle):
//!   - register the app for login-launch via `tauri-plugin-autostart`
//!     (`MacosLauncher::LaunchAgent`), only when running from the
//!     **canonical install location** (`/Applications` or
//!     `~/Applications`) so dev runs and transient build-output bundles
//!     never become the login item
//!   - decide whether the initial launch should reveal the main window:
//!     when the OS launches the app via the autostart shim it passes
//!     `--launch-at-login`, which keeps the main window hidden so the
//!     background accessory app starts dockless without flashing the
//!     settings panel
//!
//! ## Why the install-location gate matters (TCC microphone persistence)
//!
//! macOS keys the microphone privacy grant to the app's code-signing
//! Designated Requirement. The signed `/Applications` copy and a
//! `target/release/bundle` build-output copy share the same bundle id but
//! have *different* signing identities (the build output is ad-hoc signed,
//! DR = cdhash; the installed copy is stable-cert signed, DR = certificate
//! leaf). `tauri-plugin-autostart` bakes `current_exe()` into the
//! `LaunchAgent` plist at registration time, so if autostart is registered
//! while running from the build-output bundle, `launchd` boots that ad-hoc
//! copy at every login — a different code identity than the one the user
//! granted the microphone to. The grant no longer matches, so macOS
//! re-prompts for the microphone after every reboot (but not after a manual
//! relaunch, which opens the `/Applications` copy). Gating registration to
//! the canonical install location keeps the login item pointed at the same
//! signed bundle the permission was granted to.
//!
//! The setup flow is also self-healing: if a stale login item already points
//! at the wrong path (or lacks the launch flag), it is cleared and
//! re-registered against the current installed binary on the next launch
//! from `/Applications`.
//!
//! Non-macOS platforms get a no-op `setup_launch_at_login` stub so the
//! call site in `lib.rs` does not need a `#[cfg]` guard.
//!
//! Tests for the install-location gate, the reconcile flow, and the
//! initial-launch decision live at the bottom of this file (RefCell-backed
//! execution log per the project convention for verifying multi-step
//! ordering).

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

/// Resolve the `<App>.app` bundle directory for an executable that lives at
/// `<App>.app/Contents/MacOS/<binary>`, or `None` if the path is not shaped
/// like a macOS app bundle executable (e.g. a bare `cargo` dev binary).
#[cfg(target_os = "macos")]
fn macos_app_bundle_dir(executable_path: &std::path::Path) -> Option<&std::path::Path> {
    let macos_directory = executable_path.parent()?;
    let contents_directory = macos_directory.parent()?;
    let app_bundle_directory = contents_directory.parent()?;

    if macos_directory.file_name() == Some(std::ffi::OsStr::new("MacOS"))
        && contents_directory.file_name() == Some(std::ffi::OsStr::new("Contents"))
        && app_bundle_directory.extension() == Some(std::ffi::OsStr::new("app"))
    {
        Some(app_bundle_directory)
    } else {
        None
    }
}

/// Login-launch may only be registered from a stable, signed install
/// location: the `.app` bundle must sit directly inside `/Applications` or
/// `~/Applications`. Build-output bundles (`target/release/bundle/macos/…`),
/// dev binaries, DMG mount points, and `~/Downloads` copies are rejected so a
/// non-canonical code identity never becomes the login item. See the module
/// docs for why this preserves the microphone TCC grant across reboots.
#[cfg(target_os = "macos")]
fn is_running_from_canonical_install_location(executable_path: &std::path::Path) -> bool {
    let Some(app_bundle_directory) = macos_app_bundle_dir(executable_path) else {
        return false;
    };
    let Some(parent_directory) = app_bundle_directory.parent() else {
        return false;
    };

    if parent_directory == std::path::Path::new("/Applications") {
        return true;
    }

    if let Some(home_directory) = std::env::var_os("HOME") {
        if parent_directory == std::path::Path::new(&home_directory).join("Applications") {
            return true;
        }
    }

    false
}

/// Path of the `LaunchAgent` plist that `tauri-plugin-autostart` (via the
/// `auto-launch` crate) writes: `~/Library/LaunchAgents/<product name>.plist`.
#[cfg(target_os = "macos")]
fn macos_login_item_plist_path(app: &App) -> Result<std::path::PathBuf, String> {
    let home_directory = std::env::var_os("HOME")
        .ok_or_else(|| "Could not resolve HOME for the launch-at-login entry".to_string())?;
    let product_name = &app.package_info().name;

    Ok(std::path::Path::new(&home_directory)
        .join("Library/LaunchAgents")
        .join(format!("{product_name}.plist")))
}

/// Whether the existing login item already targets `executable_path` with the
/// autostart launch flag. A missing plist counts as "does not match" so the
/// caller registers a fresh one. A plist that points elsewhere (a stale
/// build-output path) or predates the launch flag also counts as "does not
/// match" so the caller repairs it.
#[cfg(target_os = "macos")]
fn login_item_targets_executable(
    login_item_plist_path: &std::path::Path,
    executable_path: &std::path::Path,
) -> Result<bool, String> {
    let plist_contents = match std::fs::read_to_string(login_item_plist_path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("Could not read the launch-at-login entry: {error}")),
    };

    let Some(executable_path_str) = executable_path.to_str() else {
        return Ok(false);
    };

    Ok(plist_contents.contains(executable_path_str)
        && plist_contents.contains(AUTOSTART_LAUNCH_FLAG))
}

#[cfg(target_os = "macos")]
fn run_launch_at_login_setup_flow<
    ResolveCurrentExecutable,
    IsCanonicalInstallLocation,
    InitializeAutostart,
    ReadAutostartStatus,
    LoginItemMatchesExecutable,
    DisableAutostart,
    EnableAutostart,
>(
    resolve_current_executable: ResolveCurrentExecutable,
    is_canonical_install_location: IsCanonicalInstallLocation,
    initialize_autostart: InitializeAutostart,
    read_autostart_status: ReadAutostartStatus,
    login_item_matches_executable: LoginItemMatchesExecutable,
    disable_autostart: DisableAutostart,
    enable_autostart: EnableAutostart,
) -> Result<(), String>
where
    ResolveCurrentExecutable: FnOnce() -> Result<std::path::PathBuf, String>,
    IsCanonicalInstallLocation: FnOnce(&std::path::Path) -> bool,
    InitializeAutostart: FnOnce() -> Result<(), String>,
    ReadAutostartStatus: FnOnce() -> Result<bool, String>,
    LoginItemMatchesExecutable: FnOnce(&std::path::Path) -> Result<bool, String>,
    DisableAutostart: FnOnce() -> Result<(), String>,
    EnableAutostart: FnOnce() -> Result<(), String>,
{
    let executable_path = resolve_current_executable()?;
    if !is_canonical_install_location(executable_path.as_path()) {
        // Dev binary, build-output bundle, DMG, or Downloads copy: never let a
        // non-canonical code identity become the login item.
        return Ok(());
    }

    initialize_autostart()?;

    if read_autostart_status()? {
        if login_item_matches_executable(executable_path.as_path())? {
            // Already registered against this installed binary — nothing to do.
            return Ok(());
        }

        // Enabled but stale: points at an old path (e.g. a previous
        // build-output bundle) or predates the launch flag. Clear it before
        // re-registering so the login item boots the current signed install.
        disable_autostart()?;
    }

    enable_autostart()
}

#[cfg(target_os = "macos")]
pub(crate) fn setup_launch_at_login(app: &App) -> Result<(), String> {
    use tauri_plugin_autostart::{MacosLauncher, ManagerExt as AutostartManagerExt};

    let login_item_plist_path = macos_login_item_plist_path(app)?;

    run_launch_at_login_setup_flow(
        || {
            std::env::current_exe()
                .and_then(|path| path.canonicalize())
                .map_err(|error| {
                    format!("Could not resolve current executable for autostart: {error}")
                })
        },
        is_running_from_canonical_install_location,
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
        |executable_path| {
            login_item_targets_executable(login_item_plist_path.as_path(), executable_path)
        },
        || {
            app.autolaunch()
                .disable()
                .map_err(|error| format!("Could not clear the stale launch-at-login entry: {error}"))
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
        is_running_from_canonical_install_location, login_item_targets_executable,
        run_launch_at_login_setup_flow, should_show_main_window_on_current_launch,
        AUTOSTART_LAUNCH_FLAG,
    };
    use std::cell::RefCell;
    use std::path::{Path, PathBuf};

    fn applications_executable() -> PathBuf {
        PathBuf::from("/Applications/Voice to Text.app/Contents/MacOS/voice_to_text")
    }

    fn build_output_executable() -> PathBuf {
        PathBuf::from(
            "/Users/dta.teks/dev/stt/src/target/release/bundle/macos/Voice to Text.app/Contents/MacOS/voice_to_text",
        )
    }

    #[test]
    fn canonical_location_accepts_applications_and_rejects_non_installed_bundles() {
        // Installed copy: the only location allowed to register login-launch.
        assert!(is_running_from_canonical_install_location(
            applications_executable().as_path()
        ));

        // Regression: the release build-output bundle is ad-hoc signed and
        // must NOT become the login item — registering it there is the
        // root cause of the microphone re-prompt after every reboot.
        assert!(!is_running_from_canonical_install_location(
            build_output_executable().as_path()
        ));

        // Bare dev binary.
        assert!(!is_running_from_canonical_install_location(Path::new(
            "/Users/dta.teks/dev/stt/src/target/debug/voice_to_text"
        )));

        // Downloaded-but-not-installed copy.
        assert!(!is_running_from_canonical_install_location(Path::new(
            "/Users/dta.teks/Downloads/Voice to Text.app/Contents/MacOS/voice_to_text"
        )));
    }

    #[test]
    fn canonical_location_accepts_user_applications_directory() {
        let home = std::env::var("HOME").expect("HOME must be set in the test environment");
        let user_apps_executable = PathBuf::from(format!(
            "{home}/Applications/Voice to Text.app/Contents/MacOS/voice_to_text"
        ));

        assert!(is_running_from_canonical_install_location(
            user_apps_executable.as_path()
        ));
    }

    #[test]
    fn login_item_matches_only_when_path_and_flag_both_present() {
        let temp_dir = std::env::temp_dir().join("stt-login-item-match-test");
        std::fs::create_dir_all(&temp_dir).expect("temp dir");
        let plist_path = temp_dir.join("Voice to Text.plist");
        let exe = applications_executable();

        // Missing plist -> not a match (caller will register fresh).
        let _ = std::fs::remove_file(&plist_path);
        assert!(!login_item_targets_executable(plist_path.as_path(), exe.as_path()).unwrap());

        // Correct path + launch flag -> match.
        std::fs::write(
            &plist_path,
            format!(
                "<plist><array><string>{}</string><string>{}</string></array></plist>",
                exe.display(),
                AUTOSTART_LAUNCH_FLAG
            ),
        )
        .unwrap();
        assert!(login_item_targets_executable(plist_path.as_path(), exe.as_path()).unwrap());

        // Stale path (points at the build-output bundle) -> not a match.
        std::fs::write(
            &plist_path,
            format!(
                "<plist><array><string>{}</string><string>{}</string></array></plist>",
                build_output_executable().display(),
                AUTOSTART_LAUNCH_FLAG
            ),
        )
        .unwrap();
        assert!(!login_item_targets_executable(plist_path.as_path(), exe.as_path()).unwrap());

        // Correct path but missing launch flag (older registration) -> not a match.
        std::fs::write(
            &plist_path,
            format!("<plist><array><string>{}</string></array></plist>", exe.display()),
        )
        .unwrap();
        assert!(!login_item_targets_executable(plist_path.as_path(), exe.as_path()).unwrap());

        let _ = std::fs::remove_file(&plist_path);
    }

    #[test]
    fn launch_at_login_skips_non_canonical_locations_before_initializing_plugin() {
        let executed_steps: RefCell<Vec<&str>> = RefCell::new(Vec::new());

        let result = run_launch_at_login_setup_flow(
            || Ok(build_output_executable()),
            is_running_from_canonical_install_location,
            || {
                executed_steps.borrow_mut().push("init");
                Ok(())
            },
            || {
                executed_steps.borrow_mut().push("is-enabled");
                Ok(false)
            },
            |_| {
                executed_steps.borrow_mut().push("matches");
                Ok(false)
            },
            || {
                executed_steps.borrow_mut().push("disable");
                Ok(())
            },
            || {
                executed_steps.borrow_mut().push("enable");
                Ok(())
            },
        );

        assert!(result.is_ok());
        assert!(
            executed_steps.borrow().is_empty(),
            "a non-canonical location must not touch login items at all"
        );
    }

    #[test]
    fn launch_at_login_registers_when_currently_disabled() {
        let executed_steps: RefCell<Vec<&str>> = RefCell::new(Vec::new());

        let result = run_launch_at_login_setup_flow(
            || Ok(applications_executable()),
            |_| true,
            || {
                executed_steps.borrow_mut().push("init");
                Ok(())
            },
            || {
                executed_steps.borrow_mut().push("is-enabled");
                Ok(false)
            },
            |_| {
                executed_steps.borrow_mut().push("matches");
                Ok(false)
            },
            || {
                executed_steps.borrow_mut().push("disable");
                Ok(())
            },
            || {
                executed_steps.borrow_mut().push("enable");
                Ok(())
            },
        );

        assert!(result.is_ok());
        // Disabled -> register fresh; no match check and no disable needed.
        assert_eq!(executed_steps.into_inner(), vec!["init", "is-enabled", "enable"]);
    }

    #[test]
    fn launch_at_login_skips_when_already_registered_for_this_binary() {
        let executed_steps: RefCell<Vec<&str>> = RefCell::new(Vec::new());

        let result = run_launch_at_login_setup_flow(
            || Ok(applications_executable()),
            |_| true,
            || {
                executed_steps.borrow_mut().push("init");
                Ok(())
            },
            || {
                executed_steps.borrow_mut().push("is-enabled");
                Ok(true)
            },
            |_| {
                executed_steps.borrow_mut().push("matches");
                Ok(true)
            },
            || {
                executed_steps.borrow_mut().push("disable");
                Ok(())
            },
            || {
                executed_steps.borrow_mut().push("enable");
                Ok(())
            },
        );

        assert!(result.is_ok());
        assert_eq!(executed_steps.into_inner(), vec!["init", "is-enabled", "matches"]);
    }

    #[test]
    fn launch_at_login_repairs_stale_login_item() {
        let executed_steps: RefCell<Vec<&str>> = RefCell::new(Vec::new());

        let result = run_launch_at_login_setup_flow(
            || Ok(applications_executable()),
            |_| true,
            || {
                executed_steps.borrow_mut().push("init");
                Ok(())
            },
            || {
                executed_steps.borrow_mut().push("is-enabled");
                Ok(true)
            },
            |_| {
                executed_steps.borrow_mut().push("matches");
                Ok(false)
            },
            || {
                executed_steps.borrow_mut().push("disable");
                Ok(())
            },
            || {
                executed_steps.borrow_mut().push("enable");
                Ok(())
            },
        );

        assert!(result.is_ok());
        // Enabled but stale path/flag -> clear then re-register.
        assert_eq!(
            executed_steps.into_inner(),
            vec!["init", "is-enabled", "matches", "disable", "enable"]
        );
    }

    #[test]
    fn launch_at_login_propagates_resolve_current_executable_failure() {
        let executed_steps: RefCell<Vec<&str>> = RefCell::new(Vec::new());

        let result = run_launch_at_login_setup_flow(
            || Err("could not resolve current_exe".to_string()),
            |_| true,
            || {
                executed_steps.borrow_mut().push("init");
                Ok(())
            },
            || {
                executed_steps.borrow_mut().push("is-enabled");
                Ok(true)
            },
            |_| {
                executed_steps.borrow_mut().push("matches");
                Ok(true)
            },
            || {
                executed_steps.borrow_mut().push("disable");
                Ok(())
            },
            || {
                executed_steps.borrow_mut().push("enable");
                Ok(())
            },
        );

        assert_eq!(result, Err("could not resolve current_exe".to_string()));
        assert!(
            executed_steps.borrow().is_empty(),
            "plugin must NOT be initialised when current_exe resolution fails"
        );
    }

    #[test]
    fn launch_at_login_propagates_plugin_init_failure() {
        let executed_steps: RefCell<Vec<&str>> = RefCell::new(Vec::new());

        let result = run_launch_at_login_setup_flow(
            || Ok(applications_executable()),
            |_| true,
            || {
                executed_steps.borrow_mut().push("init");
                Err("autostart plugin failed to init".to_string())
            },
            || {
                executed_steps.borrow_mut().push("is-enabled");
                Ok(true)
            },
            |_| {
                executed_steps.borrow_mut().push("matches");
                Ok(true)
            },
            || {
                executed_steps.borrow_mut().push("disable");
                Ok(())
            },
            || {
                executed_steps.borrow_mut().push("enable");
                Ok(())
            },
        );

        assert_eq!(result, Err("autostart plugin failed to init".to_string()));
        assert_eq!(
            executed_steps.into_inner(),
            vec!["init"],
            "is-enabled / matches / enable must NOT run after init failure",
        );
    }

    #[test]
    fn launch_at_login_propagates_is_enabled_failure() {
        let executed_steps: RefCell<Vec<&str>> = RefCell::new(Vec::new());

        let result = run_launch_at_login_setup_flow(
            || Ok(applications_executable()),
            |_| true,
            || {
                executed_steps.borrow_mut().push("init");
                Ok(())
            },
            || {
                executed_steps.borrow_mut().push("is-enabled");
                Err("could not read autostart status".to_string())
            },
            |_| {
                executed_steps.borrow_mut().push("matches");
                Ok(true)
            },
            || {
                executed_steps.borrow_mut().push("disable");
                Ok(())
            },
            || {
                executed_steps.borrow_mut().push("enable");
                Ok(())
            },
        );

        assert_eq!(result, Err("could not read autostart status".to_string()));
        assert_eq!(
            executed_steps.into_inner(),
            vec!["init", "is-enabled"],
            "matches / enable must NOT run after is-enabled failure",
        );
    }

    #[test]
    fn launch_at_login_propagates_login_item_match_failure() {
        let executed_steps: RefCell<Vec<&str>> = RefCell::new(Vec::new());

        let result = run_launch_at_login_setup_flow(
            || Ok(applications_executable()),
            |_| true,
            || {
                executed_steps.borrow_mut().push("init");
                Ok(())
            },
            || {
                executed_steps.borrow_mut().push("is-enabled");
                Ok(true)
            },
            |_| {
                executed_steps.borrow_mut().push("matches");
                Err("could not read the launch-at-login entry".to_string())
            },
            || {
                executed_steps.borrow_mut().push("disable");
                Ok(())
            },
            || {
                executed_steps.borrow_mut().push("enable");
                Ok(())
            },
        );

        assert_eq!(
            result,
            Err("could not read the launch-at-login entry".to_string())
        );
        assert_eq!(
            executed_steps.into_inner(),
            vec!["init", "is-enabled", "matches"],
            "disable / enable must NOT run after a match-read failure",
        );
    }

    #[test]
    fn launch_at_login_propagates_disable_failure() {
        let executed_steps: RefCell<Vec<&str>> = RefCell::new(Vec::new());

        let result = run_launch_at_login_setup_flow(
            || Ok(applications_executable()),
            |_| true,
            || {
                executed_steps.borrow_mut().push("init");
                Ok(())
            },
            || {
                executed_steps.borrow_mut().push("is-enabled");
                Ok(true)
            },
            |_| {
                executed_steps.borrow_mut().push("matches");
                Ok(false)
            },
            || {
                executed_steps.borrow_mut().push("disable");
                Err("could not clear stale entry".to_string())
            },
            || {
                executed_steps.borrow_mut().push("enable");
                Ok(())
            },
        );

        assert_eq!(result, Err("could not clear stale entry".to_string()));
        assert_eq!(
            executed_steps.into_inner(),
            vec!["init", "is-enabled", "matches", "disable"],
            "enable must NOT run after a disable failure",
        );
    }

    #[test]
    fn launch_at_login_propagates_enable_failure() {
        let executed_steps: RefCell<Vec<&str>> = RefCell::new(Vec::new());

        let result = run_launch_at_login_setup_flow(
            || Ok(applications_executable()),
            |_| true,
            || {
                executed_steps.borrow_mut().push("init");
                Ok(())
            },
            || {
                executed_steps.borrow_mut().push("is-enabled");
                Ok(false)
            },
            |_| {
                executed_steps.borrow_mut().push("matches");
                Ok(false)
            },
            || {
                executed_steps.borrow_mut().push("disable");
                Ok(())
            },
            || {
                executed_steps.borrow_mut().push("enable");
                Err("autostart enable failed".to_string())
            },
        );

        assert_eq!(result, Err("autostart enable failed".to_string()));
        assert_eq!(executed_steps.into_inner(), vec!["init", "is-enabled", "enable"]);
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
