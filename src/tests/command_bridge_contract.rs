use std::fs;
use std::path::Path;

use serde_json::json;
use voice_to_text_lib::permissions::{
    build_accessibility_permission_required_result, build_microphone_denied_result,
    PermissionsStatus,
};
use voice_to_text_lib::text_inserter::{
    build_insert_text_result, ensure_text_insertion_permission,
};

const COMMAND_NAMES: [&str; 27] = [
    "get_config",
    "has_soniox_key",
    "create_soniox_temporary_key",
    "has_xai_key",
    "has_openai_compatible_key",
    "save_credentials",
    "update_xai_key",
    "update_openai_compatible_key",
    "update_soniox_key",
    "list_models",
    "reset_credentials",
    "ensure_microphone_permission",
    "ensure_accessibility_permission",
    "ensure_text_insertion_permission",
    "check_permissions_status",
    "insert_text",
    "correct_transcript",
    "set_mic_state",
    "copy_to_clipboard",
    "quit_app",
    "relaunch_app",
    "show_bar",
    "hide_bar",
    "set_mouse_events",
    "show_settings",
    "get_mic_toggle_shortcut",
    "update_mic_toggle_shortcut",
];

fn read_file(relative_path: &str) -> String {
    let absolute_path = Path::new(env!("CARGO_MANIFEST_DIR")).join(relative_path);
    fs::read_to_string(absolute_path).expect("file should be readable")
}

fn extract_between<'a>(source: &'a str, start: &str, end: &str) -> &'a str {
    let start_index = source
        .find(start)
        .unwrap_or_else(|| panic!("missing start marker: {start}"));
    let after_start = &source[start_index + start.len()..];
    let end_index = after_start
        .find(end)
        .unwrap_or_else(|| panic!("missing end marker: {end}"));
    &after_start[..end_index]
}

fn extract_quoted_items(source: &str) -> std::collections::BTreeSet<String> {
    let mut items = std::collections::BTreeSet::new();
    let mut remaining = source;

    while let Some(open_quote) = remaining.find('"') {
        let after_open_quote = &remaining[open_quote + 1..];
        let close_quote = after_open_quote
            .find('"')
            .expect("missing closing quote in commands list");
        items.insert(after_open_quote[..close_quote].to_string());
        remaining = &after_open_quote[close_quote + 1..];
    }

    items
}

fn extract_registered_commands(lib_rs: &str) -> std::collections::BTreeSet<String> {
    let invoke_block = extract_between(lib_rs, ".invoke_handler(tauri::generate_handler![", "])");
    let mut commands = std::collections::BTreeSet::new();

    for segment in invoke_block.split("commands::").skip(1) {
        let identifier: String = segment
            .chars()
            .take_while(|character| character.is_ascii_alphanumeric() || *character == '_')
            .collect();
        if !identifier.is_empty() {
            commands.insert(identifier);
        }
    }

    commands
}

#[test]
fn command_registration_and_build_allow_list_stay_aligned() {
    let lib_rs = read_file("src/lib.rs");
    let build_rs = read_file("build.rs");
    let expected_commands: std::collections::BTreeSet<String> = COMMAND_NAMES
        .iter()
        .map(|command| command.to_string())
        .collect();
    let build_allow_list = extract_quoted_items(extract_between(
        &build_rs,
        "AppManifest::new().commands(&[",
        "])",
    ));
    let invoke_handler_commands = extract_registered_commands(&lib_rs);

    assert!(
        build_rs.contains("AppManifest::new().commands(&["),
        "build.rs must restrict callable app commands"
    );
    assert!(
        build_rs.contains("Attributes::new().app_manifest"),
        "build.rs must scope command exposure through app manifest"
    );

    assert_eq!(
        invoke_handler_commands, expected_commands,
        "invoke_handler command set must exactly match contract"
    );
    assert_eq!(
        build_allow_list, expected_commands,
        "build.rs allow-list must exactly match contract"
    );
}

#[test]
fn ensure_permission_results_serialize_with_expected_shapes() {
    let microphone_denied =
        serde_json::to_value(build_microphone_denied_result("denied".to_string()))
            .expect("microphone result should serialize");
    let microphone_object = microphone_denied
        .as_object()
        .expect("microphone permission result should be object");
    assert_eq!(
        microphone_object.get("granted"),
        Some(&json!(false)),
        "microphone denied must serialize granted=false"
    );
    assert_eq!(
        microphone_object.get("status"),
        Some(&json!("denied")),
        "microphone denied must serialize status"
    );
    assert_eq!(
        microphone_object.get("code"),
        Some(&json!("microphone-permission-required")),
        "microphone denied must serialize permission code"
    );
    assert_eq!(
        microphone_object.get("message"),
        Some(&json!("Microphone permission is required. Enable Voice to Text in System Settings → Privacy & Security → Microphone, then restart Voice to Text and try again.")),
        "microphone denied must serialize actionable message"
    );
    assert!(
        microphone_object
            .get("openedSettings")
            .is_some_and(|value| value.is_boolean()),
        "microphone denied must serialize openedSettings as boolean"
    );

    let accessibility_prompted =
        serde_json::to_value(build_accessibility_permission_required_result(true))
            .expect("accessibility result should serialize");
    assert_eq!(
        accessibility_prompted,
        json!({
            "granted": false,
            "code": "accessibility-permission-required",
            "openedSettings": true,
            "message": "Accessibility permission is required to insert text. Enable Voice to Text in System Settings → Privacy & Security → Accessibility, then try again."
        })
    );

    let text_insertion = serde_json::to_value(ensure_text_insertion_permission())
        .expect("text insertion permission result should serialize");
    let object = text_insertion
        .as_object()
        .expect("text insertion permission result should be object");
    assert!(
        object
            .get("granted")
            .is_some_and(|value| value.is_boolean()),
        "granted must be present as boolean"
    );
    if object
        .get("granted")
        .and_then(serde_json::Value::as_bool)
        .expect("granted should be bool")
    {
        assert!(
            !object.contains_key("code") && !object.contains_key("message"),
            "granted=true should not serialize failure-only fields"
        );
    } else {
        assert!(
            object.get("code").is_some_and(|value| value.is_string()),
            "granted=false must include code"
        );
        assert!(
            object.get("message").is_some_and(|value| value.is_string()),
            "granted=false must include message"
        );
    }
}

#[test]
fn insert_text_results_serialize_with_expected_optional_fields() {
    let success = serde_json::to_value(build_insert_text_result(Ok(()), Ok(())))
        .expect("insert text success should serialize");
    assert_eq!(success, json!({ "success": true }));

    let restore_failed = serde_json::to_value(build_insert_text_result(
        Ok(()),
        Err("Clipboard unavailable".to_string()),
    ))
    .expect("insert text restore failure should serialize");
    assert_eq!(
        restore_failed,
        json!({
            "success": false,
            "error": "Text was inserted, but previous clipboard contents could not be restored: Clipboard unavailable",
            "code": "clipboard-restore-failed"
        })
    );

    let operation_failed = serde_json::to_value(build_insert_text_result(
        Err("Could not control System Events: paste failed".to_string()),
        Ok(()),
    ))
    .expect("insert text operation failure should serialize");
    assert_eq!(
        operation_failed,
        json!({
            "success": false,
            "error": "Could not control System Events: paste failed"
        })
    );
}

#[test]
fn bridge_payload_keys_match_rust_command_signatures() {
    let bridge_js = read_file("../ui/tauri-bridge.js");

    assert!(
        bridge_js.contains("invoke(\"set_mic_state\", { is_active: isActive })"),
        "set_mic_state payload must use snake_case is_active"
    );
    assert!(
        bridge_js.contains("enter_mode: opts?.enterMode ?? false"),
        "insert_text payload must use enter_mode and default false"
    );
    assert!(
        bridge_js.contains("output_lang: outputLang ?? \"auto\""),
        "correct_transcript payload must use output_lang"
    );
    assert!(
        bridge_js.contains("llm_provider: llmOptions?.provider"),
        "correct_transcript payload must pass optional llm_provider"
    );
    assert!(
        bridge_js.contains("llm_model: llmOptions?.model"),
        "correct_transcript payload must pass optional llm_model"
    );
    assert!(
        bridge_js.contains("llm_base_url: llmOptions?.baseUrl"),
        "correct_transcript payload must pass optional llm_base_url"
    );
    assert!(
        bridge_js
            .contains("invoke(\"save_credentials\", { xai_key: xaiKey, soniox_key: sonioxKey })"),
        "save_credentials payload must use snake_case keys"
    );
    assert!(
        bridge_js.contains("invoke(\"update_xai_key\", { xai_key: xaiKey })"),
        "update_xai_key payload must use snake_case xai_key"
    );
    assert!(
        bridge_js.contains("invoke(\"has_soniox_key\")"),
        "has_soniox_key bridge call must be present"
    );
    assert!(
        bridge_js.contains("invoke(\"create_soniox_temporary_key\")"),
        "create_soniox_temporary_key bridge call must be present"
    );
    assert!(
        bridge_js
            .contains("invoke(\"has_openai_compatible_key\", { provider: \"openai_compatible\" })"),
        "has_openai_compatible_key bridge call must pass explicit provider"
    );
    assert!(
        bridge_js.contains("invoke(\"has_openai_compatible_key\", { provider: \"gemini\" })"),
        "gemini key check must route through has_openai_compatible_key with provider override"
    );
    assert!(
        bridge_js.contains("invoke(\"update_openai_compatible_key\", {"),
        "update_openai_compatible_key bridge call must be present"
    );
    assert!(
        bridge_js.contains("openai_compatible_key: openaiCompatibleKey")
            && bridge_js.contains("provider: \"openai_compatible\""),
        "update_openai_compatible_key payload must include provider-scoped openai key"
    );
    assert!(
        bridge_js.contains("openai_compatible_key: geminiKey")
            && bridge_js.contains("provider: \"gemini\""),
        "gemini key update must use provider-scoped update_openai_compatible_key payload"
    );
    assert!(
        bridge_js.contains("invoke(\"update_soniox_key\", { soniox_key: sonioxKey })"),
        "update_soniox_key payload must use snake_case soniox_key"
    );
    assert!(
        bridge_js.contains("invoke(\"list_models\""),
        "list_models bridge call must be present"
    );
    assert!(
        bridge_js.contains("invoke(\"update_mic_toggle_shortcut\", { shortcut })"),
        "update_mic_toggle_shortcut payload must pass shortcut field"
    );
}

#[test]
fn set_mic_state_command_keeps_snake_case_argument_name() {
    let commands_rs = read_file("src/commands.rs");

    assert!(
        commands_rs.contains("set_mic_state(is_active: bool)"),
        "set_mic_state command must keep `is_active` so snake_case bridge payloads deserialize"
    );
}

#[test]
fn commands_with_multiword_args_opt_into_snake_case_deserialization() {
    let commands_rs = read_file("src/commands.rs");

    assert!(
        commands_rs
            .contains("#[tauri::command(rename_all = \"snake_case\")]\npub fn save_credentials"),
        "save_credentials must opt into snake_case arg deserialization"
    );
    assert!(
        commands_rs
            .contains("#[tauri::command(rename_all = \"snake_case\")]\npub fn update_xai_key"),
        "update_xai_key must opt into snake_case arg deserialization"
    );
    assert!(
        commands_rs.contains(
            "#[tauri::command(rename_all = \"snake_case\")]\npub fn update_openai_compatible_key"
        ),
        "update_openai_compatible_key must opt into snake_case arg deserialization"
    );
    assert!(
        commands_rs
            .contains("#[tauri::command(rename_all = \"snake_case\")]\npub fn update_soniox_key"),
        "update_soniox_key must opt into snake_case arg deserialization"
    );
    assert!(
        commands_rs
            .contains("#[tauri::command(rename_all = \"snake_case\")]\npub async fn list_models"),
        "list_models must opt into snake_case arg deserialization"
    );
    assert!(
        commands_rs.contains("#[tauri::command(rename_all = \"snake_case\")]\npub fn insert_text"),
        "insert_text must opt into snake_case arg deserialization"
    );
    assert!(
        commands_rs.contains(
            "#[tauri::command(rename_all = \"snake_case\")]\npub async fn correct_transcript"
        ),
        "correct_transcript must opt into snake_case arg deserialization"
    );
    assert!(
        commands_rs
            .contains("#[tauri::command(rename_all = \"snake_case\")]\npub fn set_mic_state"),
        "set_mic_state must opt into snake_case arg deserialization"
    );
}

#[test]
fn permissions_status_serializes_with_expected_shape() {
    let status = PermissionsStatus {
        microphone: true,
        accessibility: false,
        automation: true,
    };
    let value = serde_json::to_value(status).expect("PermissionsStatus should serialize");
    assert_eq!(
        value,
        json!({
            "microphone": true,
            "accessibility": false,
            "automation": true,
        })
    );
}
