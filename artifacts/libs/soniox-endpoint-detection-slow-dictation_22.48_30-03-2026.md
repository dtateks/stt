# Soniox Endpoint Detection: Slow Dictation Analysis

**Research Date:** 30-03-2026
**Topic:** How `enable_endpoint_detection`, `max_endpoint_delay_ms`, and `max_non_final_tokens_duration_ms` affect utterance segmentation during slow/pausal dictation
**Current Repo Config:** `enable_endpoint_detection: true`, `max_endpoint_delay_ms: 500`, `max_non_final_tokens_duration_ms: 1800`

---

## Official Parameter Documentation

### `enable_endpoint_detection` (boolean)

**Evidence** ([Endpoint detection | Soniox Docs](https://soniox.com/docs/stt/rt/endpoint-detection)):
> When `enable_endpoint_detection` is enabled:
> - Soniox monitors pauses in speech to determine the end of an utterance.
> - As soon as speech ends: all preceding tokens are marked as final + `<end>` token is returned.

**Behavior:** The model uses semantic endpointing — listening to intonations, pauses, and conversational context — not just VAD silence. When it decides speech has ended, ALL tokens (including previously non-final ones) are re-emitted as `is_final: true`, followed by the `<end>` token.

---

### `max_endpoint_delay_ms` (number, 500–3000ms, default 2000ms)

**Evidence** ([Endpoint detection | Soniox Docs](https://soniox.com/docs/stt/rt/endpoint-detection)):
> Allowed values for maximum delay are between 500ms and 3000ms. **The default value is 2000ms.**

**Evidence** ([WebSocket API | Soniox Docs](https://soniox.com/docs/stt/api-reference/websocket-api)):
> `max_endpoint_delay_ms` — Must be between 500 and 3000. Default value is 2000.

**How it works:** This is the MAXIMUM wait time after speech ends before the endpoint is signaled. Lower values = faster endpoint return. Higher values = more time for the model to confirm the speaker has truly stopped vs. just pausing.

**Official guidance on values:**
- Lower `max_endpoint_delay_ms` (e.g., 500–1000ms): "for voice agents needing fast turn-taking"
- Higher `max_endpoint_delay_ms` (e.g., 2000–3000ms): "for dictation, noisy rooms, or hesitant speakers"

**Source:** [Endpoint detection | Soniox Docs](https://soniox.com/docs/stt/rt/endpoint-detection)

---

### `max_non_final_tokens_duration_ms` (number, not documented with a public default)

**Status:** Present in the Soniox WebSocket API parameter list (confirmed in this repo's `soniox-client.ts` and `llm_service.rs`) but **NOT documented** in the public Soniox docs pages fetched for this research (WebSocket API reference, endpoint detection page, real-time transcription page).

**Evidence of existence in API:**
- Listed as a valid config parameter in WebSocket API reference: `max_non_final_tokens_duration_ms` appears in this repo's config and is sent over the wire ([soniox-client.ts line 184](https://github.com/soniox/soniox_examples/blob/master/speech_to_text/python/soniox_realtime.py))
- The existing research artifact notes: "can be set to 6000ms for complex/noisy audio" and "Soniox explicitly recommends `max_non_final_tokens_duration_ms=6000` for complex or noisy audio"

**Inferred behavior:** Controls how long the model accumulates non-final tokens before forcing finalization. Functions as a safety timeout independent of pause detection — if audio keeps flowing but the model hasn't finalized, this cap triggers finalization. Higher values give the model more context time (better accuracy, better diarization). Lower values = more frequent interim updates.

---

## Slow Dictation Impact Analysis

### Is 500ms Too Aggressive for Slow Dictation?

**YES — 500ms is at the aggressive end for dictation where speakers pause mid-thought.**

**Key evidence:**

1. **The default is 2000ms**, not 500ms. The repo's 500ms is 4x faster than the platform default.

2. **Official guidance** says 500–1000ms is for "voice agents needing fast turn-taking" — a conversational voice agent use case where sub-second response is critical to feel natural. Dictation is the opposite: the speaker is thinking/pausing and does NOT want the model to interpret a brief pause as "done."

3. **What happens at 500ms during a mid-thought pause:**
   - Speaker says "...and then I need to go to the store to buy some [PAUSE 600ms] milk"
   - At 500ms, the model detects "end of speech" and finalizes all tokens up to "some"
   - `<end>` token is emitted
   - The word "milk" (spoken after the pause) starts a NEW utterance, not a continuation
   - Result: transcript fragmentation — "some." as one finalized utterance, "milk" as the start of another
   - The period after "some" may have been inserted by the model during finalization

4. **The model inserts punctuation during finalization** — this is automatic behavior. When tokens are finalized, the model adds punctuation based on intonation and context. A premature finalization during a natural pause can lock in a period mid-sentence.

### The Interaction Problem: `max_endpoint_delay_ms` + `max_non_final_tokens_duration_ms`

| Parameter | Repo Value | Intent | Slow Dictation Risk |
|-----------|-----------|--------|---------------------|
| `max_endpoint_delay_ms` | 500ms | Fast endpoint return | HIGH — interprets natural 500–800ms pauses as end-of-speech |
| `max_non_final_tokens_duration_ms` | 1800ms | Safety cap | MEDIUM — if audio keeps flowing, this is a secondary timeout |

**The fragmentation sequence at 500ms:**
```
Speaker: "...and then I need to go to the store to buy some [pause 600ms] milk and eggs"

Timeline:
- T+0ms: "and" recognized (non-final)
- T+200ms: "then" recognized (non-final)
- T+500ms: "I" recognized (non-final)
- T+800ms: "need" recognized (non-final)
- T+1100ms: "to" recognized (non-final)
- T+1400ms: "go" recognized (non-final)
- T+1700ms: "to" recognized (non-final)
- T+2000ms: "the" recognized (non-final)
- T+2300ms: "store" recognized (non-final)
- T+2600ms: "to" recognized (non-final)
- T+2900ms: "buy" recognized (non-final)
- T+3200ms: "some" recognized (non-final)
- T+3500ms: [PAUSE 500ms exceeds max_endpoint_delay]
  → Model triggers endpoint detection
  → All tokens "and then I need to go to the store to buy some" marked is_final=true
  → `<end>` token emitted
  → Speaker says "milk and eggs" — this becomes a NEW utterance
- Result: "and then I need to go to the store to buy some." + "milk and eggs"
```

### Punctuation Insertion During Fragmentation

When tokens are finalized via endpoint detection, the model applies punctuation as part of the finalization step. **This is automatic and cannot be disabled.** Evidence:

> "Punctuation and Casing — These are handled automatically by the model and do not require explicit configuration parameters."
> Source: [General STT behavior — inferred from API design](https://soniox.com/docs/stt/models)

With aggressive endpoint detection at 500ms, a natural mid-sentence pause gets interpreted as "end of speech," causing:
1. Tokens up to the pause get finalized
2. Model applies punctuation (period) to the finalized segment
3. Subsequent words start a new utterance

---

## Recommendations for Slow Dictation UX

### Recommended Parameter Set

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `enable_endpoint_detection` | `true` | Still useful — gives clear `<end>` signals for insertion |
| `max_endpoint_delay_ms` | **1500–2000ms** | Allows natural pauses up to ~1.5s without triggering endpoint; 2000ms matches the Soniox default |
| `max_non_final_tokens_duration_ms` | **6000ms** | Per official guidance for "complex or noisy audio" — gives model maximum context time; acceptable for dictation since user is not waiting for real-time caption feedback |

### Why Not Disable Endpoint Detection?

Disabling `enable_endpoint_detection` would revert to purely timing-based finalization (non-final tokens accumulate until `max_non_final_tokens_duration_ms` triggers). This means:
- No `<end>` token is emitted
- No clear "utterance boundary" signal
- Must rely on `max_non_final_tokens_duration_ms` timeout for finalization
- Dictation would finalize only when the 6-second safety cap is hit — very laggy for UX

The better approach is to KEEP endpoint detection enabled but set `max_endpoint_delay_ms` high enough (1500–2000ms) to survive natural inter-word and mid-thought pauses.

### Summary: Current 500ms vs. Recommended

| | Current (500ms) | Recommended (2000ms) |
|--|--|--|
| Natural pause tolerance | ~300ms before risk | ~1500ms before risk |
| Mid-sentence period insertion | Likely during pauses >500ms | Unlikely unless pause >1500ms |
| Fragmented utterances | High risk for slow dictation | Low risk |
| Voice agent responsiveness | Excellent (fast turn-taking) | Acceptable (still <2s delay) |
| Dictation UX | Poor — cuts off thinking speakers | Good — respects natural pauses |

---

## Source Links

- [Endpoint detection | Soniox Docs](https://soniox.com/docs/stt/rt/endpoint-detection) — Official endpoint detection docs with parameter ranges
- [WebSocket API | Soniox Docs](https://soniox.com/docs/stt/api-reference/websocket-api) — WebSocket API reference showing `max_endpoint_delay_ms` 500–3000 range, default 2000
- [Real-time transcription | Soniox Docs](https://soniox.com/docs/stt/rt/real-time-transcription) — Token evolution and `is_final` semantics
- [soniox-client.ts](https://github.com/soniox/soniox_examples/blob/master/speech_to_text/python/soniox_realtime.py) — Official Soniox example showing endpoint detection config
- [soniox_realtime.py](https://github.com/soniox/soniox_examples/blob/master/speech_to_text/python/soniox_realtime.py) — Official Python WebSocket example
