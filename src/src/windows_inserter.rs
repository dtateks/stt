use std::env;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use serde::{Deserialize, Serialize};

use super::{
    ClipboardFormatData, ClipboardSnapshot, TextInsertionPermissionResult,
    WINDOWS_HELPER_REQUIRED_MESSAGE, WINDOWS_HELPER_REQUIRED_PREFIX,
    WINDOWS_HELPER_UNAVAILABLE_CODE, WINDOWS_HELPER_UNAVAILABLE_MESSAGE,
    WINDOWS_HELPER_UNAVAILABLE_PREFIX,
};

const WINDOWS_INSERT_HELPER_ACTION: &str = "windows-insert";
const HELPER_REQUEST_PATH_FLAG: &str = "--helper-request-path";
const HELPER_RESPONSE_PATH_FLAG: &str = "--helper-response-path";
const POWERSHELL_EXECUTABLE: &str = "powershell";
const TEXT_CLIPBOARD_FORMAT: &str = "text/plain";
const UIPI_ACCESS_DENIED_MARKER: &str = "access is denied";
const UIPI_PRIVILEGE_ERROR_MARKER: &str = "privilege";
const UIPI_INTEGRITY_ERROR_MARKER: &str = "integrity";
const WINDOWS_HELPER_RESPONSE_PARSE_FAILED: &str = "windows-helper-response-parse-failed";
const WINDOWS_HELPER_LAUNCH_FAILED: &str = "windows-helper-launch-failed";
const VALUE_PATTERN_SCRIPT: &str = "Add-Type -AssemblyName UIAutomationClient; $text=[Console]::In.ReadToEnd(); $focused=[System.Windows.Automation.AutomationElement]::FocusedElement; if ($null -eq $focused) { throw 'No focused element is available for UIAutomation.' }; $valuePatternType=[System.Windows.Automation.ValuePattern]::Pattern; $patternObj=$null; if (-not $focused.TryGetCurrentPattern($valuePatternType, [ref]$patternObj)) { throw 'Focused element does not support ValuePattern.' }; $valuePattern=[System.Windows.Automation.ValuePattern]$patternObj; $valuePattern.SetValue($text);";
const SEND_INPUT_SCRIPT: &str = "Add-Type -AssemblyName System.Windows.Forms; $text=[Console]::In.ReadToEnd(); [System.Windows.Forms.SendKeys]::SendWait($text);";
const HELPER_TRANSPORT_CREATE_ATTEMPTS: usize = 8;
const DOUBLE_ENTER_REPEAT_DELAY_MS: u64 = 230;
const ENTER_KEY_SEND_SCRIPT: &str = "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')";

static HELPER_TRANSPORT_NONCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Serialize, Deserialize)]
struct WindowsInsertHelperRequest {
    text: String,
    enter_mode: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct WindowsInsertHelperResponse {
    success: bool,
    error: Option<String>,
    code: Option<String>,
}

type WindowsInsertionAttempt = fn(&str, bool) -> Result<(), String>;

pub(super) fn ensure_text_insertion_permission() -> TextInsertionPermissionResult {
    if is_privileged_helper_available() {
        return TextInsertionPermissionResult {
            granted: true,
            code: None,
            opened_settings: None,
            message: None,
        };
    }

    TextInsertionPermissionResult {
        granted: false,
        code: Some(WINDOWS_HELPER_UNAVAILABLE_CODE.to_string()),
        opened_settings: Some(false),
        message: Some(WINDOWS_HELPER_UNAVAILABLE_MESSAGE.to_string()),
    }
}

pub(super) fn perform_insertion(text: &str, enter_mode: bool) -> Result<(), String> {
    perform_insertion_with_mode(text, enter_mode, true)
}

fn perform_insertion_with_mode(
    text: &str,
    enter_mode: bool,
    allow_helper_escalation: bool,
) -> Result<(), String> {
    let attempts: [WindowsInsertionAttempt; 3] = [
        try_value_pattern_set_value,
        try_send_input,
        try_clipboard_paste,
    ];
    let mut last_error = "Windows insertion did not run any insertion strategy".to_string();

    for attempt in attempts {
        match attempt(text, enter_mode) {
            Ok(()) => return Ok(()),
            Err(error) => {
                if allow_helper_escalation && is_uipi_restriction_error(&error) {
                    return run_privileged_helper(text, enter_mode);
                }

                last_error = error;
            }
        }
    }

    Err(last_error)
}

fn try_value_pattern_set_value(text: &str, enter_mode: bool) -> Result<(), String> {
    run_powershell_script_with_stdin(VALUE_PATTERN_SCRIPT, text)?;

    if enter_mode {
        run_double_enter_sequence()?;
    }

    Ok(())
}

fn try_send_input(text: &str, enter_mode: bool) -> Result<(), String> {
    run_powershell_script_with_stdin(SEND_INPUT_SCRIPT, text)?;

    if enter_mode {
        run_double_enter_sequence()?;
    }

    Ok(())
}

fn try_clipboard_paste(text: &str, enter_mode: bool) -> Result<(), String> {
    write_plain_text_clipboard(text)?;
    run_powershell_script(
        "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')",
    )?;

    if enter_mode {
        run_double_enter_sequence()?;
    }

    Ok(())
}

fn run_double_enter_sequence() -> Result<(), String> {
    run_powershell_script(ENTER_KEY_SEND_SCRIPT)?;
    thread::sleep(Duration::from_millis(DOUBLE_ENTER_REPEAT_DELAY_MS));
    run_powershell_script(ENTER_KEY_SEND_SCRIPT)
}

pub(super) fn run_windows_insertion_helper_mode(
    request_path: Option<&str>,
    response_path: Option<&str>,
) -> i32 {
    let request = match read_helper_request(request_path) {
        Ok(request) => request,
        Err(error) => {
            return write_helper_response(
                response_path,
                WindowsInsertHelperResponse {
                    success: false,
                    error: Some(format!(
                        "{WINDOWS_HELPER_UNAVAILABLE_PREFIX} could not parse helper payload: {error}"
                    )),
                    code: Some(WINDOWS_HELPER_UNAVAILABLE_CODE.to_string()),
                },
            );
        }
    };

    let response = match perform_insertion_with_mode(&request.text, request.enter_mode, false) {
        Ok(()) => WindowsInsertHelperResponse {
            success: true,
            error: None,
            code: None,
        },
        Err(error) => WindowsInsertHelperResponse {
            success: false,
            error: Some(error),
            code: None,
        },
    };

    write_helper_response(response_path, response)
}

fn read_helper_request(request_path: Option<&str>) -> Result<WindowsInsertHelperRequest, String> {
    let payload = if let Some(path) = request_path {
        fs::read_to_string(path).map_err(|error| error.to_string())?
    } else {
        let mut payload = String::new();
        std::io::stdin()
            .read_to_string(&mut payload)
            .map_err(|error| error.to_string())?;
        payload
    };

    serde_json::from_str::<WindowsInsertHelperRequest>(&payload).map_err(|error| error.to_string())
}

fn write_helper_response(
    response_path: Option<&str>,
    response: WindowsInsertHelperResponse,
) -> i32 {
    if let Some(path) = response_path {
        let serialized = match serde_json::to_string(&response) {
            Ok(serialized) => serialized,
            Err(_) => return 1,
        };

        if fs::write(path, serialized).is_ok() {
            return 0;
        }

        return 1;
    }

    if serde_json::to_writer(std::io::stdout(), &response).is_ok() {
        return 0;
    }

    1
}

fn run_privileged_helper(text: &str, enter_mode: bool) -> Result<(), String> {
    run_privileged_helper_via_elevation(text, enter_mode)
}

fn run_privileged_helper_via_elevation(text: &str, enter_mode: bool) -> Result<(), String> {
    let helper_path = helper_command_path().map_err(helper_unavailable_error)?;
    let request = WindowsInsertHelperRequest {
        text: text.to_string(),
        enter_mode,
    };
    let mut transport = HelperFileTransport::new()?;
    let request_path = transport.request_path.clone();
    let response_path = transport.response_path.clone();

    run_windows_helper_escalation_contract(
        || transport.write_request(&request),
        || {
            let start_process_script = build_runas_script(
                helper_path.as_path(),
                request_path.as_path(),
                response_path.as_path(),
            );
            let launch_output = Command::new(POWERSHELL_EXECUTABLE)
                .args([
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    &start_process_script,
                ])
                .output()
                .map_err(helper_launch_failed_error)?;
            if launch_output.status.success() {
                return Ok(());
            }

            let stderr = String::from_utf8_lossy(&launch_output.stderr)
                .trim()
                .to_string();
            Err(helper_launch_failed_error(stderr))
        },
        || {
            let response = HelperFileTransport::read_response_from_path(response_path.as_path())?;
            Ok((response.success, response.error))
        },
    )
}

pub(super) fn run_windows_helper_escalation_contract<WriteRequest, LaunchHelper, ReadResponse>(
    write_request: WriteRequest,
    launch_helper: LaunchHelper,
    read_response: ReadResponse,
) -> Result<(), String>
where
    WriteRequest: FnOnce() -> Result<(), String>,
    LaunchHelper: FnOnce() -> Result<(), String>,
    ReadResponse: FnOnce() -> Result<(bool, Option<String>), String>,
{
    write_request()?;
    launch_helper()?;
    let (success, error) = read_response()?;
    if success {
        return Ok(());
    }

    if let Some(error) = error {
        return Err(error);
    }

    Err(format!(
        "{WINDOWS_HELPER_REQUIRED_PREFIX} {WINDOWS_HELPER_REQUIRED_MESSAGE}"
    ))
}

fn helper_unavailable_error(details: impl ToString) -> String {
    format!(
        "{WINDOWS_HELPER_UNAVAILABLE_PREFIX} {WINDOWS_HELPER_UNAVAILABLE_MESSAGE} Details: {}",
        details.to_string()
    )
}

fn helper_launch_failed_error(details: impl ToString) -> String {
    format!(
        "{WINDOWS_HELPER_REQUIRED_PREFIX} {WINDOWS_HELPER_LAUNCH_FAILED}: {}",
        details.to_string()
    )
}

fn build_runas_script(helper_path: &Path, request_path: &Path, response_path: &Path) -> String {
    let escaped_helper = powershell_single_quote_escape(&helper_path.display().to_string());
    let escaped_request = powershell_single_quote_escape(&request_path.display().to_string());
    let escaped_response = powershell_single_quote_escape(&response_path.display().to_string());

    format!(
        "$args = @('--helper-mode', '{WINDOWS_INSERT_HELPER_ACTION}', '{HELPER_REQUEST_PATH_FLAG}', '{escaped_request}', '{HELPER_RESPONSE_PATH_FLAG}', '{escaped_response}'); $process = Start-Process -FilePath '{escaped_helper}' -ArgumentList $args -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $process.ExitCode"
    )
}

fn powershell_single_quote_escape(input: &str) -> String {
    input.replace('\'', "''")
}

struct HelperFileTransport {
    request_path: PathBuf,
    response_path: PathBuf,
    request_file: Option<File>,
}

impl HelperFileTransport {
    fn new() -> Result<Self, String> {
        for _ in 0..HELPER_TRANSPORT_CREATE_ATTEMPTS {
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|error| error.to_string())?
                .as_nanos();
            let nonce = HELPER_TRANSPORT_NONCE.fetch_add(1, Ordering::Relaxed);
            let base = env::temp_dir().join(format!(
                "voice-to-text-helper-{}-{timestamp}-{nonce}",
                std::process::id()
            ));
            let request_path = base.with_extension("request.json");
            let response_path = base.with_extension("response.json");

            // Helper transport carries dictated text, so temp files are created with
            // private permissions and no sharing before any bytes are written.
            let request_file = match create_private_transport_file(&request_path) {
                Ok(request_file) => request_file,
                Err(error) => {
                    if is_file_already_exists_error(&error) {
                        continue;
                    }
                    return Err(error);
                }
            };
            if let Err(error) = create_private_transport_file(&response_path) {
                let _ = fs::remove_file(&request_path);
                if is_file_already_exists_error(&error) {
                    continue;
                }
                return Err(error);
            }

            return Ok(Self {
                request_path,
                response_path,
                request_file: Some(request_file),
            });
        }

        Err("windows helper transport file creation exhausted retry budget".to_string())
    }

    fn write_request(&mut self, request: &WindowsInsertHelperRequest) -> Result<(), String> {
        let Some(mut request_file) = self.request_file.take() else {
            return Err("windows helper request file is unavailable".to_string());
        };

        serde_json::to_writer(&mut request_file, request).map_err(|error| error.to_string())?;
        request_file.flush().map_err(|error| error.to_string())?;
        Ok(())
    }

    fn read_response_from_path(
        response_path: &Path,
    ) -> Result<WindowsInsertHelperResponse, String> {
        let raw_response = fs::read_to_string(response_path).map_err(|error| {
            format!(
                "{WINDOWS_HELPER_REQUIRED_PREFIX} {WINDOWS_HELPER_RESPONSE_PARSE_FAILED}: {error}"
            )
        })?;
        serde_json::from_str::<WindowsInsertHelperResponse>(&raw_response).map_err(|error| {
            format!(
                "{WINDOWS_HELPER_REQUIRED_PREFIX} {WINDOWS_HELPER_RESPONSE_PARSE_FAILED}: {error}"
            )
        })
    }
}

fn is_file_already_exists_error(error: &str) -> bool {
    error.to_ascii_lowercase().contains("exists")
}

#[cfg(unix)]
fn create_private_transport_file(path: &Path) -> Result<File, String> {
    use std::fs::OpenOptions;
    use std::os::unix::fs::OpenOptionsExt;

    OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn create_private_transport_file(path: &Path) -> Result<File, String> {
    use std::fs::OpenOptions;
    use std::os::windows::fs::OpenOptionsExt;

    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
    const FILE_ATTRIBUTE_TEMPORARY: u32 = 0x100;

    OpenOptions::new()
        .write(true)
        .create_new(true)
        .share_mode(0)
        .attributes(FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_TEMPORARY)
        .open(path)
        .map_err(|error| error.to_string())
}

#[cfg(all(not(unix), not(target_os = "windows")))]
fn create_private_transport_file(path: &Path) -> Result<File, String> {
    use std::fs::OpenOptions;

    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| error.to_string())
}

impl Drop for HelperFileTransport {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.request_path);
        let _ = fs::remove_file(&self.response_path);
    }
}

fn run_powershell_script(script: &str) -> Result<(), String> {
    let output = Command::new(POWERSHELL_EXECUTABLE)
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .map_err(|error| error.to_string())?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        return Err("Windows PowerShell command failed".to_string());
    }

    Err(stderr)
}

fn run_powershell_script_with_stdin(script: &str, payload: &str) -> Result<(), String> {
    let mut child = Command::new(POWERSHELL_EXECUTABLE)
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(payload.as_bytes())
            .map_err(|error| error.to_string())?;
    }

    let output = child
        .wait_with_output()
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        return Err("Windows PowerShell command failed".to_string());
    }

    Err(stderr)
}

pub(super) fn is_privileged_helper_available() -> bool {
    helper_command_path()
        .map(|path| path.exists())
        .unwrap_or(false)
}

fn helper_command_path() -> Result<std::path::PathBuf, String> {
    env::current_exe().map_err(|error| error.to_string())
}

fn is_uipi_restriction_error(error: &str) -> bool {
    let normalized_error = error.to_ascii_lowercase();
    normalized_error.contains(UIPI_ACCESS_DENIED_MARKER)
        || normalized_error.contains(UIPI_PRIVILEGE_ERROR_MARKER)
        || normalized_error.contains(UIPI_INTEGRITY_ERROR_MARKER)
}

pub(super) fn snapshot_clipboard() -> Option<ClipboardSnapshot> {
    let clipboard_text = read_plain_text_clipboard().ok()?;
    let Some(clipboard_text) = clipboard_text else {
        return Some(ClipboardSnapshot {
            had_formats: false,
            formats: Vec::new(),
            non_preservable_formats: Vec::new(),
        });
    };

    Some(ClipboardSnapshot {
        had_formats: true,
        formats: vec![ClipboardFormatData {
            format: TEXT_CLIPBOARD_FORMAT.to_string(),
            data_base64: BASE64_STANDARD.encode(clipboard_text.as_bytes()),
        }],
        non_preservable_formats: Vec::new(),
    })
}

pub(super) fn restore_clipboard(snapshot: &ClipboardSnapshot) -> Result<(), String> {
    if !snapshot.had_formats {
        return write_plain_text_clipboard("");
    }

    let Some(item) = snapshot.formats.first() else {
        return Err("Original clipboard contained formats that could not be preserved".to_string());
    };

    let decoded = BASE64_STANDARD.decode(&item.data_base64).map_err(|error| {
        format!(
            "Failed to decode clipboard format `{}` for restore: {error}",
            item.format
        )
    })?;
    let text = String::from_utf8(decoded)
        .map_err(|error| format!("Clipboard restore data was not valid UTF-8: {error}"))?;

    write_plain_text_clipboard(&text)
}

pub(super) fn write_plain_text_clipboard(text: &str) -> Result<(), String> {
    let mut child = Command::new(POWERSHELL_EXECUTABLE)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$input | Set-Clipboard",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(text.as_bytes())
            .map_err(|error| error.to_string())?;
    }

    let output = child
        .wait_with_output()
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        return Err("Failed to write text to clipboard".to_string());
    }

    Err(stderr)
}

fn read_plain_text_clipboard() -> Result<Option<String>, String> {
    let output = Command::new(POWERSHELL_EXECUTABLE)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$clip = Get-Clipboard -Raw -ErrorAction SilentlyContinue; if ($null -eq $clip) { '' } else { $clip }",
        ])
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let value = String::from_utf8_lossy(&output.stdout).to_string();
    if value.is_empty() {
        return Ok(None);
    }

    Ok(Some(value))
}
