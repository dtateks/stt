# Architecture

## Overview

Voice to Text is a global voice input app for macOS. It converts speech to text and inserts text at the system cursor position — any app, any editable field.

## Sibling Projects

| Project | Path | Purpose |
|---------|------|---------|
| **voice-vs-extension** | `/Users/sonph36/tools/voice-vs-extension` | VS Code extension (VVoice). **Reference for pipeline code — nearly identical, adapt as needed.** |
| **voice-terminal** | `/Users/sonph36/tools/voice-terminal` | Kitty terminal Electron menubar app. **Reference for UI/UX — same pattern, discard terminal-specific features.** |

## Pipeline Flow

```
Microphone (Web Audio API / getUserMedia in renderer)
    ↓
Renderer audio pipeline (raw 16-bit PCM, 16kHz, mono)
    ↓
Soniox STT (WebSocket streaming, model stt-rt-v4)
    ↓
Token accumulation (interim + final)
    ↓
Stop Word Detector ("thank you")
    ↓
[Optional] LLM Correction (xAI Grok)
    ↓
Insert text at cursor (system-level)
```

Pipeline logic is conceptually similar to voice-vs-extension, but this app captures audio in the renderer with Web Audio API and finishes with system-level text insertion instead of `terminal.sendText()`.

## Reference Files from voice-vs-extension (pipeline logic)

The pipeline logic is conceptually similar. Reference these files for structure, but adapt them to renderer-side Web Audio capture instead of SoX:

- `src/stt/soniox.ts` — Soniox WebSocket client (conceptually similar)
- `src/stt/context.ts` — Context/terms builder (nearly identical)
- `src/detection/stopword.ts` — Stop word detection (nearly identical)
- `src/llm/correction.ts` — xAI Grok LLM correction (nearly identical)
- `src/pipeline.ts` — Orchestration (adapt: replace terminal sender with system text insertion)

Discard (VS Code specific, not applicable):
- `src/extension.ts`, `src/terminal/sender.ts`, `src/terminal/selector.ts`, `src/ui/statusbar.ts`

## Reference Files from voice-terminal (UI/UX)

Reference and adapt (discard terminal-specific features like terminal dropdown and preview):
- `ui/index.html` — Main UI layout (remove terminal dropdown)
- `ui/styles.css` — Apple system design styling
- `ui/setup.html` — First-run API key entry
- `electron/main.js` — Menubar app setup
- `electron/preload.js` — Context bridge
- `electron/credentials.js` — Plain JSON file storage (no Keychain)

## Key Differences from Sibling Projects

| Aspect | voice-vs-extension | voice-terminal | voice-to-text |
|--------|-------------------|---------------|-----------------|
| Scope | VS Code only | Kitty terminal only | System-wide (any app) |
| Text insertion | `terminal.sendText()` | `kitty @ send-text` | System-level (clipboard paste / AppleScript) |
| Terminal context | None | Last 100 lines from Kitty | None |
| UI | VS Code status bar | Electron menubar popup | Electron menubar popup (same as voice-terminal) |
| Activation | VS Code keybinding | Click tray icon | Click tray icon |
| Config | VS Code settings + SecretStorage | config.json + Keychain | config.json + plain JSON |

## Text Insertion (the main engineering challenge)

Must insert text at cursor position in ANY app. Possible approaches on macOS:
- **Clipboard paste**: Copy to clipboard, simulate Cmd+V — most reliable
- **AppleScript**: `osascript -e 'tell application "System Events" to keystroke "text"'`
- **CGEvent API**: Low-level keyboard event simulation (Swift/Objective-C)
- **Accessibility API**: Find focused text field and insert directly

Requires macOS Accessibility permissions.

## External Services

### Soniox STT
- WebSocket: `wss://stt-rt.soniox.com/transcribe-websocket`
- Model: `stt-rt-v4`
- Format: 16-bit signed PCM, 16kHz, mono (`pcm_s16le`)
- Protocol: First message = JSON config, then binary audio frames ONLY
- Language hints: `["vi", "en"]` with `language_hints_strict: true`

### xAI Grok (LLM Correction)
- API: `https://api.x.ai/v1/chat/completions`
- Model: `grok-4-1-fast-non-reasoning`
- Purpose: Fix STT errors, translate Vietnamese to English, remove fillers
