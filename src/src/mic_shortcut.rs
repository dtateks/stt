//! Global mic-toggle shortcut: state, registration, update transaction,
//! workspace health observers, and watchdog.
//!
//! Two failure modes drove the health/watchdog architecture, both documented
//! upstream in `artifacts/researches/tauri-plugin-global-shortcut-v2-*` and
//! `tauri-macos-global-shortcut-long-uptime_*`:
//!
//! 1. **System sleep/wake.** The Carbon Event Manager registration goes stale
//!    across suspension. NSWorkspace willSleep/didWake notifications drive
//!    suspend/refresh; the periodic watchdog catches the rare case where the
//!    notification path itself misses an event.
//! 2. **Long continuous runtime.** Even without sleep the handler can drift;
//!    the 30-minute watchdog refresh is a cheap safety net.
//!
//! The update path is a register-then-unregister transaction with explicit
//! rollback so a failed switch never leaves the user with no working shortcut.

use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[cfg(target_os = "macos")]
use block2::RcBlock;
#[cfg(target_os = "macos")]
use objc2_app_kit::{
    NSWorkspace, NSWorkspaceDidWakeNotification, NSWorkspaceSessionDidBecomeActiveNotification,
    NSWorkspaceSessionDidResignActiveNotification, NSWorkspaceWillSleepNotification,
};

pub const DEFAULT_MIC_TOGGLE_SHORTCUT: &str = "Control+Alt+V";
const TOGGLE_MIC_EVENT: &str = "toggle-mic";

pub struct MicToggleShortcutState {
    active_shortcut: Mutex<String>,
}

pub struct PendingMicToggleRequestState {
    pending: Mutex<bool>,
}

impl Default for MicToggleShortcutState {
    fn default() -> Self {
        Self {
            active_shortcut: Mutex::new(DEFAULT_MIC_TOGGLE_SHORTCUT.to_string()),
        }
    }
}

impl Default for PendingMicToggleRequestState {
    fn default() -> Self {
        Self {
            pending: Mutex::new(false),
        }
    }
}

fn lock_error_message() -> String {
    "mic shortcut state is unavailable".to_string()
}

fn pending_toggle_lock_error_message() -> String {
    "pending mic toggle state is unavailable".to_string()
}

fn parse_error_message(shortcut: &str, error: &str) -> String {
    format!(
        "Invalid global shortcut `{shortcut}`. Use an accelerator like `Control+Option+V`. Details: {error}"
    )
}

fn handler_registration_error_message(shortcut: &str, error: &str) -> String {
    format!("Could not attach global shortcut handler for `{shortcut}`: {error}")
}

fn unregister_error_message(shortcut: &str, error: &str) -> String {
    format!("Could not unregister global shortcut `{shortcut}`: {error}")
}

fn consume_pending_toggle_request_state(pending_toggle: &mut bool) -> bool {
    std::mem::take(pending_toggle)
}

fn mark_pending_mic_toggle_request(app: &AppHandle) -> Result<(), String> {
    let pending_state = app.state::<PendingMicToggleRequestState>();
    let mut pending_toggle = pending_state
        .pending
        .lock()
        .map_err(|_| pending_toggle_lock_error_message())?;
    *pending_toggle = true;
    Ok(())
}

pub fn consume_pending_request(app: &AppHandle) -> Result<bool, String> {
    let pending_state = app.state::<PendingMicToggleRequestState>();
    let mut pending_toggle = pending_state
        .pending
        .lock()
        .map_err(|_| pending_toggle_lock_error_message())?;
    Ok(consume_pending_toggle_request_state(&mut pending_toggle))
}

pub fn current(app: &AppHandle) -> Result<String, String> {
    app.state::<MicToggleShortcutState>()
        .active_shortcut
        .lock()
        .map_err(|_| lock_error_message())
        .map(|shortcut| shortcut.clone())
}

#[cfg(target_os = "macos")]
fn run_macos_shortcut_toggle_action<MarkPendingToggle, ShowBarWindow, EmitToggleMic>(
    visible: bool,
    mut mark_pending_toggle: MarkPendingToggle,
    mut show_bar_window: ShowBarWindow,
    mut emit_toggle_mic: EmitToggleMic,
) where
    MarkPendingToggle: FnMut(),
    ShowBarWindow: FnMut(),
    EmitToggleMic: FnMut(),
{
    if !visible {
        mark_pending_toggle();
        show_bar_window();
        return;
    }

    emit_toggle_mic();
}

fn register_toggle_mic_handler(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _, event| {
            if event.state == ShortcutState::Pressed {
                eprintln!("[global-shortcut] toggle fired");
                let Some(bar_window) = app.get_webview_window(crate::bar_window::BAR_WINDOW_LABEL)
                else {
                    return;
                };

                let visible = crate::bar_window::is_bar_currently_visible(app)
                    .unwrap_or_else(|error| {
                    eprintln!("[global-shortcut] visibility query failed: {}", error);
                    false
                });

                eprintln!("[global-shortcut] bar visible: {}", visible);

                #[cfg(target_os = "macos")]
                run_macos_shortcut_toggle_action(
                    visible,
                    || {
                        if let Err(error) = mark_pending_mic_toggle_request(app) {
                            eprintln!("[global-shortcut] pending-toggle mark failed: {}", error);
                        }
                    },
                    || {
                        if let Err(error) = crate::platform_app_shell::show_bar(app, &bar_window) {
                            eprintln!("[global-shortcut] show_bar failed: {}", error);
                        }
                    },
                    || {
                        if let Err(error) = bar_window.emit(TOGGLE_MIC_EVENT, ()) {
                            eprintln!("[global-shortcut] emit failed: {}", error);
                        }
                    },
                );

                #[cfg(not(target_os = "macos"))]
                {
                    if !visible {
                        if let Err(error) = crate::platform_app_shell::show_bar(app, &bar_window) {
                            eprintln!("[global-shortcut] show_bar failed: {}", error);
                        }
                    }

                    if let Err(error) = bar_window.emit(TOGGLE_MIC_EVENT, ()) {
                        eprintln!("[global-shortcut] emit failed: {}", error);
                    }
                }
            }
        })
        .map_err(|error| handler_registration_error_message(shortcut, &error.to_string()))
}

fn unregister_toggle_mic_shortcut(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    let global_shortcut = app.global_shortcut();
    if global_shortcut.is_registered(shortcut) {
        global_shortcut
            .unregister(shortcut)
            .map_err(|error| unregister_error_message(shortcut, &error.to_string()))?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn suspend_toggle_mic_shortcut(app: &AppHandle) -> Result<(), String> {
    let shortcut = current(app)?;
    unregister_toggle_mic_shortcut(app, &shortcut)
}

/// Re-register the active mic-toggle shortcut handler.
///
/// `tauri-plugin-global-shortcut` on macOS hooks the Carbon Event Manager.
/// After system sleep/wake cycles — or after prolonged runtime — the OS-level
/// handler can silently stop firing even though the plugin still reports the
/// shortcut as registered. Unregistering and re-attaching the handler restores
/// event delivery. This is the only reliable recovery path short of restarting
/// the process.
fn refresh_toggle_mic_shortcut(app: &AppHandle) -> Result<(), String> {
    let shortcut = current(app)?;

    if let Err(error) = unregister_toggle_mic_shortcut(app, &shortcut) {
        eprintln!(
            "[global-shortcut] refresh: unregister of `{}` failed (continuing): {}",
            shortcut, error
        );
    }
    register_toggle_mic_handler(app, &shortcut)
}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ShortcutHealthEvent {
    WillSleep,
    DidWake,
    SessionDidBecomeActive,
    SessionDidResignActive,
}

#[cfg(target_os = "macos")]
impl ShortcutHealthEvent {
    fn label(self) -> &'static str {
        match self {
            Self::WillSleep => "workspace-will-sleep",
            Self::DidWake => "workspace-did-wake",
            Self::SessionDidBecomeActive => "workspace-session-did-become-active",
            Self::SessionDidResignActive => "workspace-session-did-resign-active",
        }
    }
}

#[cfg(target_os = "macos")]
fn run_macos_shortcut_health_event<RefreshShortcut, SuspendShortcut>(
    event: ShortcutHealthEvent,
    mut refresh_shortcut: RefreshShortcut,
    mut suspend_shortcut: SuspendShortcut,
) -> Result<(), String>
where
    RefreshShortcut: FnMut() -> Result<(), String>,
    SuspendShortcut: FnMut() -> Result<(), String>,
{
    match event {
        ShortcutHealthEvent::WillSleep | ShortcutHealthEvent::SessionDidResignActive => {
            suspend_shortcut()
        }
        ShortcutHealthEvent::DidWake | ShortcutHealthEvent::SessionDidBecomeActive => {
            refresh_shortcut()
        }
    }
}

#[cfg(target_os = "macos")]
fn handle_macos_shortcut_health_event(app: &AppHandle, event: ShortcutHealthEvent) {
    let label = event.label();
    let result = run_macos_shortcut_health_event(
        event,
        || {
            eprintln!("[global-shortcut] {}: refreshing handler", label);
            refresh_toggle_mic_shortcut(app)
        },
        || {
            eprintln!("[global-shortcut] {}: suspending handler", label);
            suspend_toggle_mic_shortcut(app)
        },
    );

    if let Err(error) = result {
        eprintln!("[global-shortcut] {} failed: {}", label, error);
    }
}

#[cfg(target_os = "macos")]
fn install_workspace_observers(app: &tauri::App) {
    let notification_center = NSWorkspace::sharedWorkspace().notificationCenter();

    let will_sleep_app = app.handle().clone();
    let will_sleep_observer = RcBlock::new(move |_| {
        handle_macos_shortcut_health_event(&will_sleep_app, ShortcutHealthEvent::WillSleep);
    });
    unsafe {
        let _ = notification_center.addObserverForName_object_queue_usingBlock(
            Some(NSWorkspaceWillSleepNotification),
            None,
            None,
            &will_sleep_observer,
        );
    }

    let did_wake_app = app.handle().clone();
    let did_wake_observer = RcBlock::new(move |_| {
        handle_macos_shortcut_health_event(&did_wake_app, ShortcutHealthEvent::DidWake);
    });
    unsafe {
        let _ = notification_center.addObserverForName_object_queue_usingBlock(
            Some(NSWorkspaceDidWakeNotification),
            None,
            None,
            &did_wake_observer,
        );
    }

    let session_active_app = app.handle().clone();
    let session_active_observer = RcBlock::new(move |_| {
        handle_macos_shortcut_health_event(
            &session_active_app,
            ShortcutHealthEvent::SessionDidBecomeActive,
        );
    });
    unsafe {
        let _ = notification_center.addObserverForName_object_queue_usingBlock(
            Some(NSWorkspaceSessionDidBecomeActiveNotification),
            None,
            None,
            &session_active_observer,
        );
    }

    let session_resign_app = app.handle().clone();
    let session_resign_observer = RcBlock::new(move |_| {
        handle_macos_shortcut_health_event(
            &session_resign_app,
            ShortcutHealthEvent::SessionDidResignActive,
        );
    });
    unsafe {
        let _ = notification_center.addObserverForName_object_queue_usingBlock(
            Some(NSWorkspaceSessionDidResignActiveNotification),
            None,
            None,
            &session_resign_observer,
        );
    }
}

fn spawn_watchdog(app_handle: AppHandle) {
    const TICK_INTERVAL: Duration = Duration::from_secs(60);
    const WAKE_DRIFT_THRESHOLD: Duration = Duration::from_secs(120);
    const PERIODIC_REFRESH_INTERVAL: Duration = Duration::from_secs(30 * 60);

    std::thread::Builder::new()
        .name("global-shortcut-watchdog".into())
        .spawn(move || {
            let mut last_tick = Instant::now();
            let mut last_refresh = Instant::now();

            loop {
                std::thread::sleep(TICK_INTERVAL);
                let now = Instant::now();
                let since_last_tick = now.duration_since(last_tick);
                last_tick = now;

                let woke_from_sleep = since_last_tick > WAKE_DRIFT_THRESHOLD;
                let periodic_due = now.duration_since(last_refresh) >= PERIODIC_REFRESH_INTERVAL;

                if !woke_from_sleep && !periodic_due {
                    continue;
                }

                if woke_from_sleep {
                    eprintln!(
                        "[global-shortcut] process suspension detected ({:?}); refreshing handler",
                        since_last_tick
                    );
                } else {
                    eprintln!("[global-shortcut] periodic refresh");
                }

                match refresh_toggle_mic_shortcut(&app_handle) {
                    Ok(()) => {
                        last_refresh = now;
                    }
                    Err(error) => {
                        eprintln!("[global-shortcut] watchdog refresh failed: {}", error);
                    }
                }
            }
        })
        .expect("global-shortcut watchdog thread must spawn");
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

pub fn update(app: &AppHandle, requested_shortcut: &str) -> Result<String, String> {
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
    let current_is_registered = app
        .global_shortcut()
        .is_registered(active_shortcut.as_str());

    apply_mic_toggle_shortcut_update(
        &mut active_shortcut,
        next_shortcut,
        current_is_registered,
        |shortcut| app.global_shortcut().is_registered(shortcut),
        |shortcut| register_toggle_mic_handler(app, shortcut),
        |shortcut| {
            app.global_shortcut()
                .unregister(shortcut)
                .map_err(|error| unregister_error_message(shortcut, &error.to_string()))
        },
    )
}

pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    let app_handle = app.handle().clone();
    let shortcut = app
        .state::<MicToggleShortcutState>()
        .active_shortcut
        .lock()
        .map_err(|_| std::io::Error::other("mic shortcut state is unavailable"))?
        .clone();

    if let Err(error) = register_toggle_mic_handler(&app_handle, &shortcut) {
        eprintln!("[global-shortcut] {error}");
        eprintln!("[global-shortcut] Continuing without global shortcut.");
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    install_workspace_observers(app);
    spawn_watchdog(app_handle);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn keeps_current_registration_when_new_registration_fails() {
        let registered = RefCell::new(vec!["Control+Alt+V".to_string()]);

        let result = apply_shortcut_update_transaction(
            "Control+Alt+V",
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
            .any(|item| item == "Control+Alt+V"));
    }

    #[test]
    fn replaces_old_shortcut_with_new_shortcut() {
        let registered = RefCell::new(vec!["Control+Alt+V".to_string()]);

        let result = apply_shortcut_update_transaction(
            "Control+Alt+V",
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
            .any(|item| item == "Control+Alt+V"));
        assert!(registered
            .borrow()
            .iter()
            .any(|item| item == "Control+Alt+Super+M"));
    }

    #[test]
    fn update_lifecycle_keeps_only_selected_shortcut_active() {
        let registered = RefCell::new(vec!["Control+Alt+V".to_string()]);
        let mut active_shortcut = "Control+Alt+V".to_string();

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
            "Control+Alt+V".to_string(),
            "Control+Alt+Super+M".to_string(),
        ]);

        let result = apply_shortcut_update_transaction(
            "Control+Alt+V",
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
                if shortcut == "Control+Alt+V" {
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
            .any(|item| item == "Control+Alt+V"));
        assert!(!registered
            .borrow()
            .iter()
            .any(|item| item == "Control+Alt+Super+M"));
    }

    #[test]
    fn consume_pending_toggle_request_returns_true_once() {
        let mut pending_toggle = true;

        assert!(consume_pending_toggle_request_state(&mut pending_toggle));
        assert!(!consume_pending_toggle_request_state(&mut pending_toggle));
    }
}

#[cfg(all(test, target_os = "macos"))]
mod macos_tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn macos_shortcut_hidden_bar_marks_pending_and_shows_without_emit() {
        let executed_steps: RefCell<Vec<&str>> = RefCell::new(Vec::new());

        run_macos_shortcut_toggle_action(
            false,
            || executed_steps.borrow_mut().push("mark-pending"),
            || executed_steps.borrow_mut().push("show-bar"),
            || executed_steps.borrow_mut().push("emit-toggle"),
        );

        assert_eq!(executed_steps.into_inner(), vec!["mark-pending", "show-bar"]);
    }

    #[test]
    fn macos_shortcut_visible_bar_emits_without_mark_or_show() {
        let executed_steps: RefCell<Vec<&str>> = RefCell::new(Vec::new());

        run_macos_shortcut_toggle_action(
            true,
            || executed_steps.borrow_mut().push("mark-pending"),
            || executed_steps.borrow_mut().push("show-bar"),
            || executed_steps.borrow_mut().push("emit-toggle"),
        );

        assert_eq!(executed_steps.into_inner(), vec!["emit-toggle"]);
    }

    #[test]
    fn workspace_wake_and_session_resume_refresh_shortcut_handler() {
        for event in [
            ShortcutHealthEvent::DidWake,
            ShortcutHealthEvent::SessionDidBecomeActive,
        ] {
            let executed_steps: RefCell<Vec<&str>> = RefCell::new(Vec::new());

            let result = run_macos_shortcut_health_event(
                event,
                || {
                    executed_steps.borrow_mut().push("refresh");
                    Ok(())
                },
                || {
                    executed_steps.borrow_mut().push("suspend");
                    Ok(())
                },
            );

            assert!(result.is_ok());
            assert_eq!(executed_steps.into_inner(), vec!["refresh"]);
        }
    }

    #[test]
    fn workspace_sleep_and_session_resign_suspend_shortcut_handler() {
        for event in [
            ShortcutHealthEvent::WillSleep,
            ShortcutHealthEvent::SessionDidResignActive,
        ] {
            let executed_steps: RefCell<Vec<&str>> = RefCell::new(Vec::new());

            let result = run_macos_shortcut_health_event(
                event,
                || {
                    executed_steps.borrow_mut().push("refresh");
                    Ok(())
                },
                || {
                    executed_steps.borrow_mut().push("suspend");
                    Ok(())
                },
            );

            assert!(result.is_ok());
            assert_eq!(executed_steps.into_inner(), vec!["suspend"]);
        }
    }
}
