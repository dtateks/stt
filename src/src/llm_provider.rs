//! Canonical LLM provider catalogue.
//!
//! `Provider` is the typed dispatch tag used across `llm_service` and
//! `commands` for everything provider-specific: endpoint, request shape,
//! response shape, error formatting, credential pick, display name, model
//! validation. Public boundaries (LlmConfig.provider, native_services tests)
//! still travel as `&str` / `Option<String>`; conversion happens here so
//! callers never reinvent the if/else chain.
//!
//! Adding a new provider is a single-file change: extend `Provider`,
//! `parse`, `id`, `display_name`, `pick_credential`, plus the per-variant
//! arms in `llm_service` (endpoint / request body / response extractor /
//! error formatter / timeout phrasing).

use crate::credentials::Credentials;

pub const XAI_PROVIDER_ID: &str = "xai";
pub const OPENAI_COMPATIBLE_PROVIDER_ID: &str = "openai_compatible";
pub const GEMINI_PROVIDER_ID: &str = "gemini";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Provider {
    Xai,
    OpenAiCompatible,
    Gemini,
}

impl Provider {
    /// Resolve a provider tag from the wire-format string. Empty/missing
    /// resolves to `Xai` to match the historical default.
    pub fn parse(provider: &str) -> Result<Self, String> {
        let trimmed = provider.trim();
        if trimmed.is_empty() || trimmed == XAI_PROVIDER_ID {
            return Ok(Self::Xai);
        }
        if trimmed == OPENAI_COMPATIBLE_PROVIDER_ID {
            return Ok(Self::OpenAiCompatible);
        }
        if trimmed == GEMINI_PROVIDER_ID {
            return Ok(Self::Gemini);
        }

        Err(format!("Unsupported LLM provider `{trimmed}`"))
    }

    /// Wire-format string id (matches the persisted/bridge value).
    pub fn id(self) -> &'static str {
        match self {
            Self::Xai => XAI_PROVIDER_ID,
            Self::OpenAiCompatible => OPENAI_COMPATIBLE_PROVIDER_ID,
            Self::Gemini => GEMINI_PROVIDER_ID,
        }
    }

    /// Human-facing label used in error and status messages.
    pub fn display_name(self) -> &'static str {
        match self {
            Self::Xai => "xAI",
            Self::OpenAiCompatible => "OpenAI-compatible",
            Self::Gemini => "Gemini",
        }
    }

    /// Pick the credential field that authenticates this provider.
    pub fn pick_credential<'a>(self, credentials: &'a Credentials) -> &'a str {
        match self {
            Self::Xai => credentials.xai_key.as_str(),
            Self::OpenAiCompatible => credentials.openai_compatible_key.as_str(),
            Self::Gemini => credentials.gemini_key.as_str(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_resolves_known_provider_ids() {
        assert_eq!(Provider::parse("xai"), Ok(Provider::Xai));
        assert_eq!(
            Provider::parse("openai_compatible"),
            Ok(Provider::OpenAiCompatible),
        );
        assert_eq!(Provider::parse("gemini"), Ok(Provider::Gemini));
    }

    #[test]
    fn parse_treats_empty_or_blank_string_as_xai_default() {
        assert_eq!(Provider::parse(""), Ok(Provider::Xai));
        assert_eq!(Provider::parse("   "), Ok(Provider::Xai));
    }

    #[test]
    fn parse_rejects_unknown_provider_with_actionable_error() {
        let error = Provider::parse("openai").unwrap_err();
        assert!(error.contains("Unsupported LLM provider `openai`"));
    }

    #[test]
    fn id_round_trips_through_parse() {
        for provider in [
            Provider::Xai,
            Provider::OpenAiCompatible,
            Provider::Gemini,
        ] {
            assert_eq!(Provider::parse(provider.id()), Ok(provider));
        }
    }

    #[test]
    fn pick_credential_returns_provider_specific_field() {
        let credentials = Credentials {
            xai_key: "xai-key".to_string(),
            gemini_key: "gemini-key".to_string(),
            openai_compatible_key: "openai-key".to_string(),
            soniox_key: "soniox-key".to_string(),
        };

        assert_eq!(Provider::Xai.pick_credential(&credentials), "xai-key");
        assert_eq!(
            Provider::OpenAiCompatible.pick_credential(&credentials),
            "openai-key"
        );
        assert_eq!(Provider::Gemini.pick_credential(&credentials), "gemini-key");
    }
}
