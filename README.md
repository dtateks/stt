# Voice to Text

A background dictation app for macOS and Windows. Press a global shortcut,
speak, say a stop word, and the cleaned text is typed wherever your cursor
is.

- Real-time speech recognition via [Soniox](https://soniox.com)
- Optional LLM cleanup (xAI, Gemini, OpenAI-compatible) for punctuation and
  grammar before insert
- Background accessory app — no Dock icon on macOS, no tray icon on Windows
- Custom global shortcut, custom stop word, per-app vocabulary terms
- Pause, resume, clear, and close controls on a floating HUD

## How it works

1. Press your global shortcut. A small HUD appears.
2. Speak. Live transcript renders in the HUD as you talk.
3. Say your stop word (default: `thank you`). The HUD freezes the cleaned
   command, runs an optional LLM pass, and types it into the focused field.
4. The HUD returns to listening for the next utterance, ready for another
   stop word. Press the shortcut again to close.

## Install

### macOS

One-line install for the signed release build:

```bash
curl -fsSL https://raw.githubusercontent.com/dtateks/stt/main/install.sh | bash
```

The installer pulls the latest signed `.zip` from [GitHub
Releases](https://github.com/dtateks/stt/releases/latest) and places
`Voice to Text.app` in `/Applications`. Apple Silicon and Intel builds
are both published; the installer picks the right one automatically.

### Windows

Download `Voice-to-Text-windows-x64-setup.exe` from the [latest
release](https://github.com/dtateks/stt/releases/latest) and run it.

## First-run setup

1. Open the app. A settings window appears (Dockless on macOS — the window
   itself is the surface).
2. Paste a Soniox API key into **Speech engine → Soniox API key**. Get a
   free key at [soniox.com](https://soniox.com). The app verifies it before
   activating dictation.
3. Grant the prompted system permissions when the OS asks:
   - **macOS:** microphone, accessibility (for text insertion), and
     automation/Apple Events (for AppleScript-driven paste).
   - **Windows:** microphone. Text insertion via `SendInput` needs no extra
     permission for most apps; elevated targets prompt for a privileged
     helper on demand.
4. (Optional) Enable **AI Enhance** and add a key for xAI, Gemini, or any
   OpenAI-compatible provider. Pick a model. The chosen provider cleans up
   punctuation and grammar before the text is inserted.
5. (Optional) Customize the global shortcut, stop word, output language,
   reminder beep, and vocabulary terms.

## Daily use

- **Toggle dictation:** the shortcut you set under **Daily use → Shortcut**.
- **Stop word:** say it at the end of an utterance to insert the text. The
  default is `thank you`; change it in settings.
- **Pause / resume:** click the pause button on the HUD, or just stop
  speaking.
- **Clear / restart:** the wipe button on the HUD discards the current
  transcript and starts a fresh listening session in place.
- **Close:** the × button on the HUD, or press your global shortcut again.

## AI Enhance

Three provider catalogues are supported:

- **xAI** (Grok) — defaults to `grok-4-1-fast-non-reasoning`.
- **Gemini** — defaults to `gemini-2.5-flash-lite`.
- **OpenAI-compatible** — supply your own Base URL and pick a model from
  whatever the endpoint lists. Useful for local LLMs (LM Studio, Ollama)
  or self-hosted gateways.

The correction layer is optional and degrades gracefully: if the LLM call
fails or the key is missing, the raw Soniox transcript is inserted instead.

## Build from source

Requirements: Node.js, Rust toolchain, and [Tauri v2
prerequisites](https://tauri.app/start/prerequisites/) for your platform.

```bash
npm install
npm run dev          # development build with hot-reload
npm test             # UI vitest + Rust cargo tests
npm run build        # production bundle
npm run build:dmg    # macOS .dmg bundle
```

Project layout:

- `ui/` — Vite/TypeScript frontend (settings window + HUD).
- `src/` — Tauri shell (Rust). Sources live in `src/src/`; bundle config
  in `src/tauri.conf.json`.
- `AGENTS.md` — architecture and contribution conventions.

## License

MIT. See `src/Cargo.toml` for the canonical declaration.
