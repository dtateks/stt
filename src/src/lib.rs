use std::sync::Mutex;
use tauri::utils::config::WindowConfig;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[cfg(target_os = "macos")]
use core_graphics::event::CGEvent;
#[cfg(target_os = "macos")]
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
#[cfg(target_os = "macos")]
use objc2::msg_send;
#[cfg(target_os = "macos")]
use objc2::runtime::AnyObject;
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSColor, NSWindowCollectionBehavior};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSNumber, NSString};
#[cfg(target_os = "macos")]
use objc2_web_kit::WKWebView;

#[cfg(target_os = "macos")]
use tauri_nspanel::{ManagerExt, WebviewWindowExt};

mod commands;
pub mod credentials;
pub mod llm_service;
pub mod permissions;
pub mod shell_credentials;
pub mod text_inserter;

const MAIN_WINDOW_LABEL: &str = "main";
pub(crate) const BAR_WINDOW_LABEL: &str = "bar";
const TOGGLE_MIC_EVENT: &str = "toggle-mic";
pub(crate) const DEFAULT_MIC_TOGGLE_SHORTCUT: &str = "Control+Alt+Super+V";
const BAR_WINDOW_WIDTH: f64 = 600.0;
const BAR_WINDOW_HEIGHT: f64 = 56.0;
const BAR_BOTTOM_OFFSET_PX: i32 = 40;
const BAR_WINDOW_CORNER_RADIUS: f64 = 24.0;

struct MicToggleShortcutState {
    active_shortcut: Mutex<String>,
}

impl Default for MicToggleShortcutState {
    fn default() -> Self {
        Self {
            active_shortcut: Mutex::new(DEFAULT_MIC_TOGGLE_SHORTCUT.to_string()),
        }
    }
}

fn lock_error_message() -> String {
    "mic shortcut state is unavailable".to_string()
}

fn parse_error_message(shortcut: &str, error: &str) -> String {
    format!(
        "Invalid global shortcut `{shortcut}`. Use an accelerator like `Control+Alt+Super+V`. Details: {error}"
    )
}

fn handler_registration_error_message(shortcut: &str, error: &str) -> String {
    format!("Could not attach global shortcut handler for `{shortcut}`: {error}")
}

fn unregister_error_message(shortcut: &str, error: &str) -> String {
    format!("Could not unregister global shortcut `{shortcut}`: {error}")
}

fn register_toggle_mic_handler(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _, event| {
            if event.state == ShortcutState::Pressed {
                if let Some(bar_window) = app.get_webview_window(BAR_WINDOW_LABEL) {
                    let _ = bar_window.emit(TOGGLE_MIC_EVENT, ());
                }
            }
        })
        .map_err(|error| handler_registration_error_message(shortcut, &error.to_string()))
}

fn register_toggle_mic_shortcut(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    register_toggle_mic_handler(app, shortcut)
}

fn validate_shortcut_format(shortcut: &str) -> Result<(), String> {
    shortcut
        .parse::<Shortcut>()
        .map(|_| ())
        .map_err(|error| parse_error_message(shortcut, &error.to_string()))
}

fn apply_shortcut_update_transaction<IsRegistered, RegisterShortcut, UnregisterShortcut>(
    current_shortcut: &str,
    new_shortcut: &str,
    current_is_registered: bool,
    mut is_registered: IsRegistered,
    mut register_shortcut: RegisterShortcut,
    mut unregister_shortcut: UnregisterShortcut,
) -> Result<(), String>
where
    IsRegistered: FnMut(&str) -> bool,
    RegisterShortcut: FnMut(&str) -> Result<(), String>,
    UnregisterShortcut: FnMut(&str) -> Result<(), String>,
{
    if current_shortcut == new_shortcut {
        return Ok(());
    }

    if !current_is_registered {
        return register_shortcut(new_shortcut);
    }

    register_shortcut(new_shortcut)?;

    if let Err(unregister_error) = unregister_shortcut(current_shortcut) {
        let rollback_unregister_new_error = unregister_shortcut(new_shortcut)
            .err()
            .unwrap_or_else(|| "none".to_string());
        let current_still_registered = is_registered(current_shortcut);
        let rollback_restore_old_error = if current_still_registered {
            "none".to_string()
        } else {
            register_shortcut(current_shortcut)
                .err()
                .unwrap_or_else(|| "none".to_string())
        };

        return Err(format!(
            "Failed to switch global shortcut from `{current_shortcut}` to `{new_shortcut}`: {unregister_error}. Rollback status — unregister new: {rollback_unregister_new_error}; restore previous: {rollback_restore_old_error}."
        ));
    }

    Ok(())
}

fn apply_mic_toggle_shortcut_update<IsRegistered, RegisterShortcut, UnregisterShortcut>(
    active_shortcut: &mut String,
    new_shortcut: &str,
    current_is_registered: bool,
    is_registered: IsRegistered,
    register_shortcut: RegisterShortcut,
    unregister_shortcut: UnregisterShortcut,
) -> Result<String, String>
where
    IsRegistered: FnMut(&str) -> bool,
    RegisterShortcut: FnMut(&str) -> Result<(), String>,
    UnregisterShortcut: FnMut(&str) -> Result<(), String>,
{
    let current_shortcut = active_shortcut.clone();

    apply_shortcut_update_transaction(
        &current_shortcut,
        new_shortcut,
        current_is_registered,
        is_registered,
        register_shortcut,
        unregister_shortcut,
    )?;

    *active_shortcut = new_shortcut.to_string();
    Ok(active_shortcut.clone())
}

pub(crate) fn get_mic_toggle_shortcut(app: &AppHandle) -> Result<String, String> {
    app.state::<MicToggleShortcutState>()
        .active_shortcut
        .lock()
        .map_err(|_| lock_error_message())
        .map(|shortcut| shortcut.clone())
}

pub(crate) fn update_mic_toggle_shortcut(
    app: &AppHandle,
    requested_shortcut: &str,
) -> Result<String, String> {
    let next_shortcut = requested_shortcut.trim();
    if next_shortcut.is_empty() {
        return Err("Global shortcut cannot be empty".to_string());
    }

    validate_shortcut_format(next_shortcut)?;

    let shortcut_state = app.state::<MicToggleShortcutState>();
    let mut active_shortcut = shortcut_state
        .active_shortcut
        .lock()
        .map_err(|_| lock_error_message())?;
    let current_is_registered = app.global_shortcut().is_registered(active_shortcut.as_str());

    apply_mic_toggle_shortcut_update(
        &mut active_shortcut,
        next_shortcut,
        current_is_registered,
        |shortcut| app.global_shortcut().is_registered(shortcut),
        |shortcut| register_toggle_mic_shortcut(app, shortcut),
        |shortcut| {
            app.global_shortcut()
                .unregister(shortcut)
                .map_err(|error| unregister_error_message(shortcut, &error.to_string()))
        },
    )
}

/// Above NSScreenSaverWindowLevel (1000) — reliably visible over fullscreen apps.
#[cfg(target_os = "macos")]
const PANEL_WINDOW_LEVEL: i64 = 1001;

#[cfg(target_os = "macos")]
mod hud_panel {
    use tauri::Manager;

    tauri_nspanel::tauri_panel! {
        panel!(HUDPanel {
            config: {
                can_become_key_window: true,
                is_floating_panel: true
            }
        })
    }
}

#[cfg(target_os = "macos")]
use hud_panel::HUDPanel;

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

pub fn run_bar_close_request_sequence<PreventClose, HideBarWindow>(
    prevent_close: PreventClose,
    hide_bar_window: HideBarWindow,
) -> tauri::Result<()>
where
    PreventClose: FnOnce(),
    HideBarWindow: FnOnce() -> tauri::Result<()>,
{
    prevent_close();
    hide_bar_window()
}

pub(crate) fn show_bar_window_with_runtime_invariants(
    app: &AppHandle,
    bar_window: &WebviewWindow,
) -> tauri::Result<()> {
    let panel = app
        .get_webview_panel(BAR_WINDOW_LABEL)
        .map_err(|_| std::io::Error::other("bar panel not found"))?;

    run_bar_show_sequence(
        || configure_bar_webview_transparency(bar_window),
        || position_bar_window_bottom_center(app, bar_window),
        || {
            panel.show();
            Ok(())
        },
        || {
            panel.order_front_regardless();
            Ok(())
        },
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
pub(crate) fn bar_window_collection_behavior() -> NSWindowCollectionBehavior {
    NSWindowCollectionBehavior::CanJoinAllSpaces
        | NSWindowCollectionBehavior::FullScreenAuxiliary
        | NSWindowCollectionBehavior::Stationary
}

/// Configure the bar panel's native properties for fullscreen overlay behavior.
#[cfg(target_os = "macos")]
fn configure_bar_panel(panel: &tauri_nspanel::PanelHandle<tauri::Wry>) {
    use tauri_nspanel::{CollectionBehavior, StyleMask};

    panel.set_level(PANEL_WINDOW_LEVEL);
    panel.set_style_mask(StyleMask::empty().nonactivating_panel().into());
    panel
        .set_collection_behavior(CollectionBehavior::from(bar_window_collection_behavior()).into());
    panel.set_hides_on_deactivate(false);
    panel.set_opaque(false);
    panel.set_has_shadow(true);
    panel.set_transparent(true);
    panel.set_corner_radius(BAR_WINDOW_CORNER_RADIUS);
}

/// Configure WKWebView transparency for the bar window.
/// Panel-level transparency alone is not enough — the WKWebView must also be
/// cleared so the pill-shaped HUD composites correctly on all backgrounds.
#[cfg(target_os = "macos")]
pub(crate) fn configure_bar_webview_transparency(bar_window: &WebviewWindow) -> tauri::Result<()> {
    bar_window.with_webview(|webview| unsafe {
        let view: &WKWebView = &*webview.inner().cast();
        let background_enabled = NSNumber::new_bool(false);
        let draws_background_key = NSString::from_str("drawsBackground");
        let under_page_background = NSColor::clearColor();

        let _: () = msg_send![view, setValue: &*background_enabled, forKey: &*draws_background_key];
        view.setUnderPageBackgroundColor(Some(&under_page_background));

        configure_bar_window_view_layer(view as *const WKWebView as *mut AnyObject);
    })
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn configure_bar_webview_transparency(_bar_window: &WebviewWindow) -> tauri::Result<()> {
    Ok(())
}

/// Set mouse-event passthrough on the bar panel.
#[cfg(target_os = "macos")]
pub(crate) fn set_bar_ignores_mouse_events(app: &AppHandle, ignores: bool) -> tauri::Result<()> {
    let panel = app
        .get_webview_panel(BAR_WINDOW_LABEL)
        .map_err(|_| std::io::Error::other("bar panel not found"))?;
    panel.set_ignores_mouse_events(ignores);
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn set_bar_ignores_mouse_events(app: &AppHandle, ignores: bool) -> tauri::Result<()> {
    let bar_window = app
        .get_webview_window(BAR_WINDOW_LABEL)
        .ok_or_else(|| std::io::Error::other("bar window not found"))?;
    bar_window.set_ignore_cursor_events(ignores)
}

/// Hide the bar via the panel API so it truly disappears from all Spaces.
#[cfg(target_os = "macos")]
pub(crate) fn hide_bar_panel(app: &AppHandle) -> tauri::Result<()> {
    let panel = app
        .get_webview_panel(BAR_WINDOW_LABEL)
        .map_err(|_| std::io::Error::other("bar panel not found"))?;
    panel.hide();
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn hide_bar_panel(app: &AppHandle) -> tauri::Result<()> {
    let bar_window = app
        .get_webview_window(BAR_WINDOW_LABEL)
        .ok_or_else(|| std::io::Error::other("bar window not found"))?;
    bar_window.hide()
}

#[cfg(target_os = "macos")]
fn monitor_from_global_mouse_location(app: &AppHandle) -> Option<tauri::Monitor> {
    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState).ok()?;
    let event = CGEvent::new(source).ok()?;
    let point = event.location();

    app.monitor_from_point(point.x, point.y)
        .ok()
        .and_then(|monitor| monitor)
}

#[cfg(not(target_os = "macos"))]
fn monitor_from_global_mouse_location(_app: &AppHandle) -> Option<tauri::Monitor> {
    None
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

    let monitor_from_cursor =
        monitor_from_cursor.or_else(|| monitor_from_global_mouse_location(app));

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

    let bar_window_for_events = bar_window.clone();
    bar_window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            if let Err(error) = run_bar_close_request_sequence(
                || api.prevent_close(),
                || bar_window_for_events.hide(),
            ) {
                eprintln!("[bar] close-request hide failed: {}", error);
            }
        }
    });

    let app_handle = app.handle().clone();
    position_bar_window_bottom_center(&app_handle, &bar_window)?;

    // Convert NSWindow → NSPanel for fullscreen overlay capability.
    #[cfg(target_os = "macos")]
    {
        let panel = bar_window.to_panel::<HUDPanel>()?;
        configure_bar_panel(&panel);
        configure_bar_webview_transparency(&bar_window)?;
    }

    Ok(())
}

fn setup_global_shortcut(app: &tauri::App) -> tauri::Result<()> {
    let app_handle = app.handle().clone();
    let shortcut = app
        .state::<MicToggleShortcutState>()
        .active_shortcut
        .lock()
        .map_err(|_| std::io::Error::other("mic shortcut state is unavailable"))?
        .clone();

    if let Err(error) = register_toggle_mic_shortcut(&app_handle, &shortcut) {
        eprintln!("[global-shortcut] {error}");
        eprintln!("[global-shortcut] Continuing without global shortcut.");
        return Ok(());
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_nspanel::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(MicToggleShortcutState::default())
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
            commands::has_openai_compatible_key,
            commands::save_credentials,
            commands::update_xai_key,
            commands::update_openai_compatible_key,
            commands::update_soniox_key,
            commands::list_models,
            commands::reset_credentials,
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
            commands::get_mic_toggle_shortcut,
            commands::update_mic_toggle_shortcut,
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

#[cfg(test)]
mod shortcut_transaction_tests {
    use super::{apply_mic_toggle_shortcut_update, apply_shortcut_update_transaction};
    use std::cell::RefCell;

    #[test]
    fn keeps_current_registration_when_new_registration_fails() {
        let registered = RefCell::new(vec!["Control+Alt+Super+V".to_string()]);

        let result = apply_shortcut_update_transaction(
            "Control+Alt+Super+V",
            "Control+Alt+Super+M",
            true,
            |shortcut| registered.borrow().iter().any(|item| item == shortcut),
            |shortcut| {
                if shortcut == "Control+Alt+Super+M" {
                    return Err("in use by another app".to_string());
                }
                registered.borrow_mut().push(shortcut.to_string());
                Ok(())
            },
            |shortcut| {
                registered.borrow_mut().retain(|item| item != shortcut);
                Ok(())
            },
        );

        assert!(result.is_err());
        assert!(registered
            .borrow()
            .iter()
            .any(|item| item == "Control+Alt+Super+V"));
    }

    #[test]
    fn replaces_old_shortcut_with_new_shortcut() {
        let registered = RefCell::new(vec!["Control+Alt+Super+V".to_string()]);

        let result = apply_shortcut_update_transaction(
            "Control+Alt+Super+V",
            "Control+Alt+Super+M",
            true,
            |shortcut| registered.borrow().iter().any(|item| item == shortcut),
            |shortcut| {
                if !registered.borrow().iter().any(|item| item == shortcut) {
                    registered.borrow_mut().push(shortcut.to_string());
                }
                Ok(())
            },
            |shortcut| {
                registered.borrow_mut().retain(|item| item != shortcut);
                Ok(())
            },
        );

        assert!(result.is_ok());
        assert!(!registered
            .borrow()
            .iter()
            .any(|item| item == "Control+Alt+Super+V"));
        assert!(registered
            .borrow()
            .iter()
            .any(|item| item == "Control+Alt+Super+M"));
    }

    #[test]
    fn update_lifecycle_keeps_only_selected_shortcut_active() {
        let registered = RefCell::new(vec!["Control+Alt+Super+V".to_string()]);
        let mut active_shortcut = "Control+Alt+Super+V".to_string();

        let result = apply_mic_toggle_shortcut_update(
            &mut active_shortcut,
            "Control+Alt+Super+M",
            true,
            |shortcut| registered.borrow().iter().any(|item| item == shortcut),
            |shortcut| {
                if !registered.borrow().iter().any(|item| item == shortcut) {
                    registered.borrow_mut().push(shortcut.to_string());
                }
                Ok(())
            },
            |shortcut| {
                registered.borrow_mut().retain(|item| item != shortcut);
                Ok(())
            },
        );

        assert_eq!(result, Ok("Control+Alt+Super+M".to_string()));
        assert_eq!(active_shortcut, "Control+Alt+Super+M");
        assert_eq!(registered.borrow().as_slice(), ["Control+Alt+Super+M"]);
    }

    #[test]
    fn rolls_back_to_previous_shortcut_when_unregister_old_fails() {
        let registered = RefCell::new(vec![
            "Control+Alt+Super+V".to_string(),
            "Control+Alt+Super+M".to_string(),
        ]);

        let result = apply_shortcut_update_transaction(
            "Control+Alt+Super+V",
            "Control+Alt+Super+M",
            true,
            |shortcut| registered.borrow().iter().any(|item| item == shortcut),
            |shortcut| {
                if !registered.borrow().iter().any(|item| item == shortcut) {
                    registered.borrow_mut().push(shortcut.to_string());
                }
                Ok(())
            },
            |shortcut| {
                if shortcut == "Control+Alt+Super+V" {
                    return Err("failed to unregister old".to_string());
                }
                registered.borrow_mut().retain(|item| item != shortcut);
                Ok(())
            },
        );

        assert!(result.is_err());
        assert!(registered
            .borrow()
            .iter()
            .any(|item| item == "Control+Alt+Super+V"));
        assert!(!registered
            .borrow()
            .iter()
            .any(|item| item == "Control+Alt+Super+M"));
    }
}
