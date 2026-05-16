use std::sync::OnceLock;
use std::time::Duration;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::llm_provider::Provider;

const XAI_CHAT_COMPLETIONS_URL: &str = "https://api.x.ai/v1/chat/completions";
const XAI_MODELS_URL: &str = "https://api.x.ai/v1/models";
const GEMINI_GENERATE_CONTENT_BASE_URL: &str =
    "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODELS_URL: &str = "https://generativelanguage.googleapis.com/v1beta/openai/models";
const DEFAULT_OPENAI_COMPATIBLE_BASE_URL: &str = "https://api.openai.com/v1";
const REQUEST_TIMEOUT_SECONDS: u64 = 15;
const DEFAULT_TEMPERATURE: f64 = 0.1;
const RESPONSE_SHAPE_ERROR_SUFFIX: &str =
    "response shape unexpected — could not extract corrected text";
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
    let provider_kind = Provider::parse(provider)?;

    if api_key.trim().is_empty() {
        return Err(format!(
            "{} API key is not configured",
            provider_kind.display_name()
        ));
    }

    let endpoint = models_endpoint(provider_kind, base_url)?;
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
        return Err(format_provider_api_error(provider_kind, status, &body));
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
        return Err(empty_models_error_for(provider_kind));
    }

    Ok(models)
}

fn empty_models_error_for(provider: Provider) -> String {
    match provider {
        Provider::OpenAiCompatible => {
            // Empty OpenAI-compatible responses almost always mean the Base
            // URL points at an endpoint that does not implement the
            // `GET /v1/models` shape (e.g. a chat-completion URL, a
            // dashboard URL, or a non-OpenAI server). Surface that as the
            // probable cause so the user knows where to look first.
            "No models returned. Check your Base URL and API key.".to_string()
        }
        Provider::Xai | Provider::Gemini => {
            format!("No models returned from {}.", provider.display_name())
        }
    }
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

    let provider_kind = Provider::parse(llm_config.provider.as_deref().unwrap_or(""))?;
    validate_llm_config_for(&llm_config, provider_kind)?;

    let client = shared_http_client()?;

    let request_body = build_request_body_for(transcript, &llm_config, &output_lang, provider_kind)?;
    let endpoint = completion_endpoint_for(provider_kind, &llm_config)?;
    let request_builder = client.post(endpoint).json(&request_body);
    let request_builder = match provider_kind {
        Provider::Gemini => request_builder.header("x-goog-api-key", api_key),
        Provider::Xai | Provider::OpenAiCompatible => request_builder.bearer_auth(api_key),
    };
    let response = request_builder
        .send()
        .await
        .map_err(|error| map_http_error(provider_kind, error))?;

    if !response.status().is_success() {
        let status = response.status();
        let response_body = response.text().await.unwrap_or_default();
        return Err(format_provider_api_error(
            provider_kind,
            status.as_u16(),
            &response_body,
        ));
    }

    let payload = response
        .json::<Value>()
        .await
        .map_err(|error| error.to_string())?;
    extract_corrected_text_for(&payload, provider_kind)
}

/// Public string-based accessor preserved for the `native_services` test
/// surface and `commands.rs`. Callers receive the canonical `Provider::id()`
/// rather than the user-supplied trimmed string.
pub fn resolve_provider(llm_config: &LlmConfig) -> Result<&'static str, String> {
    Provider::parse(llm_config.provider.as_deref().unwrap_or("")).map(Provider::id)
}

pub fn validate_llm_config(llm_config: &LlmConfig, provider: &str) -> Result<(), String> {
    let provider_kind = Provider::parse(provider)?;
    validate_llm_config_for(llm_config, provider_kind)
}

pub fn completion_endpoint(provider: &str, llm_config: &LlmConfig) -> Result<String, String> {
    let provider_kind = Provider::parse(provider)?;
    completion_endpoint_for(provider_kind, llm_config)
}

pub fn extract_corrected_text_from_response(
    payload: &Value,
    provider: &str,
) -> Result<String, String> {
    let provider_kind = Provider::parse(provider)?;
    extract_corrected_text_for(payload, provider_kind)
}

fn validate_llm_config_for(llm_config: &LlmConfig, provider: Provider) -> Result<(), String> {
    if matches!(provider, Provider::OpenAiCompatible) {
        let base_url = openai_compatible_base_url(llm_config);
        if base_url.is_empty() {
            return Err("OpenAI-compatible base URL is required".to_string());
        }
    }

    Ok(())
}

fn completion_endpoint_for(provider: Provider, llm_config: &LlmConfig) -> Result<String, String> {
    match provider {
        Provider::Xai => Ok(XAI_CHAT_COMPLETIONS_URL.to_string()),
        Provider::Gemini => {
            let model = required_model_for(llm_config, provider)?;
            Ok(format!(
                "{}/{}:generateContent",
                GEMINI_GENERATE_CONTENT_BASE_URL, model
            ))
        }
        Provider::OpenAiCompatible => {
            let base_url = openai_compatible_base_url(llm_config);
            if base_url.is_empty() {
                return Err("OpenAI-compatible base URL is required".to_string());
            }
            Ok(format!("{}/chat/completions", base_url))
        }
    }
}

fn models_endpoint(provider: Provider, base_url: Option<&str>) -> Result<String, String> {
    match provider {
        Provider::Xai => Ok(XAI_MODELS_URL.to_string()),
        Provider::Gemini => Ok(GEMINI_MODELS_URL.to_string()),
        Provider::OpenAiCompatible => {
            let base = base_url
                .unwrap_or(DEFAULT_OPENAI_COMPATIBLE_BASE_URL)
                .trim()
                .trim_end_matches('/');
            if base.is_empty() {
                return Err("OpenAI-compatible base URL is required".to_string());
            }
            Ok(format!("{base}/models"))
        }
    }
}

fn extract_corrected_text_for(payload: &Value, provider: Provider) -> Result<String, String> {
    if matches!(provider, Provider::Gemini) {
        return extract_gemini_response_text(payload);
    }

    let response_shape_error = response_shape_error(provider);

    let Some(choices) = payload.get("choices").and_then(Value::as_array) else {
        return Err(response_shape_error);
    };

    let Some(first_choice) = choices.first() else {
        return Err(response_shape_error);
    };

    let Some(content) = first_choice
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(extract_message_content_text)
    else {
        return Err(response_shape_error);
    };

    let corrected_text = content.trim();
    if corrected_text.is_empty() {
        return Err(response_shape_error);
    }

    Ok(corrected_text.to_string())
}

fn extract_gemini_response_text(payload: &Value) -> Result<String, String> {
    let response_shape_error = response_shape_error(Provider::Gemini);

    let Some(candidates) = payload.get("candidates").and_then(Value::as_array) else {
        return Err(response_shape_error);
    };

    let Some(first_candidate) = candidates.first() else {
        return Err(response_shape_error);
    };

    let Some(parts) = first_candidate
        .get("content")
        .and_then(|content| content.get("parts"))
        .and_then(Value::as_array)
    else {
        return Err(response_shape_error);
    };

    let Some(text) = parts
        .iter()
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .map(str::trim)
        .find(|value| !value.is_empty())
    else {
        return Err(response_shape_error);
    };

    Ok(text.to_string())
}

fn response_shape_error(provider: Provider) -> String {
    format!("{} {RESPONSE_SHAPE_ERROR_SUFFIX}", provider.display_name())
}

fn build_request_body_for(
    transcript: String,
    llm_config: &LlmConfig,
    output_lang: &str,
    provider: Provider,
) -> Result<Value, String> {
    let system_prompt = system_prompt_for_output_language(output_lang);
    let user_prompt = format!(
        "## Voice Transcript (may have pronunciation errors):\n\"{}\"",
        transcript
    );

    if matches!(provider, Provider::Gemini) {
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

    let model = required_model_for(llm_config, provider)?;

    Ok(json!({
      "model": model,
      "temperature": llm_config.temperature.unwrap_or(DEFAULT_TEMPERATURE),
      "messages": [
        { "role": "system", "content": system_prompt },
        { "role": "user", "content": user_prompt }
      ]
    }))
}

const STT_FIX_TABLE: &str = "\
\"cross code\"/\"cloud code\"/\"cloth code\" → Claude Code
\"tea mux\"/\"tee mux\"/\"T mux\"/\"TMAX\" → tmux
\"tm send\"/\"T M send\"/\"team send\" → tm-send
\"L M\"/\"L.M.\"/\"elem\" → LLM
\"A.P.I\"/\"a p i\" → API
\"get hub\"/\"git hub\" → GitHub
\"pie test\"/\"pi test\" → pytest
\"you v\"/\"UV\" → uv
\"pee npm\"/\"P NPM\" → pnpm
\"salary\"/\"seller e\"/\"celery\" → Celery";

const CLEANUP_RULES: &str = "\
1. Keep ALL ideas and points — never drop information the user intended to convey.\n\
2. Merge repetitions — if the user restates the same idea, keep the clearest version once.\n\
3. Remove these fillers: uh, um, à, ờ, ừ, false starts, self-corrections.\n\
4. Clean rambling — if the user circles back, keep the clearest statement only.\n\
5. Keep ALL swear words and profanity intact — they signal frustration for analysis.";

fn system_prompt_for_output_language(output_lang: &str) -> String {
    let lang_block = match output_lang {
        "english" => concat!(
            "Output MUST be in English regardless of the input language. ",
            "Translate Vietnamese to natural, fluent English — translate meaning, not word-by-word. ",
            "Translate Vietnamese profanity to equivalent English swear words."
        ),
        "vietnamese" => concat!(
            "Output MUST be in Vietnamese. ",
            "Translate English prose to Vietnamese, but keep technical terms ",
            "(API, GitHub, pytest, tmux, Claude Code, etc.) in English. ",
            "Keep Vietnamese profanity as-is."
        ),
        _ => concat!(
            "Match the input language exactly — Vietnamese input → Vietnamese output, ",
            "English input → English output, mixed → mixed. Do NOT translate. ",
            "Keep profanity in whatever language it was spoken."
        ),
    };

    let cleanup_rules = CLEANUP_RULES;
    let stt_fixes = STT_FIX_TABLE;

    format!(
        "You correct voice transcriptions from a user who speaks mixed Vietnamese and English.\n\n\
         Rules:\n{cleanup_rules}\n\n\
         STT mishear fixes:\n{stt_fixes}\n\n\
         {lang_block}\n\n\
         Return ONLY the corrected text — no explanations, no quotes, no formatting."
    )
}

pub fn format_xai_api_error(status_code: u16, response_body: &str) -> String {
    format_provider_api_error(Provider::Xai, status_code, response_body)
}

pub fn format_openai_compatible_api_error(status_code: u16, response_body: &str) -> String {
    format_provider_api_error(Provider::OpenAiCompatible, status_code, response_body)
}

pub fn format_gemini_api_error(status_code: u16, response_body: &str) -> String {
    format_provider_api_error(Provider::Gemini, status_code, response_body)
}

fn format_provider_api_error(provider: Provider, status_code: u16, response_body: &str) -> String {
    let parsed = serde_json::from_str::<Value>(response_body).ok();
    let message = parsed
        .as_ref()
        .and_then(|value| extract_provider_error_message(value.clone()))
        .unwrap_or_else(|| {
            format!(
                "{} returned an unexpected error response",
                provider.display_name()
            )
        });

    if matches!(provider, Provider::Gemini) {
        let status = parsed
            .and_then(extract_gemini_error_status)
            .map(|value| format!(" {value}"))
            .unwrap_or_default();
        return format!(
            "{} API error ({status_code}{status}): {message}",
            provider.display_name()
        );
    }

    format!(
        "{} API error ({status_code}): {message}",
        provider.display_name()
    )
}

fn map_http_error(provider: Provider, error: reqwest::Error) -> String {
    if error.is_timeout() {
        return format!(
            "{} request timed out after {REQUEST_TIMEOUT_SECONDS} seconds",
            provider.display_name()
        );
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

fn openai_compatible_base_url(llm_config: &LlmConfig) -> String {
    llm_config
        .base_url
        .as_deref()
        .unwrap_or(DEFAULT_OPENAI_COMPATIBLE_BASE_URL)
        .trim()
        .trim_end_matches('/')
        .to_string()
}

fn required_model_for(llm_config: &LlmConfig, provider: Provider) -> Result<String, String> {
    let model = llm_config
        .model
        .clone()
        .unwrap_or_default()
        .trim()
        .to_string();

    if !model.is_empty() {
        return Ok(model);
    }

    Err(format!(
        "{} model is not configured. Refresh models and select one in Settings.",
        provider.display_name()
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        build_request_body_for, empty_models_error_for, system_prompt_for_output_language,
        LlmConfig, Provider,
    };

    #[test]
    fn build_request_body_requires_explicit_model_for_xai() {
        let config = LlmConfig {
            provider: Some("xai".to_string()),
            model: None,
            temperature: Some(0.1),
            base_url: None,
        };

        let error =
            build_request_body_for("hello".to_string(), &config, "auto", Provider::Xai).unwrap_err();
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

        let error = build_request_body_for(
            "hello".to_string(),
            &config,
            "auto",
            Provider::OpenAiCompatible,
        )
        .unwrap_err();
        assert!(error.contains("OpenAI-compatible model is not configured"));
    }

    #[test]
    fn empty_models_error_for_openai_compatible_names_base_url_and_key() {
        let message = empty_models_error_for(Provider::OpenAiCompatible);
        assert!(message.contains("Base URL"), "got: {message}");
        assert!(message.contains("API key"), "got: {message}");
    }

    #[test]
    fn empty_models_error_for_xai_names_the_provider() {
        let message = empty_models_error_for(Provider::Xai);
        assert!(message.contains("xAI"), "got: {message}");
        assert!(
            !message.contains("Base URL"),
            "xAI message should not mention Base URL: {message}"
        );
    }

    #[test]
    fn empty_models_error_for_gemini_names_the_provider() {
        let message = empty_models_error_for(Provider::Gemini);
        assert!(message.contains("Gemini"), "got: {message}");
        assert!(
            !message.contains("Base URL"),
            "Gemini message should not mention Base URL: {message}"
        );
    }

    #[test]
    fn english_prompt_demands_english_output_regardless_of_input() {
        let prompt = system_prompt_for_output_language("english");
        assert!(prompt.contains("English regardless of the input language"));
        assert!(prompt.contains("Translate Vietnamese"));
    }

    #[test]
    fn vietnamese_prompt_keeps_technical_terms_in_english() {
        let prompt = system_prompt_for_output_language("vietnamese");
        assert!(prompt.contains("Vietnamese"));
        assert!(prompt.contains("technical terms"));
        // The bare technical-term examples must remain (API, GitHub, etc.)
        // so the model knows what to leave untranslated.
        assert!(prompt.contains("GitHub"));
        assert!(prompt.contains("tmux"));
    }

    #[test]
    fn auto_prompt_matches_input_language_without_translating() {
        let prompt = system_prompt_for_output_language("auto");
        assert!(prompt.contains("Match the input language exactly"));
        assert!(prompt.contains("Do NOT translate"));
    }

    #[test]
    fn unknown_output_language_falls_back_to_auto_behavior() {
        let prompt = system_prompt_for_output_language("klingon");
        assert!(prompt.contains("Match the input language exactly"));
    }

    #[test]
    fn every_prompt_carries_the_shared_cleanup_rules_and_stt_fix_table() {
        for output_lang in ["auto", "english", "vietnamese", "unknown"] {
            let prompt = system_prompt_for_output_language(output_lang);
            // Shared cleanup rule: keep all ideas. Pinned because moving it
            // out of the prompt would silently drop a contract the LLM
            // depends on.
            assert!(
                prompt.contains("Keep ALL ideas"),
                "missing cleanup rules for output_lang={output_lang}",
            );
            // Shared STT mishear fix: "cross code" → Claude Code.
            assert!(
                prompt.contains("Claude Code"),
                "missing STT fix table for output_lang={output_lang}",
            );
        }
    }
}
