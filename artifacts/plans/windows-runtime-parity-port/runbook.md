# Windows Runtime Parity Port Plan

## TL;DR
> Convert the existing macOS-only Tauri app into a shared macOS+Windows codebase with near-runtime parity, while explicitly deferring installer/signing/release-pipeline work. Deliver a cross-platform native contract layer first, then parallelize Windows shell/HUD, elevated-target insertion, and platform-aware UI updates, followed by a verification sweep. Estimated effort: large. Waves: 4.

## Context
### Original Request
- User asked for a plan to convert the current macOS app into a Windows version.

### Key Decisions (from interview)
- One shared codebase; do **not** fork a separate Windows app.
- Target **near-full runtime parity**, but keep **release/distribution work out of scope** for this plan.
- Windows must support insertion into **elevated/admin target apps** via a **privileged helper**, not whole-app elevation.
- Windows should use a **tray-assisted background model** rather than a hidden-only dockless clone.
- Phase 1 Windows HUD should aim to work above fullscreen apps **as closely as Windows allows**.
- Direct-user distribution is the eventual target audience once release work begins.
- A Windows VM/PC is available for implementation-time runtime verification.

### Assumptions (evidence-based defaults applied — user did not explicitly decide)
- None; scope, codebase shape, runtime expectations, and verification environment were explicitly confirmed.

## Objectives
### Must Have (exact deliverables)
- Preserve the existing macOS app while extracting shared native contracts for shell/runtime info/helper dispatch.
- Add a Windows app-shell implementation with tray-assisted background recovery, non-focus-stealing HUD show, whole-window passive/interactive mouse toggling, and the closest safe fullscreen HUD behavior Windows allows.
- Add Windows insertion/permission backends that preserve existing bridge result shapes and support elevated target apps through a privileged helper path.
- Make the frontend platform-aware for permission copy, shortcut labels, and background UX without introducing raw `window.__TAURI__` access outside `ui/tauri-bridge.js`.
- Land cross-platform contract/invariant coverage so shared `npm test` and `npm run build` stay green, plus Windows VM runtime spot-check evidence for fullscreen HUD, tray recovery, normal insertion, and elevated insertion.

### Must NOT Have (explicit exclusions)
- No Windows installer/signing/update-manifest/release-asset work.
- No Linux/mobile support.
- No whole-app elevation on Windows.
- No per-pixel hit-testing, acrylic/blur polish, or other overlay cosmetics that are not required for the confirmed runtime parity target.
- No backward-compat shim layer that renames or duplicates existing bridge commands.

### Definition of Done
- Shared bridge contract remains stable except for the addition of `get_platform_runtime_info`.
- macOS runtime behavior remains intact for hidden launch, show order, permissions, and shortcut flows.
- Windows runtime can be exercised on a VM/PC with: global shortcut → HUD show, tray recovery, normal-target insertion, elevated-target insertion via helper, and fullscreen HUD spot-check evidence.
- `npm test` and `npm run build` pass on the shared codebase after the final verification sweep.

## Execution Graph

### File Ownership Matrix
| File Path | Wave | Task | Action (create/modify/delete/rename/generate) | Merge Risk |
|-----------|------|------|-----------------------------------------------|------------|
| `src/src/lib.rs` | 1 | 01 | modify | — |
| `src/src/commands.rs` | 1 | 01 | modify | — |
| `src/src/platform_app_shell.rs` | 1 | 01 | create | — |
| `src/src/platform_runtime_info.rs` | 1 | 01 | create | — |
| `src/src/macos_app_shell.rs` | 1 | 01 | create | — |
| `src/src/windows_app_shell.rs` | 1 | 01 | create | — |
| `src/src/helper_mode.rs` | 1 | 01 | create | — |
| `src/Cargo.toml` | 1 | 01 | modify | — |
| `src/build.rs` | 1 | 01 | modify | — |
| `src/capabilities/default.json` | 1 | 01 | modify | — |
| `src/capabilities/bar.json` | 1 | 01 | modify | — |
| `ui/tauri-bridge.js` | 1 | 01 | modify | — |
| `ui/src/types.ts` | 1 | 01 | modify | — |
| `src/tests/runtime_platform_contract.rs` | 1 | 01 | create | — |
| `ui/src/__tests__/platform-runtime-bridge.test.ts` | 1 | 01 | create | — |
| `src/src/windows_app_shell.rs` | 2 | 02 | modify | ⚠️ |
| `src/tests/windows_shell_runtime.rs` | 2 | 02 | create | — |
| `src/src/text_inserter.rs` | 2 | 03 | modify | — |
| `src/src/permissions.rs` | 2 | 03 | modify | — |
| `src/src/helper_mode.rs` | 2 | 03 | modify | ⚠️ |
| `src/src/windows_inserter.rs` | 2 | 03 | create | — |
| `src/src/windows_permissions.rs` | 2 | 03 | create | — |
| `src/tests/windows_text_insertion.rs` | 2 | 03 | create | — |
| `ui/src/main.ts` | 2 | 04 | modify | — |
| `ui/src/startup-permissions.ts` | 2 | 04 | modify | — |
| `ui/index.html` | 2 | 04 | modify | — |
| `ui/src/shortcut-display.ts` | 2 | 04 | modify | — |
| `ui/src/shortcut-recorder-logic.ts` | 2 | 04 | modify | — |
| `ui/src/__tests__/startup-permissions.test.ts` | 2 | 04 | modify | — |
| `ui/src/__tests__/shortcut-recorder-logic.test.ts` | 2 | 04 | modify | — |
| `ui/src/__tests__/platform-runtime-ui.test.ts` | 2 | 04 | create | — |
| `src/tests/window_shell.rs` | 3 | 05 | modify | — |
| `src/tests/text_insertion_permissions.rs` | 3 | 05 | modify | — |
| `src/tests/command_bridge_contract.rs` | 3 | 05 | modify | — |
| `ui/src/__tests__/bridge-contract.test.ts` | 3 | 05 | modify | — |
| `ui/src/__tests__/bar-session-controller.test.ts` | 3 | 05 | modify | — |

### Wave Schedule
| Wave | Tasks (parallel) | Glue Task (sequential) | Depends On | Est. Complexity |
|------|-------------------|------------------------|------------|-----------------|
| 1 | 01 | — | — | L |
| 2 | 02, 03, 04 | — | 01 | L |
| 3 | 05 | — | 02, 03, 04 | M |
| 4 | 06 (`clio`) | — | 05 | S |

### Contract Dependencies
> Orchestrator uses this for cascade-block + deviation routing. Contract IDs follow `C-{XX}-{short-name}` format.
| Contract ID | Producer (Task) | Consumer (Tasks) | Signature (abbreviated) |
|-------------|-----------------|------------------|-------------------------|
| `C-01-app-shell-port` | 01 | 02, 05 | `AppShellPort::{show_bar, hide_bar, set_bar_mouse_events, show_settings, handle_runtime_event}` |
| `C-01-runtime-info` | 01 | 04, 05 | `get_platform_runtime_info() -> PlatformRuntimeInfo` |
| `C-01-helper-mode-dispatch` | 01 | 03, 05 | `helper_mode::maybe_run_from_args(args) -> Option<i32>` |
| `C-02-windows-shell-behavior` | 02 | 05 | `WindowsAppShell implements C-01-app-shell-port for Windows` |
| `C-03-windows-insertion-contract` | 03 | 05 | `insert_text(text, enter_mode) -> InsertTextResult` |
| `C-03-windows-permission-contract` | 03 | 05 | `ensure_* / check_permissions_status -> *PermissionResult | PermissionsStatus` |
| `C-04-platform-aware-ui` | 04 | 05 | `UI consumes PlatformRuntimeInfo without renaming bridge methods` |

### Wave Prerequisites
> Orchestrator verifies these in PREFLIGHT before dispatching each wave's tasks.
| Wave | Task | Prerequisite | Verify Command |
|------|------|-------------|----------------|
| 2 | 02 | Interactive Windows VM/PC is available for fullscreen HUD and tray spot-checks | `Manual — confirm a Windows VM/PC is accessible and can launch interactive desktop apps` |
| 2 | 03 | Interactive Windows VM/PC can run both normal and elevated target apps for insertion checks | `Manual — confirm an elevated target app can be started in the Windows VM/PC` |

### Task Index
> Grouped by wave. Links to task card files. Orchestrator dispatches, verifies, and cascade-blocks using ONLY this table + Contract Dependencies.
> - **Acceptance**: non-destructive, idempotent commands only (read-only checks, test runs — never mutations)

#### Wave 1 (parallel)
| # | Task | File | Agent | Skills | Review | Acceptance | Status |
|---|------|------|-------|--------|--------|------------|--------|
| 01 | Extract cross-platform shell/runtime contracts | [tasks/01-cross-platform-shell-contracts.md](tasks/01-cross-platform-shell-contracts.md) | titan | arch-best-practices, tauri-v2 | per-task | `cargo test --manifest-path src/Cargo.toml runtime_platform_contract && npm run test:ui -- ui/src/__tests__/platform-runtime-bridge.test.ts && npm run build` | pending |

#### Wave 2 (depends on Wave 1)
| # | Task | File | Agent | Skills | Review | Acceptance | Status |
|---|------|------|-------|--------|--------|------------|--------|
| 02 | Implement Windows shell/HUD/tray runtime | [tasks/02-windows-shell-hud-runtime.md](tasks/02-windows-shell-hud-runtime.md) | hades | tauri-v2 | per-task | `cargo test --manifest-path src/Cargo.toml windows_shell_runtime && npm run build` + Manual Windows VM fullscreen/tray spot-check | pending |
| 03 | Implement Windows insertion/helper runtime | [tasks/03-windows-insertion-helper-runtime.md](tasks/03-windows-insertion-helper-runtime.md) | hades | tauri-v2 | per-task | `cargo test --manifest-path src/Cargo.toml windows_text_insertion && npm run build` + Manual Windows VM normal/elevated insertion spot-check | pending |
| 04 | Make the UI platform-aware | [tasks/04-platform-aware-ui.md](tasks/04-platform-aware-ui.md) | golem | web-best-practices | per-task | `npm run test:ui -- ui/src/__tests__/startup-permissions.test.ts ui/src/__tests__/shortcut-recorder-logic.test.ts ui/src/__tests__/platform-runtime-ui.test.ts && npm run build` | pending |

#### Wave 3 (depends on Wave 2)
| # | Task | File | Agent | Skills | Review | Acceptance | Status |
|---|------|------|-------|--------|--------|------------|--------|
| 05 | Reconcile contracts and verification sweep | [tasks/05-cross-platform-verification-sweep.md](tasks/05-cross-platform-verification-sweep.md) | golem | — | skip | `npm test && npm run build` | pending |

#### Wave 4 (depends on Wave 3)
| # | Task | File | Agent | Skills | Review | Acceptance | Status |
|---|------|------|-------|--------|--------|------------|--------|
| 06 | Sync AGENTS knowledge with final runtime architecture | [brief.md](brief.md) | clio | — | skip | `clio update completed or explicit no-op reported` | pending |

## Dispatch Protocol

> **For the orchestrator**: step-by-step how to execute this plan.
>
> **Orchestrator contract**: READ runbook only. WRITE whiteboard between waves. NEVER read task cards, brief, or source code.
> All dispatch info (agent, skills, review type, acceptance) is in the Task Index. All templates are below.

### Per-Wave Flow

```
FOR each wave in Wave Schedule:
  1. PREFLIGHT — verify Wave Prerequisites from runbook (if any) for this wave's tasks
  2. DISPATCH  — launch all tasks in this wave as parallel subagents (select template by TDD column)
  3. VERIFY    — run each task's Acceptance command from Task Index
  4. REVIEW    — for tasks with Review = per-task, dispatch Heimdall (Spec Compliance first, Code Quality second)
  5. TRIAGE    — if any task failed, classify and handle (see Failure Handling)
  6. UPDATE    — collect executor findings → append to whiteboard.md
  7. NEXT      — proceed to next wave only after all tasks verified and review issues resolved
```

### Step 1: Dispatch

For each task in the current wave, launch a subagent using:
- **Agent type**: from Task Index → Agent column
- **Skills**: from Task Index → Skills column (pass to subagent if not "—")
- **Delegation prompt**: use template below (replace `XX-{slug}` with actual task file name)

**Template — Wave 1:**

> MUST: write tests FIRST — RED (verify fails for behavioral reason, not config/import) → GREEN → REFACTOR.
> NEVER weaken tests to pass — fix implementation instead.
> Read these files, then execute the task:
> 1. `./artifacts/plans/windows-runtime-parity-port/brief.md`
> 2. `./artifacts/plans/windows-runtime-parity-port/tasks/XX-{slug}.md`

**Template — Wave 2+:**

> MUST: write tests FIRST — RED (verify fails for behavioral reason, not config/import) → GREEN → REFACTOR.
> NEVER weaken tests to pass — fix implementation instead.
> ⚠️ If whiteboard shows contract deviations or new downstream constraints, use ACTUAL over planned.
> ⚠️ If whiteboard says `amend` or `escalate` for your dependency chain, stop and follow runbook handling instead of implementing blindly.
> Read these files, then execute the task:
> 1. `./artifacts/plans/windows-runtime-parity-port/brief.md`
> 2. `./artifacts/plans/windows-runtime-parity-port/whiteboard.md`
> 3. `./artifacts/plans/windows-runtime-parity-port/tasks/XX-{slug}.md`

**clio dispatch (AGENTS.md sync):**

BECAUSE clio has its own autonomous UPDATE workflow (reads git diff, self-detects changes), orchestrator MUST send ONLY the brief path — NEVER summarize code, describe structure, or add custom instructions.

> `./artifacts/plans/windows-runtime-parity-port/brief.md`

### Step 2: Verify

After each executor completes:
1. Run the **Acceptance** command from Task Index for that task
2. If PASS → validate executor **Report** has ALL required fields:
   - **Actual outputs**: files created/modified with paths
   - **Test evidence**: exact command + PASS/FAIL + scope (or skip reason)
   - **Resolved review items**: ID → files → verification (or "None")
   - **Contract amendments**: if Produces signatures changed from planned → actual signature + reason + whether amendment is bug-fix or plan-correction (or "None")
   - **New constraints or prerequisites**: newly discovered facts later waves must assume or verify (or "None")
   - **Deviations**: other differences from planned behavior (or "None")
   - **Discoveries**: patterns, gotchas affecting other tasks — include **Recommendation** (what downstream should do) + **Rationale** (why)
   - **Warnings**: anything downstream tasks should know
   - **Downstream action**: `continue` | `amend` | `escalate` — with short reason
   - **Prerequisites confirmed**: runtime prerequisites verified (if applicable)
3. If Report has Contract amendments → check Contract Dependencies table for consumers of that contract → note in whiteboard before dispatching consumers
4. If Report says **Downstream action = amend** → invoke Plan Amendment before dispatching affected downstream tasks
5. If Report says **Downstream action = escalate** → STOP and report to user before dispatching affected downstream tasks
6. If FAIL → classify failure type and handle (see Failure Handling)
7. Mark Status as `done` only after Step 2.5 review passes (for tasks with Review = `per-task`) or immediately after Step 2 (for tasks with Review = `skip`)

### Step 2.5: Review

For each task where Task Index → Review = `per-task` AND Acceptance = PASS:

**Dispatch Heimdall using this template:**

> Review this task for spec compliance and code quality.
> 1. Read brief: `./artifacts/plans/windows-runtime-parity-port/brief.md`
> 2. Read task spec: `./artifacts/plans/windows-runtime-parity-port/tasks/XX-{slug}.md`
> 3. Review changed files (from task's Owns): {file list from File Ownership Matrix}
> Spec Compliance first, Code Quality second.

**After Heimdall returns** (save Heimdall's `task_id` as `heimdall_task_id` for re-reviews):
1. If no unresolved Critical/Important → mark task `done`
2. If Critical/Important found:
   a. **Re-dispatch executor** (same session via `task_id`) for ALL fixes — orchestrator NEVER reads or edits source code. Include full finding table, not just IDs —
      `"Heimdall review found issues. Fix ONLY these:\n{paste CRIT/IMP rows: ID | File:Line | Problem | Fix Direction}\nReturn: ID → changed files → verification command/result for each fix."`
   c. **Re-run Acceptance** command
   d. **Re-review via Heimdall** (same session via `heimdall_task_id`): `"Re-review: {fixed IDs}. Verify fixes and check for regressions from changes."`
   e. Repeat until no unresolved Critical/Important (max 3 review cycles per task)
3. Require executor to return `Resolved review items` mapping each `CRIT-*`/`IMP-*` ID → changed files + verification
4. Mark task `done` only when: Acceptance PASS + Heimdall verdict "Ready" or "Ready with fixes" + `Resolved review items` provided

Tasks with Review = `skip` → mark `done` immediately after Acceptance PASS.

### Step 3: Failure Handling

| Failure Type | Signal | Action |
|--------------|--------|--------|
| **Crash** | Executor errors out, no usable output | Retry same session via `task_id` (max 2 retries). If still fails → escalate to hades with crash context |
| **Wrong output** | Acceptance command fails, code exists but incorrect | Analyze failure. Re-dispatch same session with failure context: `"Acceptance failed: {error}. Fix: {specific issue}"` (max 2 retries) |
| **Plan defect** | Executor reports file path doesn't exist, contract impossible, requirements contradictory, or referenced code doesn't match plan description | Do NOT retry executor. Invoke Plan Amendment flow (see below) with executor's error report as input. Re-dispatch affected tasks after amendment |
| **Review fail** | Heimdall reports unresolved Critical/Important issues | Re-dispatch executor via `task_id` with full finding table (ID, File:Line, Problem, Fix Direction) → re-run Acceptance → re-review via Heimdall `heimdall_task_id`. Orchestrator NEVER self-fixes code |
| **Review evidence missing** | Executor response lacks `Resolved review items` mapping for fixed review IDs | Re-dispatch same session: `"Provide review traceability: ID → files → verification command/result"` then re-check report |
| **Blocked** | Missing prerequisite, upstream contract not available | Mark task as `blocked`. Resolve blocker first (fix upstream task or provide prerequisite). Then re-dispatch |
| **Partial** | Some acceptance criteria pass, others fail | Re-dispatch same session targeting only failed criteria: `"Passing: {list}. Failing: {list}. Fix failing only"` |
| **Owns violation** | Executor modified files outside its Owns list (detect via `git diff --name-only` vs. Owns) | Revert unauthorized changes. Re-dispatch with explicit warning: `"You modified files outside Owns. ONLY modify: {Owns list}"` |
| **Environment failure** | Missing env var, service down, dependency install fails (distinct from executor bug) | Check Wave Prerequisites. If prerequisite gap → treat as Plan defect. If transient → retry after fixing environment |

**Cascade rule**: If Task X fails after max retries, look up Contract Dependencies table → find all tasks that consume from Task X → mark as `blocked`. Report blocked chain to user before proceeding.

**Wave gate**: ALL tasks in a wave must reach `done` before dispatching next wave. Blocked tasks prevent wave completion — resolve or re-plan.

**Max retries**: 2 per task. After 2 retries with same failure → STOP, report to user with failure context and ask for direction.

### Step 4: Update Whiteboard

After ALL tasks in a wave are verified:
1. From each executor's Report, extract whiteboard-relevant fields only: **Actual outputs**, **Contract amendments**, **New constraints or prerequisites**, **Deviations**, **Discoveries**, **Warnings**, **Downstream action** (skip Test evidence, Resolved review items, Prerequisites confirmed — those are orchestrator-only unless they change later work)
2. Synthesize **Blockers or failures affecting later work** from extracted Deviations, Discoveries, and Warnings where Downstream action is `amend` or `escalate`
3. Append to `whiteboard.md` under `## After Wave N` heading using Whiteboard Schema field structure
4. Resolve conflicting discoveries between tasks (if Task A says "use pattern X" and Task B says "avoid pattern X" → decide and note resolution)
5. Write updated `whiteboard.md` BEFORE dispatching next wave

**Report format**: defined in each task card's Report section. Orchestrator extracts this from executor responses.

### Plan Amendment (after partial execution)

When plan needs changes after some waves completed:
1. Keep completed waves and their whiteboard entries as-is
2. Re-invoke planner with: `whiteboard.md` (delta-only actual findings) + `brief.md` (conventions) + change description
3. Planner produces ONLY remaining waves (new task cards numbered from last completed + 1)
4. Append new tasks to existing `tasks/` directory
5. Update `runbook.md` Wave Schedule and Task Index for remaining waves only
6. Record amendment reason in Context section

## Verification Strategy
> TDD (Red→Green→Refactor) default for behavior-changing tasks. NEVER weaken tests — fix implementation.
> **Test types**: frontend → Vitest/jsdom contract tests, Rust shell/insertion → cargo unit/invariant tests, Windows-only runtime behaviors → Windows VM manual spot-checks after automated checks.
> **Skip**: release/signing/installer work is out of scope for this plan.
> **Manual**: fullscreen HUD visibility, tray recovery, standard target insertion, elevated target insertion through helper.

## Risks
- **Fullscreen HUD parity on Windows may be partial** — mitigate by isolating shell behavior in a Windows app-shell module and requiring explicit VM evidence before claiming success.
- **Elevated-target insertion depends on helper/UIPI behavior** — mitigate with a dedicated helper dispatch seam, explicit fallback ordering tests, and honest error reporting instead of silent failure.
- **Current host is macOS** — mitigate with the confirmed Windows VM/PC prerequisite for wave 2 runtime checks.
- **Release/signing is deferred** — mitigate by keeping the helper/runtime architecture packaging-friendly and documenting out-of-scope release work instead of smuggling it into runtime tasks.
- **Shared bridge contract drift** — mitigate with dedicated runtime-info bridge tests in wave 1 and a final contract sweep in wave 3.

## Commit Strategy
- `refactor: extract cross-platform shell contracts`
- `feat: add windows shell and insertion helper runtime`
- `test: lock cross-platform runtime invariants`

## Success Criteria
- `get_platform_runtime_info` exists and is permissioned/typed without renaming existing bridge methods.
- macOS runtime still passes shared suite and preserves current hidden-launch/HUD semantics.
- Windows VM/PC runtime checks demonstrate fullscreen-capable HUD, tray-assisted recovery, standard insertion, and elevated insertion via helper.
- Shared `npm test` and `npm run build` pass after the final sweep.
- No installer/signing/updater/release-pipeline changes landed as part of this plan.
