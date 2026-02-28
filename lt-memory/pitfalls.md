# Pitfalls

Known gotchas and hard-earned lessons. Read before modifying tricky areas.

## Soniox STT

- WebSocket URL must be `wss://stt-rt.soniox.com/transcribe-websocket` (NOT old `wss://api.soniox.com/...`)
- Sending JSON after initial config message crashes the connection silently — first message is JSON config, then ONLY binary audio frames
- Translation terms format: `[{source, target}]` array, NOT `{key: value}` map
- Max stream duration: 300 minutes per connection; reconnect for longer sessions

## Electron

- Audio uses Web Audio API in renderer (MediaDevices.getUserMedia), NOT SoX — no native dependencies needed
- WebSocket for Soniox STT runs in renderer (browser WebSocket) — `ws` npm package does not work in renderer with contextIsolation
- Build: Must use `CSC_IDENTITY_AUTO_DISCOVERY=false` or electron-builder hangs on code signing
- `app.on("window-all-closed", () => {})` is required — without it, macOS quits when window closes
- UI buttons that trigger IPC calls (like resend/insert) steal focus from the target app — avoid action buttons that need the target app focused
