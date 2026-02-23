# UI/UX Specification

Mimic voice-terminal (`/Users/sonph36/tools/voice-terminal`) exactly, with adaptations for system-wide use.

## App Type

macOS menubar popup using `menubar` npm package. NOT a floating window or overlay.

## Tray Icon

- Small microphone icon in system menu bar (top-right)
- **Inactive**: Gray mic (`mic-iconTemplate.png`)
- **Listening**: Red mic (`mic-activeTemplate.png`)
- Click to toggle popup visibility
- Swap icon via IPC on mic state change

## Popup Window

- **Size**: 360px wide x 560px tall, resizable
- **Behavior**: `skipTaskbar: true` (not in Cmd+Tab), hides on click outside
- **Style**: Apple system design (`-apple-system` font, light gray `#f5f5f7` background)

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
5. **Corrected command** — dark terminal-style box (`#1d1d1f` bg, green `#30d158` monospace text)
   - Informational only (no "Send to Terminal" button — text auto-inserts at cursor)
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
- Keys stored in macOS Keychain (encrypted via Electron `safeStorage`)

## Design Tokens

```css
/* Apple system font */
font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;

/* Colors */
Background: #f5f5f7
Text: #1d1d1f
Accent (blue): #0071e3
Success (green): #34c759 / #30d158
Error (red): #ff3b30
Secondary: #86868b
Border: #d2d2d7

/* Command box monospace */
font-family: "SF Mono", "Menlo", "Monaco", monospace;
```

## Audio Feedback

- Gentle 880Hz beep every 60 seconds while listening (reminder that recording is active)

## Adaptations from voice-terminal

- **NO terminal selector dropdown** — voice-everywhere inserts at system cursor, not a specific terminal
- **NO terminal preview on hover** — no terminals to preview
- **NO "Send to Terminal" button** — text auto-inserts at cursor
- **NO terminal context** — LLM correction works without context (same as voice-vs-extension)
