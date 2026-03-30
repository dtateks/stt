use std::cell::RefCell;
use std::env;
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use voice_to_text_lib::maybe_run_from_args;
use voice_to_text_lib::text_inserter::{
    build_insert_text_result, build_text_insertion_permission_result,
    run_windows_helper_escalation_contract, run_windows_insertion_helper_mode,
};

fn read_src_file(relative_path: &str) -> String {
    let absolute_path = Path::new(env!("CARGO_MANIFEST_DIR")).join(relative_path);
    fs::read_to_string(absolute_path).expect("source file should be readable")
}

#[test]
fn windows_text_insertion_contract_uses_standard_fallback_order() {
    let windows_inserter = read_src_file("src/windows_inserter.rs");
    let value_pattern_index = windows_inserter
        .find("try_value_pattern_set_value")
        .expect("windows insertion must attempt ValuePattern first");
    let send_input_index = windows_inserter
        .find("try_send_input")
        .expect("windows insertion must attempt SendInput second");
    let clipboard_index = windows_inserter
        .find("try_clipboard_paste")
        .expect("windows insertion must attempt clipboard fallback last");

    assert!(
        value_pattern_index < send_input_index,
        "ValuePattern must run before SendInput"
    );
    assert!(
        send_input_index < clipboard_index,
        "SendInput must run before clipboard fallback"
    );
}

#[test]
fn windows_text_insertion_helper_escalation_contract_runs_in_order() {
    let steps = RefCell::new(Vec::new());

    let result = run_windows_helper_escalation_contract(
        || {
            steps.borrow_mut().push("write-request");
            Ok(())
        },
        || {
            steps.borrow_mut().push("launch-helper");
            Ok(())
        },
        || {
            steps.borrow_mut().push("read-response");
            Ok((true, None))
        },
    );

    assert!(result.is_ok());
    assert_eq!(
        steps.borrow().as_slice(),
        ["write-request", "launch-helper", "read-response"]
    );
}

#[test]
fn windows_text_insertion_helper_escalation_contract_surfaces_helper_failure() {
    let result = run_windows_helper_escalation_contract(
        || Ok(()),
        || Ok(()),
        || Ok((false, Some("helper response failed".to_string()))),
    );

    assert_eq!(result.err().as_deref(), Some("helper response failed"));
}

#[test]
fn windows_text_insertion_helper_transport_uses_request_response_files() {
    let temp_dir = create_temp_test_dir("windows-helper-file-transport");
    let request_path = temp_dir.join("request.json");
    let response_path = temp_dir.join("response.json");
    fs::write(&request_path, "not-json").expect("request should be written");

    let exit_code =
        run_windows_insertion_helper_mode(request_path.to_str(), response_path.to_str());
    let response = fs::read_to_string(&response_path).expect("response should be written");
    let response_json: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert!(
        exit_code == 0,
        "helper mode should return success when response file write succeeds"
    );
    assert!(
        response_json
            .get("success")
            .and_then(serde_json::Value::as_bool)
            .is_some_and(|success| !success),
        "helper mode should report parse failure through response file"
    );
    assert_eq!(
        response_json
            .get("code")
            .and_then(serde_json::Value::as_str),
        Some("windows-helper-unavailable")
    );
}

#[test]
fn windows_text_insertion_helper_mode_rejects_unknown_helper_action() {
    assert_eq!(
        maybe_run_from_args(vec![
            "voice_to_text".to_string(),
            "--helper-mode".to_string(),
            "unknown-action".to_string(),
        ]),
        Some(1),
        "unknown helper actions must fail fast"
    );
}

#[test]
fn windows_text_insertion_helper_unavailable_error_maps_to_stable_permission_code() {
    let result = build_text_insertion_permission_result(Err(
        "windows-helper-unavailable: helper executable not found".to_string(),
    ));

    assert!(!result.granted);
    assert_eq!(
        result.code.as_deref(),
        Some("windows-helper-unavailable"),
        "helper availability failures must surface a dedicated stable code"
    );
}

#[test]
fn windows_text_insertion_insert_result_preserves_clipboard_restore_code() {
    let result = build_insert_text_result(Ok(()), Err("Clipboard unavailable".to_string()));

    assert!(!result.success);
    assert_eq!(result.code.as_deref(), Some("clipboard-restore-failed"));
}

fn create_temp_test_dir(prefix: &str) -> std::path::PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after unix epoch")
        .as_nanos();
    let directory = env::temp_dir().join(format!(
        "voice-to-text-{prefix}-{}-{timestamp}",
        std::process::id()
    ));
    fs::create_dir_all(&directory).expect("temp directory should be created");
    directory
}
