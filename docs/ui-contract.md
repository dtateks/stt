# UI Rebuild Contract

This document is the only functional source of truth for rebuilding the UI.

It intentionally preserves:
- behavior
- contracts
- APIs
- window constraints
- persistence keys
- accessibility and focus rules

It intentionally does **not** preserve:
- current layout
- colors
- typography
- spacing
- component styling
- visual structure beyond what is required for behavior

## 1. Rebuild scope

The app has 3 UI surfaces:

1. **Setup screen** — first-run credentials entry
2. **Main window** — settings/preferences window shown from tray or bar settings
3. **Floating bar** — always-on-top transcription HUD

The rebuild may redesign all visuals from scratch, but must preserve the contracts below.

## 2. Native window constraints

### Main window
- Window label: `main`
- Loads the main settings UI
- Starts hidden
- Is resizable
- Closing the window must **hide** it, not destroy it
- Tray left-click toggles its visibility
- When opened from bar settings, it must be shown and focused

### Floating bar window
- Window label: `bar`
- Loads the transcription HUD
- Starts visible at app boot but the HUD content may stay hidden until active
- Must be borderless / decoration-free
- Must be always-on-top
- Must be non-resizable
- Must be hidden from taskbar/dock switching surfaces used by standard windows
- Must be visible on all workspaces
- Must be non-focusable by default
- Must avoid stealing focus from the active app during passive HUD use
- Must default to a passive click-through mode at app boot and whenever the HUD is hidden
- Must support a separate explicit interactive mode
- Overlay interaction state should be owned natively, not inferred only from DOM hover
- On macOS, the rebuild should target a non-activating panel-style overlay surface rather than treating the HUD as a normal focused app window

### Global shortcut
- Shortcut: `Ctrl + Option + Cmd + V`
- Shortcut emits `toggle-mic` to the bar window
- If shortcut registration fails, the app still runs

## 3. Frontend bridge contract

Frontend code must only use the bridge surface below.

### Available methods on `window.voiceToText`

| Method | Input | Output | Required use |
|---|---|---|---|
| `setMicState` | `{ isActive: boolean }` | none | Sync mic active/inactive state on start/stop/error |
| `insertText` | `text`, `{ enterMode?: boolean }` | `{ success: boolean, error?: string }` | Insert final text into target app |
| `correctTranscript` | `transcript`, `outputLang` | corrected string | Optional LLM correction |
| `getSonioxKey` | none | string | Init bar pipeline |
| `hasXaiKey` | none | boolean | Decide whether LLM correction is available |
| `getConfig` | none | config object | Init STT + stop word behavior |
| `ensureMicrophonePermission` | none | permission result object | Gate audio start |
| `saveCredentials` | `xaiKey`, `sonioxKey` | success/error | Setup submit |
| `updateXaiKey` | `xaiKey` | success/error | Reserved native contract |
| `resetCredentials` | none | success/error | Reset keys from main window |
| `onToggleMic` | callback | unlisten function | Listen for global shortcut |
| `copyToClipboard` | `text` | success/error | Reserved native contract |
| `quitApp` | none | none | Quit action |
| `showBar` | none | success/error | Make native bar window visible |
| `hideBar` | none | success/error | Hide native bar window |
| `setMouseEvents` | `ignore: boolean` | success/error | Toggle bar mouse passthrough |
| `showSettings` | none | success/error | Show/focus main window from bar |

### Bridge invariants
- The rebuild must keep using a narrow bridge instead of raw ad-hoc Tauri access throughout the UI.
- `onToggleMic` must subscribe to `toggle-mic` and return an unsubscribe function.
- `saveCredentials` argument order is `xaiKey` first, `sonioxKey` second.

## 4. Setup screen contract

### Required visible elements
- App identity/title
- Soniox API key input
- xAI API key input
- Inline error region
- Primary submit action
- Short note that explains where keys are stored and that env fallbacks exist

### Required behavior
- Soniox key is **required**
- xAI key is **optional**
- Missing Soniox key must show a user-facing error
- While saving:
  - submit button becomes disabled
  - submit label changes to a saving state
- On save failure:
  - error is shown inline
  - button is re-enabled
  - button label returns to normal

### Required copy semantics
- Error messaging must clearly communicate: Soniox required, xAI optional

## 5. Main window contract

### Required visible controls
- Enter Mode preference
- Output Language preference
- Reset Keys action
- Open Settings action
- Quit action

### Enter Mode
- Persistence key: `enterMode`
- Default: `true`
- Meaning: after inserting text, optionally send Enter

### Output Language
- Persistence key: `outputLang`
- Default: `auto`
- Allowed values: `auto`, `english`, `vietnamese`
- Used only by LLM correction path

## 6. Advanced settings dialog contract

### Required visible content
- Terms list
- Add-term input + action
- Translation terms list
- Translation source input
- Translation target input
- Add-translation action
- Reset action
- Cancel action
- Save action

### Persistence keys
- `sonioxTerms`
- `sonioxTranslationTerms`

### Defaults source
- Both settings fall back to defaults from `window.voiceToTextDefaults`

### Save model
- Dialog edits are staged in working copies
- Changes are committed only on **Save**
- **Cancel** closes without persisting staged edits
- **Reset** restores staged values to defaults, but still requires Save to persist

### Terms rules
- Blank terms are ignored
- Duplicate terms are ignored
- Removing a term updates staged state immediately

### Translation term rules
- Each item is a `{ source, target }` pair
- Blank source or target is ignored
- Duplicate source+target pair is ignored
- Removing a translation item updates staged state immediately

## 7. Client-side persistent state

| Key | Default | Meaning |
|---|---|---|
| `enterMode` | `true` | Whether insertion also sends Enter |
| `outputLang` | `auto` | Preferred corrected output language |
| `sonioxTerms` | defaults list | Soniox vocabulary terms |
| `sonioxTranslationTerms` | defaults list | Soniox translation replacements |
| `skipLlm` | `false` | If `true`, bypass LLM correction even when xAI key exists |

### Default vocabulary contract
- The rebuild must expose a shared defaults source on `window.voiceToTextDefaults`
- It must contain:
  - `terms: string[]`
  - `translationTerms: { source: string, target: string }[]`

## 8. Floating bar contract

### Required visible elements
- Status indicator
- Live waveform visualization area
- Transcript area
- Settings action
- Stop/close action

### Required state machine

```text
HIDDEN
  -> CONNECTING
  -> LISTENING
  -> PROCESSING
  -> INSERTING
  -> SUCCESS -> LISTENING
  -> ERROR   -> LISTENING

Any active state + toggle/close -> HIDDEN
```

### State semantics
- `HIDDEN`
  - HUD not shown
  - STT stopped
  - waveform stopped
  - native bar window hidden
- `CONNECTING`
  - starting mic / checking permission / opening websocket
- `LISTENING`
  - live transcript updates
  - waveform animates
  - reminder beep every 60s
- `PROCESSING`
  - optional LLM correction in progress
- `INSERTING`
  - native insertion in progress
- `SUCCESS`
  - insertion succeeded
  - brief success feedback
  - auto-return to `LISTENING` after about 1.5s
- `ERROR`
  - error feedback is shown
  - if the stream was already active, the error is recoverable and auto-returns to `LISTENING` after about 2s
  - if startup fails before `LISTENING` begins (for example permission denied or missing key), the HUD may close after brief error feedback instead of resuming a non-existent live session

### Toggle behavior
- Global shortcut toggles the bar pipeline
- If hidden, toggle starts listening
- If in any other state, toggle stops current session and hides the HUD

### Button behavior
- Settings button opens the main window through `showSettings()`
- Close button stops listening and hides the HUD

### Overlay interaction behavior
- Passive HUD mode must remain click-through and non-focus-stealing
- Interactive HUD mode must be an explicit state change, not a hover-driven control loop
- Native code should own overlay interaction state and apply click-through toggles at the window level
- The rebuild does **not** need to preserve the old DOM `mouseenter` / `mouseleave` passthrough pattern
- With the current bridge surface, interaction mode is a whole-window native toggle, not a per-control hit-test region
- Starting a listening session may temporarily enable interactive mode so HUD controls are reachable, then return to passive mode after idle
- A finer-grained passive-body / interactive-controls split would require additional native hit-test support

## 9. Overlay best-practice target

This section intentionally updates the rebuild target beyond the old implementation.

### Confirmed best-practice direction
- A separate HUD overlay surface is the correct architecture for this app class
- The passive HUD should not steal focus from whatever app the user is dictating into
- The HUD should be treated as a passive overlay first, interactive surface second
- Click-through behavior should be treated as a coarse native mode switch, not as a web-layer hover trick

### macOS-specific target
- Prefer a non-activating panel-style overlay surface for the HUD
- Do not model the passive HUD as a normal focusable application window
- Keep the main/settings window separate from the HUD window

### Rebuild guidance
- Rust/native code should own:
  - window visibility
  - focus policy
  - click-through policy
  - workspace/always-on-top behavior
- Frontend code should own:
  - rendering
  - transcript presentation
  - explicit interaction affordances
  - session-state visuals

## 10. Transcript pipeline contract

### Start flow
1. Load shared settings from localStorage
2. Require Soniox key
3. Show native bar window
4. Check microphone permission
5. Set mic active
6. Build Soniox context from defaults + stored user vocabulary
7. Start STT streaming
8. Enter `LISTENING`

### Live transcript behavior
- Transcript only updates while state is `LISTENING`
- Final text and interim text are displayed separately
- If no transcript content exists while listening, show a listening prompt

### Stop word behavior
- Final transcript is passed through a stop-word detector
- Detection is **normalized suffix matching**, not raw string matching
- Normalization removes punctuation, collapses spaces, trims, and lowercases
- Default stop word is configurable from native config
- When detected, the stop word is stripped and the remaining command text is processed

### LLM correction behavior
- Only runs when:
  - xAI key exists
  - `skipLlm !== true`
- Uses `outputLang` from localStorage, default `auto`
- If correction fails:
  - brief error feedback is shown
  - pipeline still continues with raw text

### Insert behavior
- If final text exists after optional correction:
  - call `insertText(text, { enterMode })`
  - success enters `SUCCESS`
  - failure enters `ERROR`
- If final text is empty:
  - stop listening
  - hide the HUD

## 11. Soniox STT protocol contract

### STT class contract
- UI side must provide a Soniox STT client abstraction with:
  - `setConfig(config)`
  - `start(apiKey, context)`
  - `stop()`
  - `resetTranscript()`
  - `getAnalyser()`
  - `onTranscript` callback
  - `onError` callback

### Critical protocol rules
- Soniox config must be set before start
- WebSocket URL comes from config
- The **first** WebSocket frame is JSON config
- After that, audio frames are **binary only**
- Audio capture uses Web Audio + AudioWorklet
- Incoming token messages accumulate final transcript and interim transcript separately

## 12. Accessibility and focus contract

### Settings dialog
- Must be a real modal dialog
- Must expose dialog semantics (`role="dialog"`, `aria-modal`, label)
- Must trap focus while open
- `Tab` and `Shift+Tab` wrap within dialog
- `Escape` closes dialog
- Focus returns to the element that opened the dialog

### Setup screen
- Error region must be announced (`role="alert"` or equivalent live behavior)
- Inputs must remain labelled

### Bar
- Settings and close buttons must remain keyboard reachable when bar interactivity is enabled
- Icon-only actions must have accessible names
- Decorative visual status elements must not produce noisy announcements

## 13. Security and configuration contract

### Capability scope
- Only `main` and `bar` windows participate in this UI contract

### App security expectations
- Rebuild must preserve a Tauri v2 security posture with explicit capabilities and config-driven CSP
- Do not depend on remote scripts
- Do not depend on direct raw Tauri globals spread throughout app code

## 14. Credential/storage contract

### Credential resolution precedence
1. app JSON store
2. inherited env vars (`XAI_API_KEY`, `SONIOX_API_KEY`)
3. shell-startup environment fallback

### Persistence path semantics
- Keys are stored in app data at `voice-to-text/credentials.json`

### Save rules
- Soniox empty after trim -> reject
- xAI may be empty
- Reset deletes the stored credentials file

## 15. Acceptance checklist for the rebuild

The new UI is acceptable only if all items below hold:

- Setup enforces Soniox required / xAI optional
- Main window still exposes Enter Mode and Output Language preferences
- Settings dialog still stages edits until Save
- Terms and translation terms still persist through localStorage keys above
- Global shortcut still toggles mic flow through the bar
- Bar still follows the same state machine
- Soniox protocol still sends JSON init first, binary audio after
- Stop-word detection still uses normalized suffix matching
- Main window still hides on close
- Bar still remains always-on-top, non-focusable by default, and uses an explicit native-owned passive/interactive interaction model
- Bar settings action still opens/focuses the main window
- Accessibility/focus rules above still pass

## 16. Explicit non-goals

The rebuild does **not** need to preserve:
- current CSS class names
- current DOM tree shape
- current layout grouping
- current colors or visual style
- current icon shapes
- current animation style

Only the contracts in this file must survive.
