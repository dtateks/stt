use std::cell::RefCell;
use std::fs;
use std::path::Path;

use tauri::RunEvent;
use voice_to_text_lib::{
    maybe_run_from_args, run_hide_bar_contract, run_runtime_event_contract,
    run_set_bar_mouse_events_contract, run_show_bar_contract, run_show_settings_contract,
};

fn read_project_file(relative_path: &str) -> String {
    let absolute_path = Path::new(env!("CARGO_MANIFEST_DIR")).join(relative_path);
    fs::read_to_string(absolute_path).expect("project file should be readable")
}

#[test]
fn runtime_platform_contract_defines_platform_shell_port_exports() {
    let lib_rs = read_project_file("src/lib.rs");

    assert!(
        lib_rs.contains("mod platform_app_shell;"),
        "lib.rs must declare platform_app_shell module"
    );
    assert!(
        lib_rs.contains("mod macos_app_shell;"),
        "lib.rs must declare macos_app_shell module"
    );
    assert!(
        lib_rs.contains("mod windows_app_shell;"),
        "lib.rs must declare windows_app_shell module"
    );
}

#[test]
fn runtime_platform_contract_defines_app_shell_port_functions() {
    let executed_steps: RefCell<Vec<&str>> = RefCell::new(Vec::new());

    let show_result = run_show_bar_contract(
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
                "show_bar contract must force interactive mouse events"
            );
            executed_steps.borrow_mut().push("set-mouse-events-false");
            Ok::<(), &'static str>(())
        },
    );

    assert!(show_result.is_ok());
    assert_eq!(
        executed_steps.borrow().as_slice(),
        ["show", "set-mouse-events-false"]
    );

    let hide_invocations = RefCell::new(0);
    let hide_result = run_hide_bar_contract(&"app-handle", |app| {
        assert_eq!(*app, "app-handle");
        *hide_invocations.borrow_mut() += 1;
        Ok::<(), &'static str>(())
    });
    assert!(hide_result.is_ok());
    assert_eq!(*hide_invocations.borrow(), 1);

    let ignore_arguments: RefCell<Vec<bool>> = RefCell::new(Vec::new());
    let set_mouse_result = run_set_bar_mouse_events_contract(&"app-handle", true, |app, ignore| {
        assert_eq!(*app, "app-handle");
        ignore_arguments.borrow_mut().push(ignore);
        Ok::<(), &'static str>(())
    });
    assert!(set_mouse_result.is_ok());
    assert_eq!(ignore_arguments.borrow().as_slice(), [true]);

    let show_settings_invocations = RefCell::new(0);
    let show_settings_result = run_show_settings_contract(&"main-window", |window| {
        assert_eq!(*window, "main-window");
        *show_settings_invocations.borrow_mut() += 1;
        Ok::<(), &'static str>(())
    });
    assert!(show_settings_result.is_ok());
    assert_eq!(*show_settings_invocations.borrow(), 1);

    let runtime_event_invocations = RefCell::new(0);
    run_runtime_event_contract(&"app-handle", RunEvent::Ready, |app, event| {
        assert_eq!(*app, "app-handle");
        match event {
            RunEvent::Ready => *runtime_event_invocations.borrow_mut() += 1,
            _ => panic!("runtime event contract must forward the original event"),
        }
    });
    assert_eq!(*runtime_event_invocations.borrow(), 1);
}

#[test]
fn runtime_platform_contract_defines_runtime_info_shape_and_command_wiring() {
    let runtime_info_rs = read_project_file("src/platform_runtime_info.rs");
    let commands_rs = read_project_file("src/commands.rs");
    let build_rs = read_project_file("build.rs");

    for field in [
        "pub os:",
        "pub shortcut_display:",
        "pub permission_flow:",
        "pub background_recovery:",
        "pub supports_fullscreen_hud:",
        "pub requires_privileged_insertion_helper:",
    ] {
        assert!(
            runtime_info_rs.contains(field),
            "PlatformRuntimeInfo must include `{field}`"
        );
    }

    assert!(
        runtime_info_rs.contains("pub fn get_platform_runtime_info() -> PlatformRuntimeInfo"),
        "platform_runtime_info.rs must expose get_platform_runtime_info"
    );
    assert!(
        commands_rs.contains("pub fn get_platform_runtime_info() -> PlatformRuntimeInfo"),
        "commands.rs must expose get_platform_runtime_info as Tauri command"
    );
    assert!(
        build_rs.contains("\"get_platform_runtime_info\""),
        "build.rs must include get_platform_runtime_info in allow-list"
    );
}

#[test]
fn runtime_platform_contract_defines_helper_mode_dispatch_signature() {
    assert_eq!(
        maybe_run_from_args(vec![
            "voice_to_text".to_string(),
            "--helper-mode".to_string(),
        ]),
        Some(0),
        "helper launches must short-circuit with success exit code"
    );

    assert!(
        maybe_run_from_args(vec![
            "voice_to_text".to_string(),
            "--launch-at-login".to_string(),
        ])
        .is_none(),
        "non-helper launches must continue into normal Tauri startup"
    );
}
