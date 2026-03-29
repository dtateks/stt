use std::fs;
use std::path::PathBuf;

use serde_json::json;

use voice_to_text_lib::credentials::{
    load_stored_credentials_or_empty, parse_stored_credentials, parse_stored_credentials_or_empty,
    resolve_credentials_with_precedence, Credentials,
};
use voice_to_text_lib::llm_service::{
    extract_corrected_text_from_response, format_gemini_api_error,
    format_openai_compatible_api_error, format_xai_api_error, resolve_provider,
    validate_llm_config, AppConfig, LlmConfig,
};
use voice_to_text_lib::shell_credentials::{
    parse_shell_environment_output, parse_shell_environment_result,
};

#[test]
fn credential_precedence_is_store_then_env_then_shell() {
    let store = Credentials {
        xai_key: "store-xai".to_string(),
        gemini_key: "store-gemini".to_string(),
        openai_compatible_key: "store-openai".to_string(),
        soniox_key: String::new(),
    };
    let env = Credentials {
        xai_key: "env-xai".to_string(),
        gemini_key: "env-gemini".to_string(),
        openai_compatible_key: "env-openai".to_string(),
        soniox_key: "env-soniox".to_string(),
    };
    let shell = Credentials {
        xai_key: "shell-xai".to_string(),
        gemini_key: "shell-gemini".to_string(),
        openai_compatible_key: "shell-openai".to_string(),
        soniox_key: "shell-soniox".to_string(),
    };

    let resolved = resolve_credentials_with_precedence(&store, &env, &shell);

    assert_eq!(resolved.xai_key, "store-xai");
    assert_eq!(resolved.gemini_key, "store-gemini");
    assert_eq!(resolved.openai_compatible_key, "store-openai");
    assert_eq!(resolved.soniox_key, "env-soniox");
}

#[test]
fn shell_parser_extracts_credentials_between_markers() {
    let payload = [
        b"shell noise\0".as_slice(),
        b"__VOICE_TO_TEXT_ENV_START__\0".as_slice(),
        b"PATH=/usr/bin\0".as_slice(),
        b"SONIOX_API_KEY=shell-soniox\0".as_slice(),
        b"XAI_API_KEY=shell-xai\0".as_slice(),
        b"GEMINI_API_KEY=shell-gemini\0".as_slice(),
        b"OPENAI_COMPATIBLE_API_KEY=shell-openai\0".as_slice(),
        b"__VOICE_TO_TEXT_ENV_END__\0".as_slice(),
    ]
    .concat();

    let parsed = parse_shell_environment_output(&payload);

    assert_eq!(parsed.soniox_key, "shell-soniox");
    assert_eq!(parsed.xai_key, "shell-xai");
    assert_eq!(parsed.gemini_key, "shell-gemini");
    assert_eq!(parsed.openai_compatible_key, "shell-openai");
}

#[test]
fn shell_parser_keeps_credentials_even_if_shell_exit_status_is_non_zero() {
    let payload = [
        b"shell noise\0".as_slice(),
        b"__VOICE_TO_TEXT_ENV_START__\0".as_slice(),
        b"SONIOX_API_KEY=shell-soniox\0".as_slice(),
        b"XAI_API_KEY=shell-xai\0".as_slice(),
        b"GEMINI_API_KEY=shell-gemini\0".as_slice(),
        b"OPENAI_COMPATIBLE_API_KEY=shell-openai\0".as_slice(),
        b"__VOICE_TO_TEXT_ENV_END__\0".as_slice(),
    ]
    .concat();

    let parsed = parse_shell_environment_result(false, &payload);

    assert_eq!(parsed.soniox_key, "shell-soniox");
    assert_eq!(parsed.xai_key, "shell-xai");
    assert_eq!(parsed.gemini_key, "shell-gemini");
    assert_eq!(parsed.openai_compatible_key, "shell-openai");
}

#[test]
fn shell_parser_uses_openai_api_key_as_fallback_for_openai_compatible_key() {
    let payload = [
        b"shell noise\0".as_slice(),
        b"__VOICE_TO_TEXT_ENV_START__\0".as_slice(),
        b"OPENAI_API_KEY=shell-openai\0".as_slice(),
        b"__VOICE_TO_TEXT_ENV_END__\0".as_slice(),
    ]
    .concat();

    let parsed = parse_shell_environment_output(&payload);

    assert_eq!(parsed.openai_compatible_key, "shell-openai");
}

#[test]
fn llm_response_parser_validates_required_fields() {
    let valid_payload = json!({
      "choices": [
        { "message": { "content": " corrected text " } }
      ]
    });

    let parsed = extract_corrected_text_from_response(&valid_payload, "xai").unwrap();
    assert_eq!(parsed, "corrected text");

    let invalid_payload = json!({ "choices": [] });
    let error = extract_corrected_text_from_response(&invalid_payload, "xai").unwrap_err();
    assert!(error.contains("response shape unexpected"));
}

#[test]
fn llm_response_parser_supports_structured_content_blocks() {
    let payload = json!({
      "choices": [
        {
          "message": {
            "content": [
              { "type": "text", "text": " corrected " }
            ]
          }
        }
      ]
    });

    let parsed = extract_corrected_text_from_response(&payload, "xai").unwrap();

    assert_eq!(parsed, "corrected");
}

#[test]
fn llm_response_parser_supports_gemini_candidate_shape() {
    let payload = json!({
      "candidates": [
        {
          "content": {
            "parts": [
              { "text": " corrected by gemini " }
            ]
          }
        }
      ]
    });

    let parsed = extract_corrected_text_from_response(&payload, "gemini").unwrap();

    assert_eq!(parsed, "corrected by gemini");
}

#[test]
fn llm_response_parser_rejects_blank_text() {
    let payload = json!({
      "choices": [
        { "message": { "content": "   " } }
      ]
    });

    let error = extract_corrected_text_from_response(&payload, "xai").unwrap_err();

    assert!(error.contains("response shape unexpected"));
}

#[test]
fn stored_credentials_parser_reports_invalid_json() {
    let error = parse_stored_credentials("{not-json}").unwrap_err();

    assert!(error.contains("Stored credentials are invalid JSON"));
}

#[test]
fn stored_credentials_parser_falls_back_to_empty_credentials_on_invalid_json() {
    let parsed = parse_stored_credentials_or_empty("{not-json}");

    assert_eq!(parsed, Credentials::empty());
}

#[test]
fn stored_credentials_loader_falls_back_to_empty_on_store_errors() {
    let parsed = load_stored_credentials_or_empty(Err("store path unavailable".to_string()));

    assert_eq!(parsed, Credentials::empty());
}

#[test]
fn llm_config_validator_rejects_unknown_provider() {
    let error = resolve_provider(&LlmConfig {
        provider: Some("openai".to_string()),
        model: None,
        temperature: None,
        base_url: None,
    })
    .unwrap_err();

    assert!(error.contains("Unsupported LLM provider `openai`"));
}

#[test]
fn llm_config_validator_accepts_gemini_provider() {
    let config = LlmConfig {
        provider: Some("gemini".to_string()),
        model: None,
        temperature: None,
        base_url: None,
    };
    let provider = resolve_provider(&config).unwrap();

    assert_eq!(provider, "gemini");
}

#[test]
fn llm_config_validator_requires_openai_compatible_base_url() {
    let config = LlmConfig {
        provider: Some("openai_compatible".to_string()),
        model: Some("gpt-4o-mini".to_string()),
        temperature: Some(0.1),
        base_url: Some("   ".to_string()),
    };

    let provider = resolve_provider(&config).unwrap();
    let error = validate_llm_config(&config, provider).unwrap_err();

    assert!(error.contains("OpenAI-compatible base URL is required"));
}

#[test]
fn xai_error_formatter_prefers_structured_message() {
    let formatted = format_xai_api_error(
        401,
        r#"{"error":{"message":"Invalid API key"},"request_id":"req-123"}"#,
    );

    assert_eq!(formatted, "xAI API error (401): Invalid API key");
}

#[test]
fn openai_compatible_error_formatter_prefers_structured_message() {
    let formatted = format_openai_compatible_api_error(
        401,
        r#"{"error":{"message":"Invalid API key"},"request_id":"req-123"}"#,
    );

    assert_eq!(
        formatted,
        "OpenAI-compatible API error (401): Invalid API key"
    );
}

#[test]
fn gemini_error_formatter_includes_status_and_message() {
    let formatted = format_gemini_api_error(
        429,
        r#"{"error":{"status":"RESOURCE_EXHAUSTED","message":"Quota exceeded"}}"#,
    );

    assert_eq!(
        formatted,
        "Gemini API error (429 RESOURCE_EXHAUSTED): Quota exceeded"
    );
}

#[test]
fn bundled_config_deserializes_into_runtime_contract() {
    let config_path = project_root().join("config.json");
    let raw_config = fs::read_to_string(config_path).unwrap();

    let parsed = serde_json::from_str::<AppConfig>(&raw_config).unwrap();

    assert_eq!(parsed.llm.provider.as_deref(), Some("xai"));
    assert_eq!(
        parsed.llm.model.as_deref(),
        Some("grok-4-1-fast-non-reasoning")
    );
    assert_eq!(
        parsed.llm.base_url.as_deref(),
        Some("https://api.openai.com/v1")
    );
    assert_eq!(parsed.voice.stop_word, "thank you");
    assert_eq!(parsed.soniox.sample_rate, 16000);
}

fn project_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .to_path_buf()
}
