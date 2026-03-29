# Soniox Speech-to-Text API — Official Documentation Research

**Research Date:** 29-03-2026
**Source:** [Soniox Official Documentation](https://soniox.com/docs/stt/api-reference/websocket-api)

---

## 1. WebSocket API Contract

### Endpoint
```
wss://stt-rt.soniox.com/transcribe-websocket
```

### Connection Flow
1. Establish WebSocket connection
2. Send initial JSON configuration as a **text frame**
3. Stream audio as **binary frames**
4. Receive transcription results as JSON text frames

### Initial Configuration Message (sent as text frame before audio)

```json
{
  "api_key": "<SONIOX_API_KEY>",
  "model": "stt-rt-v3",
  "audio_format": "auto",
  "language_hints": ["en", "es"],
  "context": { ... },
  "enable_speaker_diarization": true,
  "enable_language_identification": true,
  "enable_endpoint_detection": true,
  "translation": { "type": "two_way", "language_a": "en", "language_b": "es" },
  "client_reference_id": "optional-string"
}
```

**Source:** [WebSocket API Documentation](https://soniox.com/docs/stt/api-reference/websocket-api)

### Control Messages (sent as JSON text frames)

| Message | Purpose |
|---------|---------|
| `{"type":"keepalive"}` | Send at least every 20 seconds when audio is paused |
| `{"type":"finalize"}` | Signals end of current audio segment |
| `{"type":"finalize","trailing_silence_ms":300}` | Signals end with custom trailing silence |

### Token Response Shape

```json
{
  "tokens": [
    {
      "text": "Hello",
      "start_ms": 600,
      "end_ms": 760,
      "confidence": 0.97,
      "is_final": true,
      "speaker": "1",
      "language": "en",
      "translation_status": "none",
      "source_language": "en"
    }
  ],
  "final_audio_proc_ms": 760,
  "total_audio_proc_ms": 880
}
```

### Finished Response

```json
{
  "tokens": [],
  "final_audio_proc_ms": 1560,
  "total_audio_proc_ms": 1680,
  "finished": true
}
```

### Error Response

```json
{
  "tokens": [],
  "error_code": 503,
  "error_message": "Cannot continue request (code N). Please restart the request..."
}
```

---

## 2. API Parameters Reference

### Core Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `api_key` | string | Yes | Your Soniox API key or temporary key |
| `model` | string | Yes | Real-time model to use (e.g., `stt-rt-v3`) |
| `audio_format` | string | No | Audio format. `"auto"` recommended. Other: `pcm_s16le` |
| `sample_rate` | integer | If not auto | Sample rate in Hz (e.g., 16000) |
| `num_channels` | integer | If not auto | Number of audio channels (1 = mono, 2 = stereo) |
| `language_hints` | array[string] | No | Array of ISO language codes to bias recognition |
| `context` | object | No | Context object for improved accuracy |
| `enable_speaker_diarization` | boolean | No | Enable speaker labeling (default: false) |
| `enable_language_identification` | boolean | No | Enable per-token language detection (default: false) |
| `enable_endpoint_detection` | boolean | No | Enable automatic speech endpoint detection |
| `translation` | object | No | Translation configuration |
| `client_reference_id` | string | No | Custom identifier for the client session |

**Source:** [WebSocket API Parameters](https://soniox.com/docs/stt/api-reference/websocket-api)

---

## 3. Model Selection

### Available Real-Time Models

| Model | Description |
|-------|-------------|
| `stt-rt-v3` | **Latest v3 model** — improved accuracy, multilingual switching, up to 5 hours audio processing |
| `stt-rt-preview` | Alias pointing to `stt-rt-v3` for backward compatibility |

### Available Async Models

| Model | Description |
|-------|-------------|
| `stt-async-v3` | **Latest v3 async model** — for file-based transcription |
| `stt-async-preview` | Alias pointing to `stt-async-v3` |

### v3 Model Improvements
- Support for up to **5 hours of audio**
- Enhanced multilingual switching capabilities
- Higher accuracy
- Better diarization and translation
- Full API compatibility with existing code (except context feature)

**Source:** [Soniox Models Documentation](https://soniox.com/docs/stt/models)

### Migration from Older Models
To upgrade to v3, simply replace the model name:
```json
{ "model": "stt-rt-v3" }  // was previously "stt-rt-..."
```

---

## 4. Context / Custom Vocabulary Support

### Context Object Structure

The `context` object has **four sections**:

```json
{
  "context": {
    "general": [
      { "key": "domain", "value": "Healthcare" },
      { "key": "topic", "value": "Diabetes management consultation" }
    ],
    "text": "Long unstructured background text or documents...",
    "terms": ["Celebrex", "Zyrtec", "Xanax"],
    "translation_terms": [
      { "source": "Mr. Smith", "target": "Sr. Smith" }
    ]
  }
}
```

| Section | Type | Purpose |
|---------|------|---------|
| `general` | array of `{key, value}` objects | Structured key-value pairs (domain, topic, participants). **Recommend ≤10 pairs** |
| `text` | string | Long unstructured background documents or meeting notes |
| `terms` | array of strings | Custom vocabulary — domain-specific words, proper nouns, rare terms |
| `translation_terms` | array of `{source, target}` objects | Custom translation pairs to preserve specific terms |

### Size Limit
- **Maximum ~8,000 tokens (~10,000 characters)**
- Exceeding this limit returns an API error

### Official Tips for Context

> *"Provide domain and topic in the `general` section for best accuracy. Keep `general` short — ideally no more than **10** key-value pairs. Use `terms` to ensure consistent spelling and casing of difficult entity names. Use `translations` to preserve terms like names or brands unchanged."*

**Source:** [Context Documentation](https://soniox.com/docs/stt/concepts/context)

---

## 5. Audio Format Requirements

### Auto-Detected Formats (no configuration needed)
When using `audio_format: "auto"`, Soniox detects from stream headers:
- `aac`, `aiff`, `amr`, `asf`, `flac`, `mp3`, `ogg`, `wav`, `webm`

### Raw Audio Formats (requires explicit configuration)

When using raw formats, **three parameters required**:

```json
{
  "audio_format": "pcm_s16le",
  "sample_rate": 16000,
  "num_channels": 1
}
```

### Supported Raw Encodings
- **PCM signed/unsigned:** `pcm_s16le`, `pcm_u16le`, etc.
- **PCM float:** `pcm_f32le`, etc.
- **Companded:** `mulaw`, `alaw`

### Official Sample Rate Recommendation
- **`16000 Hz`** — standard for speech recognition (used in examples)
- Higher sample rates accepted but 16kHz is optimal for speech

### Recommended Configuration (from official examples)
```json
{
  "audio_format": "pcm_s16le",
  "sample_rate": 16000,
  "num_channels": 1
}
```

**Source:** [Audio Formats Documentation](https://soniox.com/docs/stt/rt/real-time-transcription#audio-formats)

---

## 6. Official Quality Best Practices

### From Official "Best Practices" Page

> *"To achieve optimal results, it's recommended to provide `language_hints` and `context` when available, as this significantly improves accuracy. For controlling the trade-off between latency and accuracy, use `endpoint_detection` or the `finalize` option."*

### Specific Recommendations

| Technique | Impact | Implementation |
|-----------|--------|----------------|
| **Language Hints** | "Significantly improves accuracy" | `"language_hints": ["en", "es"]` |
| **Context - General** | Improves domain understanding | `"general": [{"key": "domain", "value": "..."}]` — keep ≤10 pairs |
| **Context - Terms** | Ensures consistent spelling of proper nouns | `"terms": ["EBITDA", "Dr. Smith"]` |
| **Context - Text** | Background documents improve accuracy | `"text": "Long background..."` |
| **Endpoint Detection** | Minimizes latency by finalizing tokens immediately | `"enable_endpoint_detection": true` |
| **Async for Quality** | Higher accuracy for difficult audio | Use `stt-async-v3` instead of real-time |

### Latency vs Accuracy Trade-off

| Scenario | Approach |
|----------|----------|
| Real-time, low latency needed | Display non-final tokens live; act only on final tokens |
| High accuracy required | Use `finalize` option or async processing |
| Difficult audio / speaker attribution | Prefer asynchronous processing |

**Source:** [Best Practices](https://soniox.com/docs/llms) and [WebSocket API](https://soniox.com/docs/stt/api-reference/websocket-api)

---

## 7. Token Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `text` | string | The transcribed text |
| `start_ms` | number | Start timestamp in milliseconds |
| `end_ms` | number | End timestamp in milliseconds |
| `confidence` | number | Confidence score 0.0–1.0 |
| `is_final` | boolean | Whether token is finalized |
| `speaker` | string | Speaker identifier (if diarization enabled) |
| `language` | string | ISO language code (if identification enabled) |
| `translation_status` | string | `"none"` \| `"original"` \| `"translation"` |
| `source_language` | string | Source language for translated tokens |

---

## 8. Additional Features

### Speaker Diarization
```json
{ "enable_speaker_diarization": true }
```
Each token includes a `"speaker"` field (e.g., `"1"`, `"2"`).

### Language Identification
```json
{ "enable_language_identification": true }
```
Each token includes a `"language"` field with the detected ISO code.

### Endpoint Detection
```json
{ "enable_endpoint_detection": true }
```
Automatically detects when speaker stops and finalizes non-final tokens, minimizing latency.

### Translation Modes
```json
{
  "translation": {
    "type": "one_way",        // translates all languages to target
    "target_language": "es"
  }
}

{
  "translation": {
    "type": "two_way",        // bidirectional
    "language_a": "en",
    "language_b": "es"
  }
}
```

---

## Summary: Official Recommendations for Maximizing Quality

1. **Use v3 models:** `stt-rt-v3` or `stt-async-v3`
2. **Provide `language_hints`:** Array of expected ISO codes
3. **Use context extensively:**
   - `general`: domain/topic key-values (≤10 pairs)
   - `terms`: proper nouns, technical terms
   - `text`: background documents
4. **Use appropriate sample rate:** 16000 Hz for speech
5. **Use mono channel:** `num_channels: 1` for speech
6. **Enable `enable_endpoint_detection`:** For lower latency
7. **For highest accuracy:** Use async (`stt-async-v3`) instead of real-time
8. **Context limit:** ~8,000 tokens maximum

**Primary Source:** [Soniox WebSocket API Documentation](https://soniox.com/docs/stt/api-reference/websocket-api)
