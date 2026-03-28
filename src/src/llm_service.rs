use std::time::Duration;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const XAI_CHAT_COMPLETIONS_URL: &str = "https://api.x.ai/v1/chat/completions";
const REQUEST_TIMEOUT_SECONDS: u64 = 15;
const DEFAULT_MODEL: &str = "grok-4-1-fast-non-reasoning";
const DEFAULT_TEMPERATURE: f64 = 0.1;
const XAI_PROVIDER: &str = "xai";
const XAI_RESPONSE_SHAPE_ERROR: &str =
    "xAI response shape unexpected — could not extract corrected text";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct AppConfig {
    pub soniox: SonioxConfig,
    pub llm: LlmConfig,
    pub voice: VoiceConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct SonioxConfig {
    pub ws_url: String,
    pub model: String,
    pub sample_rate: u32,
    pub num_channels: u16,
    pub audio_format: String,
    pub chunk_size: usize,
    pub language_hints: Vec<String>,
    pub language_hints_strict: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct LlmConfig {
    pub provider: Option<String>,
    pub model: Option<String>,
    pub temperature: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct VoiceConfig {
    pub stop_word: String,
}

pub async fn correct_transcript(
    transcript: String,
    api_key: String,
    llm_config: LlmConfig,
    output_lang: String,
) -> Result<String, String> {
    if api_key.trim().is_empty() {
        return Err("xAI API key is not configured".to_string());
    }

    validate_llm_config_for_xai(&llm_config)?;

    let client = Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECONDS))
        .build()
        .map_err(|error| error.to_string())?;

    let request_body = build_request_body(transcript, &llm_config, &output_lang);
    let response = client
        .post(XAI_CHAT_COMPLETIONS_URL)
        .bearer_auth(api_key)
        .json(&request_body)
        .send()
        .await
        .map_err(map_http_error)?;

    if !response.status().is_success() {
        let status = response.status();
        let response_body = response.text().await.unwrap_or_default();
        return Err(format_xai_api_error(status.as_u16(), &response_body));
    }

    let payload = response
        .json::<Value>()
        .await
        .map_err(|error| error.to_string())?;
    extract_corrected_text_from_response(&payload)
}

pub fn validate_llm_config_for_xai(llm_config: &LlmConfig) -> Result<(), String> {
    let Some(provider) = llm_config.provider.as_deref() else {
        return Ok(());
    };

    if provider.is_empty() || provider == XAI_PROVIDER {
        return Ok(());
    }

    Err(format!(
        "Unsupported LLM provider `{provider}` for xAI transcript correction"
    ))
}

pub fn extract_corrected_text_from_response(payload: &Value) -> Result<String, String> {
    let Some(choices) = payload.get("choices").and_then(Value::as_array) else {
        return Err(XAI_RESPONSE_SHAPE_ERROR.to_string());
    };

    let Some(first_choice) = choices.first() else {
        return Err(XAI_RESPONSE_SHAPE_ERROR.to_string());
    };

    let Some(content) = first_choice
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(extract_message_content_text)
    else {
        return Err(XAI_RESPONSE_SHAPE_ERROR.to_string());
    };

    let corrected_text = content.trim();
    if corrected_text.is_empty() {
        return Err(XAI_RESPONSE_SHAPE_ERROR.to_string());
    }

    Ok(corrected_text.to_string())
}

fn build_request_body(transcript: String, llm_config: &LlmConfig, output_lang: &str) -> Value {
    let system_prompt = system_prompt_for_output_language(output_lang);
    let user_prompt = format!(
        "## Voice Transcript (may have pronunciation errors):\n\"{}\"",
        transcript
    );

    json!({
      "model": llm_config.model.clone().unwrap_or_else(|| DEFAULT_MODEL.to_string()),
      "temperature": llm_config.temperature.unwrap_or(DEFAULT_TEMPERATURE),
      "messages": [
        { "role": "system", "content": system_prompt },
        { "role": "user", "content": user_prompt }
      ]
    })
}

fn system_prompt_for_output_language(output_lang: &str) -> &'static str {
    match output_lang {
        "english" => {
            "You are a voice transcription corrector. Fix misheard words and return only corrected natural English text."
        }
        "vietnamese" => {
            "You are a voice transcription corrector. Fix misheard words and return only corrected Vietnamese text."
        }
        _ => {
            "You are a voice transcription corrector. Fix misheard words and preserve the original language mix. Return only corrected text."
        }
    }
}

pub fn format_xai_api_error(status_code: u16, response_body: &str) -> String {
    let message = serde_json::from_str::<Value>(response_body)
        .ok()
        .and_then(extract_xai_error_message)
        .unwrap_or_else(|| "xAI returned an unexpected error response".to_string());

    format!("xAI API error ({status_code}): {message}")
}

fn map_http_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        return "xAI request timed out after 15 seconds".to_string();
    }

    error.to_string()
}

fn extract_message_content_text(content: &Value) -> Option<&str> {
    if let Some(content_text) = content.as_str() {
        return Some(content_text);
    }

    let content_blocks = content.as_array()?;
    content_blocks.iter().find_map(|block| {
        (block.get("type").and_then(Value::as_str) == Some("text"))
            .then(|| block.get("text").and_then(Value::as_str))
            .flatten()
    })
}

fn extract_xai_error_message(payload: Value) -> Option<String> {
    payload
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .or_else(|| payload.get("message").and_then(Value::as_str))
        .map(str::trim)
        .filter(|message| !message.is_empty())
        .map(ToString::to_string)
}
