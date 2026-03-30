# Task 01: Extract cross-platform shell/runtime contracts

- **Agent**: titan
- **Skills**: arch-best-practices, tauri-v2
- **Wave**: 1
- **Complexity**: L

## Owns
> Files this task exclusively modifies — verified workspace-relative paths, no overlap in wave.
> Task-local dependencies must be inlined in this card. References to other tasks may describe coordination edges, but must never be required reading for execution.
- `src/src/lib.rs` (modify)
- `src/src/commands.rs` (modify)
- `src/src/platform_app_shell.rs` (create)
- `src/src/platform_runtime_info.rs` (create)
- `src/src/macos_app_shell.rs` (create)
- `src/src/windows_app_shell.rs` (create)
- `src/src/helper_mode.rs` (create)
- `src/Cargo.toml` (modify)
- `src/build.rs` (modify)
- `src/capabilities/default.json` (modify)
- `src/capabilities/bar.json` (modify)
- `ui/tauri-bridge.js` (modify)
- `ui/src/types.ts` (modify)
- `src/tests/runtime_platform_contract.rs` (create)
- `ui/src/__tests__/platform-runtime-bridge.test.ts` (create)

## Entry References
> 2-5 starting points — ALL VERIFIED via tools.
- `src/src/lib.rs:233` — current show/hide/reopen sequencing helpers already separate ordering from native calls
- `src/src/lib.rs:702` — Tauri builder setup, plugin registration, invoke handler, and runtime-event entrypoint
- `src/src/commands.rs:148` — permission/window commands that the frontend already consumes
- `src/build.rs:1` — explicit command allow-list that must stay aligned with invoke_handler and capabilities
- `src/capabilities/default.json:1` — current main-window capability grant pattern

## Exemplar
> Similar implementation in codebase to copy pattern from — verified path.
- `src/src/lib.rs` — already isolates order-critical window steps into pure helpers before native side effects
- `ui/tauri-bridge.js` — stable bridge wrapper pattern for exposing new commands without raw `window.__TAURI__` leakage

## Research Notes
- **Architecture seam**: keep one codebase, preserve the JS bridge, and isolate platform divergence in Rust-native adapters instead of forking the app or scattering OS branches through TS. (source: oracle recommendation `ses_2c388b43cffebC6HB3DLcmIF09`)
- **Tauri v2 permissions**: custom commands need build-manifest + capability updates; window-scoped capability files stay least-privilege. (source: Tauri v2 skill refs + `artifacts/libs/tauri-v2-plugin-support-matrix_09.39_27-03-2026.md`)
- **Windows dependency**: future Windows shell/helper work should use `windows = ^0.62.2`; keep imports behind `cfg(target_os = "windows")`. (source: crates.io webfetch extraction)

## Produces
- `C-01-app-shell-port`:
  - Signature: `platform_app_shell::{build_main_window(app), build_bar_window(app), show_bar(app, &WebviewWindow), hide_bar(app), set_bar_mouse_events(app, ignore), show_settings(&WebviewWindow), handle_runtime_event(app, event)}`
  - Behavior: preserves current command-facing semantics while moving platform-specific shell behavior behind named adapter functions/modules; macOS behavior stays unchanged after extraction.
  - Validate: dedicated Rust contract tests pass and existing command names remain untouched.
- `C-01-runtime-info`:
  - Signature: `get_platform_runtime_info() -> PlatformRuntimeInfo { os, shortcutDisplay, permissionFlow, backgroundRecovery, supportsFullscreenHud, requiresPrivilegedInsertionHelper }`
  - Behavior: returns deterministic, side-effect-free platform metadata for UI copy/formatting; no user-agent sniffing or runtime mutation.
  - Validate: bridge/type test confirms command name, payload-free invocation, and serialized shape.
- `C-01-helper-mode-dispatch`:
  - Signature: `helper_mode::maybe_run_from_args(args: impl IntoIterator<Item = String>) -> Option<i32>`
  - Behavior: returns `Some(exit_code)` and bypasses Tauri startup when launched in helper mode; returns `None` for normal app launches.
  - Validate: Rust contract tests cover helper-mode detection and the non-helper path.

## Consumes
- None.

## Tests
> BECAUSE test-FIRST ordering prevents "implementation without tests" drift, MUST follow RED (verify fails for behavioral reason, not config/import) → GREEN → REFACTOR.
> BECAUSE AI RLHF bias makes "weaken test to pass" the path of least resistance, NEVER modify tests to match buggy output — fix implementation instead.
- **Skip reason**: None

## Steps
1. Add dedicated failing tests for the new seams first: one Rust contract test file for app-shell/helper dispatch/runtime info and one bridge test file for the new runtime-info command/type path.
2. Refactor `src/src/lib.rs` into a cross-platform shell boundary: move the current macOS shell behavior into `macos_app_shell.rs`, add compile-safe Windows stubs in `windows_app_shell.rs`, and keep the existing show/hide/window-label semantics intact while `lib.rs` becomes a thinner composition root.
3. Add `platform_runtime_info.rs` and expose `get_platform_runtime_info` through `commands.rs`, `build.rs`, the capability files, `ui/tauri-bridge.js`, and `ui/src/types.ts`. Do **not** rename or alias any existing bridge method.
4. Add `helper_mode.rs` and wire its early-dispatch hook so helper launches can short-circuit before the Tauri builder starts. Keep the normal app path byte-for-byte equivalent in behavior after the refactor.
5. Add `windows = ^0.62.2` in `src/Cargo.toml`, but keep all Windows-only uses behind `cfg(target_os = "windows")` so current macOS builds remain green.
6. Finish by running the owned tests plus `npm run build`; if any macOS shell behavior regresses, fix it here rather than deferring to later Windows tasks.

## Failure Modes
- **If app-shell extraction changes startup or close-to-hide behavior**: stop and restore parity before continuing; later Windows work assumes the refactor is behavior-preserving.
- **If the new runtime-info command is missing from `build.rs` or capability files**: fix command exposure here, not in a later glue task.
- **If helper-mode dispatch interferes with normal startup**: keep the early return isolated to explicit helper flags only and cover it with a dedicated regression test.

## Guardrails
- Preserve every existing bridge command name and payload shape; `get_platform_runtime_info` is the only approved new command in this plan.
- Do not pull Windows-only logic into the frontend or add release/signing scope.
- No hacks/workarounds: if the refactor cannot preserve current macOS behavior, stop and report a plan defect instead of shipping a shim.

## Acceptance
> Command + expected output — automation-first.
> Commands MUST be non-destructive, idempotent, side-effect-free (read-only checks, test runs — never mutations).
> If manual verification needed: mark with reason + what to check.
- `cargo test --manifest-path src/Cargo.toml runtime_platform_contract && npm run test:ui -- ui/src/__tests__/platform-runtime-bridge.test.ts && npm run build`
- Expected: owned Rust/UI contract tests pass and the shared macOS build still succeeds.

## Report (include in your final response to orchestrator)
> Structured findings for the whiteboard. Orchestrator aggregates these between waves.
- **Actual outputs**: files created/modified with paths
- **Test evidence**: exact test command(s) executed + PASS/FAIL summary + scope (or skip reason from Tests section)
- **Resolved review items**: for each fixed `CRIT-*`/`IMP-*` issue from Heimdall, provide `ID → changed files → verification command/result` (or `None`)
- **Contract amendments**: if Produces signatures changed from planned → actual signature + reason + classification (bug-fix or plan-correction) (or `None`)
- **New constraints or prerequisites**: newly discovered downstream-affecting constraints/prereqs, or `None`
- **Deviations**: other differences from planned behavior (or `None`)
- **Discoveries**: patterns found, gotchas, unexpected behavior affecting other tasks — include **Recommendation** (what downstream should do) + **Rationale** (why)
- **Warnings**: anything downstream tasks should know
- **Downstream action**: `continue` | `amend` | `escalate` — with short reason
- **Prerequisites confirmed**: runtime prerequisites that were verified during execution
