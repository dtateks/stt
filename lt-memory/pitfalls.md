# Pitfalls

Known gotchas and hard-earned lessons. Read before modifying tricky areas.

## Soniox STT

- WebSocket URL must be `wss://stt-rt.soniox.com/transcribe-websocket` (NOT old `wss://api.soniox.com/...`)
- Sending JSON after initial config message crashes the connection silently — first message is JSON config, then ONLY binary audio frames
- Translation terms format: `[{source, target}]` array, NOT `{key: value}` map
- Max stream duration: 300 minutes per connection; reconnect for longer sessions

## SoX Audio

- macOS: `brew install sox` required
- Command: `rec -q -t raw -b 16 -e signed -c 1 -r 16000 -`
- PCM format must be exactly 16-bit signed LE, 16kHz, mono — wrong format = garbage transcription
- Always kill `rec` process on stop/quit — orphaned processes keep mic open

## Electron

- Use `ws` npm package for WebSocket (NOT browser WebSocket) in the main process
- If using WebSocket in renderer, browser WebSocket works but `ws` does not (no Node.js in renderer with contextIsolation)
