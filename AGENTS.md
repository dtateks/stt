# PROJECT KNOWLEDGE BASE

**Updated:** 2026-03-27 08:28
**Commit:** bcdfc69
**Branch:** main

## OVERVIEW
Voice to Text is a macOS Tauri v2 tray app with a Rust backend and a Vite/TypeScript UI under `ui/`. `docs/ui-contract.md` remains the functional contract for the rebuilt setup window and floating bar.

## STRUCTURE
```text
./lt-memory/*.md       # durable project memory; read on demand
./docs/ui-contract.md  # authoritative UI contract; reflects current HUD semantics
./ui/index.html        # Vite page entry for setup/main window
./ui/bar.html          # Vite page entry for floating HUD
./ui/tauri-bridge.js   # narrow bridge initializer; only file that touches window.__TAURI__
./ui/src/              # TypeScript/CSS frontend modules
./ui/src/bar-session-controller.ts  # overlay mode + session orchestration
./ui/src/__tests__/logic.test.ts     # pure UI logic regression tests
./ui/dist/             # generated Vite output; do not hand-edit
./vite.config.mjs      # Vite multi-page root for ui/index.html + ui/bar.html
./tsconfig.json        # shared TS config for vite.config.mjs and ui/src
./ui/tsconfig.json     # UI-local TS config used by the frontend build
./package.json         # ui:dev/ui:build/test:ui/test scripts
./src/                 # Tauri app root; Rust backend, bundle config, permissions
./src/src/             # Rust tray, bridge, credentials, insertion, window control
./src/tauri.conf.json  # Vite hooks, CSP, frontendDist -> ../ui/dist
./assets/              # app icons and screenshots
./config.json          # runtime Soniox/LLM config bundled into the app
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| App lifecycle / tray / IPC | `src/src/lib.rs` | tray-first app, settings window hides on close |
| Credential resolution | `src/src/credentials.rs` | JSON storage first, then env, then Finder startup-shell resolution |
| Transcript correction | `src/src/llm_service.rs` | xAI prompt policy and model defaults |
| Text insertion | `src/src/text_inserter.rs` | clipboard swap + Rust-based AppleScript paste |
| macOS permissions | `src/src/permissions.rs` | mic/accessibility gating and System Settings deep links |
| UI setup/preferences/dialog | `ui/src/main.ts` | staged dialog edits, local UI prefs |
| HUD render/state | `ui/src/bar.ts` | rendering-only; delegates orchestration |
| HUD session control | `ui/src/bar-session-controller.ts` | overlay mode, timers, STT, error recovery |
| HUD state machine | `ui/src/bar-state-machine.ts` | pure state transitions for bar lifecycle |
| UI persistence/defaults | `ui/src/storage.ts`, `ui/tauri-bridge.js` | localStorage helpers + shared defaults |
| UI logic tests | `ui/src/__tests__/logic.test.ts` | pure-module Vitest coverage |
| UI build pipeline | `package.json`, `vite.config.mjs`, `tsconfig.json`, `ui/tsconfig.json` | multi-page Vite root and scripts |
| Tauri build/security | `src/tauri.conf.json` | Vite hooks, CSP, `frontendDist`, bundle resources |
| UI contract | `docs/ui-contract.md` | current setup/main/bar behavior, bridge, persistence, focus rules |
| App entitlements | install/signing flow + Tauri bundle | packaged app needs audio-input entitlement for mic/TCC registration |

## CONVENTIONS
| Rule | Detail |
|------|--------|
| Bridge surface | `ui/tauri-bridge.js` is the only file that reads `window.__TAURI__`; app code uses `window.voiceToText`.
| Overlay mode | PASSIVE/INTERACTIVE is explicit native state via `setMouseEvents`; no hover-driven passthrough.
| Overlay scope | Current bridge only supports whole-window click-through. Per-control hit-testing needs native support.
| Session recovery | Startup failures before LISTENING may briefly show ERROR then close; stream-active errors auto-return to LISTENING.
| State ownership | `bar-session-controller.ts` owns timers, mouse events, and session lifecycle; `bar.ts` stays rendering-focused.
| Persistence | `ui/src/storage.ts` is the only localStorage read/write site.
| Defaults | `window.voiceToTextDefaults` is the single source of truth for vocabulary defaults.
| Tests | `ui/src/__tests__/logic.test.ts` stays pure: no DOM, bridge, or network.
| Build hooks | `src/tauri.conf.json` drives Vite dev/build, `devUrl`, `frontendDist`, and CSP.
| Fonts | UI uses local/system font stacks; do not reintroduce remote font dependencies.
| Credentials | resolved in order: app JSON storage, inherited `XAI_API_KEY` / `SONIOX_API_KEY`, Finder startup-shell exports via Rust |
| Text insertion | Rust side runs AppleScript paste, then restores clipboard |
| macOS permissions | Rust permission coordination checks mic before capture and accessibility before paste |
| Entitlements | packaged app needs `com.apple.security.device.audio-input` for mic/TCC registration |

## ANTI-PATTERNS (THIS PROJECT)
- Treating `ui/` as a tombstone or rebuilding from deleted `ui/*` implementation files.
- Adding raw `window.__TAURI__` access outside `ui/tauri-bridge.js`.
- Reintroducing DOM hover / `mouseenter` / `mouseleave` passthrough for the HUD.
- Assuming per-control HUD hit-testing exists without new native support.
- Sending any JSON to Soniox after the initial config frame.
- Reintroducing resend/insert buttons that steal focus from the destination app.
- Bypassing the permission coordinator before mic capture or text insertion.
- Splitting `window.voiceToTextDefaults` across files.
- Reintroducing remote Google Fonts or other network font loads.
- Changing bar state names without updating matching CSS classes.
- Copying `Info.plist` via `bundle.macOS.files`; it replaces Tauri's generated plist and breaks app launch.
- Forcing unsigned macOS package builds in install/signing flow; packaged identity must stay valid so TCC permissions appear in System Settings.
- Skipping `com.apple.security.device.audio-input` on the packaged app; mic/TCC registration fails without it.
- Bypassing the Rust bridge and calling `__TAURI__` directly from app code.

## COMMANDS
```bash
npm install
npm run ui:dev
npm run ui:build
npm run test:ui
npm test
TAURI_APP_PATH=src cargo tauri dev
TAURI_APP_PATH=src cargo tauri build
```

## NOTES
- `docs/ui-contract.md` now tracks the implemented HUD semantics, including explicit passive/interactive mode and startup error handling.
- `ui/dist/` is generated by Vite; do not edit it by hand.
