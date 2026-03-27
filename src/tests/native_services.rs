use serde_json::json;

use voice_to_text_lib::credentials::{resolve_credentials_with_precedence, Credentials};
use voice_to_text_lib::llm_service::extract_corrected_text_from_response;
use voice_to_text_lib::shell_credentials::parse_shell_environment_output;

#[test]
fn credential_precedence_is_store_then_env_then_shell() {
    let store = Credentials {
        xai_key: "store-xai".to_string(),
        soniox_key: String::new(),
    };
    let env = Credentials {
        xai_key: "env-xai".to_string(),
        soniox_key: "env-soniox".to_string(),
    };
    let shell = Credentials {
        xai_key: "shell-xai".to_string(),
        soniox_key: "shell-soniox".to_string(),
    };

    let resolved = resolve_credentials_with_precedence(&store, &env, &shell);

    assert_eq!(resolved.xai_key, "store-xai");
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
        b"__VOICE_TO_TEXT_ENV_END__\0".as_slice(),
    ]
    .concat();

    let parsed = parse_shell_environment_output(&payload);

    assert_eq!(parsed.soniox_key, "shell-soniox");
    assert_eq!(parsed.xai_key, "shell-xai");
}

#[test]
fn llm_response_parser_validates_required_fields() {
    let valid_payload = json!({
      "choices": [
        { "message": { "content": " corrected text " } }
      ]
    });

    let parsed = extract_corrected_text_from_response(&valid_payload).unwrap();
    assert_eq!(parsed, "corrected text");

    let invalid_payload = json!({ "choices": [] });
    let error = extract_corrected_text_from_response(&invalid_payload).unwrap_err();
    assert!(error.contains("response shape unexpected"));
}
