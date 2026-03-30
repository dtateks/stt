use tauri::{AppHandle, RunEvent, WebviewWindow};

pub fn build_main_window(app: &tauri::App) -> tauri::Result<()> {
    crate::build_main_window(app)
}

pub fn build_bar_window(app: &tauri::App) -> tauri::Result<()> {
    crate::build_bar_window(app)
}

pub fn show_bar(app: &AppHandle, bar_window: &WebviewWindow) -> tauri::Result<()> {
    crate::show_bar_window_with_runtime_invariants(app, bar_window)?;
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

pub fn handle_runtime_event(app: &AppHandle, event: RunEvent) {
    crate::handle_macos_runtime_event(app, event);
}
