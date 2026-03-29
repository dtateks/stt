# Google Gemini API Research — Transcript Correction Provider

**Date:** 2026-03-28
**Source:** [Google AI Gemini API Documentation](https://ai.google.dev/gemini-api/docs)

---

## 1. REST Endpoint

**Base URL:** `https://generativelanguage.googleapis.com`

**Generate Content endpoint (v1beta):**
```
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
```

**Models List endpoint (via OpenAI compatibility layer):**
```
GET https://generativelanguage.googleapis.com/v1beta/openai/models
```

The v1beta prefix is the current stable API version. Model names include variant suffixes (e.g., `gemini-2.5-flash`, `gemini-3-flash-preview`).

---

## 2. Authentication

**Header:** `x-goog-api-key` — NOT `Authorization: Bearer`

```bash
curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -X POST \
  -d '{ ... }'
```

**Important:** Unlike xAI/OpenAI which use `Bearer` tokens, Gemini uses a dedicated header key. The API key is passed as a query parameter alternative but header is preferred.

---

## 3. Models Endpoint

**OpenAI-compatible listing (Bearer auth):**
```bash
curl https://generativelanguage.googleapis.com/v1beta/openai/models \
  -H "Authorization: Bearer GEMINI_API_KEY"
```

**Response shape:**
```json
{
  "data": [
    { "id": "gemini-2.5-flash", "object": "model", ... },
    { "id": "gemini-3-flash-preview", "object": "model", ... }
  ],
  "object": "list"
}
```

**Current models** include: `gemini-2.5-flash`, `gemini-3-flash-preview`, `gemini-pro`, `gemini-pro-vision`.

---

## 4. Request Body Shape — Text Generation / Chat

**Endpoint:** `POST /v1beta/models/{model}:generateContent`

**Minimal request body:**
```json
{
  "contents": [
    {
      "role": "user",
      "parts": [
        { "text": "Your prompt text here" }
      ]
    }
  ]
}
```

**With generation config (temperature, JSON mode):**
```json
{
  "contents": [
    {
      "parts": [
        { "text": "Your prompt text here" }
      ]
    }
  ],
  "generationConfig": {
    "temperature": 0.1,
    "topP": 0.8,
    "topK": 10,
    "responseMimeType": "application/json",
    "responseJsonSchema": {
      "type": "object",
      "properties": {
        "corrected_text": {
          "type": "string",
          "description": "The corrected transcript text"
        }
      }
    }
  }
}
```

**System instruction via `systemInstruction`:**
```json
{
  "systemInstruction": {
    "parts": [
      { "text": "You are a voice transcription corrector..." }
    ]
  },
  "contents": [ ... ]
}
```

**Full request example (cURL):**
```bash
curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -X POST \
  -d '{
    "contents": [{
      "parts": [{
        "text": "Fix misheard words in this transcript: \"Hello wurl is ths\""
      }]
    }],
    "generationConfig": {
      "temperature": 0.1,
      "responseMimeType": "application/json",
      "responseJsonSchema": {
        "type": "object",
        "properties": {
          "corrected_text": { "type": "string" }
        }
      }
    }
  }'
```

---

## 5. Response Shape — Extracted Text

**Success response (200):**
```json
{
  "candidates": [
    {
      "content": {
        "parts": [
          { "text": "The corrected transcript text" }
        ],
        "role": "model"
      },
      "finishReason": "STOP",
      "safetyRatings": [ ... ]
    }
  ],
  "usageMetadata": {
    "promptTokenCount": 12,
    "candidatesTokenCount": 8,
    "totalTokenCount": 20
  }
}
```

**Extracting text:** Navigate `candidates[0].content.parts[0].text`

**With structured JSON output (when `responseJsonSchema` is set):**
The response body is the JSON object conforming to the schema directly — NOT wrapped in `candidates`. Example:
```json
{
  "corrected_text": "Hello world is this"
}
```

---

## 6. Structured Error Shape

**Error response format:**
```json
{
  "error": {
    "code": 429,
    "message": "Resource has been exhausted (e.g. check quota).",
    "status": "RESOURCE_EXHAUSTED"
  }
}
```

| HTTP Status | `status` field | Meaning |
|-------------|----------------|---------|
| 400 | `INVALID_ARGUMENT` | Malformed request or missing required fields |
| 400 | `FAILED_PRECONDITION` | Free tier not available in user's country |
| 403 | `PERMISSION_DENIED` | API key lacks permissions or tune model auth missing |
| 404 | `NOT_FOUND` | Requested resource (file/model) not found |
| 429 | `RESOURCE_EXHAUSTED` | Rate limit exceeded for current tier |
| 500 | `INTERNAL` | Unexpected Google-side error (e.g. context too long) |
| 503 | `UNAVAILABLE` | Service temporarily overloaded |
| 504 | `DEADLINE_EXCEEDED` | Request timed out |

---

## 7. Comparison with Existing Providers (xAI / OpenAI-Compatible)

| Aspect | xAI / OpenAI | Gemini |
|--------|--------------|--------|
| **Auth header** | `Authorization: Bearer` | `x-goog-api-key` (separate header) |
| **Endpoint** | `/v1/chat/completions` | `/v1beta/models/{model}:generateContent` |
| **Request format** | `messages: [{role, content}]` | `contents: [{parts: [{text}]}]` |
| **System prompt** | First message with `role: system` | `systemInstruction: {parts: [{text}]}` |
| **Response text path** | `choices[0].message.content` | `candidates[0].content.parts[0].text` |
| **JSON mode** | `response_format: {type: "json_object"}` | `generationConfig: {responseMimeType, responseJsonSchema}` |
| **Error shape** | `{error: {message}}` | `{error: {code, message, status}}` |
| **Models list** | `/v1/models` | `/v1beta/openai/models` (Bearer) |

---

## 8. Key Implementation Notes for Adding Gemini Provider

1. **Provider detection:** Add `gemini` as a new provider variant alongside `xai` and `openai_compatible` in `llm_service.rs`

2. **Auth:** Gemini uses `x-goog-api-key` header instead of Bearer token. Different from existing providers.

3. **Endpoint construction:**
   ```
   https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
   ```
   Where model defaults to `gemini-2.5-flash` or `gemini-3-flash-preview`.

4. **Request body transformation:**
   - xAI/OpenAI: `{"model": "...", "messages": [{"role": "system", "content": "..."}, {"role": "user", "content": "..."}]}`
   - Gemini: `{"contents": [{"parts": [{"text": "..."}]}], "systemInstruction": {"parts": [{"text": "..."}]}}`

5. **Response extraction:**
   - xAI/OpenAI: `payload["choices"][0]["message"]["content"]`
   - Gemini: `payload["candidates"][0]["content"]["parts"][0]["text"]`

6. **Error handling:** Parse `payload["error"]["status"]` for structured error classification.

7. **Temperature mapping:** Both providers accept `0.0-2.0` range, so mapping is 1:1.

8. **Model listing:** Can use the OpenAI-compatible endpoint with Bearer auth: `GET /v1beta/openai/models` with `Authorization: Bearer $GEMINI_API_KEY`.

---

## 9. References

- [Gemini API Overview](https://ai.google.dev/gemini-api/docs/api-overview)
- [Text Generation](https://ai.google.dev/gemini-api/docs/text-generation)
- [Structured Output](https://ai.google.dev/gemini-api/docs/structured-output)
- [Error Handling](https://ai.google.dev/gemini-api/docs/troubleshooting)
- [OpenAI Compatibility](https://ai.google.dev/gemini-api/docs/openai)
- [System Instructions](https://ai.google.dev/gemini-api/docs/system-instructions)
