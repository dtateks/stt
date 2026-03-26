# UI/UX Specification

Mimic voice-terminal (`/Users/sonph36/tools/voice-terminal`) exactly, with adaptations for system-wide use.

## App Type

macOS Electron app using Tray + BrowserWindow (NOT `menubar` package). Normal persistent window that hides on close (stays in tray).

## Tray Icon

- Circle icon in system menu bar (top-right)
- **Inactive**: White circle (`circleTemplate.png`)
- **Listening**: Red circle (`circle-active.png`)
- Click to show/focus window
- Swap icon via IPC on mic state change

## Window

- **Size**: 360px wide x 480px tall, resizable
- **Behavior**: Close hides (not quit), app stays in tray. NOT a popup — normal window.
- **Global shortcut**: Ctrl+Option+Cmd+V toggles mic

## UI Layout (top to bottom)

1. **Drag bar** — draggable title bar with visual handle (`-webkit-app-region: drag`)
2. **Mic button** — large circular button, center of UI
   - Idle: Gray, label "Start"
   - Listening: Red + pulsing box-shadow animation (2s interval), label "Stop"
   - Processing: Orange, disabled
   - Sent: Green check
3. **Status indicator** — color-coded text below mic button
   - Gray "Idle" → Red "Listening..." → Orange "Correcting..." → Green "Sent! Listening..."
4. **Live transcript** — white box, real-time display
   - Final text in **black**, interim text in **gray**
   - Editable after recording stops (edit button toggles contentEditable)
   - Clear button to reset
   - Min 80px, max 120px height with auto-scroll
5. **Corrected text** — dark terminal-style box (`#1c1c1e` bg, green `#30d158` JetBrains Mono text)
   - Copy button only (no resend — it steals focus from target app)
   - Text auto-inserts at cursor
6. **Footer** — "Reset API Keys" / "Settings" / "Quit"

## Visual Feedback States

| State | Mic Button | Status Text | Tray Icon |
|-------|-----------|------------|-----------|
| Idle | Gray "Start" | Gray "Idle" | Gray mic |
| Listening | Red "Stop" + pulse | Red "Listening..." | Red mic |
| Processing | Orange disabled | Orange "Correcting..." | Gray mic |
| Sent | Green check | Green "Sent! Listening..." | Gray mic |
| Error | Gray | Red error message | Gray mic |

## Setup Page

- First-run screen if no API keys configured
- Two password input fields: xAI API key + Soniox API key
- "Save & Start" button
- Keys stored in plain JSON at `~/Library/Application Support/voice-to-text/credentials.json` (Keychain abandoned — breaks across rebuilds)

## Design Tokens

```css
/* Typography: DM Sans (display) + JetBrains Mono (code) — loaded from Google Fonts */
--font-sans: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
--font-mono: 'JetBrains Mono', 'SF Mono', 'Menlo', monospace;

/* Colors */
--bg: #f0f0f0;
--surface: rgba(255, 255, 255, 0.72);    /* glass morphism */
--text-primary: #1a1a1a;
--text-secondary: #6e6e73;
--text-tertiary: #aeaeb2;
--accent: #007aff;
--green: #30d158;
--red: #ff3b30;
--orange: #ff9f0a;

/* Cards use backdrop-filter: blur(20px) for frosted glass effect */
```

## Audio Feedback

- 660Hz beep every 60 seconds while listening (reminder that recording is active)
- 1200Hz beep on successful text insertion (confirmation)

## Adaptations from voice-terminal

- **NO terminal selector dropdown** — Voice to Text inserts at system cursor, not a specific terminal
- **NO terminal preview on hover** — no terminals to preview
- **NO "Send to Terminal" button** — text auto-inserts at cursor
- **NO terminal context** — LLM correction works without context (same as voice-vs-extension)
