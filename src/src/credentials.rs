use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::shell_credentials::get_credentials_from_shell_environment;

const CREDENTIALS_DIRECTORY_NAME: &str = "voice-to-text";

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct Credentials {
    pub xai_key: String,
    pub gemini_key: String,
    pub openai_compatible_key: String,
    pub soniox_key: String,
}

impl Credentials {
    pub fn empty() -> Self {
        Self {
            xai_key: String::new(),
            gemini_key: String::new(),
            openai_compatible_key: String::new(),
            soniox_key: String::new(),
        }
    }
}

pub fn get_credentials(app: &AppHandle) -> Result<Credentials, String> {
    let env_credentials = get_env_credentials();
    let store = load_stored_credentials_or_empty(read_store(app));
    let needs_shell_fallback = (store.xai_key.is_empty() && env_credentials.xai_key.is_empty())
        || (store.gemini_key.is_empty() && env_credentials.gemini_key.is_empty())
        || (store.openai_compatible_key.is_empty()
            && env_credentials.openai_compatible_key.is_empty())
        || (store.soniox_key.is_empty() && env_credentials.soniox_key.is_empty());

    let shell_credentials = if needs_shell_fallback {
        get_credentials_from_shell_environment()
    } else {
        Credentials::empty()
    };

    Ok(resolve_credentials_with_precedence(
        &store,
        &env_credentials,
        &shell_credentials,
    ))
}

pub fn resolve_credentials_with_precedence(
    store: &Credentials,
    env_credentials: &Credentials,
    shell_credentials: &Credentials,
) -> Credentials {
    Credentials {
        xai_key: first_non_empty([
            store.xai_key.as_str(),
            env_credentials.xai_key.as_str(),
            shell_credentials.xai_key.as_str(),
        ]),
        gemini_key: first_non_empty([
            store.gemini_key.as_str(),
            env_credentials.gemini_key.as_str(),
            shell_credentials.gemini_key.as_str(),
        ]),
        openai_compatible_key: first_non_empty([
            store.openai_compatible_key.as_str(),
            env_credentials.openai_compatible_key.as_str(),
            shell_credentials.openai_compatible_key.as_str(),
        ]),
        soniox_key: first_non_empty([
            store.soniox_key.as_str(),
            env_credentials.soniox_key.as_str(),
            shell_credentials.soniox_key.as_str(),
        ]),
    }
}

pub fn save_credentials(
    app: &AppHandle,
    xai_key: String,
    soniox_key: String,
) -> Result<(), String> {
    let trimmed_soniox_key = soniox_key.trim().to_string();
    if trimmed_soniox_key.is_empty() {
        return Err("Soniox API key is required".to_string());
    }

    let mut current = read_store(app)?;
    current.xai_key = xai_key;
    current.soniox_key = trimmed_soniox_key;
    write_store_with_readback_verification(app, &current)
}

pub fn save_xai_key(app: &AppHandle, xai_key: String) -> Result<(), String> {
    let mut current = read_store(app)?;
    current.xai_key = xai_key;
    write_store_with_readback_verification(app, &current)
}

pub fn save_openai_compatible_key(
    app: &AppHandle,
    openai_compatible_key: String,
) -> Result<(), String> {
    let mut current = read_store(app)?;
    current.openai_compatible_key = openai_compatible_key;
    write_store_with_readback_verification(app, &current)
}

pub fn save_gemini_key(app: &AppHandle, gemini_key: String) -> Result<(), String> {
    let mut current = read_store(app)?;
    current.gemini_key = gemini_key;
    write_store_with_readback_verification(app, &current)
}

pub fn save_soniox_key(app: &AppHandle, soniox_key: String) -> Result<(), String> {
    let trimmed_soniox_key = soniox_key.trim().to_string();
    if trimmed_soniox_key.is_empty() {
        return Err("Soniox API key is required".to_string());
    }

    let mut current = read_store(app)?;
    current.soniox_key = trimmed_soniox_key;
    write_store_with_readback_verification(app, &current)
}

pub fn clear_credentials(app: &AppHandle) -> Result<(), String> {
    let credentials_path = get_credentials_path(app)?;
    remove_file_if_exists(&credentials_path)
}

fn get_env_credentials() -> Credentials {
    Credentials {
        xai_key: env::var("XAI_API_KEY").unwrap_or_default(),
        gemini_key: env::var("GEMINI_API_KEY").unwrap_or_default(),
        openai_compatible_key: env::var("OPENAI_COMPATIBLE_API_KEY")
            .or_else(|_| env::var("OPENAI_API_KEY"))
            .unwrap_or_default(),
        soniox_key: env::var("SONIOX_API_KEY").unwrap_or_default(),
    }
}

fn read_store(app: &AppHandle) -> Result<Credentials, String> {
    let file_path = get_credentials_path(app)?;
    if !file_path.exists() {
        return Ok(Credentials::empty());
    }

    let raw_data = fs::read_to_string(file_path).map_err(|error| error.to_string())?;
    Ok(parse_stored_credentials_or_empty(&raw_data))
}

pub fn parse_stored_credentials(raw_data: &str) -> Result<Credentials, String> {
    serde_json::from_str::<Credentials>(raw_data)
        .map_err(|error| format!("Stored credentials are invalid JSON: {error}"))
}

pub fn parse_stored_credentials_or_empty(raw_data: &str) -> Credentials {
    load_stored_credentials_or_empty(parse_stored_credentials(raw_data))
}

pub fn load_stored_credentials_or_empty(result: Result<Credentials, String>) -> Credentials {
    match result {
        Ok(credentials) => credentials,
        Err(error) => {
            eprintln!("[credentials] {error}; ignoring stored credentials file");
            Credentials::empty()
        }
    }
}

fn write_store(app: &AppHandle, credentials: &Credentials) -> Result<(), String> {
    let file_path = get_credentials_path(app)?;
    if let Some(parent_dir) = file_path.parent() {
        fs::create_dir_all(parent_dir).map_err(|error| error.to_string())?;
    }

    let serialized =
        serde_json::to_string_pretty(credentials).map_err(|error| error.to_string())?;
    fs::write(file_path, serialized).map_err(|error| error.to_string())
}

fn write_store_with_readback_verification(
    app: &AppHandle,
    credentials: &Credentials,
) -> Result<(), String> {
    write_store(app, credentials)?;

    let persisted = read_store(app)?;
    verify_persisted_credentials_match_expected(&persisted, credentials)
}

fn verify_persisted_credentials_match_expected(
    persisted: &Credentials,
    expected: &Credentials,
) -> Result<(), String> {
    if persisted == expected {
        return Ok(());
    }

    Err("Stored credentials could not be verified after save".to_string())
}

fn get_credentials_path(app: &AppHandle) -> Result<PathBuf, String> {
    let credentials_directory = get_credentials_directory_path(app)?;
    Ok(credentials_directory.join("credentials.json"))
}

fn get_credentials_directory_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    Ok(app_data_path.join(CREDENTIALS_DIRECTORY_NAME))
}

fn remove_file_if_exists(path: &Path) -> Result<(), String> {
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn first_non_empty(candidates: [&str; 3]) -> String {
    candidates
        .iter()
        .find(|value| !value.is_empty())
        .copied()
        .unwrap_or_default()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::{verify_persisted_credentials_match_expected, Credentials};

    #[test]
    fn persisted_credentials_verification_accepts_exact_round_trip() {
        let expected = Credentials {
            xai_key: "xai".to_string(),
            gemini_key: "gemini".to_string(),
            openai_compatible_key: "openai".to_string(),
            soniox_key: "soniox".to_string(),
        };

        assert_eq!(
            verify_persisted_credentials_match_expected(&expected, &expected),
            Ok(())
        );
    }

    #[test]
    fn persisted_credentials_verification_rejects_mismatch() {
        let expected = Credentials {
            xai_key: "xai".to_string(),
            gemini_key: String::new(),
            openai_compatible_key: String::new(),
            soniox_key: "soniox".to_string(),
        };
        let persisted = Credentials {
            xai_key: "xai".to_string(),
            gemini_key: String::new(),
            openai_compatible_key: String::new(),
            soniox_key: String::new(),
        };

        let error = verify_persisted_credentials_match_expected(&persisted, &expected)
            .expect_err("mismatched credentials should fail verification");

        assert!(error.contains("Stored credentials could not be verified after save"));
    }
}
