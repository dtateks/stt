fn main() {
    let app_manifest = tauri_build::AppManifest::new().commands(&[
        "get_config",
        "get_soniox_key",
        "has_xai_key",
        "save_credentials",
        "update_xai_key",
        "reset_credentials",
        "ensure_microphone_permission",
        "ensure_accessibility_permission",
        "ensure_text_insertion_permission",
        "insert_text",
        "correct_transcript",
        "set_mic_state",
        "copy_to_clipboard",
        "quit_app",
        "show_bar",
        "hide_bar",
        "set_mouse_events",
        "show_settings",
    ]);

    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(app_manifest))
        .expect("failed to apply tauri build attributes");
}
