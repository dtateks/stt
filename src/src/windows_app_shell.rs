use tauri::{AppHandle, Manager, RunEvent, WebviewWindow};

const MAIN_WINDOW_LABEL: &str = "main";

pub fn build_main_window(app: &tauri::App) -> tauri::Result<()> {
    crate::build_main_window(app)
}

pub fn build_bar_window(app: &tauri::App) -> tauri::Result<()> {
    crate::build_bar_window(app)
}

pub fn show_bar(app: &AppHandle, bar_window: &WebviewWindow) -> tauri::Result<()> {
    crate::run_bar_show_sequence(
        || crate::configure_bar_webview_transparency(bar_window),
        || crate::position_bar_window_bottom_center(app, bar_window),
        || bar_window.show(),
        || {
            crate::run_bar_order_front_without_focus_steal(|| {
                order_bar_window_front_without_focus_steal(bar_window)
            })
        },
    )?;

    crate::set_bar_ignores_mouse_events(app, false)
}

pub fn hide_bar(app: &AppHandle) -> tauri::Result<()> {
    crate::hide_bar_panel(app)
}

pub fn set_bar_mouse_events(app: &AppHandle, ignore: bool) -> tauri::Result<()> {
    crate::set_bar_ignores_mouse_events(app, ignore)
}

pub fn show_settings(main_window: &WebviewWindow) -> tauri::Result<()> {
    crate::show_main_window_with_runtime_invariants(main_window)
}

#[cfg(target_os = "windows")]
fn order_bar_window_front_without_focus_steal(bar_window: &WebviewWindow) -> tauri::Result<()> {
    // Tauri's cross-platform window API does not expose the Win32
    // non-activating foreground primitive (SetWindowPos + SWP_NOACTIVATE).
    // The conservative path is to re-assert visibility and top-most ordering
    // without ever calling focus APIs.
    bar_window.show()?;
    bar_window.set_always_on_top(false)?;
    bar_window.set_always_on_top(true)
}

#[cfg(not(target_os = "windows"))]
fn order_bar_window_front_without_focus_steal(_bar_window: &WebviewWindow) -> tauri::Result<()> {
    Ok(())
}

fn reopen_main_window(app: &AppHandle) {
    let Some(main_window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };

    let _ = crate::show_main_window_with_runtime_invariants(&main_window);
}

pub fn handle_runtime_event(app: &AppHandle, event: RunEvent) {
    let _ = app;
    let _ = event;
}
