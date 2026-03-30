# Task 04: Make the UI platform-aware

- **Agent**: golem
- **Skills**: web-best-practices
- **Wave**: 2
- **Complexity**: M

## Owns
> Files this task exclusively modifies — verified workspace-relative paths, no overlap in wave.
> Task-local dependencies must be inlined in this card. References to other tasks may describe coordination edges, but must never be required reading for execution.
- `ui/src/main.ts` (modify)
- `ui/src/startup-permissions.ts` (modify)
- `ui/index.html` (modify)
- `ui/src/shortcut-display.ts` (modify)
- `ui/src/shortcut-recorder-logic.ts` (modify)
- `ui/src/__tests__/startup-permissions.test.ts` (modify)
- `ui/src/__tests__/shortcut-recorder-logic.test.ts` (modify)
- `ui/src/__tests__/platform-runtime-ui.test.ts` (create)

## Entry References
> 2-5 starting points — ALL VERIFIED via tools.
- `ui/src/main.ts:243` — startup permission priming and current hard-coded macOS advisory copy
- `ui/src/startup-permissions.ts:18` — best-effort sequential permission priming flow
- `ui/src/bar-session-controller.ts:233` — whole-window passive/interactive overlay semantics already assumed by the frontend
- `ui/src/shortcut-display.ts:1` — current macOS-only label formatting boundary
- `ui/index.html:118` — current permission banner text hard-codes macOS “System Settings” wording

## Exemplar
> Similar implementation in codebase to copy pattern from — verified path.
- `ui/src/shortcut-display.ts` — keep platform formatting in pure helpers instead of pushing it into DOM/event handlers
- `ui/tauri-bridge.js` — keep the bridge surface stable and consume platform info through typed helpers instead of new raw IPC calls scattered through the UI

## Research Notes
- **Runtime-aware UI**: Windows should present tray/privacy/helper guidance through runtime info, not by cloning macOS strings or branching on user agent. (source: oracle recommendation + user interview)
- **Windows shortcut model**: canonical shortcut tokens remain reusable; only display labels should switch from macOS names to Windows names. (source: local artifact `artifacts/libs/tauri-global-shortcut-v2-apis_15.17_28-03-2026.md`)

## Produces
- `C-04-platform-aware-ui`:
  - Signature: `main.ts`/startup/shortcut UI consume `getPlatformRuntimeInfo(): PlatformRuntimeInfo` while preserving existing `window.voiceToText` method names
  - Behavior: Windows users see tray/privacy/helper-aware copy and Windows shortcut labels; macOS users keep the current semantics; UI still relies on the stable bridge wrapper only.
  - Validate: UI tests cover Windows vs macOS runtime-info rendering and shortcut label behavior.

## Consumes
- `C-01-runtime-info` from Task 01:
  - Signature: `get_platform_runtime_info() -> PlatformRuntimeInfo { os, shortcutDisplay, permissionFlow, backgroundRecovery, supportsFullscreenHud, requiresPrivilegedInsertionHelper }`
  - Behavior: provides the platform facts this task must use instead of hard-coded macOS wording.

## Tests
> BECAUSE test-FIRST ordering prevents "implementation without tests" drift, MUST follow RED (verify fails for behavioral reason, not config/import) → GREEN → REFACTOR.
> BECAUSE AI RLHF bias makes "weaken test to pass" the path of least resistance, NEVER modify tests to match buggy output — fix implementation instead.
- **Skip reason**: None

## Steps
1. Add failing UI tests first for runtime-info-driven permission copy, tray/background guidance, and Windows shortcut labels.
2. Update `main.ts` and `startup-permissions.ts` so startup messaging uses `getPlatformRuntimeInfo()` and backend-provided permission results instead of hard-coded “System Settings” strings.
3. Generalize `shortcut-display.ts` and the recorder UI so canonical stored shortcuts stay unchanged while displayed labels switch by runtime-info policy.
4. Keep `window.voiceToText` as the only bridge entrypoint; if you need more platform branching, push it into small formatting helpers instead of spreading it through DOM/event logic.
5. Finish by running the owned UI tests plus `npm run build`; macOS wording/flows must remain correct when runtime info reports `macos`.

## Failure Modes
- **If platform branching starts leaking into unrelated UI logic**: extract a focused helper and keep `main.ts` orchestration thin.
- **If tests depend on browser/OS globals instead of runtime info**: stub `getPlatformRuntimeInfo()` in tests and drive behavior from that contract.
- **If Windows copy requires backend result details not yet exposed**: stop and report the missing contract rather than inventing frontend-only heuristics.

## Guardrails
- No direct `window.__TAURI__` access outside `ui/tauri-bridge.js`.
- Do not keep macOS-only copy in Windows flows.
- No scattered platform hacks in event handlers; keep platform differences in dedicated helpers.

## Acceptance
> Command + expected output — automation-first.
> Commands MUST be non-destructive, idempotent, side-effect-free (read-only checks, test runs — never mutations).
> If manual verification needed: mark with reason + what to check.
- `npm run test:ui -- ui/src/__tests__/startup-permissions.test.ts ui/src/__tests__/shortcut-recorder-logic.test.ts ui/src/__tests__/platform-runtime-ui.test.ts && npm run build`
- Expected: owned UI tests pass and the bundled UI still builds.

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
