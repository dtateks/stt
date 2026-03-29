use std::collections::BTreeSet;
use std::time::Duration;

use reqwest::Client;

const SONIOX_MODELS_DOCS_URL: &str = "https://soniox.com/docs/stt/models";
const SONIOX_MODELS_REQUEST_TIMEOUT_SECONDS: u64 = 10;
const CURRENT_REALTIME_MODELS_SECTION_MARKER: &str = "Current models";
const CHANGELOG_SECTION_MARKER: &str = "Changelog";
const FALLBACK_REALTIME_MODELS: [&str; 4] = [
    "stt-rt-v4",
    "stt-rt-v3-preview",
    "stt-rt-v3",
    "stt-rt-preview-v2",
];

fn fallback_realtime_models() -> Vec<String> {
    FALLBACK_REALTIME_MODELS
        .iter()
        .map(|model| model.to_string())
        .collect()
}

fn is_model_token_character(character: char) -> bool {
    character.is_ascii_alphanumeric() || character == '-' || character == '_'
}

fn lowercase_html(html: &str) -> String {
    html.to_ascii_lowercase()
}

fn section_between<'a>(source: &'a str, start_marker: &str, end_marker: &str) -> Option<&'a str> {
    let start_index = source.find(start_marker)?;
    let after_start = &source[start_index..];
    let end_index = after_start.find(end_marker)?;
    Some(&after_start[..end_index])
}

fn parse_realtime_models_from_docs_html(html: &str) -> Vec<String> {
    let normalized_html = lowercase_html(html);
    let scoped_html = section_between(
        &normalized_html,
        &CURRENT_REALTIME_MODELS_SECTION_MARKER.to_ascii_lowercase(),
        &CHANGELOG_SECTION_MARKER.to_ascii_lowercase(),
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
    if token.is_empty() {
        return;
    }

    if !token.starts_with("stt-rt") {
        return;
    }

    models.insert(token.to_string());
}

fn resolve_realtime_models_from_docs_html(html: &str) -> Vec<String> {
    let parsed_models = parse_realtime_models_from_docs_html(html);
    if parsed_models.is_empty() {
        return fallback_realtime_models();
    }

    parsed_models
}

pub async fn list_soniox_models() -> Vec<String> {
    let client = match Client::builder()
        .timeout(Duration::from_secs(SONIOX_MODELS_REQUEST_TIMEOUT_SECONDS))
        .build()
    {
        Ok(client) => client,
        Err(_) => return fallback_realtime_models(),
    };

    let response = match client.get(SONIOX_MODELS_DOCS_URL).send().await {
        Ok(response) => response,
        Err(_) => return fallback_realtime_models(),
    };

    if !response.status().is_success() {
        return fallback_realtime_models();
    }

    let html = match response.text().await {
        Ok(html) => html,
        Err(_) => return fallback_realtime_models(),
    };

    resolve_realtime_models_from_docs_html(&html)
}

#[cfg(test)]
mod tests {
    use super::{
        fallback_realtime_models, parse_realtime_models_from_docs_html,
        resolve_realtime_models_from_docs_html,
    };

    #[test]
    fn parses_realtime_models_and_aliases_from_current_docs_sections() {
        let html = r#"
            <section>
              <h2>Current models</h2>
              <code>stt-rt-v4</code>
              <code>stt-async-v4</code>
              <code>stt-rt-v3</code>
              <h2>Aliases</h2>
              <code>stt-rt-v3-preview</code>
              <code>stt-rt-preview-v2</code>
              <h2>Changelog</h2>
              <code>stt-rt-v2</code>
            </section>
        "#;

        let models = parse_realtime_models_from_docs_html(html);
        assert_eq!(
            models,
            vec![
                "stt-rt-preview-v2",
                "stt-rt-v3",
                "stt-rt-v3-preview",
                "stt-rt-v4",
            ]
        );
    }

    #[test]
    fn falls_back_to_curated_realtime_models_when_parse_returns_empty() {
        let html = "<html><body>No model identifiers here.</body></html>";

        let models = resolve_realtime_models_from_docs_html(html);
        assert_eq!(models, fallback_realtime_models());
    }
}
