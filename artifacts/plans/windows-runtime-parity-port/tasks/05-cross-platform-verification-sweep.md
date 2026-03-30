# Task 05: Reconcile contracts and verification sweep

- **Agent**: golem
- **Skills**: —
- **Wave**: 3
- **Complexity**: M

## Owns
> Files this task exclusively modifies — verified workspace-relative paths, no overlap in wave.
> Task-local dependencies must be inlined in this card. References to other tasks may describe coordination edges, but must never be required reading for execution.
- `src/tests/window_shell.rs` (modify)
- `src/tests/text_insertion_permissions.rs` (modify)
- `src/tests/command_bridge_contract.rs` (modify)
- `ui/src/__tests__/bridge-contract.test.ts` (modify)
- `ui/src/__tests__/bar-session-controller.test.ts` (modify)

## Entry References
> 2-5 starting points — ALL VERIFIED via tools.
- `src/tests/window_shell.rs:78` — current config/runtime invariants still assume a macOS-only shell
- `src/tests/command_bridge_contract.rs:13` — current command list and serialized shape assertions
- `src/tests/text_insertion_permissions.rs:20` — current insertion/permission result-code expectations
- `ui/src/__tests__/bridge-contract.test.ts:22` — frontend bridge snake_case/defaults contract
- `ui/src/__tests__/bar-session-controller.test.ts:121` — controller-side bridge mock that must stay aligned with the shared bridge contract

## Exemplar
> Similar implementation in codebase to copy pattern from — verified path.
- `src/tests/command_bridge_contract.rs` — use the existing contract-first style: exact command sets and result shapes, not fuzzy assertions
- `ui/src/__tests__/bridge-contract.test.ts` — mirror Rust contract coverage on the frontend side instead of inventing a second source of truth

## Produces
- None.

## Consumes
- `C-01-app-shell-port` from Task 01:
  - Signature: `AppShellPort::{show_bar, hide_bar, set_bar_mouse_events, show_settings, handle_runtime_event}`
  - Behavior: shell contract stays stable while Windows and macOS implementations diverge behind it.
- `C-01-runtime-info` from Task 01:
  - Signature: `get_platform_runtime_info() -> PlatformRuntimeInfo`
  - Behavior: new bridge contract that shared tests must now cover.
- `C-01-helper-mode-dispatch` from Task 01:
  - Signature: `helper_mode::maybe_run_from_args(args) -> Option<i32>`
  - Behavior: helper mode must not boot the Tauri app on privileged helper launches.
- `C-02-windows-shell-behavior` from Task 02:
  - Signature: `WindowsAppShell implements C-01-app-shell-port`
  - Behavior: tray/fullscreen shell semantics now exist behind shared contracts.
- `C-03-windows-insertion-contract` from Task 03:
  - Signature: `insert_text(text, enter_mode) -> InsertTextResult`
  - Behavior: insertion semantics still preserve explicit codes/messages while supporting Windows elevated targets.
- `C-03-windows-permission-contract` from Task 03:
  - Signature: `ensure_* / check_permissions_status -> *PermissionResult | PermissionsStatus`
  - Behavior: serialized shapes stay stable while Windows-native messaging differs.
- `C-04-platform-aware-ui` from Task 04:
  - Signature: `UI consumes PlatformRuntimeInfo without renaming bridge methods`
  - Behavior: Windows/macOS UI differences are driven by runtime info rather than duplicate bridge surfaces.

## Tests
> BECAUSE test-FIRST ordering prevents "implementation without tests" drift, MUST follow RED (verify fails for behavioral reason, not config/import) → GREEN → REFACTOR.
> BECAUSE AI RLHF bias makes "weaken test to pass" the path of least resistance, NEVER modify tests to match buggy output — fix implementation instead.
- **Skip reason**: None

## Steps
1. Update the shared Rust and UI contract tests so they reflect the new runtime-info command and the cross-platform shell/insertion semantics without weakening the existing protections.
2. Convert macOS-only invariant assertions into platform-aware assertions where behavior is intentionally divergent, but keep the bridge names, serialized field names, and current macOS expectations strict.
3. Reconcile the controller/bridge mocks with any contract additions from earlier waves and ensure the final shared suite covers both the new Windows paths and existing macOS paths.
4. Run the full shared suite plus `npm run build`; if failures appear, classify each as intended contract change vs regression before touching the tests.

## Failure Modes
- **If a shared test fails because it encoded a macOS-only assumption**: update it to a runtime-aware assertion, not a weaker one.
- **If a contract test fails because an earlier task changed a bridge/result shape unexpectedly**: fix the implementation to restore the planned contract unless the whiteboard records an approved deviation.
- **If the full automated suite passes but Windows manual runtime evidence from wave 2 contradicts it**: report `amend` with the missing assertion gap instead of claiming the plan complete.

## Guardrails
- Never weaken tests to make the Windows port look green.
- No installer/signing/release-pipeline work in this sweep.
- Keep command/result contracts exact; do not introduce fuzzy assertions or partial-match workarounds.

## Acceptance
> Command + expected output — automation-first.
> Commands MUST be non-destructive, idempotent, side-effect-free (read-only checks, test runs — never mutations).
> If manual verification needed: mark with reason + what to check.
- `npm test && npm run build`
- Expected: shared UI + Rust suites pass and the bundled app still builds after all runtime changes.

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
