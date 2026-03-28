use tauri::utils::config::{Color, WindowConfig};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[cfg(target_os = "macos")]
use objc2::msg_send;
#[cfg(target_os = "macos")]
use objc2::runtime::AnyObject;
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSColor, NSWindow, NSWindowCollectionBehavior};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSNumber, NSString};
#[cfg(target_os = "macos")]
use objc2_web_kit::WKWebView;

mod commands;
pub mod credentials;
pub mod llm_service;
pub mod permissions;
pub mod shell_credentials;
pub mod text_inserter;

const MAIN_WINDOW_LABEL: &str = "main";
pub(crate) const BAR_WINDOW_LABEL: &str = "bar";
const TOGGLE_MIC_EVENT: &str = "toggle-mic";
const BAR_WINDOW_WIDTH: f64 = 600.0;
const BAR_WINDOW_HEIGHT: f64 = 56.0;
const BAR_BOTTOM_OFFSET_PX: i32 = 40;
const BAR_WINDOW_CORNER_RADIUS: f64 = 24.0;
#[cfg(target_os = "macos")]
const NS_STATUS_WINDOW_LEVEL: i64 = 25;

pub fn run_bar_show_sequence<
    ConfigureBarWindow,
    PositionBarWindow,
    ShowBarWindow,
    OrderBarWindowFront,
>(
    mut configure_bar_window: ConfigureBarWindow,
    mut position_bar_window: PositionBarWindow,
    mut show_bar_window: ShowBarWindow,
    mut order_bar_window_front: OrderBarWindowFront,
) -> tauri::Result<()>
where
    ConfigureBarWindow: FnMut() -> tauri::Result<()>,
    PositionBarWindow: FnMut() -> tauri::Result<()>,
    ShowBarWindow: FnMut() -> tauri::Result<()>,
    OrderBarWindowFront: FnMut() -> tauri::Result<()>,
{
    configure_bar_window()?;
    position_bar_window()?;
    show_bar_window()?;
    order_bar_window_front()?;
    Ok(())
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

pub(crate) fn show_bar_window_with_runtime_invariants(
    app: &AppHandle,
    bar_window: &WebviewWindow,
) -> tauri::Result<()> {
    run_bar_show_sequence(
        || configure_bar_window_for_macos(bar_window),
        || position_bar_window_bottom_center(app, bar_window),
        || bar_window.show(),
        || order_bar_window_front_for_macos(bar_window),
    )
}

fn get_window_config<'a>(app: &'a tauri::App, label: &str) -> tauri::Result<&'a WindowConfig> {
    app.config()
        .app
        .windows
        .iter()
        .find(|config| config.label == label)
        .ok_or_else(|| std::io::Error::other(format!("missing window config for `{label}`")).into())
}

#[cfg(target_os = "macos")]
unsafe fn configure_bar_window_view_layer(view: *mut AnyObject) {
    if view.is_null() {
        return;
    }

    let clear = NSColor::clearColor();
    let clear_cg_color: *mut AnyObject = msg_send![&clear, CGColor];

    let _: () = msg_send![view, setWantsLayer: true];

    let layer: *mut AnyObject = msg_send![view, layer];
    if layer.is_null() {
        return;
    }

    let _: () = msg_send![layer, setBackgroundColor: clear_cg_color];
    let _: () = msg_send![layer, setCornerRadius: BAR_WINDOW_CORNER_RADIUS];
    let _: () = msg_send![layer, setMasksToBounds: true];
}

#[cfg(target_os = "macos")]
fn bar_window_collection_behavior() -> NSWindowCollectionBehavior {
    NSWindowCollectionBehavior::CanJoinAllSpaces
        | NSWindowCollectionBehavior::FullScreenAuxiliary
        | NSWindowCollectionBehavior::Stationary
}

#[cfg(target_os = "macos")]
pub(crate) fn configure_bar_window_for_macos(bar_window: &WebviewWindow) -> tauri::Result<()> {
    bar_window.set_background_color(Some(Color(0, 0, 0, 0)))?;

    let ns_window = unsafe { &*(bar_window.ns_window()? as *mut NSWindow) };
    let clear = NSColor::clearColor();
    let collection_behavior = bar_window_collection_behavior();

    ns_window.setOpaque(false);
    ns_window.setHasShadow(true);
    ns_window.setBackgroundColor(Some(&clear));
    ns_window.setCollectionBehavior(collection_behavior);

    // NSStatusWindowLevel (25) — high enough to appear over fullscreen apps.
    // setHidesOnDeactivate(false) keeps HUD visible when another app is active.
    unsafe {
        let _: () = msg_send![ns_window, setLevel: NS_STATUS_WINDOW_LEVEL];
        let _: () = msg_send![ns_window, setHidesOnDeactivate: false];

        let content_view: *mut AnyObject = msg_send![ns_window, contentView];
        configure_bar_window_view_layer(content_view);

        let _: () = msg_send![ns_window, invalidateShadow];
    }

    bar_window.with_webview(|webview| unsafe {
        let view: &WKWebView = &*webview.inner().cast();
        let background_enabled = NSNumber::new_bool(false);
        let draws_background_key = NSString::from_str("drawsBackground");
        let under_page_background = NSColor::clearColor();

        let _: () = msg_send![view, setValue: &*background_enabled, forKey: &*draws_background_key];
        view.setUnderPageBackgroundColor(Some(&under_page_background));

        configure_bar_window_view_layer(view as *const WKWebView as *mut AnyObject);
    })?;

    Ok(())
}

#[cfg(target_os = "macos")]
pub(crate) fn order_bar_window_front_for_macos(bar_window: &WebviewWindow) -> tauri::Result<()> {
    let ns_window = unsafe { &*(bar_window.ns_window()? as *mut NSWindow) };

    unsafe {
        let _: () = msg_send![ns_window, orderFrontRegardless];
    }

    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn order_bar_window_front_for_macos(_bar_window: &WebviewWindow) -> tauri::Result<()> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn configure_bar_window_for_macos(_bar_window: &WebviewWindow) -> tauri::Result<()> {
    Ok(())
}

pub(crate) fn position_bar_window_bottom_center(
    app: &AppHandle,
    bar_window: &WebviewWindow,
) -> tauri::Result<()> {
    let monitor_from_cursor = app.cursor_position().ok().and_then(|cursor| {
        app.monitor_from_point(cursor.x, cursor.y)
            .ok()
            .and_then(|monitor| monitor)
    });

    let monitor = match monitor_from_cursor {
        Some(monitor) => Some(monitor),
        None => app.primary_monitor()?,
    };

    if let Some(monitor) = monitor {
        let scale = monitor.scale_factor();
        let monitor_position = monitor.position();
        let monitor_width = i64::from(monitor.size().width);
        let monitor_height = i64::from(monitor.size().height);

        // Window config dimensions are logical; monitor.size() is physical.
        let bar_width_physical = (BAR_WINDOW_WIDTH * scale) as i64;
        let bar_height_physical = (BAR_WINDOW_HEIGHT * scale) as i64;
        let bottom_offset_physical = (f64::from(BAR_BOTTOM_OFFSET_PX) * scale) as i64;

        let centered_x = ((monitor_width - bar_width_physical).max(0)) / 2;
        let x = i64::from(monitor_position.x) + centered_x;
        let y = i64::from(monitor_position.y)
            + (monitor_height - bar_height_physical - bottom_offset_physical).max(0);

        bar_window.set_position(PhysicalPosition::new(x as i32, y as i32))?;
    }

    Ok(())
}

fn build_main_window(app: &tauri::App) -> tauri::Result<()> {
    let main_window =
        WebviewWindowBuilder::from_config(app, get_window_config(app, MAIN_WINDOW_LABEL)?)?
            .initialization_script(include_str!("../../ui/tauri-bridge.js"))
            .build()?;

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

fn build_bar_window(app: &tauri::App) -> tauri::Result<()> {
    let bar_window =
        WebviewWindowBuilder::from_config(app, get_window_config(app, BAR_WINDOW_LABEL)?)?
            .initialization_script(include_str!("../../ui/tauri-bridge.js"))
            .build()?;

    let app_handle = app.handle().clone();
    position_bar_window_bottom_center(&app_handle, &bar_window)?;
    configure_bar_window_for_macos(&bar_window)?;

    bar_window.set_ignore_cursor_events(true)?;

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
            eprintln!(
                "[global-shortcut] Failed to set up shortcut handler: {}",
                error
            );
            std::io::Error::other(error.to_string())
        })?;

    if let Err(error) = app.global_shortcut().register(shortcut) {
        eprintln!("[global-shortcut] Failed to register global shortcut (may be in use by another app): {}", error);
        eprintln!("[global-shortcut] Continuing without global shortcut.");
        return Ok(());
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            build_main_window(app)?;
            build_bar_window(app)?;
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
            commands::ensure_accessibility_permission,
            commands::ensure_text_insertion_permission,
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

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn bar_window_collection_behavior_keeps_hud_on_all_spaces_and_fullscreen() {
        let behavior = bar_window_collection_behavior();

        assert!(behavior.contains(NSWindowCollectionBehavior::CanJoinAllSpaces));
        assert!(behavior.contains(NSWindowCollectionBehavior::FullScreenAuxiliary));
    }

    #[test]
    fn bar_window_collection_behavior_avoids_conflicting_move_to_active_space_flag() {
        let behavior = bar_window_collection_behavior();

        assert!(behavior.contains(NSWindowCollectionBehavior::Stationary));
        assert!(!behavior.contains(NSWindowCollectionBehavior::MoveToActiveSpace));
    }
}
