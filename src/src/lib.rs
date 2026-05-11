use tauri::utils::config::WindowConfig;
use tauri::{AppHandle, Manager, RunEvent, Theme, WebviewWindow, WebviewWindowBuilder, WindowEvent};

mod autostart;
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
pub mod llm_provider;
pub mod llm_service;
pub mod permissions;
pub mod shell_credentials;
pub mod soniox_auth;
pub mod soniox_models;
pub mod text_inserter;
#[cfg(not(target_os = "macos"))]
mod windows_app_shell;

pub use bar_window::{
    run_bar_close_request_sequence, run_bar_show_sequence,
    run_macos_bar_runtime_configuration_sequence,
};
pub(crate) use bar_window::BAR_WINDOW_LABEL;
pub use helper_mode::maybe_run_from_args;
pub use platform_app_shell::{
    run_hide_bar_contract, run_runtime_event_contract, run_set_bar_mouse_events_contract,
    run_show_bar_contract, run_show_settings_contract,
};

use autostart::{setup_launch_at_login, should_show_main_window_on_current_launch};

const MAIN_WINDOW_LABEL: &str = "main";



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

