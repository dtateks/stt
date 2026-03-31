use std::fs;
use std::future::Future;
use std::sync::OnceLock;

use serde_json::Value;
use tauri::{AppHandle, LogicalSize, Manager, Size};

use crate::credentials;
use crate::llm_service;
use crate::permissions;
use crate::platform_runtime_info::PlatformRuntimeInfo;
use crate::soniox_auth;
use crate::soniox_models;
use crate::text_inserter;
use crate::BAR_WINDOW_LABEL;

const MAIN_WINDOW_LABEL: &str = "main";
static CACHED_LLM_CONFIG: OnceLock<Result<llm_service::LlmConfig, String>> = OnceLock::new();
const SONIOX_KEY_REQUIRED_MESSAGE: &str = "Soniox API key is required";
const MAIN_WINDOW_AUTO_FIT_CHROME_PADDING: f64 = 48.0;
const MAIN_WINDOW_AUTO_FIT_MIN_HEIGHT: f64 = 560.0;
const MAIN_WINDOW_AUTO_FIT_MAX_HEIGHT: f64 = 880.0;

fn trimmed_soniox_key(soniox_key: String) -> String {
    soniox_key.trim().to_string()
}

async fn validate_soniox_key_for_persistence_with<F, Fut>(
    soniox_key: String,
    validate_temporary_key: F,
) -> Result<String, String>
where
    F: FnOnce(String) -> Fut,
    Fut: Future<Output = Result<soniox_auth::SonioxTemporaryKey, String>>,
{
    let trimmed_key = trimmed_soniox_key(soniox_key);
    if trimmed_key.is_empty() {
        return Err(SONIOX_KEY_REQUIRED_MESSAGE.to_string());
    }

    validate_temporary_key(trimmed_key.clone()).await?;
    Ok(trimmed_key)
}

async fn validate_soniox_key_for_persistence(soniox_key: String) -> Result<String, String> {
    validate_soniox_key_for_persistence_with(soniox_key, soniox_auth::create_temporary_api_key)
        .await
}

fn cached_llm_config(app: &AppHandle) -> Result<llm_service::LlmConfig, String> {
    match CACHED_LLM_CONFIG.get_or_init(|| {
        let config = get_config(app.clone())?;
        Ok(parse_llm_config_from_app_config(&config))
    }) {
        Ok(config) => Ok(config.clone()),
        Err(error) => Err(error.clone()),
    }
}

fn parse_llm_config_from_app_config(config: &Value) -> llm_service::LlmConfig {
    serde_json::from_value::<llm_service::LlmConfig>(
        config.get("llm").cloned().unwrap_or(Value::Null),
    )
    .unwrap_or_default()
}

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

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SonioxTemporaryApiKeyResult {
    pub api_key: String,
    pub expires_at: Option<String>,
    pub expires_in_seconds: Option<u64>,
}

#[tauri::command]
pub fn has_soniox_key(app: AppHandle) -> Result<bool, String> {
    let credentials = credentials::get_credentials(&app)?;
    Ok(!credentials.soniox_key.trim().is_empty())
}

#[tauri::command]
pub async fn create_soniox_temporary_key(
    app: AppHandle,
) -> Result<SonioxTemporaryApiKeyResult, String> {
    let credentials = credentials::get_credentials(&app)?;
    let soniox_key = trimmed_soniox_key(credentials.soniox_key);
    if soniox_key.is_empty() {
        return Err("Soniox API key is missing. Open Settings and add your key.".to_string());
    }

    let temporary_key = soniox_auth::create_temporary_api_key(soniox_key).await?;

    Ok(SonioxTemporaryApiKeyResult {
        api_key: temporary_key.api_key,
        expires_at: temporary_key.expires_at,
        expires_in_seconds: temporary_key.expires_in_seconds,
    })
}

#[tauri::command]
pub fn has_xai_key(app: AppHandle) -> Result<bool, String> {
    let credentials = credentials::get_credentials(&app)?;
    Ok(!credentials.xai_key.is_empty())
}

#[tauri::command]
pub fn has_openai_compatible_key(app: AppHandle, provider: Option<String>) -> Result<bool, String> {
    let credentials = credentials::get_credentials(&app)?;
    if provider.as_deref() == Some("gemini") {
        return Ok(!credentials.gemini_key.is_empty());
    }

    Ok(!credentials.openai_compatible_key.is_empty())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn save_credentials(
    app: AppHandle,
    xai_key: String,
    soniox_key: String,
) -> Result<(), String> {
    let validated_soniox_key = validate_soniox_key_for_persistence(soniox_key).await?;
    credentials::save_credentials(&app, xai_key, validated_soniox_key)
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_xai_key(app: AppHandle, xai_key: String) -> Result<(), String> {
    credentials::save_xai_key(&app, xai_key)
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_openai_compatible_key(
    app: AppHandle,
    openai_compatible_key: String,
    provider: Option<String>,
) -> Result<(), String> {
    if provider.as_deref() == Some("gemini") {
        return credentials::save_gemini_key(&app, openai_compatible_key);
    }

    credentials::save_openai_compatible_key(&app, openai_compatible_key)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn update_soniox_key(app: AppHandle, soniox_key: String) -> Result<(), String> {
    let validated_soniox_key = validate_soniox_key_for_persistence(soniox_key).await?;
    credentials::save_soniox_key(&app, validated_soniox_key)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn list_models(
    app: AppHandle,
    provider: Option<String>,
    base_url: Option<String>,
) -> Result<Vec<String>, String> {
    let credentials = credentials::get_credentials(&app)?;
    let provider_config = llm_service::LlmConfig {
        provider,
        model: None,
        temperature: None,
        base_url: None,
    };
    let resolved_provider = llm_service::resolve_provider(&provider_config)?;
    let api_key = if resolved_provider == "openai_compatible" {
        credentials.openai_compatible_key
    } else if resolved_provider == "gemini" {
        credentials.gemini_key
    } else {
        credentials.xai_key
    };

    llm_service::list_models(api_key, resolved_provider, base_url.as_deref()).await
}

#[tauri::command]
pub async fn list_soniox_models() -> Result<Vec<String>, String> {
    soniox_models::list_soniox_models().await
}

#[tauri::command]
pub fn ensure_microphone_permission() -> permissions::MicrophonePermissionResult {
    permissions::ensure_microphone_permission()
}

#[tauri::command]
pub fn ensure_accessibility_permission() -> permissions::AccessibilityPermissionResult {
    permissions::ensure_accessibility_permission()
}

#[tauri::command]
pub fn ensure_text_insertion_permission() -> text_inserter::TextInsertionPermissionResult {
    text_inserter::ensure_text_insertion_permission()
}

#[tauri::command]
pub fn check_permissions_status() -> permissions::PermissionsStatus {
    permissions::check_permissions_status()
}

#[tauri::command]
pub fn relaunch_app(app: AppHandle) {
    app.restart();
}

#[tauri::command(rename_all = "snake_case")]
pub fn insert_text(text: String, enter_mode: Option<bool>) -> text_inserter::InsertTextResult {
    text_inserter::insert_text(text, enter_mode.unwrap_or(false))
}

#[tauri::command(rename_all = "snake_case")]
pub async fn correct_transcript(
    app: AppHandle,
    transcript: String,
    output_lang: Option<String>,
    llm_provider: Option<String>,
    llm_model: Option<String>,
    llm_base_url: Option<String>,
) -> Result<String, String> {
    let credentials = credentials::get_credentials(&app)?;

    let mut llm_config = cached_llm_config(&app)?;

    if let Some(provider) = llm_provider {
        llm_config.provider = Some(provider);
    }
    if let Some(model) = llm_model {
        llm_config.model = Some(model);
    }
    if let Some(base_url) = llm_base_url {
        llm_config.base_url = Some(base_url);
    }

    let provider = llm_service::resolve_provider(&llm_config)?;
    let api_key = if provider == "openai_compatible" {
        credentials.openai_compatible_key
    } else if provider == "gemini" {
        credentials.gemini_key
    } else {
        credentials.xai_key
    };
    if api_key.trim().is_empty() {
        if provider == "openai_compatible" {
            return Err("OpenAI-compatible API key is not configured".to_string());
        }
        if provider == "gemini" {
            return Err("Gemini API key is not configured".to_string());
        }
        return Err("xAI API key is not configured".to_string());
    }

    llm_service::correct_transcript(
        transcript,
        api_key,
        llm_config,
        output_lang.unwrap_or_else(|| "auto".to_string()),
    )
    .await
}

#[tauri::command(rename_all = "snake_case")]
pub fn set_mic_state(is_active: bool) {
    let _ = is_active;
}

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

    crate::platform_app_shell::show_bar(&app, &bar_window).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn hide_bar(app: AppHandle) -> Result<(), String> {
    crate::platform_app_shell::hide_bar(&app).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_mouse_events(app: AppHandle, ignore: bool) -> Result<(), String> {
    crate::platform_app_shell::set_bar_mouse_events(&app, ignore).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn show_settings(app: AppHandle) -> Result<(), String> {
    let Some(main_window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return Err("main window not found".to_string());
    };

    crate::platform_app_shell::show_settings(&main_window).map_err(|error| error.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub fn fit_main_window_to_content(app: AppHandle, content_height: f64) -> Result<(), String> {
    if !content_height.is_finite() {
        return Err("content_height must be a finite number".to_string());
    }

    let Some(main_window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return Err("main window not found".to_string());
    };

    let scale_factor = main_window.scale_factor().map_err(|error| error.to_string())?;
    let inner_size = main_window.inner_size().map_err(|error| error.to_string())?;
    let logical_width = f64::from(inner_size.width) / scale_factor;

    if logical_width <= 0.0 {
        return Err("main window width is unavailable".to_string());
    }

    let bounded_content_height = content_height.max(0.0);
    let target_height = (bounded_content_height + MAIN_WINDOW_AUTO_FIT_CHROME_PADDING)
        .clamp(MAIN_WINDOW_AUTO_FIT_MIN_HEIGHT, MAIN_WINDOW_AUTO_FIT_MAX_HEIGHT);

    main_window
        .set_size(Size::Logical(LogicalSize::new(logical_width, target_height)))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_platform_runtime_info() -> PlatformRuntimeInfo {
    crate::platform_runtime_info::get_platform_runtime_info()
}

#[tauri::command]
pub fn get_mic_toggle_shortcut(app: AppHandle) -> Result<String, String> {
    crate::get_mic_toggle_shortcut(&app)
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_mic_toggle_shortcut(app: AppHandle, shortcut: String) -> Result<String, String> {
    crate::update_mic_toggle_shortcut(&app, &shortcut)
}

#[cfg(test)]
mod tests {
    use super::{validate_soniox_key_for_persistence_with, SONIOX_KEY_REQUIRED_MESSAGE};
    use crate::soniox_auth::SonioxTemporaryKey;

    #[test]
    fn soniox_save_validation_rejects_empty_trimmed_key() {
        let result = tauri::async_runtime::block_on(validate_soniox_key_for_persistence_with(
            "   ".to_string(),
            |_| async {
                Ok(SonioxTemporaryKey {
                    api_key: "temporary".to_string(),
                    expires_at: None,
                    expires_in_seconds: Some(3600),
                })
            },
        ));

        assert_eq!(result, Err(SONIOX_KEY_REQUIRED_MESSAGE.to_string()));
    }

    #[test]
    fn soniox_save_validation_trims_before_temporary_key_mint() {
        let result = tauri::async_runtime::block_on(validate_soniox_key_for_persistence_with(
            "  soniox-live-key  ".to_string(),
            |received_key| async move {
                assert_eq!(received_key, "soniox-live-key");
                Ok(SonioxTemporaryKey {
                    api_key: "temporary".to_string(),
                    expires_at: None,
                    expires_in_seconds: Some(3600),
                })
            },
        ));

        assert_eq!(result, Ok("soniox-live-key".to_string()));
    }

    #[test]
    fn soniox_save_validation_propagates_temporary_key_errors() {
        let result = tauri::async_runtime::block_on(validate_soniox_key_for_persistence_with(
            "soniox-live-key".to_string(),
            |_| async { Err("Soniox temporary key request failed (401): invalid key".to_string()) },
        ));

        assert_eq!(
            result,
            Err("Soniox temporary key request failed (401): invalid key".to_string())
        );
    }
}
