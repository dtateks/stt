use std::sync::OnceLock;
use std::time::Duration;

use reqwest::Client;
use serde_json::{json, Value};

const SONIOX_TEMP_KEY_ENDPOINT: &str = "https://api.soniox.com/v1/auth/temporary-api-key";
const SONIOX_TEMP_KEY_USAGE_TYPE: &str = "transcribe_websocket";
const SONIOX_TEMP_KEY_EXPIRATION_SECONDS: u64 = 3_600;
const REQUEST_TIMEOUT_SECONDS: u64 = 15;
const SONIOX_KEY_REQUIRED_MESSAGE: &str = "Soniox API key is required";

#[derive(Debug, Clone)]
pub struct SonioxTemporaryKey {
    pub api_key: String,
    pub expires_at: Option<String>,
    pub expires_in_seconds: Option<u64>,
}

static SONIOX_AUTH_HTTP_CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();

fn temporary_api_key_request_payload() -> Value {
    json!({
        "usage_type": SONIOX_TEMP_KEY_USAGE_TYPE,
        "expires_in_seconds": SONIOX_TEMP_KEY_EXPIRATION_SECONDS,
    })
}

fn soniox_auth_http_client() -> Result<&'static Client, String> {
    match SONIOX_AUTH_HTTP_CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECONDS))
            .build()
            .map_err(|error| error.to_string())
    }) {
        Ok(client) => Ok(client),
        Err(error) => Err(error.clone()),
    }
}

pub async fn create_temporary_api_key(
    long_lived_api_key: String,
) -> Result<SonioxTemporaryKey, String> {
    let trimmed_long_lived_api_key = long_lived_api_key.trim().to_string();
    if trimmed_long_lived_api_key.is_empty() {
        return Err(SONIOX_KEY_REQUIRED_MESSAGE.to_string());
    }

    let client = soniox_auth_http_client()?;

    let response = client
        .post(SONIOX_TEMP_KEY_ENDPOINT)
        .bearer_auth(trimmed_long_lived_api_key)
        .json(&temporary_api_key_request_payload())
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                format!(
                    "Soniox temporary key request timed out after {REQUEST_TIMEOUT_SECONDS} seconds"
                )
            } else {
                format!("Soniox temporary key request failed: {error}")
            }
        })?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Soniox temporary key request failed ({status}): {body}"
        ));
    }

    let payload = response
        .json::<Value>()
        .await
        .map_err(|error| format!("Could not parse Soniox temporary key response: {error}"))?;

    let api_key = payload
        .get("api_key")
        .and_then(Value::as_str)
        .or_else(|| payload.get("temporary_api_key").and_then(Value::as_str))
        .or_else(|| {
            payload
                .get("data")
                .and_then(|value| value.get("api_key"))
                .and_then(Value::as_str)
        })
        .map(str::trim)
        .unwrap_or_default()
        .to_string();

    if api_key.is_empty() {
        return Err("Soniox temporary key response did not include api_key".to_string());
    }

    Ok(SonioxTemporaryKey {
        api_key,
        expires_at: payload
            .get("expires_at")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .or_else(|| {
                payload
                    .get("data")
                    .and_then(|value| value.get("expires_at"))
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            }),
        expires_in_seconds: payload
            .get("expires_in_seconds")
            .and_then(Value::as_u64)
            .or_else(|| {
                payload
                    .get("data")
                    .and_then(|value| value.get("expires_in_seconds"))
                    .and_then(Value::as_u64)
            }),
    })
}

#[cfg(test)]
mod tests {
    use super::{create_temporary_api_key, temporary_api_key_request_payload, SONIOX_KEY_REQUIRED_MESSAGE};
    use serde_json::json;

    #[test]
    fn temporary_api_key_request_payload_includes_required_expiration() {
        assert_eq!(
            temporary_api_key_request_payload(),
            json!({
                "usage_type": "transcribe_websocket",
                "expires_in_seconds": 3600,
            })
        );
    }

    #[test]
    fn create_temporary_api_key_rejects_blank_long_lived_key() {
        let error = tauri::async_runtime::block_on(create_temporary_api_key("   ".to_string()))
            .expect_err("blank Soniox keys should fail before network call");

        assert_eq!(error, SONIOX_KEY_REQUIRED_MESSAGE);
    }
}
