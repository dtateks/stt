# Soniox `max_non_final_tokens_duration_ms`: Documentation Status

**Research Date:** 30-03-2026
**Question:** Is `max_non_final_tokens_duration_ms` officially documented by Soniox?
**Answer:** **NO — this parameter is NOT officially documented anywhere.**

---

## Verdict: UNDOCUMENTED

`max_non_final_tokens_duration_ms` does not appear in any official Soniox documentation, SDK type definitions, SDK source code, or official GitHub examples/repositories. It exists in this project's `config.json` and TypeScript/Rust code but has **no official backing**.

---

## Evidence: Official Sources Checked

### 1. Soniox Official Documentation (soniox.com/docs/*)

| Page | `max_endpoint_delay_ms` | `max_non_final_tokens_duration_ms` |
|------|-------------------------|--------------------------------------|
| [Endpoint detection](https://soniox.com/docs/stt/rt/endpoint-detection) | ✅ Documented (500–3000ms, default 2000ms) | ❌ Not present |
| [WebSocket API reference](https://soniox.com/docs/stt/api-reference/websocket-api) | ✅ Documented | ❌ Not present |
| [Real-time transcription](https://soniox.com/docs/stt/rt/real-time-transcription) | ✅ Referenced | ❌ Not present |
| [Manual finalization](https://soniox.com/docs/stt/rt/manual-finalization) | ❌ Not present | ❌ Not present |
| [Models](https://soniox.com/docs/stt/models) | ✅ Referenced (v4 improvement) | ❌ Not present |
| [Context](https://soniox.com/docs/stt/concepts/context) | ❌ Not present | ❌ Not present |
| [Direct stream](https://soniox.com/docs/stt/guides/direct-stream) | ❌ Not present | ❌ Not present |
| [Limits & quotas](https://soniox.com/docs/stt/rt/limits-and-quotas) | ❌ Not present | ❌ Not present |

### 2. Python SDK — `RealtimeSTTConfig` (soniox/soniox-python)

**Source:** [src/soniox/types/realtime.py](https://github.com/soniox/soniox-python/blob/main/src/soniox/types/realtime.py)

```python
class RealtimeSTTConfig(BaseModel):
    enable_endpoint_detection: bool | None = None
    max_endpoint_delay_ms: int | None = Field(default=None, ge=500, le=3000)
    # NO max_non_final_tokens_duration_ms field
```

The official Python SDK type definition does **not include** `max_non_final_tokens_duration_ms`. Only `max_endpoint_delay_ms` is present with range validation `ge=500, le=3000`.

### 3. Node.js SDK — `SttSessionConfig` (soniox/soniox-js)

**Source:** Fetched from [Node SDK Types reference](https://soniox.com/docs/stt/SDKs/node-SDK/reference/types) (full `SttSessionConfig` shown in page):

```typescript
interface SttSessionConfig {
  audio_format?: "auto" | AudioFormat;
  enable_endpoint_detection?: boolean;
  max_endpoint_delay_ms?: number; // 500–3000ms, default 2000ms
  model: string;
  // ... no max_non_final_tokens_duration_ms field
}
```

The official Node.js SDK type definition does **not include** `max_non_final_tokens_duration_ms`.

### 4. Soniox Official GitHub Examples (soniox/soniox-examples)

Searched all repos in `soniox` organization:
- `gh search code "max_non_final_tokens_duration_ms" --repo soniox/soniox-examples` → **0 results**
- `gh search code "max_endpoint_delay_ms" --repo soniox/soniox-examples` → 0 results (parameter not in examples either, only in docs)

### 5. GitHub General Search

- `grep_app_searchGitHub` for `max_non_final_tokens_duration_ms` across all public repos → **0 results in any Soniox org repo**
- The only hit is from `TEN-framework/ten-framework` (a third-party voice agent framework), which sets `"max_non_final_tokens_duration_ms": 360` as a default in their Soniox integration config

---

## Evidence: Parameter Existence in This Project

Despite being undocumented, the parameter IS present in this project:

### config.json (line 16)
```json
"max_non_final_tokens_duration_ms": 1800,
```

### TypeScript types.ts (lines 44-46)
```typescript
enable_endpoint_detection?: boolean;
max_endpoint_delay_ms?: number;
max_non_final_tokens_duration_ms?: number; // present but undocumented
```

### soniox-client.ts (lines 184-186)
```typescript
...(config.max_non_final_tokens_duration_ms !== undefined && {
  max_non_final_tokens_duration_ms: config.max_non_final_tokens_duration_ms,
}),
```

### Rust llm_service.rs (line 59)
```rust
pub max_non_final_tokens_duration_ms: Option<u32>,
```

### Test coverage
- `src/tests/native_services.rs` validates `max_endpoint_delay_ms` (line 306) but does **NOT** validate `max_non_final_tokens_duration_ms`

---

## Comparison: Documented vs. Undocumented

| Parameter | Status | Range | Default | Source |
|-----------|--------|-------|---------|--------|
| `enable_endpoint_detection` | ✅ Documented | boolean | — | [Endpoint detection docs](https://soniox.com/docs/stt/rt/endpoint-detection) |
| `max_endpoint_delay_ms` | ✅ Documented | 500–3000ms | 2000ms | [Endpoint detection](https://soniox.com/docs/stt/rt/endpoint-detection), [WebSocket API](https://soniox.com/docs/stt/api-reference/websocket-api), Python SDK type, Node SDK type |
| `max_non_final_tokens_duration_ms` | ❌ **UNDOCUMENTED** | **Unknown** | **Unknown** | Present in codebase only; not in any official Soniox source |

---

## Official SDK Type Definitions (Exact Evidence)

### Python SDK — `RealtimeSTTConfig` (definitive)
Source: [soniox-python/src/soniox/types/realtime.py](https://github.com/soniox/soniox-python/blob/main/src/soniox/types/realtime.py)

```python
enable_endpoint_detection: bool | None = None
"""Enable endpoint detection for utterance boundaries."""

max_endpoint_delay_ms: int | None = Field(default=None, ge=500, le=3000)
"""
Maximum delay between the end of speech and returned endpoint.
Allowed values for maximum delay are between 500ms and 3000ms. The default value is 2000ms
"""
# max_non_final_tokens_duration_ms: ABSENT
```

### Node SDK — `SttSessionConfig` (definitive)
Source: [soniox-js/packages/node/src/types/public/models.ts](https://github.com/soniox/soniox-js/blob/main/packages/node/src/types/public/models.ts)

```typescript
export type SonioxModel = {
  // ...
  supports_max_endpoint_delay: boolean; // model capability flag
  // NO max_non_final_tokens_duration field anywhere
};

interface SttSessionConfig {
  max_endpoint_delay_ms?: number; // documented 500-3000ms
  enable_endpoint_detection?: boolean;
  // max_non_final_tokens_duration_ms: ABSENT
}
```

---

## Conclusion

**`max_non_final_tokens_duration_ms` is not officially documented.**

It appears in this project's configuration and code, and appears to be sent over the Soniox WebSocket wire (in `soniox-client.ts`), but:
- No official documentation page mentions it
- No official SDK type includes it
- No official Soniox GitHub example uses it
- The Python SDK Pydantic model explicitly defines only `max_endpoint_delay_ms` with range validation, confirming `max_non_final_tokens_duration_ms` is not part of the official API surface
- A third-party framework (TEN-framework) uses it with a default of 360ms — this is the only non-project reference found, suggesting it may be a semi-stable but undocumented backend parameter

**Practical implication:** If `max_non_final_tokens_duration_ms` is being used in production, it is being used on an undocumented basis. The official, supported parameters for controlling token finalization behavior are `enable_endpoint_detection` and `max_endpoint_delay_ms` only.

For slow dictation UX, relying on the documented `max_endpoint_delay_ms` (raise to 1500–2000ms) is the only officially supported path. The `max_non_final_tokens_duration_ms` parameter, if effective, is an undocumented bonus — not a recommended configuration.
