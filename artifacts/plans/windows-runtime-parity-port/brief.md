# Brief — Windows Runtime Parity Port Plan

> This file is read by EVERY executor before their task card.
> Contains everything shared across all tasks: conventions to follow and technical decisions made.
> **Scope rule**: include ONLY cross-cutting findings (relevant to >50% of tasks). Task-specific findings go in task cards under Research Notes — executors shouldn't wade through irrelevant content.
> Naming: self-documenting, rich-meaning names by default (per Self-Documenting Names rules in your context). Only document project-specific deviations below.
> Contracts are NOT here — they live in task cards (Produces/Consumes) to avoid duplication.
> Do NOT restate task-local steps, wave status, or inter-wave deltas here.

## Evidence Summary
> Patterns executors MUST follow. Sources attributed.
> - **Structure**: `src/src/lib.rs` is the native composition root (`src/src/lib.rs:702-775`), `src/src/commands.rs` is the stable renderer contract boundary (`src/src/commands.rs:148-287`), and `ui/tauri-bridge.js` is the only frontend file allowed to touch `window.__TAURI__` (`ui/tauri-bridge.js:58-185`). Keep orchestration in these shell/boundary modules and keep leaf helpers narrow. — source: direct reads, AGENTS.md
> - **Capabilities**: window permissions are split by label (`main` vs `bar`) in `src/capabilities/default.json:1-38` and `src/capabilities/bar.json:1-23`. New bridge commands must be added to capability JSON and `src/build.rs:1-34`; custom commands are not automatically protected by plugin permissions. — source: direct reads, Tauri v2 skill refs
> - **Error handling**: native permission/insertion flows return explicit serialized objects with `granted|success`, `code`, `openedSettings`, and `message|error` (`src/src/permissions.rs:20-55`, `src/src/text_inserter.rs:36-56`); tests assert those shapes and messages (`src/tests/text_insertion_permissions.rs:20-116`, `src/tests/command_bridge_contract.rs:127-160`). Preserve explicit codes/messages; no silent failure. — source: direct reads
> - **Testing**: `npm test` runs `npm run test:ui && cargo test --manifest-path src/Cargo.toml` (`package.json:11-12`); UI tests live under `ui/src/__tests__` and favor jsdom/bridge contract coverage (`ui/src/__tests__/bridge-contract.test.ts:17-83`, `ui/src/__tests__/bar-session-controller.test.ts:121-220`); Rust runtime invariants live under `src/tests/*` (`src/tests/window_shell.rs:78-159`, `src/tests/command_bridge_contract.rs:92-123`). Use Red→Green→Refactor and always finish with `npm run build`. — source: direct reads, AGENTS.md
> - **Library APIs**: frontend uses `@tauri-apps/api` `^2.10.1`, `@tauri-apps/plugin-global-shortcut` `^2.3.0`, and updater `^2` (`package.json:18-30`); Rust uses `tauri = "2"` with `tray-icon`, autostart/single-instance/updater/global-shortcut plugins at major version `2` (`src/Cargo.toml:17-36`). Add Win32 access through `windows = ^0.62.2` when implementing Windows-native runtime code (evidence: crates.io API `default_version/max_stable_version/newest_version = 0.62.2`). — source: direct reads, crates.io webfetch extraction
> - **Other patterns**: current HUD behavior depends on hidden-build → position → show sequencing (`src/src/lib.rs:233-339`, `src/src/lib.rs:509-547`), close requests become hide (`src/src/lib.rs:294-316`), and HUD interactivity is a whole-window passive/interactive toggle (`src/src/lib.rs:457-490`, `ui/src/bar-session-controller.ts:233-252`). Startup permission priming is best-effort but currently macOS-worded (`ui/src/startup-permissions.ts:18-55`, `ui/src/main.ts:243-263`, `ui/index.html:118-130`). Preserve the sequencing and explicit toggle model; replace macOS-only copy with runtime-aware copy instead of duplicating flows. — source: direct reads, AGENTS.md
> - **Guard clauses / constants / immutability**: validate early at system boundaries, keep the happy path at the lowest indentation level, turn semantic literals into named constants/config, and prefer returning new values over mutating shared state unless a measured hot path says otherwise. — source: global rules
> - **Context7**: consulted Tauri docs for Windows transparency/effects; no additional actionable constraints beyond the local Tauri artifacts and skill references already captured below. — source: context7
> - **Comments**: comments are deny-by-default; only durable WHY/constraint comments belong in source. Prefer clearer names/tests over explanatory comments. — source: global rules

## Research Context
> BECAUSE executors cannot rediscover research findings, this section captures actionable knowledge from muninn, reused local library artifacts, and oracle that executors need for correct implementation.

### Research Findings (from muninn)
> Best practices, recommended approaches, pitfalls, ecosystem insights.
> Each finding: what was found + source tier + how it affects implementation.
> - **Windows insertion strategy**: use a three-tier chain — `ValuePattern.SetValue` first, then `SendInput`, then clipboard-paste fallback; elevated/admin targets require a privileged helper because UIPI blocks lower-integrity synthetic input. Do **not** elevate the whole app. — implement Windows insertion as an explicit backend with helper escalation instead of baking elevation logic into the UI or the whole app process. (source: muninn artifact `artifacts/researches/windows-porting-strategy_09.03_30-03-2026.md`, sections summarized at lines 17-35)
> - **Windows HUD behavior**: transparent always-on-top per-monitor HUD windows are feasible; whole-window click-through toggling is the stable baseline; avoid making acrylic/blur a phase-1 dependency; fullscreen coverage should use the closest safe Windows behavior rather than macOS NSPanel assumptions. — preserve the current passive/interactive toggle model, keep hidden-build → position → show ordering, and defer visual polish until after runtime parity is stable. (source: muninn artifact `artifacts/researches/windows-porting-strategy_09.03_30-03-2026.md`, lines 39-59)
> - **Windows privacy/runtime model**: microphone permission is an OS privacy flow, not a macOS-style entitlement path; autostart should be user-level; release/signing concerns are separate from runtime. — implement honest Windows-native permission messaging/status checks and keep release work out of runtime tasks. (source: muninn artifact `artifacts/researches/windows-porting-strategy_09.03_30-03-2026.md`, lines 62-117)

### Library Deep Dives (reused local Tauri artifacts)
> Correct usage patterns already researched locally.
> Each finding: what was discovered + why it matters for implementation.
> - **Tauri plugin/capability model**: Windows supports the desktop plugins needed here (`global-shortcut`, `autostart`, `updater`), but dangerous/native capabilities stay window-scoped and explicit. — keep `main`/`bar` capability separation, and treat any new runtime-info command like other app commands that need both capability and build-manifest updates. (source: local artifact `artifacts/libs/tauri-v2-plugin-support-matrix_09.39_27-03-2026.md`)
> - **Transparent Windows HUDs**: transparent windows are supported on Windows without macOS private-API baggage, but blur/acrylic introduce drag/resize trade-offs. — phase 1 should favor stable transparent/borderless HUD behavior over acrylic parity. (source: local artifacts `artifacts/libs/tauri-v2-transparent-window_20.04_27-03-2026.md`, `artifacts/libs/tauri-v2-hud-transparent_09.12_27-03-2026.md`)
> - **Global shortcut/autostart reuse**: the existing string-based shortcut model and official autostart plugin remain viable on Windows, but Windows recovery UX should use the system tray rather than mimicking macOS dockless behavior. — preserve canonical shortcut tokens; shift only display labels and background-recovery UX. (source: local artifacts `artifacts/libs/tauri-global-shortcut-v2-apis_15.17_28-03-2026.md`, `artifacts/libs/tauri-v2-autostart_18.05_29-03-2026.md`)

### Architecture Rationale (from oracle)
> Design reasoning that executors need to understand WHY the chosen approach works.
> - **Shared codebase with native adapters**: the UI/session flow is already mostly portable, while risk concentrates in `lib.rs`, permissions, insertion, and packaging. — keep one codebase, keep the JS bridge stable, and contain platform divergence in Rust-native adapters rather than forking the app or scattering OS checks through TS. (source: oracle recommendation `ses_2c388b43cffebC6HB3DLcmIF09`)
> - **Runtime first, not release first**: Windows shell/insertion/helper correctness is the primary unknown, not installer mechanics. — finish native runtime parity and invariant coverage before touching signing/updater/release assets. (source: oracle recommendation `ses_2c388b43cffebC6HB3DLcmIF09`, user interview)

## Design Decisions
> Non-trivial technical decisions: decided / why / rejected alternative.
- **One codebase with platform-native Rust adapters** — share UI, command names, and test philosophy; move shell behavior behind `platform_app_shell`, keep permissions/insertion as backend-specific logic. Rejected: a separate Windows app variant (too much drift) and a UI-first port with deep OS branching in TS.
- **Add exactly one new bridge command: `get_platform_runtime_info`** — use it to drive UI copy/shortcut labels/background guidance. Rejected: user-agent sniffing or duplicated TS branches per window.
- **Use a privileged helper for elevated/admin Windows targets** — helper is isolated to insertion concerns; do not elevate the entire app. Rejected: whole-app elevation (worse UX/security) and dropping admin-target support (explicitly rejected by user).
- **Keep leaf modules pure; keep orchestration at the shell boundary** — formatting and UI copy helpers stay pure, while native window management, helper launch, and permission probing stay in Rust/native layers. Rejected: wrapper layers that only rename existing calls without isolating responsibility.
- **Preserve the existing bridge contract and explicit error/result shapes** — clean change over small diff means internal refactoring is acceptable, but no deprecated aliases or compatibility shims should survive just to avoid touching call sites.
- **Phase 1 Windows HUD favors stable transparency and whole-window click-through over acrylic/blur polish** — it meets the confirmed parity goal with lower shell risk. Rejected: making blur/acrylic or per-pixel hit testing a required dependency.
- **KISS/YAGNI** — do not add release/signing/installer code, enterprise deployment support, or generalized cross-platform permission frameworks in this plan. Extract shared helpers only when the third real use appears.
- **Validate early, fail loudly** — helper launch failures, permission gaps, and clipboard-restore problems must return explicit codes/messages; no silent catch-and-continue paths.
- **Keep modules small and responsibility-focused** — prefer functions under ~30 lines and files under ~200 lines where practical; if Windows support makes a module swell, split by responsibility instead of hiding complexity inside one file.

## Pattern Conflicts
> When codebase has 2+ patterns for same concept, record which was chosen and why.
> - **Background recovery**: Chose `platform-specific recovery model` over forcing macOS-style dockless behavior everywhere because Windows tray recovery is the reliable native pattern and the user explicitly approved it.
> - **Shortcut labels**: Chose `runtime-aware display labels` over the current `macOS-only labels` because canonical shortcut storage is already platform-neutral and the UI only needs formatting changes.
