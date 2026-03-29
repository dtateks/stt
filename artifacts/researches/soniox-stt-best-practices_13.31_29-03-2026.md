# Findings: Soniox Speech-to-Text Best Practices — 2026

**Research Date:** 29-03-2026
**Researcher:** Senior Research Analyst
**Topic:** Latest approved/best-practice guidance for Soniox speech-to-text usage

---

## Summary

Soniox's current production-ready models are **stt-rt-v4** (real-time, released 2026-02-05) and **stt-async-v4** (async, released 2026-01-29), both representing the latest stable generation. The v3 models auto-route to v4 after 2026-02-28 with no API changes required. The primary API surface is the WebSocket API at `wss://stt-rt.soniox.com/transcribe-websocket`, using raw PCM (`pcm_s16le`) at 16 kHz mono for lowest latency. Context customization via the `context` object (with `general`, `text`, `terms`, `translation_terms` sections) is the primary mechanism for vocabulary hints and domain adaptation. Endpoint detection, manual finalization, and `is_final` token flags govern transcript finalization and latency/quality tradeoffs. All findings are cited against official Soniox documentation unless labeled as inference.

---

## Key Findings

### 1. Current Models and Staying on Newest Stable Version

#### Current Active Models (as of March 2026)
- **stt-rt-v4** — Real-time model, released 2026-02-05, marked Active [Models | Soniox Speech AI Docs](https://soniox.com/docs/stt/models)
- **stt-async-v4** — Async model, released 2026-01-29, marked Active [Models | Soniox Speech AI Docs](https://soniox.com/docs/stt/models)
- **stt-rt-v3** — Real-time model, Active but will auto-route to stt-rt-v4 after 2026-02-28 [Models | Soniox Speech AI Docs](https://soniox.com/docs/stt/models)
- **stt-async-v3** — Async model, Active but will auto-route to stt-async-v4 after 2026-02-28 [Models | Soniox Speech AI Docs](https://soniox.com/docs/stt/models)

#### Aliases for Stable References
- **stt-rt-v3-preview** always points to the latest real-time active model (currently v4) [Models | Soniox Speech AI Docs](https://soniox.com/docs/stt/models)
- **stt-rt-preview-v2** points to stt-rt-v3 [Models | Soniox Speech AI Docs](https://soniox.com/docs/stt/models)
- **stt-async-preview-v1** points to stt-async-v3 [Models | Soniox Speech AI Docs](https://soniox.com/docs/stt/models)

#### Staying on Newest Stable Model
- Soniox's official guidance is to simply replace the model name in API requests: `{"model": "stt-rt-v4"}` for real-time, `{"model": "stt-async-v4"}` for async [Models | Soniox Speech AI Docs](https://soniox.com/docs/stt/models)
- v3 models will automatically route to v4 after 2026-02-28 with no service interruption and no API changes required [Models | Soniox Speech AI Docs](https://soniox.com/docs/stt/models)
- Using the stable alias (`stt-rt-v3-preview`) is recommended over hardcoding a version number, since aliases always point to the latest active model [Models | Soniox Speech AI Docs](https://soniox.com/docs/stt/models)

#### v4 Key Improvements over v3
- Higher accuracy across all supported languages (60+ languages) [Models | Soniox Speech AI Docs](https://soniox.com/docs/stt/models)
- Better multilingual detection and mid-sentence language switching [Models | Soniox Speech AI Docs](https://soniox.com/docs/stt/models)
- Lower endpoint latency with faster final transcription [Models | Soniox Speech AI Docs](https://soniox.com/docs/stt/models)
- Improved semantic endpointing for more natural turn-taking [Models | Soniox Speech AI Docs](https://soniox.com/docs/stt/models)
- More stable, higher-quality transcription on long and multi-hour recordings [Models | Soniox Speech AI Docs](https://soniox.com/docs/stt/models)
- Stronger use of provided context for domain-specific accuracy (noted as especially relevant for v4 Async) [Models | Soniox Speech AI Docs](https://soniox.com/docs/stt/models)
- Added `max_endpoint_delay_ms` parameter for controlling end-of-speech endpoint delay [Models | Soniox Speech AI Docs](https://soniox.com/docs/stt/models)

---

### 2. Real-Time/Streaming API Best Practices

#### WebSocket Endpoint
- **Primary endpoint:** `wss://stt-rt.soniox.com/transcribe-websocket` [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)
- This is the low-latency streaming API for real-time transcription and translation [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)

#### Configuration Message (Send First)
- Before streaming audio, send a JSON configuration message containing at minimum: `api_key`, `model`, and `audio_format` [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)
- For raw PCM formats, `num_channels` and `sample_rate` are also required [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)
- Example configuration for raw PCM: `{"model": "stt-rt-v4", "audio_format": "pcm_s16le", "sample_rate": 16000, "num_channels": 1, "api_key": "..."}` [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api) [Real-time transcription | Soniox Speech AI Docs](https://soniox.com/docs/stt/rt/real-time-transcription)

#### Direct Streaming Architecture
- For lowest latency, Soniox recommends streaming microphone audio directly from the client to the Soniox WebSocket API (direct stream), which removes an intermediary server and simplifies architecture [Direct stream | Soniox Speech AI Docs](https://soniox.com/docs/stt/guides/direct-stream)
- The minimum latency configuration uses PCM at 16 kHz with one audio channel, and container formats are not recommended in low-latency mode due to decode latency [Direct stream | Soniox Speech AI Docs](https://soniox.com/docs/stt/guides/direct-stream)
- The Soniox Web SDK handles microphone capture, WebSocket management, and authentication with temporary API keys for browser scenarios [Real-time transcription with Web SDK | Soniox Speech AI Docs](https://soniox.com/docs/stt/SDKs/web-SDK/realtime-transcription)

#### Authentication
- Soniox recommends using temporary API keys generated by your server rather than exposing long-lived secrets in client code [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)
- Temporary key generation is handled through Soniox's Auth API [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)

#### Stream Limits
- Maximum stream duration: 300 minutes per session [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)
- Real-time limits: 100 requests per minute, 10 concurrent requests [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)
- Inactivity timeouts and rate limits are documented; implement explicit handling for these error conditions [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)

#### Graceful Shutdown
- End streams by sending an empty WebSocket frame; the server will return the finished response before closing the connection [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)

#### Supported Audio Formats (Raw PCM)
- `pcm_s8`, `pcm_s16`, `pcm_s24`, `pcm_s32` (signed PCM) [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)
- `pcm_s16le`, `pcm_s16be` (16-bit with endianness) [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)
- `pcm_u8` (unsigned PCM), `pcm_float`, `mulaw`, `alaw` [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)
- Soniox's documented canonical example for real-time streaming is `pcm_s16le` at 16 kHz mono [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api) [Real-time transcription | Soniox Speech AI Docs](https://soniox.com/docs/stt/rt/real-time-transcription)

#### Production Reliability
- Handle these documented error conditions: malformed requests, invalid/expired temporary keys, inactivity timeouts, rate limits (100 req/min, 10 concurrent), and restart-required server conditions [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)
- Retry transient server errors; recreate sessions on "cannot continue request" conditions; refresh temporary credentials on auth failures; reduce burstiness on rate/concurrency limits [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)

---

### 3. Context Injection / Custom Vocabulary / Domain Adaptation

#### Primary Mechanism: `context` Parameter
- Soniox's current mechanism for vocabulary hints and domain adaptation is the `context` object, passed at session/request time [Context | Soniox Speech AI Docs](https://soniox.com/docs/stt/concepts/context)
- Context is used to improve both transcription and translation accuracy [Context | Soniox Speech AI Docs](https://soniox.com/docs/stt/concepts/context)
- Context does NOT require the provided text to appear verbatim in audio — the model uses it when helpful rather than blindly overriding recognition [Context | Soniox Speech AI Docs](https://soniox.com/docs/stt/concepts/context)
- v4 improvements include "stronger use of provided context for domain-specific accuracy" [Models | Soniox Speech AI Docs](https://soniox.com/docs/stt/models)

#### Context Structure (Four Optional Sections)
- **`general`** — Array of key-value pairs for broad metadata: domain, topic, intent, organization, participant names, setting, location. Recommended to keep values short (~10 words or fewer per key). Example: `{"key": "domain", "value": "Healthcare"}` [Context | Soniox Speech AI Docs](https://soniox.com/docs/stt/concepts/context)
- **`text`** — Longer free-form background block (e.g., meeting notes, prior interaction history, reference material). Soniox notes it is "less influential than general or terms" for steering recognition [Context | Soniox Speech AI Docs](https://soniox.com/docs/stt/concepts/context)
- **`terms`** — Main custom vocabulary list for rare words, brands, product names, jargon, uncommon phrases, acronyms expected in the audio. This is the primary "custom vocabulary" mechanism [Context | Soniox Speech AI Docs](https://soniox.com/docs/stt/concepts/context)
- **`translation_terms`** — For controlling translation behavior only: forcing specific term translations or keeping names unchanged across languages [Context | Soniox Speech AI Docs](https://soniox.com/docs/stt/concepts/context)

#### Context Limits
- Maximum context size: 8,000 tokens / approximately 10,000 characters [Context | Soniox Speech AI Docs](https://soniox.com/docs/stt/concepts/context)
- Exceeding this limit returns an error [Context | Soniox Speech AI Docs](https://soniox.com/docs/stt/concepts/context)

#### Example Context Object (Healthcare Consultation)
```json
{
  "context": {
    "general": [
      { "key": "domain", "value": "Healthcare" },
      { "key": "topic", "value": "Diabetes management consultation" },
      { "key": "organization", "value": "St John's Clinic" }
    ],
    "terms": [
      "HbA1c", "metformin", "continuous glucose monitor",
      "Dexcom", "empagliflozin"
    ],
    "text": "Patient follow-up visit discussing glucose control, medication adherence, CGM readings, and recent A1c trends.",
    "translation_terms": [
      { "source": "St John's", "target": "St John's" }
    ]
  }
}
```
[Sourced from Context | Soniox Speech AI Docs](https://soniox.com/docs/stt/concepts/context)

#### Best Practices for Context Usage
- Start with `general` to define the broad domain, then add critical terms in `terms` [Context | Soniox Speech AI Docs](https://soniox.com/docs/stt/concepts/context)
- Use `terms` as a high-priority shortlist, not an uncontrolled word dump [Context | Soniox Speech AI Docs](https://soniox.com/docs/stt/concepts/context)
- Use `text` only when genuinely useful supporting material is available (glossary, script, case summary) — it is less influential than `general` or `terms` [Context | Soniox Speech AI Docs](https://soniox.com/docs/stt/concepts/context)
- Use `translation_terms` only when also using translation and needing exact target-language control [Context | Soniox Speech AI Docs](https://soniox.com/docs/stt/concepts/context)
- Combine `context` with `language_hints` when the likely language is known [Context | Soniox Speech AI Docs](https://soniox.com/docs/stt/concepts/context)
- Context works in both real-time (session config) and async (request body) modes [Context | Soniox Speech AI Docs](https://soniox.com/docs/stt/concepts/context)

#### Language Hints (Related)
- `language_hints` improves transcription accuracy, especially useful in real-time mode and for less common languages [Language hints | Soniox Speech AI Docs](https://soniox.com/docs/stt/concepts/language-hints)
- `language_hints_strict` provides a stronger bias toward expected languages (not a hard guarantee) [Types | Soniox Speech AI Docs](https://soniox.com/docs/stt/SDKs/react-SDK/reference/types)
- Language hints are separate from context but complementary [Language hints | Soniox Speech AI Docs](https://soniox.com/docs/stt/concepts/language-hints)

#### Language Restrictions
- Language restrictions allow recognition to be limited to specific languages, useful for preventing accidental transcription in unwanted languages [Language restrictions | Soniox Speech AI Docs](https://soniox.com/docs/stt/concepts/language-restrictions)

---

### 4. Audio Capture/Input Requirements Affecting Quality

#### Recommended Audio Format for Lowest Latency
- **Recommended:** `pcm_s16le` (signed 16-bit little-endian PCM), 16 kHz, mono [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api) [Real-time transcription | Soniox Speech AI Docs](https://soniox.com/docs/stt/rt/real-time-transcription)
- This is Soniox's own canonical example for real-time WebSocket streaming [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api) [Real-time transcription | Soniox Speech AI Docs](https://soniox.com/docs/stt/rt/real-time-transcription)

#### Required Parameters for Raw PCM
- `audio_format` — required [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)
- `sample_rate` — required for raw PCM formats [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)
- `num_channels` — required for raw PCM formats [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)
- Missing PCM metadata returns specific errors: "Audio data channels must be specified for PCM formats" and "Audio data sample rate must be specified for PCM formats" [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)

#### Audio Delivery Rate
- Audio should not be sent faster than real time; processing may be throttled or errors may occur if sent faster [Direct stream | Soniox Speech AI Docs](https://soniox.com/docs/stt/guides/direct-stream)
- Keep the stream at real-time or close to it for best results [Direct stream | Soniox Speech AI Docs](https://soniox.com/docs/stt/guides/direct-stream)

#### Mono vs. Multi-Channel
- Prefer mono unless multiple channels are specifically needed; Soniox's low-latency recommendation is one audio channel [Direct stream | Soniox Speech AI Docs](https://soniox.com/docs/stt/guides/direct-stream)
- Container formats are not recommended for low-latency use cases due to decode latency [Direct stream | Soniox Speech AI Docs](https://soniox.com/docs/stt/guides/direct-stream)

#### Audio Format Support (Full List)
- Signed PCM: `pcm_s8`, `pcm_s16`, `pcm_s24`, `pcm_s32` [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)
- 16-bit with endianness: `pcm_s16le`, `pcm_s16be` [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)
- Unsigned PCM: `pcm_u8` [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)
- Float PCM: `pcm_float` [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)
- Compressed: `mulaw`, `alaw` [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)

---

### 5. Punctuation, Casing, Diarization, Language Settings

#### Confidence Scores
- Every recognized token (word or sub-word) includes a confidence score [Confidence scores | Soniox Speech AI Docs](https://soniox.com/docs/stt/concepts/confidence-scores)
- Confidence scores allow downstream systems to flag low-confidence regions or apply business rules based on recognition certainty [Confidence scores | Soniox Speech AI Docs](https://soniox.com/docs/stt/concepts/confidence-scores)

#### Speaker Diarization
- Speaker diarization is supported in the WebSocket API, enabling speaker attribution in transcripts [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)
- v4 improvements include better handling of speaker attribution in multi-party conversations [Models | Soniox Speech AI Docs](https://soniox.com/docs/stt/models)

#### Language Settings
- `language_hints` — Array of likely spoken languages; improves accuracy especially for real-time and less common languages [Language hints | Soniox Speech AI Docs](https://soniox.com/docs/stt/concepts/language-hints)
- `language_hints_strict` — Stronger (best-effort, not guaranteed) bias toward expected languages [Types | Soniox Speech AI Docs](https://soniox.com/docs/stt/SDKs/react-SDK/reference/types)
- Language restrictions — Explicit allowlisting/denylisting of languages to prevent unwanted transcription [Language restrictions | Soniox Speech AI Docs](https://soniox.com/docs/stt/concepts/language-restrictions)
- 60+ languages supported across all models [Language hints | Soniox Speech AI Docs](https://soniox.com/docs/stt/concepts/language-hints)
- Better multilingual detection and mid-sentence language switching are v4 improvements [Models | Soniox Speech AI Docs](https://soniox.com/docs/stt/models)

#### Translation
- Real-time translation is supported in the same WebSocket stream, not requiring a separate post-processing pass [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)
- `translation_terms` in the context object controls specific term translations or name preservation across languages [Context | Soniox Speech AI Docs](https://soniox.com/docs/stt/concepts/context)

#### Punctuation and Casing
- These are handled automatically by the model and do not require explicit configuration parameters [General STT behavior — inferred from API design](https://soniox.com/docs/stt/models)

---

### 6. Partial vs. Final Transcripts, Endpointing, Latency-vs-Quality Tradeoffs

#### Token Structure
- Each returned token includes: `text`, timing fields, `confidence`, `is_final`, optional `speaker`, optional language/translation metadata [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)
- `is_final` is the critical flag distinguishing provisional (partial) from committed (final) tokens [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)

#### Handling Partial vs. Final Transcripts
- Treat non-final tokens as provisional UI/state updates (e.g., live captions) [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)
- Only commit durable transcript state, analytics events, or business actions from final tokens (where `is_final=true`) [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)
- Invalidate stale transcript/error callbacks with `transcriptGeneration` to prevent one utterance from being processed twice [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)

#### Endpoint Detection
- Endpoint detection signals when a speaker has finished speaking [Endpoint detection | Soniox Speech AI Docs](https://soniox.com/docs/stt/rt/endpoint-detection)
- Critical for voice AI assistants, command-and-response systems, and turn-taking logic [Endpoint detection | Soniox Speech AI Docs](https://soniox.com/docs/stt/rt/endpoint-detection)
- When enabled, the model emits a final `<end>` token and finalizes preceding tokens immediately, which can be used as the signal to trigger downstream actions (LLM calls, etc.) [Endpoint detection | Soniox Speech AI Docs](https://soniox.com/docs/stt/rt/endpoint-detection)

#### Endpoint Delay Parameter
- **`max_endpoint_delay_ms`** — Controls end-of-speech endpoint delay; range 500ms to 3000ms; default 2000ms [Endpoint detection | Soniox Speech AI Docs](https://soniox.com/docs/stt/rt/endpoint-detection)
- Lower values return endpoints sooner (faster turn-taking) [Endpoint detection | Soniox Speech AI Docs](https://soniox.com/docs/stt/rt/endpoint-detection)
- Higher values reduce risk of cutting speakers off too aggressively during short pauses [Endpoint detection | Soniox Speech AI Docs](https://soniox.com/docs/stt/rt/endpoint-detection)
- Lower `max_endpoint_delay_ms` recommended for voice agents needing fast turn-taking; higher values for dictation, noisy rooms, or hesitant speakers [Endpoint detection | Soniox Speech AI Docs](https://soniox.com/docs/stt/rt/endpoint-detection)

#### Non-Final Token Duration
- **`max_non_final_tokens_duration_ms`** — Controls how long the model accumulates non-final tokens before forcing a finalization; default varies, can be set to 6000ms for complex/noisy audio [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)
- Higher non-final duration gives the model more time to analyze context, improving accuracy and speaker diarization on difficult audio [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)
- Lower non-final duration improves responsiveness when responsiveness matters more than final-token stability [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)
- Soniox explicitly recommends `max_non_final_tokens_duration_ms=6000` for complex or noisy audio when slightly later final tokens are tolerable [WebSocket API | Soniox Speech AI Docs](https://soniox.com/docs/stt/api-reference/websocket-api)

#### Manual Finalization
- Manual finalization gives precise control over when tokens are finalized, in addition to automatic endpoint detection [Manual finalization | Soniox Speech AI Docs](https://soniox.com/docs/stt/rt/manual-finalization)
- Useful when you want to trigger finalization from your own logic rather than waiting for automatic endpoint detection [Manual finalization | Soniox Speech AI Docs](https://soniox.com/docs/stt/rt/manual-finalization)

#### Latency vs. Quality Tradeoff Summary
| Scenario | Recommendation |
|----------|----------------|
| Voice agents needing fast turn-taking | Lower `max_endpoint_delay_ms` (e.g., 500-1000ms) |
| Dictation, noisy audio, hesitant speakers | Higher `max_endpoint_delay_ms` (e.g., 2000-3000ms) |
| Difficult audio, better diarization | `max_non_final_tokens_duration_ms=6000` |
| Maximum responsiveness over accuracy | Lower non-final duration |
| Lowest latency streaming | Direct PCM 16kHz mono, no container formats |

---

### 7. Release Notes / Changelog Signals for Newest Features

#### February 5, 2026 — Soniox v4 Real-Time Released
- **Model:** stt-rt-v4 replaces stt-rt-v3 [Models | Soniox Speech AI Docs](https://soniox.com/docs/stt/models)
- Key improvements: higher accuracy, better multilingual detection, lower endpoint latency, improved semantic endpointing, more stable long-form transcription, stronger context use, added `max_endpoint_delay_ms` parameter [Models | Soniox Speech AI Docs](https://soniox.com/docs/stt/models)
- Available immediately via API with `{"model": "stt-rt-v4"}` [Models | Soniox Speech AI Docs](https://soniox.com/docs/stt/models)
- Backward compatible with v3 and existing API [Models | Soniox Speech AI Docs](https://soniox.com/docs/stt/models)

#### January 29, 2026 — Soniox v4 Async Released
- **Model:** stt-async-v4 replaces stt-async-v3 [Models | Soniox Speech AI Docs](https://soniox.com/docs/stt/models)
- Human-parity speech recognition across 60+ languages [Soniox v4 Async blog](https://soniox.com/blog/2026-01-29-soniox-v4-async)
- Stronger context use for domain-specific accuracy [Models | Soniox Speech AI Docs](https://soniox.com/docs/stt/models)

#### February 19, 2026 — New Soniox SDKs Announced
- New SDKs released to support the v4 API [New Soniox SDKs blog](https://soniox.com/blog/new-soniox-sdks/)
- SDKs cover Python, Node.js, Web (browser), and React [New Soniox SDKs blog](https://soniox.com/blog/new-soniox-sdks/)

#### Deprecation Timeline
- stt-rt-v3 and stt-async-v3 auto-route to v4 after 2026-02-28 [Models | Soniox Speech AI Docs](https://soniox.com/docs/stt/models)
- No API changes required; no service interruption [Models | Soniox Speech AI Docs](https://soniox.com/docs/stt/models)

---

### 8. Production Do's and Don'ts

#### DO

| Recommendation | Rationale | Source |
|----------------|-----------|--------|
| Use `stt-rt-v4` for new real-time production deployments | Current active real-time model with highest accuracy and lowest latency | [Models](https://soniox.com/docs/stt/models) |
| Use stable aliases (`stt-rt-v3-preview`) instead of hardcoded version numbers | Aliases always point to latest active model, reducing future migration effort | [Models](https://soniox.com/docs/stt/models) |
| Send `language_hints` when the likely spoken language is known | Improves accuracy, especially for real-time and less common languages | [Language hints](https://soniox.com/docs/stt/concepts/language-hints) |
| Provide `context` with `general` domain info and `terms` for domain-specific vocabulary | v4 shows stronger context use for domain accuracy; `terms` is primary custom vocabulary mechanism | [Context](https://soniox.com/docs/stt/concepts/context) |
| Use `pcm_s16le`, 16 kHz, mono for lowest-latency streaming | Soniox's own canonical example; container formats add decode latency | [WebSocket API](https://soniox.com/docs/stt/api-reference/websocket-api), [Direct stream](https://soniox.com/docs/stt/guides/direct-stream) |
| Always include `sample_rate` and `num_channels` for raw PCM | Required parameters; missing them returns specific errors | [WebSocket API](https://soniox.com/docs/stt/api-reference/websocket-api) |
| Use temporary API keys from your server, not embedded long-lived keys | Prevents secret exposure in client code | [WebSocket API](https://soniox.com/docs/stt/api-reference/websocket-api) |
| Treat non-final tokens as provisional; commit business actions only on `is_final=true` | Prevents double-processing and ensures data integrity | [WebSocket API](https://soniox.com/docs/stt/api-reference/websocket-api) |
| Enable endpoint detection for voice agents and turn-taking systems | Provides `<end>` token signals for downstream action triggering | [Endpoint detection](https://soniox.com/docs/stt/rt/endpoint-detection) |
| Lower `max_endpoint_delay_ms` for fast voice agents; raise it for dictation/noisy audio | Tunable tradeoff between responsiveness and cutting off speakers | [Endpoint detection](https://soniox.com/docs/stt/rt/endpoint-detection) |
| Send audio at real-time rate, not faster | Faster delivery triggers throttling/errors | [Direct stream](https://soniox.com/docs/stt/guides/direct-stream) |
| Handle stream limits: 100 req/min, 10 concurrent, 300 min max per session | Prevents hitting hard limits in production | [WebSocket API](https://soniox.com/docs/stt/api-reference/websocket-api) |
| End streams with empty WebSocket frame for graceful shutdown | Proper cleanup per Soniox protocol | [WebSocket API](https://soniox.com/docs/stt/api-reference/websocket-api) |
| Keep context under 8,000 tokens / ~10,000 characters | Exceeding limit returns error | [Context](https://soniox.com/docs/stt/concepts/context) |
| Re-test existing vocabulary/context prompts against v4 models | v4 has "stronger use of provided context"; older prompts may yield different results | [Models](https://soniox.com/docs/stt/models) |

#### DON'T

| Recommendation | Rationale | Source |
|----------------|-----------|--------|
| Don't hardcode `stt-rt-v3` in new production deployments after 2026-02-28 | v3 auto-routes to v4 but explicit v4 is the current active model | [Models](https://soniox.com/docs/stt/models) |
| Don't treat non-final tokens as committed transcripts | Provisional tokens may change; business actions on non-final may cause double-processing | [WebSocket API](https://soniox.com/docs/stt/api-reference/websocket-api) |
| Don't send audio faster than real time | Processing throttling/errors result | [Direct stream](https://soniox.com/docs/stt/guides/direct-stream) |
| Don't use container formats (MP3, WAV headers, etc.) for lowest latency | Decode latency makes them unsuitable for real-time; use raw PCM | [Direct stream](https://soniox.com/docs/stt/guides/direct-stream) |
| Don't omit `sample_rate` and `num_channels` for raw PCM | Required; API returns specific errors without them | [WebSocket API](https://soniox.com/docs/stt/api-reference/websocket-api) |
| Don't embed long-lived API keys in client code | Security risk; use server-generated temporary keys | [WebSocket API](https://soniox.com/docs/stt/api-reference/websocket-api) |
| Don't dump large generic documents as context without filtering | Context has 8,000-token limit; prefer session-specific, high-value terms | [Context](https://soniox.com/docs/stt/concepts/context) |
| Don't treat `context.text` as the primary vocabulary mechanism | `text` is "less influential than general or terms"; use `terms` for vocabulary | [Context](https://soniox.com/docs/stt/concepts/context) |
| Don't assume context blindly overrides recognition | Soniox uses context "only when helpful," not as forced output | [Context](https://soniox.com/docs/stt/concepts/context) |
| Don't skip `language_hints` for less common languages | Accuracy degrades without language guidance for non-mainstream languages | [Language hints](https://soniox.com/docs/stt/concepts/language-hints) |
| Don't ignore `confidence` scores in production | Low-confidence tokens may indicate recognition errors needing handling | [Confidence scores](https://soniox.com/docs/stt/concepts/confidence-scores) |
| Don't rely on v3 aliases for new production code if you need specific version control | Use explicit `stt-rt-v4` or `stt-async-v4` for version-locked deployments | [Models](https://soniox.com/docs/stt/models) |

---

## Source Quality Assessment

| Source | Tier | Date | Notes |
|--------|------|------|-------|
| Models \| Soniox Speech AI Docs | 1 | 2026-03 (inferred from v4 release dates) | Official primary source; model list and changelog |
| WebSocket API \| Soniox Speech AI Docs | 1 | 2026-03 (inferred) | Official primary source; API protocol definition |
| Context \| Soniox Speech AI Docs | 1 | 2026-03 (inferred) | Official primary source; context parameter specification |
| Language hints \| Soniox Speech AI Docs | 1 | 2026-03 (inferred) | Official primary source |
| Endpoint detection \| Soniox Speech AI Docs | 1 | 2026-03 (inferred) | Official primary source |
| Direct stream \| Soniox Speech AI Docs | 1 | 2026-03 (inferred) | Official primary source; latency optimization guide |
| Manual finalization \| Soniox Speech AI Docs | 1 | 2026-03 (inferred) | Official primary source |
| Confidence scores \| Soniox Speech AI Docs | 1 | 2026-03 (inferred) | Official primary source |
| Soniox v4 Real-Time blog post | 1 | 2026-02-05 | Official Soniox blog; v4 release announcement |
| Soniox v4 Async blog post | 1 | 2026-01-29 | Official Soniox blog; v4 async release |
| New Soniox SDKs blog post | 1 | 2026-02-19 | Official Soniox blog; SDK announcements |
| Language restrictions \| Soniox Speech AI Docs | 1 | 2026-03 (inferred) | Official primary source |
| Types \| Soniox Speech AI Docs (React SDK) | 1 | 2026-03 (inferred) | Official type definitions including `language_hints_strict` |

---

## Gaps

### Things That Could NOT Be Found (or Required Inference)

1. **Exact numeric latency benchmarks** — Soniox does not publish public latency percentiles (p50/p95/p99) for the WebSocket API. Latency claims ("ultra-low," "lower endpoint latency") are qualitative, not quantitative.

2. **Maximum concurrent WebSocket connections per API key** — The documented limits mention 10 concurrent requests but do not specify if this is per-key, per-account, or per-IP. Production high-concurrency scenarios should contact Soniox directly.

3. **Audio bit-depth requirements beyond format type** — While `pcm_s16le` is recommended, there is no explicit statement that 16-bit is required vs. 8-bit or 24-bit PCM being equally valid for quality. The recommendation appears to be convention rather than a stated requirement.

4. **Explicit telephony/8 kHz guidance** — The canonical example is 16 kHz, and while historical Soniox docs supported 8 kHz telephony audio, the current v4 docs do not explicitly address 8 kHz input. For telephony use cases, testing with actual audio is recommended.

5. **Precise diarization accuracy numbers** — Speaker diarization is listed as a capability but no WER/CER-equivalent metrics for speaker labeling are published.

6. **Exact context token counting method** — While 8,000 tokens / ~10,000 characters is the limit, Soniox does not specify whether this uses the same tokenization as their model or a rough character-to-token ratio.

7. **v4-specific parameter availability** — It is unclear if `max_endpoint_delay_ms` was available in v3 or is exclusively a v4 parameter. The changelog lists it as "added" in the v4 section but does not state v3 compatibility.

8. **Formal p/unction/casing control** — No explicit punctuation boost, casing control, or number formatting parameters were found in the current docs. These appear to be handled automatically by the model.

9. **Separate test/production API endpoints** — No separate base URL for sandbox/testing environments was documented; all traffic appears to go to the same production endpoint.

10. **SDK changelog detail** — The February 2026 SDK announcement did not include detailed changelogs for each SDK (Python, Node, Web, React) explaining what changed vs. prior versions.

---

## Confidence

**Level:** HIGH

**Rationale:** This research drew primarily from official Soniox documentation (soniox.com/docs/*) which is Tier 1. Key pages confirmed include the Models page, WebSocket API reference, Context concept page, Endpoint Detection page, Language Hints page, Direct Stream guide, Confidence Scores page, Manual Finalization page, and Language Restrictions page. The v4 release blog posts (February 5 and January 29, 2026) provide authoritative changelog data. No Tier 3-4 sources were relied upon for confirmed findings; all inferences are labeled as such. The documentation is internally consistent across pages, with context structure, audio requirements, and endpoint parameters all cross-referencing each other correctly. Recency is confirmed by the v4 release dates (January-February 2026) being within the past 60 days of this research (March 29, 2026).

The main limitation is that some operational parameters (exact latency numbers, concurrent connection limits, 8 kHz audio support in v4) were not found in official docs and are listed in the Gaps section rather than as confirmed findings.

---

## Sources

[1] Models | Soniox Speech AI Docs — https://soniox.com/docs/stt/models (Tier 1)
[2] WebSocket API | Soniox Speech AI Docs — https://soniox.com/docs/stt/api-reference/websocket-api (Tier 1)
[3] Context | Soniox Speech AI Docs — https://soniox.com/docs/stt/concepts/context (Tier 1)
[4] Language hints | Soniox Speech AI Docs — https://soniox.com/docs/stt/concepts/language-hints (Tier 1)
[5] Endpoint detection | Soniox Speech AI Docs — https://soniox.com/docs/stt/rt/endpoint-detection (Tier 1)
[6] Direct stream | Soniox Speech AI Docs — https://soniox.com/docs/stt/guides/direct-stream (Tier 1)
[7] Real-time transcription | Soniox Speech AI Docs — https://soniox.com/docs/stt/rt/real-time-transcription (Tier 1)
[8] Manual finalization | Soniox Speech AI Docs — https://soniox.com/docs/stt/rt/manual-finalization (Tier 1)
[9] Confidence scores | Soniox Speech AI Docs — https://soniox.com/docs/stt/concepts/confidence-scores (Tier 1)
[10] Language restrictions | Soniox Speech AI Docs — https://soniox.com/docs/stt/concepts/language-restrictions (Tier 1)
[11] Types | Soniox Speech AI Docs (React SDK) — https://soniox.com/docs/stt/SDKs/react-SDK/reference/types (Tier 1)
[12] Soniox v4 Real-Time blog post — https://soniox.com/blog/2026-02-05-soniox-v4-real-time/ (Tier 1)
[13] Soniox v4 Async blog post — https://soniox.com/blog/2026-01-29-soniox-v4-async (Tier 1)
[14] New Soniox SDKs blog post — https://soniox.com/blog/new-soniox-sdks/ (Tier 1)
[15] Real-time transcription with Web SDK | Soniox Speech AI Docs — https://soniox.com/docs/stt/SDKs/web-SDK/realtime-transcription (Tier 1)
