use std::time::Duration;
use std::sync::OnceLock;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const XAI_CHAT_COMPLETIONS_URL: &str = "https://api.x.ai/v1/chat/completions";
const GEMINI_GENERATE_CONTENT_BASE_URL: &str =
    "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODELS_URL: &str = "https://generativelanguage.googleapis.com/v1beta/openai/models";
const DEFAULT_OPENAI_COMPATIBLE_BASE_URL: &str = "https://api.openai.com/v1";
const REQUEST_TIMEOUT_SECONDS: u64 = 15;
const DEFAULT_TEMPERATURE: f64 = 0.1;
const XAI_PROVIDER: &str = "xai";
const OPENAI_COMPATIBLE_PROVIDER: &str = "openai_compatible";
const GEMINI_PROVIDER: &str = "gemini";
const XAI_RESPONSE_SHAPE_ERROR: &str =
    "xAI response shape unexpected — could not extract corrected text";
const OPENAI_COMPATIBLE_RESPONSE_SHAPE_ERROR: &str =
    "OpenAI-compatible response shape unexpected — could not extract corrected text";
const GEMINI_RESPONSE_SHAPE_ERROR: &str =
    "Gemini response shape unexpected — could not extract corrected text";
static SHARED_HTTP_CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();

fn shared_http_client() -> Result<&'static Client, String> {
    match SHARED_HTTP_CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECONDS))
            .build()
            .map_err(|error| error.to_string())
    }) {
        Ok(client) => Ok(client),
        Err(error) => Err(error.clone()),
    }
}

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
    pub context_general: Vec<SonioxContextGeneralEntry>,
    pub context_text: String,
    pub enable_endpoint_detection: bool,
    pub max_endpoint_delay_ms: Option<u32>,
    pub max_non_final_tokens_duration_ms: Option<u32>,
    pub language_hints: Vec<String>,
    pub language_hints_strict: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct SonioxContextGeneralEntry {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct LlmConfig {
    pub provider: Option<String>,
    pub model: Option<String>,
    pub temperature: Option<f64>,
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct VoiceConfig {
    pub stop_word: String,
}

pub async fn list_models(
    api_key: String,
    provider: &str,
    base_url: Option<&str>,
) -> Result<Vec<String>, String> {
    if api_key.trim().is_empty() {
        return Err(format!(
            "{} API key is not configured",
            provider_display_name(provider)
        ));
    }

    let endpoint = if provider == XAI_PROVIDER {
        "https://api.x.ai/v1/models".to_string()
    } else if provider == GEMINI_PROVIDER {
        GEMINI_MODELS_URL.to_string()
    } else {
        let base = base_url
            .unwrap_or(DEFAULT_OPENAI_COMPATIBLE_BASE_URL)
            .trim()
            .trim_end_matches('/');
        if base.is_empty() {
            return Err("OpenAI-compatible base URL is required".to_string());
        }
        format!("{base}/models")
    };

    let client = shared_http_client()?;

    let response = client
        .get(&endpoint)
        .bearer_auth(&api_key)
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                format!("Model list request timed out after {REQUEST_TIMEOUT_SECONDS} seconds")
            } else {
                error.to_string()
            }
        })?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        return Err(format_provider_api_error(provider, status, &body));
    }

    let payload = response
        .json::<Value>()
        .await
        .map_err(|error| error.to_string())?;

    let models = payload
        .get("data")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(Value::as_str).map(String::from))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if models.is_empty() {
        return Err("No models returned from provider".to_string());
    }

    Ok(models)
}

pub async fn correct_transcript(
    transcript: String,
    api_key: String,
    llm_config: LlmConfig,
    output_lang: String,
) -> Result<String, String> {
    if api_key.trim().is_empty() {
        return Err("LLM API key is not configured".to_string());
    }

    let provider = resolve_provider(&llm_config)?;
    validate_llm_config(&llm_config, provider)?;

    let client = shared_http_client()?;

    let request_body = build_request_body(transcript, &llm_config, &output_lang)?;
    let endpoint = completion_endpoint(provider, &llm_config)?;
    let request_builder = client.post(endpoint).json(&request_body);
    let request_builder = if provider == GEMINI_PROVIDER {
        request_builder.header("x-goog-api-key", api_key)
    } else {
        request_builder.bearer_auth(api_key)
    };
    let response = request_builder
        .send()
        .await
        .map_err(|error| map_http_error(provider, error))?;

    if !response.status().is_success() {
        let status = response.status();
        let response_body = response.text().await.unwrap_or_default();
        return Err(format_provider_api_error(
            provider,
            status.as_u16(),
            &response_body,
        ));
    }

    let payload = response
        .json::<Value>()
        .await
        .map_err(|error| error.to_string())?;
    extract_corrected_text_from_response(&payload, provider)
}

pub fn resolve_provider(llm_config: &LlmConfig) -> Result<&str, String> {
    let provider = llm_config
        .provider
        .as_deref()
        .unwrap_or(XAI_PROVIDER)
        .trim();
    if provider.is_empty() || provider == XAI_PROVIDER {
        return Ok(XAI_PROVIDER);
    }
    if provider == OPENAI_COMPATIBLE_PROVIDER {
        return Ok(OPENAI_COMPATIBLE_PROVIDER);
    }
    if provider == GEMINI_PROVIDER {
        return Ok(GEMINI_PROVIDER);
    }

    Err(format!("Unsupported LLM provider `{provider}`"))
}

pub fn validate_llm_config(llm_config: &LlmConfig, provider: &str) -> Result<(), String> {
    if provider == OPENAI_COMPATIBLE_PROVIDER {
        let base_url = llm_config
            .base_url
            .as_deref()
            .unwrap_or(DEFAULT_OPENAI_COMPATIBLE_BASE_URL)
            .trim();
        if base_url.is_empty() {
            return Err("OpenAI-compatible base URL is required".to_string());
        }
    }

    Ok(())
}

pub fn completion_endpoint(provider: &str, llm_config: &LlmConfig) -> Result<String, String> {
    if provider == XAI_PROVIDER {
        return Ok(XAI_CHAT_COMPLETIONS_URL.to_string());
    }
    if provider == GEMINI_PROVIDER {
        let model = required_model_for_provider(llm_config, provider)?;

        return Ok(format!(
            "{}/{}:generateContent",
            GEMINI_GENERATE_CONTENT_BASE_URL, model
        ));
    }

    let base_url = llm_config
        .base_url
        .as_deref()
        .unwrap_or(DEFAULT_OPENAI_COMPATIBLE_BASE_URL)
        .trim();

    if base_url.is_empty() {
        return Err("OpenAI-compatible base URL is required".to_string());
    }

    Ok(format!(
        "{}/chat/completions",
        base_url.trim_end_matches('/')
    ))
}

pub fn extract_corrected_text_from_response(
    payload: &Value,
    provider: &str,
) -> Result<String, String> {
    if provider == GEMINI_PROVIDER {
        let Some(candidates) = payload.get("candidates").and_then(Value::as_array) else {
            return Err(GEMINI_RESPONSE_SHAPE_ERROR.to_string());
        };

        let Some(first_candidate) = candidates.first() else {
            return Err(GEMINI_RESPONSE_SHAPE_ERROR.to_string());
        };

        let Some(parts) = first_candidate
            .get("content")
            .and_then(|content| content.get("parts"))
            .and_then(Value::as_array)
        else {
            return Err(GEMINI_RESPONSE_SHAPE_ERROR.to_string());
        };

        let Some(text) = parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .map(str::trim)
            .find(|value| !value.is_empty())
        else {
            return Err(GEMINI_RESPONSE_SHAPE_ERROR.to_string());
        };

        return Ok(text.to_string());
    }

    let response_shape_error = if provider == OPENAI_COMPATIBLE_PROVIDER {
        OPENAI_COMPATIBLE_RESPONSE_SHAPE_ERROR
    } else {
        XAI_RESPONSE_SHAPE_ERROR
    };

    let Some(choices) = payload.get("choices").and_then(Value::as_array) else {
        return Err(response_shape_error.to_string());
    };

    let Some(first_choice) = choices.first() else {
        return Err(response_shape_error.to_string());
    };

    let Some(content) = first_choice
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(extract_message_content_text)
    else {
        return Err(response_shape_error.to_string());
    };

    let corrected_text = content.trim();
    if corrected_text.is_empty() {
        return Err(response_shape_error.to_string());
    }

    Ok(corrected_text.to_string())
}

fn build_request_body(
    transcript: String,
    llm_config: &LlmConfig,
    output_lang: &str,
) -> Result<Value, String> {
    let provider = resolve_provider(llm_config).unwrap_or(XAI_PROVIDER);
    let system_prompt = system_prompt_for_output_language(output_lang);
    let user_prompt = format!(
        "## Voice Transcript (may have pronunciation errors):\n\"{}\"",
        transcript
    );

    if provider == GEMINI_PROVIDER {
        return Ok(json!({
          "systemInstruction": {
            "parts": [{ "text": system_prompt }]
          },
          "contents": [
            {
              "role": "user",
              "parts": [{ "text": user_prompt }]
            }
          ],
          "generationConfig": {
            "temperature": llm_config.temperature.unwrap_or(DEFAULT_TEMPERATURE)
          }
        }));
    }

    let model = required_model_for_provider(llm_config, provider)?;

    Ok(json!({
      "model": model,
      "temperature": llm_config.temperature.unwrap_or(DEFAULT_TEMPERATURE),
      "messages": [
        { "role": "system", "content": system_prompt },
        { "role": "user", "content": user_prompt }
      ]
    }))
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
        .and_then(extract_provider_error_message)
        .unwrap_or_else(|| "xAI returned an unexpected error response".to_string());

    format!("xAI API error ({status_code}): {message}")
}

pub fn format_openai_compatible_api_error(status_code: u16, response_body: &str) -> String {
    let message = serde_json::from_str::<Value>(response_body)
        .ok()
        .and_then(extract_provider_error_message)
        .unwrap_or_else(|| {
            "OpenAI-compatible provider returned an unexpected error response".to_string()
        });

    format!("OpenAI-compatible API error ({status_code}): {message}")
}

pub fn format_gemini_api_error(status_code: u16, response_body: &str) -> String {
    let parsed = serde_json::from_str::<Value>(response_body).ok();
    let message = parsed
        .as_ref()
        .and_then(|value| extract_provider_error_message(value.clone()))
        .unwrap_or_else(|| "Gemini returned an unexpected error response".to_string());
    let status = parsed
        .and_then(extract_gemini_error_status)
        .map(|value| format!(" {value}"))
        .unwrap_or_default();

    format!("Gemini API error ({status_code}{status}): {message}")
}

fn format_provider_api_error(provider: &str, status_code: u16, response_body: &str) -> String {
    if provider == OPENAI_COMPATIBLE_PROVIDER {
        return format_openai_compatible_api_error(status_code, response_body);
    }
    if provider == GEMINI_PROVIDER {
        return format_gemini_api_error(status_code, response_body);
    }

    format_xai_api_error(status_code, response_body)
}

fn map_http_error(provider: &str, error: reqwest::Error) -> String {
    if error.is_timeout() {
        if provider == OPENAI_COMPATIBLE_PROVIDER {
            return format!(
                "OpenAI-compatible request timed out after {REQUEST_TIMEOUT_SECONDS} seconds"
            );
        }
        if provider == GEMINI_PROVIDER {
            return format!("Gemini request timed out after {REQUEST_TIMEOUT_SECONDS} seconds");
        }
        return format!("xAI request timed out after {REQUEST_TIMEOUT_SECONDS} seconds");
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

fn extract_provider_error_message(payload: Value) -> Option<String> {
    payload
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .or_else(|| payload.get("message").and_then(Value::as_str))
        .map(str::trim)
        .filter(|message| !message.is_empty())
        .map(ToString::to_string)
}

fn extract_gemini_error_status(payload: Value) -> Option<String> {
    payload
        .get("error")
        .and_then(|error| error.get("status"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|status| !status.is_empty())
        .map(ToString::to_string)
}

fn required_model_for_provider(llm_config: &LlmConfig, provider: &str) -> Result<String, String> {
    let model = llm_config
        .model
        .clone()
        .unwrap_or_default()
        .trim()
        .to_string();

    if !model.is_empty() {
        return Ok(model);
    }

    if provider == GEMINI_PROVIDER {
        return Err("Gemini model is not configured. Refresh models and select one in Settings.".to_string());
    }
    if provider == OPENAI_COMPATIBLE_PROVIDER {
        return Err("OpenAI-compatible model is not configured. Refresh models and select one in Settings.".to_string());
    }

    Err("xAI model is not configured. Refresh models and select one in Settings.".to_string())
}

fn provider_display_name(provider: &str) -> &'static str {
    if provider == GEMINI_PROVIDER {
        return "Gemini";
    }
    if provider == OPENAI_COMPATIBLE_PROVIDER {
        return "OpenAI-compatible";
    }

    "xAI"
}

#[cfg(test)]
mod tests {
    use super::{build_request_body, LlmConfig};

    #[test]
    fn build_request_body_requires_explicit_model_for_xai() {
        let config = LlmConfig {
            provider: Some("xai".to_string()),
            model: None,
            temperature: Some(0.1),
            base_url: None,
        };

        let error = build_request_body("hello".to_string(), &config, "auto").unwrap_err();
        assert!(error.contains("xAI model is not configured"));
    }

    #[test]
    fn build_request_body_requires_explicit_model_for_openai_compatible() {
        let config = LlmConfig {
            provider: Some("openai_compatible".to_string()),
            model: None,
            temperature: Some(0.1),
            base_url: Some("https://api.openai.com/v1".to_string()),
        };

        let error = build_request_body("hello".to_string(), &config, "auto").unwrap_err();
        assert!(error.contains("OpenAI-compatible model is not configured"));
    }
}
