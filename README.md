# Voice to Text

Global voice input for macOS. Speak anywhere, insert text at your cursor — in any app.

![Voice to Text](assets/screenshot.jpg)

## Install

```bash
bash -c "$(curl -fsSL https://stt.dta.business)"
```

That one-line install clones into a temporary folder, installs the app into `/Applications`, opens the app, then cleans up the cloned repo automatically.

Or, if you prefer cloning first:

```bash
git clone https://github.com/dtateks/stt.git && cd stt && bash install.sh
```

## What It Does

1. **Speak** — Click the mic button or press `Ctrl+Option+Cmd+V`
2. **Transcribe** — Real-time speech-to-text via [Soniox](https://soniox.com/) STT
3. **Correct** — LLM correction via [xAI Grok](https://x.ai/) fixes transcription errors and translates Vietnamese to English
4. **Insert** — Text is automatically pasted at your cursor position in the frontmost app

Works with VS Code, Terminal, browsers, Notes, Slack, and any app that accepts text input.

## Requirements

- macOS (Apple Silicon or Intel)
- Node.js
- [Soniox API key](https://soniox.com/) — for speech-to-text
- [xAI API key](https://console.x.ai/) — for LLM correction (optional)
- macOS Accessibility permission — for text insertion

## Features

- **System-wide text insertion** — Clipboard paste + AppleScript, works in any app
- **Enter Mode** — Optionally sends Enter after pasting (for chat inputs, terminals)
- **Live transcript** — See real-time speech-to-text as you speak
- **LLM correction** — Fixes STT errors, removes filler words, translates Vietnamese
- **Global shortcut** — `Ctrl+Option+Cmd+V` to toggle mic from anywhere
- **Audio feedback** — Reminder beep every 60s while listening, confirmation beep on insert
- **Menubar tray icon** — White circle (idle) / red circle (recording)
- **Configurable vocabulary** — Custom terms and phonetic corrections for technical jargon

## Setup

On first launch, enter your API keys. They are stored in plain JSON at `~/Library/Application Support/voice-to-text/credentials.json`.

If you prefer not to enter keys in the app, you can set them in your shell environment instead. The app checks (in order of precedence):

1. Keys saved in the app's JSON storage
2. `XAI_API_KEY` / `SONIOX_API_KEY` in your inherited shell environment (if launched from terminal)
3. `XAI_API_KEY` / `SONIOX_API_KEY` resolved from your default shell's startup environment — useful when launching from Finder

For Finder launches, the app opens your default shell once as a startup shell to resolve those exported variables.

## Dev Mode

```bash
npm start
```

## Tech Stack

- **Electron** — Tray + BrowserWindow
- **Soniox** — Real-time WebSocket STT (`stt-rt-v4`)
- **xAI Grok** — LLM correction (`grok-4-1-fast-non-reasoning`)
- **Web Audio API** — Microphone capture in renderer
- **AppleScript** — System-level text insertion via clipboard paste

## License

MIT
