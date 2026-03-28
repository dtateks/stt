# Brief — Deep macOS Codebase Audit and Full Remediation

> This file is read by EVERY executor before their task card.
> Contains everything shared across all tasks: conventions to follow and technical decisions made.
> Scope rule: include ONLY cross-cutting findings (relevant to >50% of tasks). Task-specific findings go in task cards under Research Notes.
> Contracts are NOT here — they live in task cards.

## Evidence Summary
> Patterns executors MUST follow. Sources attributed.
> - **Structure**: Rust app bootstrap/orchestration lives in `src/src/lib.rs`; Tauri commands live in `src/src/commands.rs`; UI entrypoints are split into `ui/src/main.ts` (settings/setup) and `ui/src/bar.ts` (HUD render); side effects for the HUD live in `ui/src/bar-session-controller.ts`; pure HUD state lives in `ui/src/bar-state-machine.ts`; browser persistence lives only in `ui/src/storage.ts`; raw Tauri access lives only in `ui/tauri-bridge.js`. (source: AGENTS + direct reads `src/src/lib.rs:20-29`, `ui/src/main.ts:1-18`, `ui/src/bar.ts:1-12`, `ui/src/bar-session-controller.ts:1-18`, `ui/src/bar-state-machine.ts:1-6`, `ui/src/storage.ts:1-4`, `ui/tauri-bridge.js:1-7`)
> - **Native window invariants**: the bar window starts hidden, is positioned/configured before every show, defaults to click-through on boot, and the main window hides on close instead of exiting. Do not weaken these invariants while refactoring. (source: AGENTS + direct reads `src/src/lib.rs:185-215`, `src/src/commands.rs:113-123`)
> - **Imports/boundaries**: app code must go through `window.voiceToText`; never call `window.__TAURI__` directly. Keep `bar.ts` rendering-focused and `bar-session-controller.ts` orchestration-focused; keep `bar-state-machine.ts` pure; keep localStorage reads/writes in `storage.ts`. (source: AGENTS + direct reads `ui/tauri-bridge.js:1-27`, `ui/src/bar.ts:1-7`, `ui/src/bar-session-controller.ts:7-18`, `ui/src/bar-state-machine.ts:32-35`, `ui/src/storage.ts:16-28`)
> - **Error handling**: Rust currently exposes errors either as `Result<_, String>` or serializable result objects carrying `code`, `openedSettings`, and `message`; UI shows actionable messages for user-facing failures and logs unexpected errors to console. Keep failures explicit, actionable, and fail-fast at boundaries; reduce silent fallback behavior rather than spreading it. (source: direct reads `src/src/commands.rs:14-154`, `src/src/permissions.rs:16-38`, `src/src/text_inserter.rs:14-34`, `ui/src/main.ts:150-157`, `ui/src/startup-permissions.ts:18-27`, `ui/src/storage.ts:16-23`)
> - **Testing**: UI tests run with Vitest 3.2.4 + jsdom and currently live under `ui/src/__tests__/`; Rust tests run with `cargo test --manifest-path src/Cargo.toml`, with both module tests and integration tests under `src/tests/`. Use Red→Green→Refactor for every behavior change. Never weaken existing assertions to make regressions look green. (source: `package.json:5-25`, `vite.config.mjs:37-40`, `ui/src/__tests__/logic.test.ts:1-12`, `ui/src/__tests__/startup-permissions.test.ts:1-52`, `src/tests/native_services.rs:1-60`)
> - **Packaging/runtime**: `config.json` is bundled as an app resource; packaged macOS builds rely on `src/Entitlements.plist` for microphone/automation entitlements and `src/Info.plist` for usage descriptions. Packaged/runtime verification is mandatory before calling the remediation complete. (source: `src/tauri.conf.json:47-60`, `config.json:1-20`, `src/Entitlements.plist:5-12`, `src/Info.plist:5-8`)
> - **Library APIs**: Tauri v2 capabilities should stay least-privilege and window-scoped; custom command exposure can be restricted via `build.rs` AppManifest. Current repo already scopes a default capability to `main` and `bar`, but `build.rs` still uses the open default builder. (source: context7 Tauri docs + direct reads `src/capabilities/default.json:1-14`, `src/build.rs:1-3`)
> - **Other patterns**: HUD visuals are driven by `data-state` / `data-overlay`; waveform drawing is render-only in `bar.ts`; `bar-session-controller.ts` owns timers, overlay mode, and the transcript pipeline; comments are deny-by-default and should capture durable WHY only. (source: direct reads `ui/bar.html:39-115`, `ui/src/bar.ts:40-49`, `ui/src/bar.ts:95-144`, `ui/src/bar-session-controller.ts:45-175`)

## Research Context
### Library Deep Dives (from context7)
> Correct usage patterns from official docs.
> - **Tauri v2 command exposure**: `build.rs` can narrow callable custom commands with `tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&["get_config", "show_bar"]))`. Task 07 should use this pattern if the final shared bridge/command surface can be reduced safely instead of leaving all commands broadly callable. (source: context7 `/tauri-apps/tauri-docs`)
> - **Tauri v2 capabilities**: permission files should be scoped to exact windows/webviews where possible. Tasks 01 and 07 should review whether `main` and `bar` really need every granted permission before keeping the current default bundle. (source: context7 `/tauri-apps/tauri-docs`)
> - **Vitest v3 browser mode**: richer browser/provider testing exists, but this plan intentionally favors existing jsdom + targeted mocks first so remediation can proceed without adding new dependencies. Escalate only if jsdom cannot prove the needed UI behavior. (source: context7 `/vitest-dev/vitest/v3_2_4`)

### Architecture Rationale (from oracle)
> Design reasoning that executors need to understand WHY the chosen approach works.
> - **Hybrid execution graph**: module-owned audit/remediation tasks come first, and shared-boundary reconciliation comes later. This prevents silent parallel conflicts on `src/src/commands.rs`, `ui/tauri-bridge.js`, `ui/src/types.ts`, and `src/build.rs`, while still giving one explicit place to reconcile end-to-end bugs after local refactors land. Executors should fix local problems inside owned files and report required shared-surface changes instead of freelancing outside Owns. (source: oracle)

## Design Decisions
- Keep scope macOS-only. Ignore mobile/template portability unless it directly affects the current shipped path.
- Reserve `src/src/commands.rs`, `ui/tauri-bridge.js`, `ui/src/types.ts`, and `src/build.rs` for Task 07 only.
- Reserve `ui/src/tokens.css` for Task 06 only; other UI tasks should use existing tokens or report token changes downstream.
- Use the final runtime/package verification gate (Task 08) to validate integrated behavior. If packaged-only defects remain, amend the plan instead of shipping a workaround.
- Prefer existing dependencies and existing test infrastructure; do not add new tooling unless a task proves the current setup cannot verify the behavior.

## Pattern Conflicts
> When codebase has 2+ patterns for same concept, record which was chosen and why.
> - **Shared boundary edits**: chose a single integration owner (Task 07) over opportunistic edits from module tasks because shared surface drift would otherwise be silent and hard to review.
> - **Silent fallback behavior**: keep best-effort startup permission priming isolated to `ui/src/startup-permissions.ts`; elsewhere prefer explicit errors and structured result semantics.
