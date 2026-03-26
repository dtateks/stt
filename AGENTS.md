# PROJECT KNOWLEDGE BASE

**Updated:** 2026-03-26 00:00
**Commit:** f6a3f1167216364ac149ae2e22c4b133bf92b129
**Branch:** main

## OVERVIEW
Voice to Text is a macOS Electron tray app that streams microphone audio to Soniox, optionally corrects transcripts with xAI Grok, then inserts text at the system cursor in any app.

## STRUCTURE
```text
./CLAUDE.md          # legacy memory; root source of project context
./lt-memory/*.md     # detailed project memory; read on demand
./electron/          # main process, IPC bridge, credential storage, insertion
./ui/                # renderer pipeline, setup UI, floating bar UI
./assets/            # app icons and screenshots
./config.json        # runtime Soniox/LLM config, bundled as extra resource
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| App lifecycle / tray / IPC | `electron/main.js` | tray-first app, settings window hides on close |
| Renderer bridge | `electron/preload.js` | only sanctioned renderer API surface |
| Credential resolution | `electron/credentials.js` | JSON storage first, then env, then Finder startup-shell resolution |
| Transcript correction | `electron/llm-service.js` | xAI prompt policy and model defaults |
| Text insertion | `electron/text-inserter.js` | clipboard swap + AppleScript paste |
| macOS permissions | `electron/macos-permissions.js` | mic/accessibility gating and System Settings deep links |
| App entitlements | install/signing flow + Electron bundle | packaged app and renderer helper need audio-input entitlement for mic/TCC registration |
| Live STT pipeline | `ui/stt.js` | AudioWorklet capture + Soniox WebSocket |
| Stop-word command trigger | `ui/stopword.js` | normalized suffix match for command cutoff |
| Shared Soniox defaults | `ui/soniox-defaults.js` | renderer-loaded default terms/translation terms |
| Bar state machine | `ui/bar-renderer.js` | listening/processing/inserting flow |
| Tests | `tests/*.test.js` | node:test regression coverage for credentials migration, stop-word, and LLM behavior |
| Setup UI | `ui/setup.js`, `ui/index.html` | API-key gate and settings entry |
| Floating bar UI | `ui/bar.html`, `ui/bar-styles.css` | always-on-top overlay shell |

## CONVENTIONS
| Rule | Detail |
|------|--------|
| Renderer audio/STT | AudioWorklet capture + browser WebSocket in renderer; no `ws` package there |
| Soniox protocol | first WebSocket message is JSON config; after that, binary audio only |
| Transcript end trigger | stop word defaults to `thank you`; matching is normalized, not raw string |
| Shared defaults | `soniox-defaults.js` is the single source of truth for default terms |
| Text insertion | clipboard paste via `osascript`, then clipboard restore |
| macOS permissions | mic permission is checked before renderer capture; accessibility permission is checked before paste |
| Entitlements | packaged app and renderer helper both need `com.apple.security.device.audio-input` for mic/TCC registration |
| UI focus safety | no action button that steals focus from target app |
| Settings storage | `localStorage` holds UI prefs and vocabulary lists |
| Settings dialog | focus trap + Escape close; restores opener focus |
| Bar IPC | bar window only; main process rejects IPC from unexpected renderer URLs |
| Credentials | resolved in order: app JSON storage, inherited `XAI_API_KEY` / `SONIOX_API_KEY`, Finder startup-shell exports |
| Build packaging | `config.json` ships as extra resource; app entry is `electron/main.js` |
| Installer signing | packaged app identity must remain valid; TCC permissions depend on a usable signed bundle |
| Tests | `node --test` covers credentials migration, LLM timeout/shape, and stop-word normalization |

## ANTI-PATTERNS (THIS PROJECT)
- Sending any JSON to Soniox after the initial config frame.
- Reintroducing resend/insert buttons that steal focus from the destination app.
- Bypassing the permission coordinator before mic capture or text insertion.
- Reverting credential resolution to a single source; JSON storage still wins, but env and Finder-launch shell exports are supported fallbacks.
- Removing the bar focus rules / Escape handling that keep settings keyboard-safe.
- Changing bar state names without updating matching CSS classes.
- Splitting Soniox default terms across files; `ui/soniox-defaults.js` is the source of truth.
- Assuming the renderer can reach Electron APIs without `window.voiceEverywhere`.
- Forcing unsigned macOS package builds in install/signing flow; packaged identity must stay valid so TCC permissions appear in System Settings.
- Skipping `com.apple.security.device.audio-input` on either packaged app or renderer helper; mic/TCC registration fails without both entitlements.

## COMMANDS
```bash
npm install
npm start
npm test
npm run build:dir
 npx electron-builder --mac --dir
```

## NOTES
- `CLAUDE.md` is legacy memory; keep it aligned with code, especially credential storage.
- Root memory should stay focused on repo-wide rules. UI and Electron subtrees do not currently justify separate AGENTS.md files.
- `lt-memory/` exists for deeper reference; do not duplicate its full contents here.
