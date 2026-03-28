# Whiteboard — Deep macOS Codebase Audit and Full Remediation

> Updated by orchestrator between waves. Executors read, never write directly.
> Contains ONLY actual findings from completed tasks that change downstream work — not planned, not stable shared context.
>
> Management rules:
> - Per-task summary stays concise and downstream-relevant only
> - If whiteboard stops being quickly scannable for downstream executors, archive older wave sections to `whiteboard-archive.md` and add link
> - Orchestrator resolves conflicting discoveries before writing — never leave contradictions for executors
> - Update Contract Deviations table (cumulative) from executor Contract amendments reports
> - Do NOT restate unchanged `brief.md` guidance or unchanged task-card content
> - If a finding becomes stable cross-cutting truth, promote it into `brief.md`; keep `whiteboard.md` as the delta trail

## Contract Deviations (cumulative — orchestrator maintains)
> Downstream executors Ctrl+F their consumed Contract ID here for instant deviation check.
| Contract ID | Planned Signature | Actual Signature | Reason | Affected Consumers |
|-------------|------------------|------------------|--------|--------------------|
| C-01-window-runtime-invariants | Unchanged | Unchanged | — | — |
| C-02-permission-insertion-contract | Unchanged | Unchanged | — | — |
| C-03-config-service-contract | Unchanged | Unchanged | — | — |
| C-04-main-settings-ui-contract | `writeJson` now returns boolean | `writeJson` returns boolean | Silent failure prevention | Task 07 (if any bridge consumers) |
| C-05-bar-controller-view-contract | Unchanged | Unchanged | — | — |
| C-06-hud-view-contract | `applyOverlayMode` manages tabindex | Extended: manages tabindex | Keyboard reachability fix | — |
| C-07-bridge-command-contract | `correctTranscript` optional lang | `outputLang?: string` | Typing alignment | — |

## After Wave 2

### Summary
Both Wave 2 tasks completed with Heimdall review and fixes applied:
- Task 06: HUD shell rendering - 84 bar-ui tests passing (was 53)
- Task 07: Bridge command integration - 4 Rust contract tests + 3 TS contract tests passing

### Blockers or failures affecting later work
None. All tasks pass acceptance after Heimdall fixes.

### Discoveries (Recommendation + Rationale)
1. **Discovery:** HUD tests must load actual HTML fixtures, not re-implement DOM.
   - **Recommendation:** Use `readFileSync` to load real `bar.html` in tests.
   - **Rationale:** Testing mirrored logic gives false confidence; real fixture catches drift.

2. **Discovery:** Bridge payload keys must be explicit snake_case.
   - **Recommendation:** Never rely on implicit serializer case-mapping.
   - **Rationale:** Prevents silent cross-boundary regressions.

3. **Discovery:** Command allow-list must be exact-set validation.
   - **Recommendation:** Parse `build.rs` and assert exact equality, not contains-check.
   - **Rationale:** Prevents over-broad command exposure without detection.

### Warnings
- `bar.ts` refactored to import from new `bar-render.ts` - any direct imports of render functions need path update.
- Bridge `insertText` default now explicitly `false` (was `true` in bridge only).

### Downstream action
**continue** — Wave 2 complete. Ready for Wave 3 dispatch.

## After Wave 3

### Summary
Task 08 (Runtime/Packaging Verification) partially completed:
- ✅ Automated test suites: All passing (195 UI tests, 30 Rust tests)
- ✅ UI build: Successful
- ⚠️ Manual dev-shell smoke: NOT EXECUTED (documented steps only)
- ⚠️ Packaged-build smoke: NOT EXECUTED (documented steps only)

### Prerequisites Status
- macOS host: ✅ PASS
- Tauri CLI (cargo): ❌ NOT AVAILABLE
- Tauri CLI (npx): ✅ AVAILABLE (tauri-cli 2.10.1)
- SONIOX_API_KEY: ✅ SET
- XAI_API_KEY: ✅ SET

### Blockers or failures affecting later work
None blocking. Manual verification steps are documented for execution on a macOS verifier machine with GUI access.

### Discoveries (Recommendation + Rationale)
1. **Discovery:** `cargo tauri` unavailable but `npx tauri` works.
   - **Recommendation:** Use `npm run dev` / `npm run build:dir` for manual smoke.
   - **Rationale:** Node Tauri CLI provides same functionality.

2. **Discovery:** No CI workflow exists for packaged verification.
   - **Recommendation:** Add GitHub Actions workflow for build + entitlement verification.
   - **Rationale:** Prevents packaging regressions between manual runs.

### Warnings
- Manual runtime verification (TCC dialogs, HUD overlay behavior, mic capture) requires interactive macOS session.
- Packaged app TCC behavior differs from dev - must test both.

### Downstream action
**continue with documented gaps** — Wave 3 automated verification complete. Manual smoke steps documented for execution. Ready for Wave 4 (clio AGENTS.md sync).

## After Wave 1

### Summary
All 5 Wave 1 tasks completed with Heimdall review and fixes applied:
- Task 01: Native shell/window/packaging - 7 tests passing
- Task 02: Permissions/text-insertion - 6 tests passing  
- Task 03: Credentials/config/LLM - 9 tests passing
- Task 04: Main window/preferences UI - 108 UI tests passing
- Task 05: HUD session pipeline - 6 controller tests passing

### Blockers or failures affecting later work
None. All tasks pass acceptance after Heimdall fixes.

### Discoveries (Recommendation + Rationale)
1. **Discovery:** Runtime-invariant tests need `RefCell` for closure capture in Rust.
   - **Recommendation:** Use `RefCell<Vec>` when testing multi-step sequences with closures.
   - **Rationale:** `FnMut` closures can't mutably borrow the same variable multiple times simultaneously.

2. **Discovery:** Clipboard snapshot must track non-preservable formats explicitly.
   - **Recommendation:** Always validate snapshot before insertion/restore; fail explicitly on unsupported formats.
   - **Rationale:** Silent data loss is worse than explicit failure.

3. **Discovery:** Permission priming needs user-visible feedback on failure.
   - **Recommendation:** Return results from permission checks and surface failures in UI.
   - **Rationale:** Silent failures break user trust.

### Warnings
- `writeJson` now returns `boolean` instead of `void` - downstream consumers should check return value.
- `startup-permissions.ts` now returns `PermissionPrimingResult[]` - update any direct callers.

### Downstream action
**continue** — Wave 1 complete. Ready for Wave 2 dispatch.
