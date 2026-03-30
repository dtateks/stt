use std::cell::RefCell;

use voice_to_text_lib::{
    run_bar_order_front_without_focus_steal, run_hide_bar_contract,
    run_set_bar_mouse_events_contract, run_show_bar_contract, run_windows_reopen_window_sequence,
};

#[test]
fn windows_shell_runtime_show_bar_contract_keeps_show_then_interactive_mouse() {
    let executed_steps: RefCell<Vec<&str>> = RefCell::new(Vec::new());

    let result = run_show_bar_contract(
        &"app-handle",
        &"bar-window",
        |app, window| {
            assert_eq!(*app, "app-handle");
            assert_eq!(*window, "bar-window");
            executed_steps.borrow_mut().push("show");
            Ok::<(), &'static str>(())
        },
        |app, ignore| {
            assert_eq!(*app, "app-handle");
            assert!(
                !ignore,
                "show_bar contract must end in interactive mode for the HUD"
            );
            executed_steps.borrow_mut().push("set-mouse-events-false");
            Ok::<(), &'static str>(())
        },
    );

    assert!(result.is_ok());
    assert_eq!(
        executed_steps.into_inner(),
        vec!["show", "set-mouse-events-false"]
    );
}

#[test]
fn windows_shell_runtime_contract_forwards_hide_and_mouse_toggle_requests() {
    let hide_steps: RefCell<Vec<&str>> = RefCell::new(Vec::new());
    let hide_result = run_hide_bar_contract(&"app-handle", |app| {
        assert_eq!(*app, "app-handle");
        hide_steps.borrow_mut().push("hide");
        Ok::<(), &'static str>(())
    });

    assert!(hide_result.is_ok());
    assert_eq!(hide_steps.into_inner(), vec!["hide"]);

    let ignore_arguments: RefCell<Vec<bool>> = RefCell::new(Vec::new());
    let set_mouse_result = run_set_bar_mouse_events_contract(&"app-handle", true, |app, ignore| {
        assert_eq!(*app, "app-handle");
        ignore_arguments.borrow_mut().push(ignore);
        Ok::<(), &'static str>(())
    });

    assert!(set_mouse_result.is_ok());
    assert_eq!(ignore_arguments.into_inner(), vec![true]);
}

#[test]
fn windows_shell_runtime_reopen_gate_only_reopens_when_all_windows_are_hidden() {
    let executed_steps: RefCell<Vec<&str>> = RefCell::new(Vec::new());

    run_windows_reopen_window_sequence(false, || {
        executed_steps.borrow_mut().push("reopen-main-window");
    });
    run_windows_reopen_window_sequence(true, || {
        executed_steps.borrow_mut().push("should-not-run");
    });

    assert_eq!(executed_steps.into_inner(), vec!["reopen-main-window"]);
}

#[test]
fn windows_shell_runtime_foreground_step_keeps_non_activating_contract() {
    let executed_steps: RefCell<Vec<&str>> = RefCell::new(Vec::new());

    let result = run_bar_order_front_without_focus_steal(|| {
        executed_steps
            .borrow_mut()
            .push("order-front-without-focus");
        Ok::<(), tauri::Error>(())
    });

    assert!(result.is_ok());
    assert_eq!(
        executed_steps.into_inner(),
        vec!["order-front-without-focus"]
    );
}
