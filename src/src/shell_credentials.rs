use std::env;
use std::process::Command;
use std::sync::{Mutex, OnceLock};

use crate::credentials::Credentials;

const SHELL_ENV_MAX_BUFFER_BYTES: usize = 1024 * 1024;
const SHELL_ENV_START_MARKER: &str = "__VOICE_TO_TEXT_ENV_START__";
const SHELL_ENV_END_MARKER: &str = "__VOICE_TO_TEXT_ENV_END__";

static CACHED_CREDENTIALS: OnceLock<Mutex<Option<Credentials>>> = OnceLock::new();

pub fn get_credentials_from_shell_environment() -> Credentials {
    let cache = CACHED_CREDENTIALS.get_or_init(|| Mutex::new(None));

    if let Some(cached) = cache.lock().ok().and_then(|guard| guard.clone()) {
        return cached;
    }

    let resolved = read_credentials_from_shell();

    if has_any_credential(&resolved) {
        if let Ok(mut guard) = cache.lock() {
            *guard = Some(resolved.clone());
        }
    }

    resolved
}

fn read_credentials_from_shell() -> Credentials {
    let shell_path = get_user_shell_path();

    let mut command = Command::new(shell_path);
    command.args(get_shell_command_arguments(
        &command.get_program().to_string_lossy(),
    ));
    command.env(
        "TERM",
        env::var("TERM").unwrap_or_else(|_| "dumb".to_string()),
    );

    let Ok(output) = command.output() else {
        return Credentials::empty();
    };

    parse_shell_environment_result(output.status.success(), &output.stdout)
}

fn get_user_shell_path() -> String {
    env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
}

fn get_shell_command_arguments(shell_path: &str) -> [String; 2] {
    let shell_name = shell_path
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_string();
    let launch_mode = if shell_name == "zsh" || shell_name == "bash" {
        "-ilc"
    } else {
        "-lc"
    };

    [launch_mode.to_string(), build_shell_environment_command()]
}

fn build_shell_environment_command() -> String {
    [
        format!("printf '%s\\0' '{}'", SHELL_ENV_START_MARKER),
        "env -0".to_string(),
        format!("printf '%s\\0' '{}'", SHELL_ENV_END_MARKER),
    ]
    .join("; ")
}

pub fn parse_shell_environment_output(stdout: &[u8]) -> Credentials {
    let start_marker = format!("{}\0", SHELL_ENV_START_MARKER).into_bytes();
    let end_marker = format!("{}\0", SHELL_ENV_END_MARKER).into_bytes();

    let Some(start_index) = find_subslice(stdout, &start_marker) else {
        return Credentials::empty();
    };

    let search_start = start_index + start_marker.len();
    let Some(end_offset) = find_subslice(&stdout[search_start..], &end_marker) else {
        return Credentials::empty();
    };

    let env_block = &stdout[search_start..(search_start + end_offset)];
    let env_string = String::from_utf8_lossy(env_block);

    let mut credentials = Credentials::empty();
    for entry in env_string.split('\0').filter(|value| !value.is_empty()) {
        let mut parts = entry.splitn(2, '=');
        let key = parts.next().unwrap_or_default();
        let value = parts.next().unwrap_or_default();

        if key == "XAI_API_KEY" {
            credentials.xai_key = value.to_string();
        } else if key == "GEMINI_API_KEY" {
            credentials.gemini_key = value.to_string();
        } else if key == "OPENAI_COMPATIBLE_API_KEY" {
            credentials.openai_compatible_key = value.to_string();
        } else if key == "OPENAI_API_KEY" && credentials.openai_compatible_key.is_empty() {
            credentials.openai_compatible_key = value.to_string();
        } else if key == "SONIOX_API_KEY" {
            credentials.soniox_key = value.to_string();
        }
    }

    credentials
}

pub fn parse_shell_environment_result(status_success: bool, stdout: &[u8]) -> Credentials {
    if stdout.len() > SHELL_ENV_MAX_BUFFER_BYTES {
        return Credentials::empty();
    }

    let parsed = parse_shell_environment_output(stdout);
    if has_any_credential(&parsed) {
        return parsed;
    }

    if !status_success {
        return Credentials::empty();
    }

    parsed
}

fn has_any_credential(credentials: &Credentials) -> bool {
    !credentials.soniox_key.is_empty()
        || !credentials.xai_key.is_empty()
        || !credentials.gemini_key.is_empty()
        || !credentials.openai_compatible_key.is_empty()
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || needle.len() > haystack.len() {
        return None;
    }

    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}
