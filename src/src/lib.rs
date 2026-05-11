use tauri::utils::config::WindowConfig;
use tauri::{AppHandle, Manager, RunEvent, Theme, WebviewWindow, WebviewWindowBuilder, WindowEvent};

pub mod bar_window;
mod commands;
mod helper_mode;
#[cfg(target_os = "macos")]
mod macos_app_shell;
pub mod mic_shortcut;
mod platform_app_shell;
mod platform_runtime_info;
#[cfg(target_os = "macos")]
pub mod applescript;
pub mod clipboard;
pub mod credentials;
pub mod llm_service;
pub mod permissions;
pub mod shell_credentials;
pub mod soniox_auth;
pub mod soniox_models;
pub mod text_inserter;
#[cfg(not(target_os = "macos"))]
mod windows_app_shell;

pub use bar_window::{
    run_bar_close_request_sequence, run_bar_order_front_without_focus_steal, run_bar_show_sequence,
    run_macos_bar_runtime_configuration_sequence,
};
pub(crate) use bar_window::BAR_WINDOW_LABEL;
pub use helper_mode::maybe_run_from_args;
pub use platform_app_shell::{
    run_hide_bar_contract, run_runtime_event_contract, run_set_bar_mouse_events_contract,
    run_show_bar_contract, run_show_settings_contract,
};

const MAIN_WINDOW_LABEL: &str = "main";
const AUTOSTART_LAUNCH_FLAG: &str = "--launch-at-login";



pub fn run_main_window_show_sequence<UnminimizeMainWindow, ShowMainWindow, FocusMainWindow>(
    mut unminimize_main_window: UnminimizeMainWindow,
    mut show_main_window: ShowMainWindow,
    mut focus_main_window: FocusMainWindow,
) -> tauri::Result<()>
where
    UnminimizeMainWindow: FnMut() -> tauri::Result<()>,
    ShowMainWindow: FnMut() -> tauri::Result<()>,
    FocusMainWindow: FnMut() -> tauri::Result<()>,
{
    unminimize_main_window()?;
    show_main_window()?;
    focus_main_window()?;
    Ok(())
}

pub fn run_macos_reopen_window_sequence<ReopenMainWindow>(
    has_visible_windows: bool,
    mut reopen_main_window: ReopenMainWindow,
) where
    ReopenMainWindow: FnMut(),
{
    if !has_visible_windows {
        reopen_main_window();
    }
}

pub fn run_windows_reopen_window_sequence<ReopenMainWindow>(
    has_visible_windows: bool,
    mut reopen_main_window: ReopenMainWindow,
) where
    ReopenMainWindow: FnMut(),
{
    if !has_visible_windows {
        reopen_main_window();
    }
}

pub fn run_main_close_request_sequence<PreventClose, HideMainWindow>(
    prevent_close: PreventClose,
    hide_main_window: HideMainWindow,
) -> tauri::Result<()>
where
    PreventClose: FnOnce(),
    HideMainWindow: FnOnce() -> tauri::Result<()>,
{
    prevent_close();
    hide_main_window()
}



pub(crate) fn show_main_window_with_runtime_invariants(
    main_window: &WebviewWindow,
) -> tauri::Result<()> {
    run_main_window_show_sequence(
        || main_window.unminimize(),
        || main_window.show(),
        || main_window.set_focus(),
    )
}

fn show_main_window_on_initial_launch(app: &tauri::App) -> tauri::Result<()> {
    if !should_show_main_window_on_current_launch(std::env::args()) {
        return Ok(());
    }

    let main_window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| std::io::Error::other("main window not found"))?;

    show_main_window_with_runtime_invariants(&main_window)
}

fn should_show_main_window_on_current_launch<Args, Arg>(args: Args) -> bool
where
    Args: IntoIterator<Item = Arg>,
    Arg: AsRef<str>,
{
    !args
        .into_iter()
        .skip(1)
        .any(|arg| arg.as_ref() == AUTOSTART_LAUNCH_FLAG)
}

fn reopen_main_window(app: &AppHandle) {
    if let Some(main_window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = show_main_window_with_runtime_invariants(&main_window);
    }
}

pub(crate) fn handle_macos_runtime_event(app_handle: &AppHandle, event: RunEvent) {
    #[cfg(target_os = "macos")]
    if let RunEvent::Reopen {
        has_visible_windows,
        ..
    } = event
    {
        run_macos_reopen_window_sequence(has_visible_windows, || {
            reopen_main_window(app_handle)
        });
    }
}

pub(crate) fn get_window_config<'a>(
    app: &'a tauri::App,
    label: &str,
) -> tauri::Result<&'a WindowConfig> {
    app.config()
        .app
        .windows
        .iter()
        .find(|config| config.label == label)
        .ok_or_else(|| std::io::Error::other(format!("missing window config for `{label}`")).into())
}

pub(crate) fn build_main_window(app: &tauri::App) -> tauri::Result<()> {
    let main_window =
        WebviewWindowBuilder::from_config(app, get_window_config(app, MAIN_WINDOW_LABEL)?)?
            .initialization_script(include_str!("../../ui/tauri-bridge.js"))
            .build()?;

    main_window.set_theme(Some(Theme::Dark))?;

    let main_window_for_events = main_window.clone();
    main_window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            let _ = run_main_close_request_sequence(
                || api.prevent_close(),
                || main_window_for_events.hide(),
            );
        }
    });

    Ok(())
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
fn setup_launch_at_login(app: &tauri::App) -> Result<(), String> {
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
fn setup_launch_at_login(_app: &tauri::App) -> Result<(), String> {
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Some(exit_code) = helper_mode::maybe_run_from_args(std::env::args()) {
        std::process::exit(exit_code);
    }

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            reopen_main_window(app);
        }));

    #[cfg(desktop)]
    let app = app.plugin(tauri_plugin_updater::Builder::new().build());

    #[cfg(target_os = "macos")]
    let app = app.plugin(tauri_nspanel::init());

    let app = app
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(mic_shortcut::MicToggleShortcutState::default())
        .manage(mic_shortcut::PendingMicToggleRequestState::default())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            if let Err(error) = setup_launch_at_login(app) {
                eprintln!("[autostart] {error}");
                eprintln!("[autostart] Continuing without launch-at-login.");
            }

            platform_app_shell::build_main_window(app)?;
            platform_app_shell::build_bar_window(app)?;
            mic_shortcut::setup(app)?;
            show_main_window_on_initial_launch(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::has_soniox_key,
            commands::create_soniox_temporary_key,
            commands::has_xai_key,
            commands::has_openai_compatible_key,
            commands::save_credentials,
            commands::update_xai_key,
            commands::update_openai_compatible_key,
            commands::update_soniox_key,
            commands::list_models,
            commands::list_soniox_models,
            commands::ensure_microphone_permission,
            commands::ensure_accessibility_permission,
            commands::ensure_text_insertion_permission,
            commands::check_permissions_status,
            commands::insert_text,
            commands::correct_transcript,
            commands::set_mic_state,
            commands::copy_to_clipboard,
            commands::quit_app,
            commands::relaunch_app,
            commands::show_bar,
            commands::hide_bar,
            commands::set_mouse_events,
            commands::show_settings,
            commands::fit_main_window_to_content,
            commands::get_platform_runtime_info,
            commands::consume_pending_mic_toggle,
            commands::get_mic_toggle_shortcut,
            commands::update_mic_toggle_shortcut,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        platform_app_shell::handle_runtime_event(app_handle, event);
    });
}

#[cfg(all(test, target_os = "macos"))]
mod autostart_tests {
    use super::{
        is_running_from_macos_app_bundle_path, run_bar_order_front_without_focus_steal,
        run_launch_at_login_setup_flow, should_show_main_window_on_current_launch,
        AUTOSTART_LAUNCH_FLAG,
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

    #[test]
    fn bar_front_sequence_orders_front_without_extra_focus_step() {
        let executed_steps: RefCell<Vec<&str>> = RefCell::new(Vec::new());

        let result = run_bar_order_front_without_focus_steal(|| {
            executed_steps.borrow_mut().push("front");
            Ok(())
        });

        assert!(result.is_ok());
        assert_eq!(executed_steps.into_inner(), vec!["front"]);
    }
}
