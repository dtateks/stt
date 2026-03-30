use std::fs;
use std::path::Path;

use serde_json::Value;
use voice_to_text_lib::{
    run_bar_close_request_sequence, run_bar_show_sequence, run_macos_reopen_window_sequence,
    run_main_close_request_sequence, run_main_window_show_sequence,
};

const CORE_DEFAULT_PERMISSION: &str = "core:default";
const DEFAULT_CAPABILITY: &str = "default";
const BAR_CAPABILITY: &str = "bar";
const MAIN_WINDOW_LABEL: &str = "main";
const BAR_WINDOW_LABEL: &str = "bar";
const MAIN_REQUIRED_APP_PERMISSIONS: [&str; 29] = [
    "allow-get-config",
    "allow-has-soniox-key",
    "allow-create-soniox-temporary-key",
    "allow-has-xai-key",
    "allow-has-openai-compatible-key",
    "allow-save-credentials",
    "allow-update-xai-key",
    "allow-update-openai-compatible-key",
    "allow-update-soniox-key",
    "allow-list-models",
    "allow-list-soniox-models",
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
    "allow-get-platform-runtime-info",
    "allow-get-mic-toggle-shortcut",
    "allow-update-mic-toggle-shortcut",
];
const BAR_REQUIRED_APP_PERMISSIONS: [&str; 15] = [
    "allow-get-config",
    "allow-has-soniox-key",
    "allow-create-soniox-temporary-key",
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
    "allow-get-platform-runtime-info",
];
const UNUSED_PLUGIN_SHELL: &str = "tauri-plugin-shell";
const UNUSED_PLUGIN_HTTP: &str = "tauri-plugin-http";
const UNUSED_PLUGIN_CLIPBOARD: &str = "tauri-plugin-clipboard-manager";
const REQUIRED_PLUGIN_AUTOSTART: &str = "tauri-plugin-autostart";
const UNUSED_PLUGIN_SHELL_INIT: &str = "tauri_plugin_shell::init";
const UNUSED_PLUGIN_HTTP_INIT: &str = "tauri_plugin_http::init";
const UNUSED_PLUGIN_CLIPBOARD_INIT: &str = "tauri_plugin_clipboard_manager::init";
const LOCAL_REVIEW_SIGNING_IDENTITY_LABEL: &str = "Voice to Text Local Review Signing";
const EXPLICIT_SIGNING_SOURCE_LABEL: &str = "SIGNING_SOURCE_EXPLICIT=\"explicit\"";
const LOCAL_REVIEW_SIGNING_SOURCE_LABEL: &str = "SIGNING_SOURCE_LOCAL_REVIEW=\"local-review\"";
const AD_HOC_SIGNING_SOURCE_LABEL: &str = "SIGNING_SOURCE_AD_HOC=\"ad-hoc\"";
const CODESIGN_DRYRUN_LABEL: &str = "codesign --dryrun --force --sign \"$identity_name\"";
const FIND_IDENTITY_CODESIGNING_LABEL: &str = "find-identity -v -p codesigning";
const SIGNING_PROBE_COPY_LABEL: &str = "cp /usr/bin/true \"$probe_path\"";
const RELEASE_UPDATER_GATING_LABEL: &str = "needs.prepare-release.outputs.publish_updater_assets";

fn read_project_file(relative_path: &str) -> String {
    let absolute_path = Path::new(env!("CARGO_MANIFEST_DIR")).join(relative_path);
    fs::read_to_string(absolute_path).expect("project file should be readable")
}

fn read_json(relative_path: &str) -> Value {
    serde_json::from_str(&read_project_file(relative_path)).expect("json should parse")
}

#[test]
fn macos_sign_script_prefers_explicit_then_local_review_then_ad_hoc() {
    let sign_script = read_project_file("../scripts/sign-macos-app.sh");

    assert!(
        sign_script.contains(LOCAL_REVIEW_SIGNING_IDENTITY_LABEL),
        "sign script should keep a stable local-review identity label"
    );
    assert!(
        sign_script.contains(EXPLICIT_SIGNING_SOURCE_LABEL),
        "sign script should declare explicit signing source"
    );
    assert!(
        sign_script.contains(LOCAL_REVIEW_SIGNING_SOURCE_LABEL),
        "sign script should declare local-review signing source"
    );
    assert!(
        sign_script.contains(AD_HOC_SIGNING_SOURCE_LABEL),
        "sign script should declare ad-hoc signing source"
    );
    assert!(
        sign_script.contains(CODESIGN_DRYRUN_LABEL),
        "sign script should probe signing identities with codesign before choosing a fallback"
    );
    assert!(
        !sign_script.contains(FIND_IDENTITY_CODESIGNING_LABEL),
        "sign script should not rely on keychain identity listings that miss self-signed review certs"
    );

    let explicit_source_index = sign_script
        .find("if [ -n \"$SIGNING_IDENTITY_ENV\" ]; then")
        .expect("signing resolver should check explicit identity first");
    let local_review_source_index = sign_script
        .find("if can_codesign_bundle_with_identity \"$LOCAL_REVIEW_SIGNING_IDENTITY\" \"$APP_BUNDLE_PATH\"; then")
        .expect("signing resolver should check local-review identity second");
    let ad_hoc_source_index = sign_script
        .find("SIGNING_IDENTITY=\"$AD_HOC_SIGNING_IDENTITY\"")
        .expect("signing resolver should fall back to ad-hoc last");

    assert!(
        explicit_source_index < local_review_source_index,
        "explicit signing identity should be preferred over local-review signing"
    );
    assert!(
        local_review_source_index < ad_hoc_source_index,
        "local-review signing identity should be preferred over ad-hoc fallback"
    );
}

#[test]
fn install_script_bootstraps_local_review_signing_before_bundle_install() {
    let install_script = read_project_file("../install.sh");

    assert!(
        install_script.contains("bootstrap-local-review-signing-cert.sh"),
        "installer should call the local-review signing bootstrap script"
    );
    assert!(
        install_script.contains("configure_install_signing_lane"),
        "installer should choose a signing lane before install"
    );
    assert!(
        install_script.contains(CODESIGN_DRYRUN_LABEL),
        "installer should probe signing identities with codesign before falling back to ad-hoc"
    );
    assert!(
        !install_script.contains(FIND_IDENTITY_CODESIGNING_LABEL),
        "installer should not rely on keychain identity listings that miss self-signed review certs"
    );
    assert!(
        install_script.contains("sign_bundle_for_install \"$APP_BUNDLE\""),
        "installer should sign the selected app bundle before copying to /Applications"
    );
    assert!(
        install_script.contains("configure_install_signing_lane \"$APP_BUNDLE\""),
        "installer should choose a signing lane using the actual app bundle that will be signed"
    );
}

#[test]
fn bootstrap_script_validates_local_review_signing_with_codesign_probe() {
    let bootstrap_script = read_project_file("../scripts/bootstrap-local-review-signing-cert.sh");

    assert!(
        bootstrap_script.contains(SIGNING_PROBE_COPY_LABEL),
        "bootstrap script should create a real executable probe before validating local-review signing"
    );
    assert!(
        bootstrap_script.contains("codesign --force --sign \"$identity_name\" \"$probe_path\""),
        "bootstrap script should verify the local-review identity by actually running codesign"
    );
    assert!(
        !bootstrap_script.contains(FIND_IDENTITY_CODESIGNING_LABEL),
        "bootstrap script should not treat keychain identity listings as proof that the review cert is usable"
    );
}

#[test]
fn release_pipeline_gates_updater_assets_on_explicit_release_signing() {
    let release_script = read_project_file("../scripts/release.sh");
    let workflow = read_project_file("../.github/workflows/release-main.yml");

    assert!(
        release_script.contains("STT_RELEASE_SIGNING_IDENTITY"),
        "release script should read explicit release signing identity from environment"
    );
    assert!(
        release_script
            .contains("\"$EXPLICIT_RELEASE_SIGNING_IDENTITY\" != \"$AD_HOC_SIGNING_IDENTITY\""),
        "release script should reject ad-hoc signing identity for updater publishing"
    );
    assert!(
        release_script.contains("Skipping ${UPDATER_MANIFEST_NAME}"),
        "release script should skip updater manifest generation without explicit release signing"
    );
    assert!(
        workflow.contains("publish_updater_assets"),
        "release workflow should compute updater publish gating"
    );
    assert!(
        workflow.contains(RELEASE_UPDATER_GATING_LABEL),
        "release workflow should gate updater packaging/publishing on explicit release signing"
    );
    assert!(
        workflow.contains("Create release and upload bootstrap assets only"),
        "release workflow should keep non-updater assets publishable when updater lane is disabled"
    );
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
    assert_eq!(main.get("visible").and_then(Value::as_bool), Some(false));

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
        !permission_ids.contains(&"allow-list-soniox-models"),
        "bar window must not receive Soniox model management permissions"
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
fn cargo_manifest_links_autostart_plugin_for_login_launches() {
    let manifest = read_project_file("Cargo.toml");

    assert!(
        manifest.contains(REQUIRED_PLUGIN_AUTOSTART),
        "autostart plugin should be linked for login launch support"
    );
}

#[test]
fn info_and_entitlements_keep_required_usage_and_permissions() {
    let info_plist = read_project_file("Info.plist");
    assert!(info_plist.contains("<key>LSUIElement</key>"));
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
fn runtime_invariant_main_window_show_unminimizes_before_show_and_focus() {
    let executed_steps: RefCell<Vec<&str>> = RefCell::new(Vec::new());

    let result = run_main_window_show_sequence(
        || {
            executed_steps.borrow_mut().push("unminimize");
            Ok(())
        },
        || {
            executed_steps.borrow_mut().push("show");
            Ok(())
        },
        || {
            executed_steps.borrow_mut().push("focus");
            Ok(())
        },
    );

    assert!(result.is_ok());
    assert_eq!(
        executed_steps.into_inner(),
        vec!["unminimize", "show", "focus"]
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
fn runtime_builder_registers_single_instance_plugin_before_other_plugins() {
    let lib_rs = read_project_file("src/lib.rs");

    let single_instance_index = lib_rs
        .find("tauri_plugin_single_instance::init")
        .expect("single-instance plugin should be registered");
    let global_shortcut_index = lib_rs
        .find("tauri_plugin_global_shortcut::Builder::new().build()")
        .expect("global shortcut plugin should be registered");

    assert!(
        single_instance_index < global_shortcut_index,
        "single-instance plugin should be registered before other plugins"
    );
}

#[test]
fn runtime_builder_restores_hidden_main_window_on_macos_reopen() {
    let lib_rs = read_project_file("src/lib.rs");

    assert!(
        lib_rs.contains("RunEvent::Reopen"),
        "runtime should handle macOS reopen events"
    );
    assert!(
        lib_rs.contains("run_macos_reopen_window_sequence(has_visible_windows"),
        "runtime should route macOS reopen events through the visibility gate"
    );
    assert!(
        lib_rs.contains("reopen_main_window(app_handle)"),
        "macOS reopen handler should restore the hidden main window"
    );
}

#[test]
fn runtime_setup_uses_accessory_activation_policy_for_background_app() {
    let lib_rs = read_project_file("src/lib.rs");

    assert!(
        lib_rs.contains("set_activation_policy(tauri::ActivationPolicy::Accessory)")
            || lib_rs.contains("set_activation_policy(ActivationPolicy::Accessory)"),
        "runtime should switch macOS to accessory activation policy to hide the Dock icon"
    );
}

#[test]
fn runtime_invariant_macos_reopen_restores_hidden_main_window_only_when_no_windows_are_visible() {
    let executed_steps: RefCell<Vec<&str>> = RefCell::new(Vec::new());

    run_macos_reopen_window_sequence(false, || {
        executed_steps.borrow_mut().push("reopen-main-window");
    });
    run_macos_reopen_window_sequence(true, || {
        executed_steps.borrow_mut().push("should-not-run");
    });

    assert_eq!(executed_steps.into_inner(), vec!["reopen-main-window"]);
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
        commands_rs.contains("crate::platform_app_shell::show_bar(&app, &bar_window)"),
        "show_bar should route through the shared platform shell contract"
    );
    assert!(
        commands_rs.contains("crate::platform_app_shell::set_bar_mouse_events(&app, ignore)"),
        "set_mouse_events should route through the shared platform shell contract"
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
