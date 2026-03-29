fn main() {
    let app_manifest = tauri_build::AppManifest::new().commands(&[
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
    ]);

    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(app_manifest))
        .expect("failed to apply tauri build attributes");
}
