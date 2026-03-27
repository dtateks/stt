use std::time::Duration;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const XAI_CHAT_COMPLETIONS_URL: &str = "https://api.x.ai/v1/chat/completions";
const REQUEST_TIMEOUT_SECONDS: u64 = 15;
const DEFAULT_MODEL: &str = "grok-4-1-fast-non-reasoning";
const DEFAULT_TEMPERATURE: f64 = 0.1;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LlmConfig {
    pub model: Option<String>,
    pub temperature: Option<f64>,
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
        return Err(format!("xAI API error ({status}): {response_body}"));
    }

    let payload = response
        .json::<Value>()
        .await
        .map_err(|error| error.to_string())?;
    extract_corrected_text_from_response(&payload)
}

pub fn extract_corrected_text_from_response(payload: &Value) -> Result<String, String> {
    let Some(choices) = payload.get("choices").and_then(Value::as_array) else {
        return Err("xAI response shape unexpected — could not extract corrected text".to_string());
    };

    let Some(first_choice) = choices.first() else {
        return Err("xAI response shape unexpected — could not extract corrected text".to_string());
    };

    let Some(content) = first_choice
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
    else {
        return Err("xAI response shape unexpected — could not extract corrected text".to_string());
    };

    Ok(content.trim().to_string())
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

fn map_http_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        return "xAI request timed out after 15 seconds".to_string();
    }

    error.to_string()
}
