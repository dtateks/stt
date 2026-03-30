# Task 03: Implement Windows insertion/helper runtime

- **Agent**: hades
- **Skills**: tauri-v2
- **Wave**: 2
- **Complexity**: L

## Owns
> Files this task exclusively modifies — verified workspace-relative paths, no overlap in wave.
> Task-local dependencies must be inlined in this card. References to other tasks may describe coordination edges, but must never be required reading for execution.
- `src/src/text_inserter.rs` (modify)
- `src/src/permissions.rs` (modify)
- `src/src/helper_mode.rs` (modify)
- `src/src/windows_inserter.rs` (create)
- `src/src/windows_permissions.rs` (create)
- `src/tests/windows_text_insertion.rs` (create)

## Prerequisites
> Runtime requirements beyond code — what must be true BEFORE this task runs.
- Interactive Windows VM/PC is available and can run both normal and elevated/admin target apps.

## Entry References
> 2-5 starting points — ALL VERIFIED via tools.
- `src/src/text_inserter.rs:71` — current insertion entrypoint already separates orchestration from result shaping
- `src/src/text_inserter.rs:165` — current text-insertion permission result builder and error mapping
- `src/src/text_inserter.rs:227` — current insertion backend uses clipboard + explicit restore semantics
- `src/src/permissions.rs:57` — shared `PermissionsStatus` shape and current permission probing boundary
- `src/tests/text_insertion_permissions.rs:20` — existing tests prove codes/messages/clipboard failures are contractual

## Exemplar
> Similar implementation in codebase to copy pattern from — verified path.
- `src/src/text_inserter.rs` — preserve the current explicit result-shaping, retry/error mapping, and clipboard-restore discipline while swapping out the native backend
- `src/tests/text_insertion_permissions.rs` — preserve contract-first testing for permission/insertion result semantics

## Research Notes
- **Windows insertion chain**: standard targets should try `ValuePattern.SetValue` → `SendInput` → clipboard fallback in that order. Elevated/admin targets require a privileged helper because UIPI blocks lower-integrity synthetic input. (source: muninn artifact `artifacts/researches/windows-porting-strategy_09.03_30-03-2026.md`, lines 17-35)
- **Security boundary**: keep the main app unprivileged; helper escalation is the approved path. Do not send dictated text as raw command-line arguments. (source: user interview + oracle recommendation)
- **Windows permission model**: return honest Windows-native privacy/helper readiness messages instead of macOS TCC wording or fake System Settings URLs. (source: muninn artifact `artifacts/researches/windows-porting-strategy_09.03_30-03-2026.md`, lines 62-77)

## Produces
- `C-03-windows-insertion-contract`:
  - Signature: `insert_text(text: String, enter_mode: bool) -> InsertTextResult`
  - Behavior: inserts into standard Windows targets via ValuePattern/SendInput/clipboard fallback, escalates through the privileged helper for elevated targets, preserves explicit success/error/code semantics, and restores the clipboard when that path is used.
  - Validate: task-local Windows insertion tests plus manual normal/elevated target checks on the Windows VM/PC.
- `C-03-windows-permission-contract`:
  - Signature: `ensure_microphone_permission() -> MicrophonePermissionResult; ensure_accessibility_permission() -> AccessibilityPermissionResult; ensure_text_insertion_permission() -> TextInsertionPermissionResult; check_permissions_status() -> PermissionsStatus`
  - Behavior: reports Windows-native microphone/privacy/helper readiness truthfully, without macOS-only wording or pretend-open-settings behavior; keeps serialized shapes stable for the UI.
  - Validate: result-shape tests pass and UI still receives the expected field names.

## Consumes
- `C-01-helper-mode-dispatch` from Task 01:
  - Signature: `helper_mode::maybe_run_from_args(args: impl IntoIterator<Item = String>) -> Option<i32>`
  - Behavior: provides the early helper-mode entrypoint this task must fill in for privileged insertion without booting the full Tauri app.

## Tests
> BECAUSE test-FIRST ordering prevents "implementation without tests" drift, MUST follow RED (verify fails for behavioral reason, not config/import) → GREEN → REFACTOR.
> BECAUSE AI RLHF bias makes "weaken test to pass" the path of least resistance, NEVER modify tests to match buggy output — fix implementation instead.
- **Skip reason**: None

## Steps
1. Begin with failing task-local tests in `src/tests/windows_text_insertion.rs` that lock the fallback order, helper escalation path, clipboard restore semantics, and stable result-code behavior before changing production code.
2. Implement Windows-native insertion and permission backends in `windows_inserter.rs` and `windows_permissions.rs`, then route `text_inserter.rs` and `permissions.rs` through them while preserving the existing command/result shapes used by the UI.
3. Fill in the `helper_mode` seam from task 01 so elevated/admin target insertion happens through a privileged helper path instead of whole-app elevation.
4. Ensure dictated text never appears in raw argv or logs; the helper transport must round-trip structured requests/results without leaking user text.
5. Run automated tests and `npm run build`, then capture Windows VM evidence for both a normal target and an elevated/admin target.

## Failure Modes
- **If helper launch/elevation cannot return a structured result**: stop and fix the helper transport first; do not paper over elevated-target failures with a generic clipboard fallback.
- **If standard-target insertion works but elevated-target insertion does not**: report the exact integrity-boundary failure and return an explicit error instead of silently pretending success.
- **If clipboard restore semantics diverge on Windows**: preserve the existing `clipboard-restore-failed` contract and message clarity rather than weakening the result shape.

## Guardrails
- No whole-app elevation.
- Never place dictated text in raw command-line arguments, logs, or other user-visible process metadata.
- Do not reduce admin-target support to clipboard-only behavior; if the helper path blocks, report it explicitly.

## Acceptance
> Command + expected output — automation-first.
> Commands MUST be non-destructive, idempotent, side-effect-free (read-only checks, test runs — never mutations).
> If manual verification needed: mark with reason + what to check.
- `cargo test --manifest-path src/Cargo.toml windows_text_insertion && npm run build`
- Manual (Windows VM/PC): verify insertion into a standard target app and an elevated/admin target app, including helper escalation and clipboard restoration behavior.

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
