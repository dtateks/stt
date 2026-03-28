# Task 08: Verify end-to-end macOS runtime and packaged build

- **Agent**: titan
- **Skills**: tauri-v2, web-best-practices
- **Wave**: 3
- **Complexity**: L

## Owns
- `None — verification-only gate. Do not edit code in this task. If defects remain, trigger plan amendment instead of making ad hoc fixes here.`

## Prerequisites
- macOS host available for dev/runtime and packaged-build smoke.
- Tauri CLI/build toolchain available.
- Valid Soniox key available via `SONIOX_API_KEY` on the verifier machine.
- Optional: valid xAI key if the correction path is to be verified as passing instead of blocked.

## Entry References
- `package.json:5` — canonical test/dev/build scripts
- `src/tauri.conf.json:47` — bundle targets and packaged resource config
- `src/Entitlements.plist:5` — microphone and automation entitlements required for packaged runtime
- `src/src/commands.rs:113` — native show/hide/mouse-event bridge for HUD runtime behavior
- `ui/src/bar-session-controller.ts:179` — live session happy path and recovery logic to smoke-test

## Exemplar
- `src/tests/native_services.rs` and `ui/src/__tests__/logic.test.ts` — existing automated checks define the minimum green baseline; this task adds live evidence on top of them rather than replacing them

## Research Notes
- **Bundled behavior is the real behavior**: `tauri dev` and packaged apps can differ on permissions, CSP, updater/bundle behavior, and macOS-specific runtime behavior; packaged verification is mandatory for Tauri permission/windowing work. (source: tauri-v2 skill)

## Produces
- `None`

## Consumes
- `C-01-window-runtime-invariants` from Task 01:
  - Signature: `WindowRuntimeInvariants { mainClose, barShowOrder, barDefaultIgnoreCursorEvents, bundleSettings, capabilityScope }`
  - Behavior: runtime smoke must prove these invariants still hold in dev and packaged contexts.
- `C-02-permission-insertion-contract` from Task 02:
  - Signature: `PermissionResult + InsertTextResult serialized shapes and semantics`
  - Behavior: live permission prompts and text insertion outcomes must match the contract.
- `C-03-config-service-contract` from Task 03:
  - Signature: `Credentials/AppConfig/correctTranscript behavior + error taxonomy`
  - Behavior: runtime config/credential/correction paths must match the final service contract.
- `C-04-main-settings-ui-contract` from Task 04:
  - Signature: `MainSettingsUiContract = { init, handleSetupSubmit, openSettingsDialog, closeSettingsDialog, loadPreferences }`
  - Behavior: setup/preferences/dialog UX must work as the final UI contract claims.
- `C-05-bar-controller-view-contract` from Task 05:
  - Signature: `BarSessionController { init, destroy, getAnalyserNode, getCurrentState, getOverlayMode, handleToggle, handleClose, callbacks }`
  - Behavior: runtime session/recovery behavior must match the controller contract.
- `C-06-hud-view-contract` from Task 06:
  - Signature: `HudViewContract = { #hud[data-state][data-overlay], applyState, applyTranscript, applyErrorMessage, applyOverlayMode, resizeCanvas }`
  - Behavior: live HUD render/overlay/focus behavior must match the final shell contract.
- `C-07-bridge-command-contract` from Task 07:
  - Signature: `VoiceToTextBridge + tauri command allow-list/types contract`
  - Behavior: all runtime bridge calls used by setup/HUD flows must still be available and typed as expected.

## Tests
- **Skip reason**: Verification-only task; no new tests are authored here. Use existing automated suites plus manual dev/package smoke.

## Steps
1. Run the final automated baseline first (`npm test`, `cargo test --manifest-path src/Cargo.toml`) so runtime failures are not confused with already-broken code.
2. Perform live macOS dev-shell smoke against the actual critical path: launch app, tray toggle main window, setup/preferences flows, permission prompts/gates, HUD start/stop, transcript session, insert-text success path, error/recovery path, and optional xAI correction path if credentials exist.
3. Perform packaged-build smoke using the built app and repeat the same critical path with special attention to TCC/entitlements, transparent HUD behavior, show-order correctness, overlay click-through, and insertion permissions.
4. If any integrated defect is reproduced, stop and report the exact root-cause surface, reproduction steps, and affected contracts so the plan can be amended instead of patched blindly.

## Failure Modes
- **If a dev/runtime or packaged-only defect is reproduced**: do not self-assign code changes from this verification task; return exact evidence and set Downstream action to `amend`.
- **If credentials or TCC state are missing**: report the blocker explicitly and stop rather than claiming a partial pass.
- **If packaged build differs from dev only**: record the exact delta (flow, command, permission, or visual invariant) so amendment work is narrowly targeted.

## Guardrails
- Do not make code changes in this task.
- Do not treat a dev-only pass as sufficient evidence for packaged readiness.
- Do not mark verification complete with undocumented skipped flows.

## Acceptance
- `npm test`
- `cargo test --manifest-path src/Cargo.toml`
- Manual: dev-shell smoke checklist PASS
- Manual: packaged-build smoke checklist PASS

## Report (include in your final response to orchestrator)
- **Actual outputs**: verification artifacts only (commands run, flows checked, blockers found)
- **Test evidence**: exact automated and manual verification steps executed + PASS/FAIL summary + scope
- **Resolved review items**: `None`
- **Contract amendments**: `None`
- **New constraints or prerequisites**: newly discovered downstream-affecting constraints/prereqs, or `None`
- **Deviations**: other differences from planned behavior (or `None`)
- **Discoveries**: packaged/runtime-only gotchas affecting future work — include **Recommendation** + **Rationale**
- **Warnings**: anything downstream tasks should know
- **Downstream action**: `continue` | `amend` | `escalate` — with short reason
- **Prerequisites confirmed**: runtime prerequisites that were verified during execution
