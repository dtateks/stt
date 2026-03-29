use std::fs;
use std::path::Path;

use serde_json::Value;
use voice_to_text_lib::{
    run_bar_close_request_sequence, run_bar_show_sequence, run_main_close_request_sequence,
};

const CORE_DEFAULT_PERMISSION: &str = "core:default";
const DEFAULT_CAPABILITY: &str = "default";
const BAR_CAPABILITY: &str = "bar";
const MAIN_WINDOW_LABEL: &str = "main";
const BAR_WINDOW_LABEL: &str = "bar";
const MAIN_REQUIRED_APP_PERMISSIONS: [&str; 26] = [
    "allow-get-config",
    "allow-get-soniox-key",
    "allow-has-xai-key",
    "allow-has-openai-compatible-key",
    "allow-save-credentials",
    "allow-update-xai-key",
    "allow-update-openai-compatible-key",
    "allow-update-soniox-key",
    "allow-list-models",
    "allow-reset-credentials",
    "allow-ensure-microphone-permission",
    "allow-ensure-accessibility-permission",
    "allow-ensure-text-insertion-permission",
    "allow-check-permissions-status",
    "allow-insert-text",
    "allow-correct-transcript",
    "allow-set-mic-state",
    "allow-copy-to-clipboard",
    "allow-quit-app",
    "allow-relaunch-app",
    "allow-show-bar",
    "allow-hide-bar",
    "allow-set-mouse-events",
    "allow-show-settings",
    "allow-get-mic-toggle-shortcut",
    "allow-update-mic-toggle-shortcut",
];
const BAR_REQUIRED_APP_PERMISSIONS: [&str; 13] = [
    "allow-get-config",
    "allow-get-soniox-key",
    "allow-has-xai-key",
    "allow-has-openai-compatible-key",
    "allow-ensure-microphone-permission",
    "allow-ensure-accessibility-permission",
    "allow-insert-text",
    "allow-correct-transcript",
    "allow-set-mic-state",
    "allow-show-bar",
    "allow-hide-bar",
    "allow-set-mouse-events",
    "allow-show-settings",
];
const UNUSED_PLUGIN_SHELL: &str = "tauri-plugin-shell";
const UNUSED_PLUGIN_HTTP: &str = "tauri-plugin-http";
const UNUSED_PLUGIN_CLIPBOARD: &str = "tauri-plugin-clipboard-manager";
const UNUSED_PLUGIN_SHELL_INIT: &str = "tauri_plugin_shell::init";
const UNUSED_PLUGIN_HTTP_INIT: &str = "tauri_plugin_http::init";
const UNUSED_PLUGIN_CLIPBOARD_INIT: &str = "tauri_plugin_clipboard_manager::init";

fn read_project_file(relative_path: &str) -> String {
    let absolute_path = Path::new(env!("CARGO_MANIFEST_DIR")).join(relative_path);
    fs::read_to_string(absolute_path).expect("project file should be readable")
}

fn read_json(relative_path: &str) -> Value {
    serde_json::from_str(&read_project_file(relative_path)).expect("json should parse")
}

#[test]
fn tauri_config_keeps_window_and_packaging_runtime_invariants() {
    let config = read_json("tauri.conf.json");
    let app = config.get("app").expect("app config should exist");
    let windows = app
        .get("windows")
        .and_then(Value::as_array)
        .expect("app.windows should be an array");

    assert_eq!(
        windows
            .iter()
            .filter(|window| {
                window
                    .get("label")
                    .and_then(Value::as_str)
                    .is_some_and(|label| label == MAIN_WINDOW_LABEL)
            })
            .count(),
        1,
        "main window must be declared exactly once"
    );
    assert_eq!(
        windows
            .iter()
            .filter(|window| {
                window
                    .get("label")
                    .and_then(Value::as_str)
                    .is_some_and(|label| label == BAR_WINDOW_LABEL)
            })
            .count(),
        1,
        "bar window must be declared exactly once"
    );

    let main = windows
        .iter()
        .find(|window| window.get("label").and_then(Value::as_str) == Some(MAIN_WINDOW_LABEL))
        .expect("main window should exist");
    assert_eq!(main.get("create").and_then(Value::as_bool), Some(false));
    assert_eq!(main.get("visible").and_then(Value::as_bool), Some(true));

    let bar = windows
        .iter()
        .find(|window| window.get("label").and_then(Value::as_str) == Some(BAR_WINDOW_LABEL))
        .expect("bar window should exist");
    assert_eq!(bar.get("create").and_then(Value::as_bool), Some(false));
    assert_eq!(bar.get("visible").and_then(Value::as_bool), Some(false));
    assert_eq!(bar.get("transparent").and_then(Value::as_bool), Some(true));

    assert_eq!(
        app.get("macOSPrivateApi").and_then(Value::as_bool),
        Some(true),
        "transparent bar requires macOS private API for shipped path"
    );

    let security = app.get("security").expect("app.security should exist");
    let capabilities = security
        .get("capabilities")
        .and_then(Value::as_array)
        .expect("app.security.capabilities should be an array");
    assert!(
        capabilities
            .iter()
            .any(|capability| capability.as_str() == Some(DEFAULT_CAPABILITY)),
        "default capability must remain active"
    );
    assert!(
        capabilities
            .iter()
            .any(|capability| capability.as_str() == Some(BAR_CAPABILITY)),
        "bar capability must remain active"
    );

    let bundle = config.get("bundle").expect("bundle config should exist");
    let macos_bundle = bundle.get("macOS").expect("bundle.macOS should exist");
    assert_eq!(
        macos_bundle.get("entitlements").and_then(Value::as_str),
        Some("./Entitlements.plist")
    );
}

#[test]
fn default_capability_grants_required_app_command_permissions() {
    let capability = read_json("capabilities/default.json");

    let windows = capability
        .get("windows")
        .and_then(Value::as_array)
        .expect("capability windows should be an array");
    let window_labels: Vec<&str> = windows.iter().filter_map(Value::as_str).collect();
    assert_eq!(window_labels, vec![MAIN_WINDOW_LABEL]);

    let permissions = capability
        .get("permissions")
        .and_then(Value::as_array)
        .expect("capability permissions should be an array");
    let permission_ids: Vec<&str> = permissions.iter().filter_map(Value::as_str).collect();

    assert!(
        permission_ids.contains(&CORE_DEFAULT_PERMISSION),
        "core permission should remain granted to renderer windows"
    );

    for permission in MAIN_REQUIRED_APP_PERMISSIONS {
        assert!(
            permission_ids.contains(&permission),
            "required app command permission `{permission}` should be granted"
        );
    }
}

#[test]
fn bar_capability_keeps_hud_permissions_least_privilege() {
    let capability = read_json("capabilities/bar.json");

    let windows = capability
        .get("windows")
        .and_then(Value::as_array)
        .expect("capability windows should be an array");
    let window_labels: Vec<&str> = windows.iter().filter_map(Value::as_str).collect();
    assert_eq!(window_labels, vec![BAR_WINDOW_LABEL]);

    let permissions = capability
        .get("permissions")
        .and_then(Value::as_array)
        .expect("capability permissions should be an array");
    let permission_ids: Vec<&str> = permissions.iter().filter_map(Value::as_str).collect();

    assert!(
        permission_ids.contains(&CORE_DEFAULT_PERMISSION),
        "core permission should remain granted to bar window"
    );

    for permission in BAR_REQUIRED_APP_PERMISSIONS {
        assert!(
            permission_ids.contains(&permission),
            "required bar permission `{permission}` should be granted"
        );
    }

    assert!(
        !permission_ids.contains(&"allow-list-models"),
        "bar window must not receive model management permissions"
    );
    assert!(
        !permission_ids.contains(&"allow-update-soniox-key"),
        "bar window must not receive Soniox credential mutation permissions"
    );
}

#[test]
fn cargo_manifest_excludes_unused_renderer_plugins() {
    let manifest = read_project_file("Cargo.toml");

    assert!(
        !manifest.contains(UNUSED_PLUGIN_SHELL),
        "shell plugin should not be linked when renderer does not call it"
    );
    assert!(
        !manifest.contains(UNUSED_PLUGIN_HTTP),
        "http plugin should not be linked when renderer does not call it"
    );
    assert!(
        !manifest.contains(UNUSED_PLUGIN_CLIPBOARD),
        "clipboard manager plugin should not be linked when renderer does not call it"
    );
}

#[test]
fn runtime_builder_registers_only_required_plugins() {
    let lib_rs = read_project_file("src/lib.rs");

    assert!(
        !lib_rs.contains(UNUSED_PLUGIN_SHELL_INIT),
        "runtime should not register shell plugin without a consumer"
    );
    assert!(
        !lib_rs.contains(UNUSED_PLUGIN_HTTP_INIT),
        "runtime should not register http plugin without a consumer"
    );
    assert!(
        !lib_rs.contains(UNUSED_PLUGIN_CLIPBOARD_INIT),
        "runtime should not register clipboard plugin without a consumer"
    );
}

#[test]
fn info_and_entitlements_keep_required_usage_and_permissions() {
    let info_plist = read_project_file("Info.plist");
    assert!(info_plist.contains("NSMicrophoneUsageDescription"));
    assert!(info_plist.contains("NSAppleEventsUsageDescription"));

    let entitlements_plist = read_project_file("Entitlements.plist");
    assert!(entitlements_plist.contains("com.apple.security.device.audio-input"));
    assert!(entitlements_plist.contains("com.apple.security.automation.apple-events"));
}

use std::cell::RefCell;

#[test]
fn runtime_invariant_keeps_bar_show_order_configure_position_show_front() {
    let executed_steps: RefCell<Vec<&str>> = RefCell::new(Vec::new());

    let result = run_bar_show_sequence(
        || {
            executed_steps.borrow_mut().push("configure");
            Ok(())
        },
        || {
            executed_steps.borrow_mut().push("position");
            Ok(())
        },
        || {
            executed_steps.borrow_mut().push("show");
            Ok(())
        },
        || {
            executed_steps.borrow_mut().push("front");
            Ok(())
        },
    );

    assert!(result.is_ok());
    assert_eq!(
        executed_steps.into_inner(),
        vec!["configure", "position", "show", "front"]
    );
}

#[test]
fn runtime_invariant_main_close_request_prevents_exit_and_hides_window() {
    let executed_steps: RefCell<Vec<&str>> = RefCell::new(Vec::new());

    let result = run_main_close_request_sequence(
        || {
            executed_steps.borrow_mut().push("prevent-close");
        },
        || {
            executed_steps.borrow_mut().push("hide");
            Ok(())
        },
    );

    assert!(result.is_ok());
    assert_eq!(executed_steps.into_inner(), vec!["prevent-close", "hide"]);
}

#[test]
fn runtime_invariant_bar_close_request_prevents_destroy_and_hides_window() {
    let executed_steps: RefCell<Vec<&str>> = RefCell::new(Vec::new());

    let result = run_bar_close_request_sequence(
        || {
            executed_steps.borrow_mut().push("prevent-close");
        },
        || {
            executed_steps.borrow_mut().push("hide");
            Ok(())
        },
    );

    assert!(result.is_ok());
    assert_eq!(executed_steps.into_inner(), vec!["prevent-close", "hide"]);
}

#[test]
fn runtime_builder_no_longer_registers_tray_icon() {
    let lib_rs = read_project_file("src/lib.rs");

    assert!(
        !lib_rs.contains("TrayIconBuilder"),
        "runtime should not create a menubar tray icon"
    );
    assert!(
        !lib_rs.contains("setup_tray"),
        "runtime should not keep tray setup helpers after menubar removal"
    );
}

#[test]
fn runtime_commands_use_panel_mouse_event_toggle_path() {
    let commands_rs = read_project_file("src/commands.rs");

    assert!(
        commands_rs.contains("set_bar_ignores_mouse_events(&app, false)"),
        "show_bar should use panel mouse-event toggle helper"
    );
    assert!(
        commands_rs.contains("set_bar_ignores_mouse_events(&app, ignore)"),
        "set_mouse_events should use panel mouse-event toggle helper"
    );
}

#[test]
fn runtime_positioning_uses_global_mouse_fallback_for_background_shortcuts() {
    let lib_rs = read_project_file("src/lib.rs");

    assert!(
        lib_rs.contains("monitor_from_global_mouse_location"),
        "bar positioning should include global-mouse fallback when cursor lookup fails"
    );
}
