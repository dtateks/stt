use std::collections::BTreeSet;
use std::time::Duration;

use reqwest::Client;

const SONIOX_MODELS_DOCS_URL: &str = "https://soniox.com/docs/stt/models";
const SONIOX_MODELS_REQUEST_TIMEOUT_SECONDS: u64 = 10;
const CURRENT_MODELS_SECTION_MARKER: &str = "current models";
const CHANGELOG_SECTION_MARKER: &str = "changelog";

fn is_model_token_character(character: char) -> bool {
    character.is_ascii_alphanumeric() || character == '-' || character == '_'
}

fn section_between<'a>(source: &'a str, start_marker: &str, end_marker: &str) -> Option<&'a str> {
    let start_index = source.find(start_marker)?;
    let after_start = &source[start_index..];
    let end_index = after_start.find(end_marker)?;
    Some(&after_start[..end_index])
}

fn parse_realtime_models_from_docs_html(html: &str) -> Vec<String> {
    let normalized_html = html.to_ascii_lowercase();
    let scoped_html = section_between(
        &normalized_html,
        CURRENT_MODELS_SECTION_MARKER,
        CHANGELOG_SECTION_MARKER,
    )
    .unwrap_or(normalized_html.as_str());
    let mut models = BTreeSet::new();
    let mut token = String::new();

    for character in scoped_html.chars() {
        if is_model_token_character(character) {
            token.push(character);
            continue;
        }

        push_realtime_model_token(&mut models, &token);
        token.clear();
    }

    push_realtime_model_token(&mut models, &token);
    models.into_iter().collect()
}

fn push_realtime_model_token(models: &mut BTreeSet<String>, token: &str) {
    if token.starts_with("stt-rt") {
        models.insert(token.to_string());
    }
}

fn resolve_realtime_models_from_docs_html(html: &str) -> Result<Vec<String>, String> {
    let parsed_models = parse_realtime_models_from_docs_html(html);
    if parsed_models.is_empty() {
        return Err(
            "Could not parse Soniox realtime models from docs. Try refresh again in Settings."
                .to_string(),
        );
    }

    Ok(parsed_models)
}

pub async fn list_soniox_models() -> Result<Vec<String>, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(SONIOX_MODELS_REQUEST_TIMEOUT_SECONDS))
        .build()
        .map_err(|error| format!("Could not initialize Soniox model fetch: {error}"))?;

    let response = client
        .get(SONIOX_MODELS_DOCS_URL)
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                format!(
                    "Soniox model docs request timed out after {} seconds",
                    SONIOX_MODELS_REQUEST_TIMEOUT_SECONDS
                )
            } else {
                format!("Could not fetch Soniox model docs: {error}")
            }
        })?;

    if !response.status().is_success() {
        return Err(format!(
            "Could not fetch Soniox model docs (HTTP {}). Try refresh again.",
            response.status().as_u16()
        ));
    }

    let html = response
        .text()
        .await
        .map_err(|error| format!("Could not read Soniox model docs response: {error}"))?;

    resolve_realtime_models_from_docs_html(&html)
}

#[cfg(test)]
mod tests {
    use super::{parse_realtime_models_from_docs_html, resolve_realtime_models_from_docs_html};

    #[test]
    fn parses_realtime_models_and_ignores_async_models() {
        let html = r#"
            <section>
              <h2>Current models</h2>
              <code>stt-rt-v4</code>
              <code>stt-async-v4</code>
              <code>stt-rt-v3-preview</code>
              <h2>Changelog</h2>
              <code>stt-rt-preview-v1</code>
            </section>
        "#;

        let models = parse_realtime_models_from_docs_html(html);
        assert_eq!(models, vec!["stt-rt-v3-preview", "stt-rt-v4"]);
    }

    #[test]
    fn returns_error_when_parse_returns_no_realtime_models() {
        let html = "<html><body>No model identifiers here.</body></html>";

        let error = resolve_realtime_models_from_docs_html(html).unwrap_err();
        assert!(error.contains("Could not parse Soniox realtime models"));
    }
}
