# Task 07: Reconcile bridge, command surface, shared types, and command exposure

- **Agent**: titan
- **Skills**: tauri-v2, arch-best-practices
- **Wave**: 2
- **Complexity**: L

## Owns
- `src/src/commands.rs` (modify)
- `ui/tauri-bridge.js` (modify)
- `ui/src/types.ts` (modify)
- `src/build.rs` (modify)
- `src/tests/command_bridge_contract.rs` (create)
- `ui/src/__tests__/bridge-contract.test.ts` (create)

## Entry References
- `src/src/commands.rs:14` — current Tauri command surface and result forwarding
- `src/src/lib.rs:284` — command registration list currently exposed via `invoke_handler`
- `ui/tauri-bridge.js:15` — invoke/listen wrappers and exported bridge surface
- `ui/src/types.ts:57` — shared `VoiceToTextBridge` and result/config types
- `src/build.rs:1` — current unrestricted Tauri build hook

## Exemplar
- `ui/tauri-bridge.js` — current narrow bridge wrapper is the pattern to keep; this task should tighten and align it rather than bypassing it

## Research Notes
- **Tauri v2 command restriction**: `build.rs` can narrow callable custom commands with `tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&["get_config", "show_bar"]))`. Use this pattern if the final shared bridge/command surface can be restricted safely. (source: context7 `/tauri-apps/tauri-docs`)

## Produces
- `C-07-bridge-command-contract`:
  - Signature: `VoiceToTextBridge` TS interface + serialized command/result shapes + build-time command allow-list
  - Behavior: the Rust command surface, bridge wrapper, TS types, and build-time command exposure are all aligned; no UI path depends on an undocumented command or mismatched result shape; no raw `window.__TAURI__` leaks outside the bridge.
  - Validate: `cargo test --manifest-path src/Cargo.toml && npx tsc -p ui/tsconfig.json --noEmit && npm run test:ui` passes with new contract tests.

## Consumes
- `C-01-window-runtime-invariants` from Task 01:
  - Signature: `WindowRuntimeInvariants = { mainClose, barShowOrder, barDefaultIgnoreCursorEvents, bundleSettings, capabilityScope }`
  - Behavior: shared command/bridge integration must not violate native/runtime invariants.
- `C-02-permission-insertion-contract` from Task 02:
  - Signature: `PermissionResult + InsertTextResult serialized shapes and semantics`
  - Behavior: command result shapes and error semantics must remain aligned with permission/insertion reality.
- `C-03-config-service-contract` from Task 03:
  - Signature: `Credentials/AppConfig/correctTranscript behavior + error taxonomy`
  - Behavior: bridge/types/commands must expose configuration and correction paths with the real current semantics.
- `C-04-main-settings-ui-contract` from Task 04:
  - Signature: `MainSettingsUiContract = { init, handleSetupSubmit, openSettingsDialog, closeSettingsDialog, loadPreferences }`
  - Behavior: shared boundary changes must continue to support setup/preferences flows.
- `C-05-bar-controller-view-contract` from Task 05:
  - Signature: `BarSessionController { init, destroy, getAnalyserNode, getCurrentState, getOverlayMode, handleToggle, handleClose, callbacks }`
  - Behavior: bridge/command/result shapes must continue to support the actual session controller contract.

## Tests
- **Skip reason**: None

## Steps
1. Read Wave 1 actual contracts from `whiteboard.md`, then audit `commands.rs`, `ui/tauri-bridge.js`, `ui/src/types.ts`, and `src/build.rs` for mismatched signatures, redundant wrappers, missing type/result fields, and over-broad command exposure.
2. Reconcile the shared boundary so Rust commands, bridge wrapper, TS types, and build-time exposure all match the actual module contracts produced in Wave 1.
3. If command exposure can be narrowed safely, implement the Tauri v2 build-manifest restriction in `src/build.rs`; if not, document the exact reason the broader set still needs to exist.
4. Add contract-focused Rust and UI tests proving that serialized command results, bridge wrappers, and shared types stay aligned across the boundary.

## Failure Modes
- **If Wave 1 tasks report conflicting actual contracts**: resolve using whiteboard actuals and, if necessary, stop for amendment rather than guessing a synthetic shared shape.
- **If narrowing command exposure breaks a required path**: keep the smallest verified allow-list and document the rejected narrower option instead of reverting to an unexplained broad surface.
- **If a needed fix requires editing files outside Owns**: report it for amendment; do not sprawl back into module-owned files from Wave 1.

## Guardrails
- Do not introduce direct `window.__TAURI__` usage outside `ui/tauri-bridge.js`.
- Do not broaden command exposure or capability scope without concrete proof it is needed.
- Do not let TS types diverge from the actual serialized Rust/bridge contracts.

## Acceptance
- `cargo test --manifest-path src/Cargo.toml`
- `npx tsc -p ui/tsconfig.json --noEmit`
- `npm run test:ui`

## Report (include in your final response to orchestrator)
- **Actual outputs**: files created/modified with paths
- **Test evidence**: exact test command(s) executed + PASS/FAIL summary + scope (or skip reason from Tests section)
- **Resolved review items**: for each fixed `CRIT-*`/`IMP-*` issue from Heimdall, provide `ID → changed files → verification command/result` (or `None`)
- **Contract amendments**: if Produces signatures changed from planned → actual signature + reason + classification (bug-fix or plan-correction) (or `None`)
- **New constraints or prerequisites**: newly discovered downstream-affecting constraints/prereqs, or `None`
- **Deviations**: other differences from planned behavior (or `None`)
- **Discoveries**: patterns found, gotchas, unexpected behavior affecting other tasks — include **Recommendation** + **Rationale**
- **Warnings**: anything downstream tasks should know
- **Downstream action**: `continue` | `amend` | `escalate` — with short reason
- **Prerequisites confirmed**: runtime prerequisites that were verified during execution
