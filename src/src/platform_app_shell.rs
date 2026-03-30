use tauri::{AppHandle, RunEvent, WebviewWindow};

#[cfg(target_os = "macos")]
use crate::macos_app_shell as platform_shell;
#[cfg(not(target_os = "macos"))]
use crate::windows_app_shell as platform_shell;

pub fn run_show_bar_contract<App, Window, Error, ShowBarWindow, SetBarMouseEvents>(
    app: &App,
    bar_window: &Window,
    mut show_bar_window: ShowBarWindow,
    mut set_bar_mouse_events: SetBarMouseEvents,
) -> Result<(), Error>
where
    ShowBarWindow: FnMut(&App, &Window) -> Result<(), Error>,
    SetBarMouseEvents: FnMut(&App, bool) -> Result<(), Error>,
{
    show_bar_window(app, bar_window)?;
    set_bar_mouse_events(app, false)
}

pub fn run_hide_bar_contract<App, Error, HideBar>(
    app: &App,
    mut hide_bar: HideBar,
) -> Result<(), Error>
where
    HideBar: FnMut(&App) -> Result<(), Error>,
{
    hide_bar(app)
}

pub fn run_set_bar_mouse_events_contract<App, Error, SetBarMouseEvents>(
    app: &App,
    ignore: bool,
    mut set_bar_mouse_events: SetBarMouseEvents,
) -> Result<(), Error>
where
    SetBarMouseEvents: FnMut(&App, bool) -> Result<(), Error>,
{
    set_bar_mouse_events(app, ignore)
}

pub fn run_show_settings_contract<Window, Error, ShowSettings>(
    main_window: &Window,
    mut show_settings: ShowSettings,
) -> Result<(), Error>
where
    ShowSettings: FnMut(&Window) -> Result<(), Error>,
{
    show_settings(main_window)
}

pub fn run_runtime_event_contract<App, HandleRuntimeEvent>(
    app: &App,
    event: RunEvent,
    mut handle_runtime_event: HandleRuntimeEvent,
) where
    HandleRuntimeEvent: FnMut(&App, RunEvent),
{
    handle_runtime_event(app, event)
}

pub fn build_main_window(app: &tauri::App) -> tauri::Result<()> {
    platform_shell::build_main_window(app)
}

pub fn build_bar_window(app: &tauri::App) -> tauri::Result<()> {
    platform_shell::build_bar_window(app)
}

pub fn show_bar(app: &AppHandle, bar_window: &WebviewWindow) -> tauri::Result<()> {
    run_show_bar_contract(
        app,
        bar_window,
        platform_shell::show_bar,
        platform_shell::set_bar_mouse_events,
    )
}

pub fn hide_bar(app: &AppHandle) -> tauri::Result<()> {
    run_hide_bar_contract(app, platform_shell::hide_bar)
}

pub fn set_bar_mouse_events(app: &AppHandle, ignore: bool) -> tauri::Result<()> {
    run_set_bar_mouse_events_contract(app, ignore, platform_shell::set_bar_mouse_events)
}

pub fn show_settings(main_window: &WebviewWindow) -> tauri::Result<()> {
    run_show_settings_contract(main_window, platform_shell::show_settings)
}

pub fn handle_runtime_event(app: &AppHandle, event: RunEvent) {
    run_runtime_event_contract(app, event, platform_shell::handle_runtime_event)
}
