use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

mod commands;
pub mod credentials;
pub mod llm_service;
pub mod permissions;
pub mod shell_credentials;
pub mod text_inserter;

const MAIN_WINDOW_LABEL: &str = "main";
const BAR_WINDOW_LABEL: &str = "bar";
const TOGGLE_MIC_EVENT: &str = "toggle-mic";

fn toggle_main_window_visibility(app: &AppHandle) {
    if let Some(main_window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        match main_window.is_visible() {
            Ok(true) => {
                let _ = main_window.hide();
            }
            Ok(false) => {
                let _ = main_window.show();
                let _ = main_window.set_focus();
            }
            Err(_) => {}
        }
    }
}

fn build_main_window(app: &tauri::App) -> tauri::Result<()> {
    let main_window =
        WebviewWindowBuilder::new(app, MAIN_WINDOW_LABEL, WebviewUrl::App("index.html".into()))
            .initialization_script(include_str!("../../ui/tauri-bridge.js"))
            .title("Voice to Text")
            .inner_size(360.0, 560.0)
            .visible(false)
            .resizable(true)
            .build()?;

    let main_window_for_events = main_window.clone();
    main_window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = main_window_for_events.hide();
        }
    });

    Ok(())
}

fn build_bar_window(app: &tauri::App) -> tauri::Result<()> {
    let bar_window =
        WebviewWindowBuilder::new(app, BAR_WINDOW_LABEL, WebviewUrl::App("bar.html".into()))
            .initialization_script(include_str!("../../ui/tauri-bridge.js"))
            .title("Voice to Text Bar")
            .inner_size(600.0, 56.0)
            .decorations(false)
            .always_on_top(true)
            .focused(false)
            .resizable(false)
            .skip_taskbar(true)
            .visible(true)
            .build()?;

    bar_window.set_visible_on_all_workspaces(true)?;
    bar_window.set_focusable(false)?;
    bar_window.set_ignore_cursor_events(true)?;
    bar_window.show()?;

    Ok(())
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let icon = app.default_window_icon().cloned();

    let mut tray_builder = TrayIconBuilder::new().tooltip("Voice to Text");
    if let Some(window_icon) = icon {
        tray_builder = tray_builder.icon(window_icon);
    }

    tray_builder
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                toggle_main_window_visibility(&app);
            }
        })
        .build(app)?;

    Ok(())
}

fn setup_global_shortcut(app: &tauri::App) -> tauri::Result<()> {
    let shortcut = Shortcut::new(
        Some(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER),
        Code::KeyV,
    );

    app.global_shortcut()
        .on_shortcut(shortcut.clone(), move |app, _, event| {
            if event.state == ShortcutState::Pressed {
                if let Some(bar_window) = app.get_webview_window(BAR_WINDOW_LABEL) {
                    let _ = bar_window.emit(TOGGLE_MIC_EVENT, ());
                }
            }
        })
        .map_err(|error| {
            eprintln!("[global-shortcut] Failed to set up shortcut handler: {}", error);
            std::io::Error::other(error.to_string())
        })?;

    if let Err(error) = app.global_shortcut().register(shortcut) {
        eprintln!("[global-shortcut] Failed to register global shortcut (may be in use by another app): {}", error);
        eprintln!("[global-shortcut] Continuing without global shortcut. Use tray icon to toggle mic.");
        return Ok(());
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            build_main_window(app)?;
            build_bar_window(app)?;
            setup_tray(app)?;
            setup_global_shortcut(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::get_soniox_key,
            commands::has_xai_key,
            commands::save_credentials,
            commands::update_xai_key,
            commands::reset_credentials,
            commands::ensure_microphone_permission,
            commands::insert_text,
            commands::correct_transcript,
            commands::set_mic_state,
            commands::copy_to_clipboard,
            commands::quit_app,
            commands::show_bar,
            commands::hide_bar,
            commands::set_mouse_events,
            commands::show_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
