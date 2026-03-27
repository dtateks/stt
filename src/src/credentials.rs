use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::shell_credentials::get_credentials_from_shell_environment;

const CREDENTIALS_DIRECTORY_NAME: &str = "voice-to-text";

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    pub xai_key: String,
    pub soniox_key: String,
}

impl Credentials {
    pub fn empty() -> Self {
        Self {
            xai_key: String::new(),
            soniox_key: String::new(),
        }
    }
}

pub fn get_credentials(app: &AppHandle) -> Result<Credentials, String> {
    let store = read_store(app)?;
    let env_credentials = get_env_credentials();
    let needs_shell_fallback = (store.xai_key.is_empty() && env_credentials.xai_key.is_empty())
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
    if soniox_key.trim().is_empty() {
        return Err("Soniox API key is required".to_string());
    }

    write_store(
        app,
        &Credentials {
            xai_key,
            soniox_key,
        },
    )
}

pub fn save_xai_key(app: &AppHandle, xai_key: String) -> Result<(), String> {
    let mut current = read_store(app)?;
    current.xai_key = xai_key;
    write_store(app, &current)
}

pub fn clear_credentials(app: &AppHandle) -> Result<(), String> {
    let credentials_path = get_credentials_path(app)?;
    remove_file_if_exists(&credentials_path)
}

fn get_env_credentials() -> Credentials {
    Credentials {
        xai_key: env::var("XAI_API_KEY").unwrap_or_default(),
        soniox_key: env::var("SONIOX_API_KEY").unwrap_or_default(),
    }
}

fn read_store(app: &AppHandle) -> Result<Credentials, String> {
    let file_path = get_credentials_path(app)?;
    if !file_path.exists() {
        return Ok(Credentials::empty());
    }

    let raw_data = fs::read_to_string(file_path).map_err(|error| error.to_string())?;
    serde_json::from_str::<Credentials>(&raw_data)
        .map_err(|_| String::new())
        .or_else(|_| Ok(Credentials::empty()))
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
