# Task 04: Harden setup, preferences, dialog, and persistence UX

- **Agent**: venus
- **Skills**: web-best-practices
- **Wave**: 1
- **Complexity**: M

## Owns
- `ui/index.html` (modify)
- `ui/src/main.ts` (modify)
- `ui/src/main.css` (modify)
- `ui/src/storage.ts` (modify)
- `ui/src/startup-permissions.ts` (modify)
- `ui/src/__tests__/startup-permissions.test.ts` (modify)
- `ui/src/__tests__/main-ui.test.ts` (create)

## Entry References
- `ui/index.html:38` — setup error region semantics and setup form shell
- `ui/index.html:124` — preferences sections and current `aria-hidden` labels
- `ui/index.html:221` — dialog/footer structure, staged-edit inputs, inline save-button style
- `ui/src/main.ts:79` — init and screen routing
- `ui/src/storage.ts:30` — preference load fallback contract

## Exemplar
- `ui/src/main.ts:263` — current staged-dialog state and focus-restore flow is the pattern to preserve while tightening UX and accessibility

## Produces
- `C-04-main-settings-ui-contract`:
  - Signature: `MainSettingsUiContract = { init(): Promise<void>, handleSetupSubmit(): Promise<void>, openSettingsDialog(): void, closeSettingsDialog(): void, loadPreferences(): UserPreferences }`
  - Behavior: setup requires a non-empty Soniox key; preferences reflect persisted values; dialog edits remain staged until save; reset-key and permission-priming flows surface intentional user feedback instead of silent ambiguity.
  - Validate: `npx tsc -p ui/tsconfig.json --noEmit && npm run test:ui` passes with new main-window DOM coverage.

## Consumes
- `None`

## Tests
- **Skip reason**: None

## Steps
1. Audit `ui/index.html`, `ui/src/main.ts`, `ui/src/main.css`, `ui/src/storage.ts`, and `ui/src/startup-permissions.ts` for accessibility gaps, vague UX/error handling, state leakage between staged and persisted settings, and silent fallback behavior.
2. Remediate owned files so setup, preferences, and dialog flows are clearer, more accessible, and architecturally cleaner while preserving the bridge/storage boundaries already established in the repo.
3. Keep startup permission priming best-effort, but make user-visible flows explicit about the real gatekeeping behavior and any failure states that matter.
4. Add jsdom Vitest coverage in `ui/src/__tests__/main-ui.test.ts` (and update existing tests as needed) for setup submit, reset-key handling, dialog open/close/focus behavior, staged-save semantics, and storage fallback behavior.

## Failure Modes
- **If jsdom cannot faithfully prove a focus or dialog behavior**: test as much deterministic logic as possible and surface the exact manual check for Task 08.
- **If the clean fix needs shared token or bridge/type changes**: report the required change for Task 06 or Task 07 instead of editing outside Owns.
- **If a current UX behavior is ambiguous rather than explicitly wrong**: choose the cleaner documented behavior and lock it with tests rather than keeping ambiguity for compatibility.

## Guardrails
- Do not bypass `window.voiceToText` or introduce raw Tauri access into app code.
- Do not spread localStorage usage outside `ui/src/storage.ts`.
- Do not weaken dialog focus/label semantics or replace them with cosmetic-only fixes.

## Acceptance
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
