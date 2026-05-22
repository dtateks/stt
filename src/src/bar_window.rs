//! Floating HUD bar window: build, position, show/hide, transparency,
//! mouse-event passthrough, and visibility detection.
//!
//! macOS notes (load-bearing — see recent commits a0c4d3be, e4986bb1):
//! - Visibility is the dual check (AppKit `isVisible` + CoreGraphics
//!   on-screen window list). The plain `panel.is_visible()` mirror can stay
//!   stuck on `true` when WindowServer hides the panel via paths that bypass
//!   our flip (screen lock, fast user switch, session resign-active, Space
//!   switch, WebContent suspension). `is_bar_currently_visible` reads both
//!   and treats either-missing as hidden.
//! - The show sequence MUST run configure-then-position-then-show-then-front
//!   to avoid an opaque flash. The runtime configuration sub-sequence
//!   (panel + WKWebView transparency) re-asserts on every show because the
//!   webview can drop its transparency state.
//! - `panel.set_ignores_mouse_events(...)` controls whole-window
//!   click-through; per-control hit-testing is not available, so the HUD
//!   stays INTERACTIVE while visible and only flips to PASSIVE on hide/stop.
//! - Monitor scale-factor must be applied before comparing logical HUD size
//!   to physical monitor size; positioning prefers the focused screen and
//!   only falls back to cursor/global mouse location when focus lookup fails.

use tauri::{
    AppHandle, PhysicalPosition, PhysicalSize, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

#[cfg(target_os = "macos")]
use core_graphics::display::CGDisplayBounds;
#[cfg(target_os = "macos")]
use core_graphics::event::CGEvent;
#[cfg(target_os = "macos")]
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
#[cfg(target_os = "macos")]
use core_graphics::window::{create_window_list, kCGNullWindowID, kCGWindowListOptionOnScreenOnly};
#[cfg(target_os = "macos")]
use objc2::msg_send;
#[cfg(target_os = "macos")]
use objc2::runtime::AnyObject;
#[cfg(target_os = "macos")]
use objc2::MainThreadMarker;
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSColor, NSScreen, NSWindowCollectionBehavior};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSNumber, NSString};
#[cfg(target_os = "macos")]
use objc2_web_kit::WKWebView;

#[cfg(target_os = "macos")]
use tauri_nspanel::{ManagerExt, WebviewWindowExt};

pub(crate) const BAR_WINDOW_LABEL: &str = "bar";
const BAR_WINDOW_WIDTH: f64 = 600.0;
const BAR_WINDOW_HEIGHT: f64 = 56.0;
const BAR_BOTTOM_OFFSET_PX: i32 = 40;
const BAR_WINDOW_CORNER_RADIUS: f64 = 24.0;

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

#[cfg(target_os = "macos")]
pub(crate) fn is_bar_currently_visible(app: &AppHandle) -> Result<bool, String> {
    let panel = app
        .get_webview_panel(BAR_WINDOW_LABEL)
        .map_err(|error| format!("bar panel not found: {error:?}"))?;

    let appkit_visible = panel.is_visible();
    let panel_window_is_onscreen = appkit_visible
        .then(|| is_panel_window_in_onscreen_list(&panel))
        .flatten();

    if appkit_visible && panel_window_is_onscreen == Some(false) {
        eprintln!(
            "[global-shortcut] bar panel is AppKit-visible but absent from CG on-screen window list"
        );
    }

    if appkit_visible && panel_window_is_onscreen.is_none() {
        eprintln!("[global-shortcut] bar panel on-screen state unavailable; treating as hidden");
    }

    Ok(bar_is_user_presented(
        appkit_visible,
        panel_window_is_onscreen,
    ))
}

#[cfg(target_os = "macos")]
fn bar_is_user_presented(appkit_visible: bool, panel_window_is_onscreen: Option<bool>) -> bool {
    appkit_visible && panel_window_is_onscreen == Some(true)
}

#[cfg(target_os = "macos")]
fn panel_window_number(panel: &tauri_nspanel::PanelHandle<tauri::Wry>) -> Option<u32> {
    let window_number = panel.as_panel().windowNumber();
    if window_number <= 0 {
        return None;
    }

    Some(window_number as u32)
}

#[cfg(target_os = "macos")]
fn is_panel_window_in_onscreen_list(
    panel: &tauri_nspanel::PanelHandle<tauri::Wry>,
) -> Option<bool> {
    let window_number = panel_window_number(panel)?;
    let onscreen_windows = create_window_list(kCGWindowListOptionOnScreenOnly, kCGNullWindowID)?;
    let onscreen_window_numbers = onscreen_windows
        .iter()
        .map(|window_number| *window_number)
        .collect::<Vec<_>>();

    Some(window_number_is_in_window_list(
        window_number,
        &onscreen_window_numbers,
    ))
}

#[cfg(target_os = "macos")]
fn window_number_is_in_window_list(window_number: u32, window_numbers: &[u32]) -> bool {
    window_numbers.contains(&window_number)
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn is_bar_currently_visible(app: &AppHandle) -> Result<bool, String> {
    let bar_window = app
        .get_webview_window(BAR_WINDOW_LABEL)
        .ok_or_else(|| "bar window not found".to_string())?;
    bar_window
        .is_visible()
        .map_err(|error| format!("bar window visibility unavailable: {error}"))
}

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

pub fn run_macos_bar_runtime_configuration_sequence<ConfigureBarPanel, ConfigureBarWebview>(
    mut configure_bar_panel: ConfigureBarPanel,
    mut configure_bar_webview: ConfigureBarWebview,
) -> tauri::Result<()>
where
    ConfigureBarPanel: FnMut(),
    ConfigureBarWebview: FnMut() -> tauri::Result<()>,
{
    configure_bar_panel();
    configure_bar_webview()?;
    Ok(())
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

#[cfg(target_os = "macos")]
fn run_bar_order_front_attempt(app: &AppHandle, bar_window: &WebviewWindow) -> tauri::Result<()> {
    let panel = app
        .get_webview_panel(BAR_WINDOW_LABEL)
        .map_err(|_| std::io::Error::other("bar panel not found"))?;

    run_bar_show_sequence(
        || {
            run_macos_bar_runtime_configuration_sequence(
                || configure_bar_panel(&panel),
                || configure_bar_webview_transparency(bar_window),
            )
        },
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

#[cfg(target_os = "macos")]
pub(crate) fn show_bar_window_with_runtime_invariants(
    app: &AppHandle,
    bar_window: &WebviewWindow,
) -> tauri::Result<()> {
    run_bar_order_front_attempt(app, bar_window)
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn show_bar_window_with_runtime_invariants(
    app: &AppHandle,
    bar_window: &WebviewWindow,
) -> tauri::Result<()> {
    run_bar_show_sequence(
        || configure_bar_webview_transparency(bar_window),
        || position_bar_window_bottom_center(app, bar_window),
        || bar_window.show(),
        || bar_window.set_always_on_top(true),
    )?;

    Ok(())
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
    bar_window.hide()?;
    Ok(())
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

#[cfg(target_os = "macos")]
fn monitor_from_focused_screen(app: &AppHandle) -> Option<tauri::Monitor> {
    let mtm = MainThreadMarker::new()?;
    let screen = NSScreen::mainScreen(mtm)?;
    let display_id = screen.CGDirectDisplayID();
    if display_id == 0 {
        return None;
    }

    let bounds = unsafe { CGDisplayBounds(display_id) };
    let center_x = bounds.origin.x + bounds.size.width / 2.0;
    let center_y = bounds.origin.y + bounds.size.height / 2.0;

    app.monitor_from_point(center_x, center_y)
        .ok()
        .and_then(|monitor| monitor)
}

#[cfg(not(target_os = "macos"))]
fn monitor_from_focused_screen(_app: &AppHandle) -> Option<tauri::Monitor> {
    None
}

fn monitor_from_cursor(app: &AppHandle) -> Option<tauri::Monitor> {
    app.cursor_position()
        .ok()
        .and_then(|cursor| {
            app.monitor_from_point(cursor.x, cursor.y)
                .ok()
                .and_then(|monitor| monitor)
        })
        .or_else(|| monitor_from_global_mouse_location(app))
}

fn select_bar_monitor<Monitor, FocusedMonitor, CursorMonitor, PrimaryMonitor>(
    focused_monitor: FocusedMonitor,
    cursor_monitor: CursorMonitor,
    primary_monitor: PrimaryMonitor,
) -> Option<Monitor>
where
    FocusedMonitor: FnOnce() -> Option<Monitor>,
    CursorMonitor: FnOnce() -> Option<Monitor>,
    PrimaryMonitor: FnOnce() -> Option<Monitor>,
{
    focused_monitor()
        .or_else(cursor_monitor)
        .or_else(primary_monitor)
}

#[derive(Clone, Debug, PartialEq)]
struct BarMonitorGeometry {
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    scale_factor: f64,
}

impl From<&tauri::Monitor> for BarMonitorGeometry {
    fn from(monitor: &tauri::Monitor) -> Self {
        Self {
            position: *monitor.position(),
            size: *monitor.size(),
            scale_factor: monitor.scale_factor(),
        }
    }
}

fn bar_position_for_monitor(monitor: &BarMonitorGeometry) -> PhysicalPosition<i32> {
    let scale = monitor.scale_factor;
    let monitor_position = monitor.position;
    let monitor_width = i64::from(monitor.size.width);
    let monitor_height = i64::from(monitor.size.height);

    let bar_width_physical = (BAR_WINDOW_WIDTH * scale) as i64;
    let bar_height_physical = (BAR_WINDOW_HEIGHT * scale) as i64;
    let bottom_offset_physical = (f64::from(BAR_BOTTOM_OFFSET_PX) * scale) as i64;

    let centered_x = ((monitor_width - bar_width_physical).max(0)) / 2;
    let x = i64::from(monitor_position.x) + centered_x;
    let y = i64::from(monitor_position.y)
        + (monitor_height - bar_height_physical - bottom_offset_physical).max(0);

    PhysicalPosition::new(x as i32, y as i32)
}

pub(crate) fn position_bar_window_bottom_center(
    app: &AppHandle,
    bar_window: &WebviewWindow,
) -> tauri::Result<()> {
    let monitor = select_bar_monitor(
        || monitor_from_focused_screen(app),
        || monitor_from_cursor(app),
        || app.primary_monitor().ok().flatten(),
    );

    if let Some(monitor) = monitor {
        let geometry = BarMonitorGeometry::from(&monitor);
        bar_window.set_position(bar_position_for_monitor(&geometry))?;
    }

    Ok(())
}

pub(crate) fn build_bar_window(app: &tauri::App) -> tauri::Result<()> {
    let window_config = crate::get_window_config(app, BAR_WINDOW_LABEL)?;
    let bar_window = WebviewWindowBuilder::from_config(app, window_config)?
        .initialization_script(include_str!("../../ui/tauri-bridge.js"))
        .build()?;

    let app_handle_for_events = app.handle().clone();
    bar_window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            if let Err(error) = run_bar_close_request_sequence(
                || api.prevent_close(),
                || hide_bar_panel(&app_handle_for_events),
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

    #[test]
    fn onscreen_window_list_presence_uses_panel_window_number() {
        assert!(window_number_is_in_window_list(217622, &[100, 217622, 300]));
        assert!(!window_number_is_in_window_list(217622, &[100, 200, 300]));
    }

    #[test]
    fn bar_user_presented_requires_appkit_visibility_and_cg_onscreen_presence() {
        assert!(!bar_is_user_presented(false, Some(true)));
        assert!(bar_is_user_presented(true, Some(true)));
        assert!(!bar_is_user_presented(true, Some(false)));
        assert!(!bar_is_user_presented(true, None));
    }
}

#[cfg(test)]
mod positioning_tests {
    use super::*;

    #[test]
    fn bar_monitor_selection_prefers_focused_screen_over_cursor_screen() {
        let selected =
            select_bar_monitor(|| Some("focused"), || Some("cursor"), || Some("primary"));

        assert_eq!(selected, Some("focused"));
    }

    #[test]
    fn bar_monitor_selection_keeps_cursor_and_primary_fallbacks() {
        let selected_from_cursor =
            select_bar_monitor(|| None, || Some("cursor"), || Some("primary"));
        let selected_from_primary = select_bar_monitor(|| None, || None, || Some("primary"));

        assert_eq!(selected_from_cursor, Some("cursor"));
        assert_eq!(selected_from_primary, Some("primary"));
    }

    #[test]
    fn bar_position_uses_scaled_hud_size_inside_selected_monitor() {
        let monitor = BarMonitorGeometry {
            position: PhysicalPosition::new(3024, 0),
            size: PhysicalSize::new(3456, 2234),
            scale_factor: 2.0,
        };

        assert_eq!(
            bar_position_for_monitor(&monitor),
            PhysicalPosition::new(4152, 2042)
        );
    }
}
