use std::fs;

use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::credentials;
use crate::llm_service;
use crate::permissions;
use crate::text_inserter;

const BAR_WINDOW_LABEL: &str = "bar";
const MAIN_WINDOW_LABEL: &str = "main";

#[tauri::command]
pub fn get_config(app: AppHandle) -> Result<Value, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let config_path = resource_dir.join("config.json");

    let raw_config = fs::read_to_string(config_path).map_err(|error| error.to_string())?;
    serde_json::from_str::<Value>(&raw_config).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_soniox_key(app: AppHandle) -> Result<String, String> {
    let credentials = credentials::get_credentials(&app)?;
    Ok(credentials.soniox_key)
}

#[tauri::command]
pub fn has_xai_key(app: AppHandle) -> Result<bool, String> {
    let credentials = credentials::get_credentials(&app)?;
    Ok(!credentials.xai_key.is_empty())
}

#[tauri::command]
pub fn save_credentials(app: AppHandle, xai_key: String, soniox_key: String) -> Result<(), String> {
    credentials::save_credentials(&app, xai_key, soniox_key)
}

#[tauri::command]
pub fn update_xai_key(app: AppHandle, xai_key: String) -> Result<(), String> {
    credentials::save_xai_key(&app, xai_key)
}

#[tauri::command]
pub fn reset_credentials(app: AppHandle) -> Result<(), String> {
    credentials::clear_credentials(&app)
}

#[tauri::command]
pub fn ensure_microphone_permission() -> permissions::MicrophonePermissionResult {
    permissions::ensure_microphone_permission()
}

#[tauri::command]
pub fn insert_text(text: String, enter_mode: Option<bool>) -> text_inserter::InsertTextResult {
    text_inserter::insert_text(text, enter_mode.unwrap_or(false))
}

#[tauri::command]
pub async fn correct_transcript(
    app: AppHandle,
    transcript: String,
    output_lang: Option<String>,
) -> Result<String, String> {
    let credentials = credentials::get_credentials(&app)?;
    if credentials.xai_key.trim().is_empty() {
        return Err("xAI API key is not configured".to_string());
    }

    let config = get_config(app)?;
    let llm_config = serde_json::from_value::<llm_service::LlmConfig>(
        config.get("llm").cloned().unwrap_or(Value::Null),
    )
    .unwrap_or_default();

    llm_service::correct_transcript(
        transcript,
        credentials.xai_key,
        llm_config,
        output_lang.unwrap_or_else(|| "auto".to_string()),
    )
    .await
}

#[tauri::command]
pub fn set_mic_state(_is_active: bool) {}

#[tauri::command]
pub fn copy_to_clipboard(text: String) -> Result<(), String> {
    text_inserter::copy_to_clipboard(text)
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn show_bar(app: AppHandle) -> Result<(), String> {
    let Some(bar_window) = app.get_webview_window(BAR_WINDOW_LABEL) else {
        return Err("bar window not found".to_string());
    };

    bar_window.show().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn hide_bar(app: AppHandle) -> Result<(), String> {
    let Some(bar_window) = app.get_webview_window(BAR_WINDOW_LABEL) else {
        return Err("bar window not found".to_string());
    };

    bar_window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_mouse_events(app: AppHandle, ignore: bool) -> Result<(), String> {
    let Some(bar_window) = app.get_webview_window(BAR_WINDOW_LABEL) else {
        return Err("bar window not found".to_string());
    };

    bar_window
        .set_ignore_cursor_events(ignore)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn show_settings(app: AppHandle) -> Result<(), String> {
    let Some(main_window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return Err("main window not found".to_string());
    };

    main_window.show().map_err(|error| error.to_string())?;
    main_window.set_focus().map_err(|error| error.to_string())
}
