# PROJECT KNOWLEDGE BASE

**Updated:** 2026-03-28 00:16
**Commit:** 9b0e81f
**Branch:** main

## OVERVIEW
Voice to Text is a macOS Tauri v2 tray app with a Rust backend and a Vite/TypeScript UI under `ui/`. HUD/runtime behavior now lives in code and this memory file; there is no `docs/` contract tree in the repo root. Accessibility and mic permissions are real TCC flows, not stubs.

## STRUCTURE
```text
./lt-memory/*.md       # durable project memory; read on demand
./ui/index.html        # Vite page entry for setup/main window
./ui/bar.html          # Vite page entry for floating HUD
./ui/tauri-bridge.js   # narrow bridge initializer; only file that touches window.__TAURI__
./ui/src/              # TypeScript/CSS frontend modules
./ui/src/bar-session-controller.ts  # overlay mode + session orchestration
./ui/src/bar.css       # HUD window chrome; pill fills window bounds
./ui/src/soniox-client.ts  # Soniox WebSocket client; loads PCM worklet as a real asset
./ui/src/main.ts       # setup bootstrap; first-launch permission prompts
./ui/src/__tests__/logic.test.ts     # pure UI logic regression tests
./ui/dist/             # generated Vite output; do not hand-edit
./vite.config.mjs      # Vite multi-page root for ui/index.html + ui/bar.html
./tsconfig.json        # shared TS config for vite.config.mjs and ui/src
./ui/tsconfig.json     # UI-local TS config used by the frontend build
./package.json         # ui:dev/ui:build/test:ui/test scripts
./src/                 # Tauri app root; Rust backend, bundle config, permissions
./src/src/             # Rust tray, bridge, credentials, insertion, window control
./src/src/lib.rs       # bar positioning + macOS window configuration
./src/src/commands.rs  # runtime commands; launches and repositions the HUD
./src/tauri.conf.json  # Vite hooks, CSP, frontendDist -> ../ui/dist
./assets/              # app icons and screenshots
./config.json          # runtime Soniox/LLM config bundled into the app
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| App lifecycle / tray / IPC | `src/src/lib.rs` | tray-first app, settings window hides on close, bar window starts hidden and is configured/positioned before show |
| Credential resolution | `src/src/credentials.rs` | JSON storage first, then env, then Finder startup-shell resolution |
| Transcript correction | `src/src/llm_service.rs` | xAI prompt policy and model defaults |
| Text insertion | `src/src/text_inserter.rs` | clipboard swap + Rust-based AppleScript paste |
| macOS permissions | `src/src/permissions.rs`, `ui/src/main.ts`, `ui/src/bar-session-controller.ts` | app-specific Accessibility trust via `AXIsProcessTrustedWithOptions`, mic auth via `AVCaptureDevice`, first-launch prompts, pre-session permission checks |
| UI setup/preferences/dialog | `ui/src/main.ts` | staged dialog edits, local UI prefs |
| Floating HUD shell / clipping | `ui/bar.html`, `ui/src/bar.css` | HTML/body/root sizing and clipping; keep the webview shell transparent and rounded |
| HUD render/state | `ui/src/bar.ts` | rendering-only; delegates orchestration |
| HUD session control | `ui/src/bar-session-controller.ts` | overlay mode, timers, STT, error recovery |
| HUD positioning / macOS window setup | `src/src/lib.rs`, `src/src/commands.rs` | bottom-center placement, Retina scale-factor correction, `NSStatusWindowLevel`, `Stationary`, transparent NSWindow/WebView setup |
| HUD state machine | `ui/src/bar-state-machine.ts` | pure state transitions for bar lifecycle |
| UI persistence/defaults | `ui/src/storage.ts`, `ui/tauri-bridge.js` | localStorage helpers + shared defaults |
| UI logic tests | `ui/src/__tests__/logic.test.ts` | pure-module Vitest coverage |
| UI build pipeline | `package.json`, `vite.config.mjs`, `tsconfig.json`, `ui/tsconfig.json` | multi-page Vite root and scripts |
| Tauri build/security | `src/tauri.conf.json` | Vite hooks, CSP, `frontendDist`, bundle resources |
| App entitlements | install/signing flow + Tauri bundle | packaged app needs audio-input entitlement for mic/TCC registration |

## CONVENTIONS
| Rule | Detail |
|------|--------|
| Bridge surface | `ui/tauri-bridge.js` is the only file that reads `window.__TAURI__`; app code uses `window.voiceToText`.
| Overlay mode | PASSIVE/INTERACTIVE is explicit native state via `setMouseEvents`; no hover-driven passthrough.
| Overlay scope | Current bridge only supports whole-window click-through. Per-control hit-testing needs native support.
| Bar lifecycle | `bar` starts hidden at boot; each show repositions it bottom-center on the active monitor before display.
| Bar show order | `configure_bar_window_for_macos()` and `position_bar_window_bottom_center()` run before `bar_window.show()`; reversing that flashes opaque content.
| macOS HUD spaces | Native `NSWindow` collection behavior uses `CanJoinAllSpaces` + `FullScreenAuxiliary`; do not add `MoveToActiveSpace`.
| macOS HUD level | `NSStatusWindowLevel` keeps the HUD above fullscreen apps; `NSFloatingWindowLevel` is too low.
| macOS HUD movement | `NSWindowCollectionBehavior::Stationary` is part of the HUD flag set; keep the window anchored between Spaces.
| Bar positioning | Compare logical HUD dimensions only after multiplying by `monitor.scale_factor()`; monitor sizes are physical pixels.
| macOS HUD transparency | Transparency depends on both Tauri webview background clearing and the native `NSWindow` clear background path.
| HUD chrome | `html`, `body`, and the HUD root must fill the full window, stay transparent, and use `overflow: hidden` so the rounded webview shell clips to the pill radius.
| Session recovery | Startup failures and failed stream restarts keep the HUD visible in `ERROR` with actionable guidance until the user closes or retries.
| State ownership | `bar-session-controller.ts` owns timers, mouse events, and session lifecycle; `bar.ts` stays rendering-focused.
| Persistence | `ui/src/storage.ts` is the only localStorage read/write site.
| Defaults | `window.voiceToTextDefaults` is the single source of truth for vocabulary defaults.
| Tests | `ui/src/__tests__/logic.test.ts` stays pure: no DOM, bridge, or network.
| Build hooks | `src/tauri.conf.json` drives Vite dev/build, `devUrl`, `frontendDist`, and CSP.
| Fonts | UI uses local/system font stacks; do not reintroduce remote font dependencies.
| Credentials | resolved in order: app JSON storage, inherited `XAI_API_KEY` / `SONIOX_API_KEY`, Finder startup-shell exports via Rust |
| Text insertion | Rust side runs AppleScript paste, then restores clipboard |
| macOS permissions | Rust permission coordination checks mic before capture and accessibility before paste |
| Permission UX | Both mic and accessibility permissions are requested on first launch; accessibility is also checked again before starting a session |
| Entitlements | packaged app needs `com.apple.security.device.audio-input` for mic/TCC registration |

## ANTI-PATTERNS (THIS PROJECT)
- Treating `ui/` as a tombstone or rebuilding from deleted `ui/*` implementation files.
- Adding raw `window.__TAURI__` access outside `ui/tauri-bridge.js`.
- Reintroducing DOM hover / `mouseenter` / `mouseleave` passthrough for the HUD.
- Assuming per-control HUD hit-testing exists without new native support.
- Sending any JSON to Soniox after the initial config frame.
- Importing the Soniox PCM worklet as an inlined data URL; it must stay a real `?url&no-inline` asset to satisfy CSP.
- Reintroducing resend/insert buttons that steal focus from the destination app.
- Bypassing the permission coordinator before mic capture or text insertion.
- Wrapping autoreleased Objective-C clipboard snapshot returns in `Retained::from_raw` in `src/src/text_inserter.rs`; `generalPasteboard`, `types`, `objectAtIndex:`, and `dataForType:` must keep their native ownership semantics.
- Checking Accessibility with AppleScript `tell application "System Events"`; it misses app-specific TCC trust and does not register the app in System Settings.
- Calling `bar_window.show()` before `configure_bar_window_for_macos()` / `position_bar_window_bottom_center()`; it causes a visible opaque flash.
- Using `NSFloatingWindowLevel` for the HUD; it can fall behind fullscreen apps.
- Adding `MoveToActiveSpace` to the HUD window flags; paired with `CanJoinAllSpaces` it trips AppKit startup assertions in `-[TaoWindow _validateCollectionBehavior:]`.
- Comparing logical HUD dimensions directly against `monitor.size()`; Retina displays need scale-factor conversion first.
- Setting `focusable: false` or `focus: false` on the bar window; it blocks mouse events from reaching HUD controls.
- Leaving the HUD shell/root un-clipped or smaller than the window bounds; WKWebView corners expose rectangular background.
- Splitting `window.voiceToTextDefaults` across files.
- Reintroducing remote Google Fonts or other network font loads.
- Changing bar state names without updating matching CSS classes.
- Treating a missing `docs/` tree as optional when checking HUD/runtime behavior; the code paths above are the current source of truth.
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
- HUD/runtime semantics are encoded in `src/src/lib.rs`, `src/src/commands.rs`, `ui/src/bar-session-controller.ts`, and `ui/src/soniox-client.ts`.
- `ui/dist/` is generated by Vite; do not edit it by hand.
