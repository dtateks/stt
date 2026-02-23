# CLAUDE.md

## What Is This

Global voice input app for macOS. Speech-to-text → insert text at cursor position in ANY app (VS Code, terminal, browser, notes, etc.). Electron menubar app.

**Pipeline code**: Reference voice-vs-extension (`/Users/sonph36/tools/voice-vs-extension`) — nearly identical logic, adapt as needed for standalone Electron context.
**UI/UX**: Reference voice-terminal (`/Users/sonph36/tools/voice-terminal`) — same menubar app pattern, but discard terminal-specific features.

## Commands

```bash
npm install                       # Install dependencies
npm run compile                   # TypeScript → out/
npm run watch                     # TypeScript watch mode
npm start                         # Launch Electron app
npx electron .                    # Alternative launch
```

## Architecture

```
Mic (SoX) → Soniox STT (WebSocket) → Stop Word ("thank you") → LLM Correction (xAI Grok) → Insert at cursor
```

- **Runtime**: Electron + menubar npm package
- **Audio**: SoX child process (`rec` command), 16-bit PCM 16kHz mono
- **STT**: Soniox WebSocket (`wss://stt-rt.soniox.com/transcribe-websocket`, model `stt-rt-v4`)
- **LLM**: xAI Grok (`grok-4-fast-non-reasoning`) — fixes STT errors, translates Vietnamese→English
- **Text insertion**: System-level (clipboard paste / AppleScript) — the main engineering challenge
- **Credentials**: macOS Keychain via Electron `safeStorage`

Read [lt-memory/architecture.md](lt-memory/architecture.md) for full details, sibling project comparison, and reference guidance.

## Key Conventions

- Pipeline modules (recorder, soniox, stopword, correction) are based on voice-vs-extension — reference and adapt, don't blindly copy. Discard anything VS Code-specific.
- UI mimics voice-terminal's Apple system design (see lt-memory/ui-ux.md for design tokens)
- No terminal context or terminal selector — unlike voice-terminal, this app has no knowledge of what's in the terminal
- Config stored in `config.json`, not hardcoded

## Pitfalls

- Soniox: First WebSocket message = JSON config, then ONLY binary. Sending JSON after config crashes silently.
- SoX: Always kill `rec` process on stop — orphaned processes keep mic open.
- Soniox translation terms: `[{source, target}]` array, NOT `{key: value}` map.

Read [lt-memory/pitfalls.md](lt-memory/pitfalls.md) before modifying tricky areas.

## Long-Term Memory

`lt-memory/` uses progressive disclosure — this file stays short with summaries, detail files are read on-demand:

- **[architecture.md](lt-memory/architecture.md)** — Full pipeline, sibling project comparison, what to copy from where, external services
- **[ui-ux.md](lt-memory/ui-ux.md)** — Complete UI spec: menubar popup layout, visual states, design tokens, adaptations from voice-terminal
- **[pitfalls.md](lt-memory/pitfalls.md)** — Known gotchas for Soniox, SoX, and Electron

## Status

- **Phase**: Initial setup — project structure not yet created
- **Next step**: Scaffold Electron menubar app, reference voice-vs-extension pipeline and voice-terminal UI
