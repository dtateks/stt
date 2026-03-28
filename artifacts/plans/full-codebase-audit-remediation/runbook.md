# Deep macOS Codebase Audit and Full Remediation

## TL;DR
> Audit and remediate the full shipped macOS path of the Voice to Text Tauri app in four waves: parallel module hardening, cross-boundary integration, end-to-end runtime/package verification, and final AGENTS.md sync. Estimated effort: L. Total execution graph: 8 task cards + 1 final clio sync across 4 waves.

## Context
### Original Request
> "deep audit all codebase for best arch, best solid, no gaps, no bugs"

### Key Decisions (from interview)
- Full audit **and** full remediation plan, not a read-only findings pass.
- Scope is the **macOS-only shipped path**.
- Optimize for **architecture/SOLID quality first**, then defect removal and runtime safety.
- Include **static review + automated verification + live runtime checks + packaged-build verification**.
- Broad modernization is allowed when directly justified by findings.
- Aggressive redesign is acceptable when it produces a cleaner system.
- Riskier big-batch refactor waves are acceptable.

### Assumptions (evidence-based defaults applied — user did not explicitly decide)
- A macOS verifier machine is available for Wave 3 runtime/package smoke.
- A valid Soniox key will be available on the verifier machine, preferably via `SONIOX_API_KEY`, for deterministic runtime smoke.
- xAI correction-path verification is preferred, but if no valid xAI key is available during Wave 3, that sub-flow is documented as blocked instead of guessed.

## Objectives
### Must Have (exact deliverables)
- Audit and remediate all shipped macOS surfaces in Rust, Tauri config/capabilities, UI, bridge, packaging, and verification.
- Preserve the project’s core architectural boundaries while improving them: pure leaf modules stay pure, orchestration stays explicit, and shared boundaries become more explicit and testable.
- Add or expand automated tests for every behavior-changing remediation task.
- Reconcile all cross-boundary contracts in one dedicated integration wave.
- Run final runtime smoke on both dev and packaged macOS flows before memory sync.

### Must NOT Have (explicit exclusions)
- No Android/iOS/mobile feature work.
- No new product features beyond what is required to fix architecture, correctness, security, accessibility, reliability, or packaging gaps.
- No hacks, shims, broad permission widening, or backwards-compat layers kept only to reduce diff size.
- No direct `window.__TAURI__` usage outside `ui/tauri-bridge.js`.

### Definition of Done
- Tasks 01-07 pass acceptance and Heimdall review with no unresolved Critical/Important findings.
- Task 08 reports passing dev/runtime and packaged-build smoke, or triggers plan amendment instead of shipping a workaround.
- `npm test` and `cargo test --manifest-path src/Cargo.toml` both pass on the final integrated codebase.
- clio updates AGENTS.md memory for future sessions.

## Execution Graph

### File Ownership Matrix
| File Path | Wave | Task | Action (create/modify/delete/rename/generate) | Merge Risk |
|-----------|------|------|-----------------------------------------------|------------|
| `src/src/lib.rs` | 1 | 01 | modify | — |
| `src/tauri.conf.json` | 1 | 01 | modify | — |
| `src/capabilities/default.json` | 1 | 01 | modify | — |
| `src/Cargo.toml` | 1 | 01 | modify | — |
| `src/Entitlements.plist` | 1 | 01 | modify | — |
| `src/Info.plist` | 1 | 01 | modify | — |
| `src/tests/window_shell.rs` | 1 | 01 | create | — |
| `src/src/permissions.rs` | 1 | 02 | modify | — |
| `src/src/text_inserter.rs` | 1 | 02 | modify | — |
| `src/tests/text_insertion_permissions.rs` | 1 | 02 | create | — |
| `src/src/credentials.rs` | 1 | 03 | modify | — |
| `src/src/shell_credentials.rs` | 1 | 03 | modify | — |
| `src/src/llm_service.rs` | 1 | 03 | modify | — |
| `config.json` | 1 | 03 | modify | — |
| `src/tests/native_services.rs` | 1 | 03 | modify | — |
| `ui/index.html` | 1 | 04 | modify | — |
| `ui/src/main.ts` | 1 | 04 | modify | — |
| `ui/src/main.css` | 1 | 04 | modify | — |
| `ui/src/storage.ts` | 1 | 04 | modify | — |
| `ui/src/startup-permissions.ts` | 1 | 04 | modify | — |
| `ui/src/__tests__/startup-permissions.test.ts` | 1 | 04 | modify | — |
| `ui/src/__tests__/main-ui.test.ts` | 1 | 04 | create | — |
| `ui/src/bar-session-controller.ts` | 1 | 05 | modify | — |
| `ui/src/bar-state-machine.ts` | 1 | 05 | modify | — |
| `ui/src/soniox-client.ts` | 1 | 05 | modify | — |
| `ui/src/stop-word.ts` | 1 | 05 | modify | — |
| `ui/src/pcm-capture-processor.js` | 1 | 05 | modify | — |
| `ui/src/__tests__/logic.test.ts` | 1 | 05 | modify | — |
| `ui/src/__tests__/bar-session-controller.test.ts` | 1 | 05 | create | — |
| `ui/bar.html` | 2 | 06 | modify | — |
| `ui/src/bar.ts` | 2 | 06 | modify | — |
| `ui/src/bar.css` | 2 | 06 | modify | — |
| `ui/src/tokens.css` | 2 | 06 | modify | — |
| `ui/src/__tests__/bar-ui.test.ts` | 2 | 06 | create | — |
| `src/src/commands.rs` | 2 | 07 | modify | — |
| `ui/tauri-bridge.js` | 2 | 07 | modify | — |
| `ui/src/types.ts` | 2 | 07 | modify | — |
| `src/build.rs` | 2 | 07 | modify | — |
| `src/tests/command_bridge_contract.rs` | 2 | 07 | create | — |
| `ui/src/__tests__/bridge-contract.test.ts` | 2 | 07 | create | — |

### Wave Schedule
| Wave | Tasks (parallel) | Glue Task (sequential) | Depends On | Est. Complexity |
|------|------------------|------------------------|------------|-----------------|
| 1 | 01, 02, 03, 04, 05 | — | — | L |
| 2 | 06, 07 | — | Wave 1 | L |
| 3 | 08 | — | Wave 2 | L |
| 4 | clio sync | — | Wave 3 | S |

### Contract Dependencies
> Orchestrator uses this for cascade-block + deviation routing. Contract IDs follow `C-01-name` style numbering tied to producing task IDs.
| Contract ID | Producer (Task) | Consumer (Tasks) | Signature (abbreviated) |
|-------------|-----------------|------------------|-------------------------|
| `C-01-window-runtime-invariants` | 01 | 07, 08 | `WindowRuntimeInvariants { mainClose, barShowOrder, bundleSettings, capabilityScope }` |
| `C-02-permission-insertion-contract` | 02 | 07, 08 | `PermissionResult + InsertTextResult serialized shapes and semantics` |
| `C-03-config-service-contract` | 03 | 07, 08 | `Credentials/AppConfig/correctTranscript behavior + error taxonomy` |
| `C-04-main-settings-ui-contract` | 04 | 07, 08 | `Setup/preferences/dialog/storage behavior contract` |
| `C-05-bar-controller-view-contract` | 05 | 06, 07, 08 | `BarSessionController public API + callback semantics` |
| `C-06-hud-view-contract` | 06 | 08 | `HUD DOM/render/data-state/data-overlay contract` |
| `C-07-bridge-command-contract` | 07 | 08 | `VoiceToTextBridge + tauri command allow-list/types contract` |

### Wave Prerequisites
> Orchestrator verifies these in PREFLIGHT before dispatching each wave's tasks.
| Wave | Task | Prerequisite | Verify Command |
|------|------|--------------|----------------|
| 3 | 08 | Verifier host is macOS | `python -c "import platform; raise SystemExit(0 if platform.system() == 'Darwin' else 1)"` |
| 3 | 08 | Tauri CLI/toolchain available for manual dev/build smoke | `cargo tauri --version` |
| 3 | 08 | Soniox key available via `SONIOX_API_KEY` for runtime smoke | `test -n "${SONIOX_API_KEY:-}"` |

### Task Index
> Grouped by wave. Links to task card files. Orchestrator dispatches, verifies, and cascade-blocks using ONLY this table + Contract Dependencies.
> - **Acceptance**: non-destructive, idempotent commands only (read-only checks, test runs — never mutations)

#### Wave 1 (parallel)
| # | Task | File | Agent | Skills | Review | Acceptance | Status |
|---|------|------|-------|--------|--------|------------|--------|
| 01 | Harden native shell, window, capability, and packaging boundaries | [tasks/01-native-shell-window-packaging.md](tasks/01-native-shell-window-packaging.md) | titan | tauri-v2, arch-best-practices | per-task | `python -m json.tool src/tauri.conf.json >/dev/null && python -m json.tool src/capabilities/default.json >/dev/null && cargo test --manifest-path src/Cargo.toml` | pending |
| 02 | Harden permission and text-insertion pipeline | [tasks/02-permissions-text-insertion.md](tasks/02-permissions-text-insertion.md) | hades | — | per-task | `cargo test --manifest-path src/Cargo.toml` | pending |
| 03 | Harden credentials, config, shell fallback, and LLM adapters | [tasks/03-credentials-config-llm.md](tasks/03-credentials-config-llm.md) | golem | arch-best-practices | per-task | `cargo test --manifest-path src/Cargo.toml` | pending |
| 04 | Harden setup, preferences, dialog, and persistence UX | [tasks/04-main-window-preferences-ui.md](tasks/04-main-window-preferences-ui.md) | venus | web-best-practices | per-task | `npx tsc -p ui/tsconfig.json --noEmit && npm run test:ui` | pending |
| 05 | Harden HUD session orchestration and STT pipeline | [tasks/05-hud-session-pipeline.md](tasks/05-hud-session-pipeline.md) | titan | arch-best-practices | per-task | `npx tsc -p ui/tsconfig.json --noEmit && npm run test:ui` | pending |

#### Wave 2 (depends on Wave 1)
| # | Task | File | Agent | Skills | Review | Acceptance | Status |
|---|------|------|-------|--------|--------|------------|--------|
| 06 | Harden HUD shell rendering, accessibility, and visual tokens | [tasks/06-hud-shell-rendering.md](tasks/06-hud-shell-rendering.md) | venus | web-best-practices | per-task | `npx tsc -p ui/tsconfig.json --noEmit && npm run test:ui` | pending |
| 07 | Reconcile bridge, command surface, shared types, and command exposure | [tasks/07-bridge-command-integration.md](tasks/07-bridge-command-integration.md) | titan | tauri-v2, arch-best-practices | per-task | `cargo test --manifest-path src/Cargo.toml && npx tsc -p ui/tsconfig.json --noEmit && npm run test:ui` | pending |

#### Wave 3 (depends on Wave 2)
| # | Task | File | Agent | Skills | Review | Acceptance | Status |
|---|------|------|-------|--------|--------|------------|--------|
| 08 | Verify end-to-end macOS runtime and packaged build | [tasks/08-runtime-packaging-verification.md](tasks/08-runtime-packaging-verification.md) | titan | tauri-v2, web-best-practices | skip | `npm test && cargo test --manifest-path src/Cargo.toml`; Manual: dev-shell smoke PASS; Manual: packaged-build smoke PASS | pending |

#### Wave 4 (depends on Wave 3)
| # | Task | File | Agent | Skills | Review | Acceptance | Status |
|---|------|------|-------|--------|--------|------------|--------|
| 09 | Sync AGENTS memory with implemented reality | — | clio | — | skip | `AGENTS.md updated if needed` | pending |

## Dispatch Protocol

> **For the orchestrator**: step-by-step how to execute this plan.
>
> **Orchestrator contract**: READ runbook only. WRITE whiteboard between waves. NEVER read task cards, brief, or source code.
> All dispatch info (agent, skills, review type, acceptance) is in the Task Index. All templates are below.

### Per-Wave Flow

```
FOR each wave in Wave Schedule:
  1. PREFLIGHT — verify Wave Prerequisites from runbook (if any) for this wave's tasks
  2. DISPATCH  — launch all tasks in this wave as parallel subagents (select template by wave)
  3. VERIFY    — run each task's Acceptance command from Task Index
  4. REVIEW    — for tasks with Review = per-task, dispatch Heimdall (Spec Compliance first, Code Quality second)
  5. TRIAGE    — if any task failed, classify and handle (see Failure Handling)
  6. UPDATE    — collect executor findings → append to whiteboard.md
  7. NEXT      — proceed to next wave only after all tasks verified and review issues resolved
```

### Step 1: Dispatch

For each task in the current wave, launch a subagent using:
- **Agent type**: from Task Index → Agent column
- **Skills**: from Task Index → Skills column (pass to subagent if not `—`)
- **Delegation prompt**: use the current task card path from Task Index in place of “the task card path” below

**Template — Wave 1:**

> MUST: write tests FIRST — RED (verify fails for behavioral reason, not config/import) → GREEN → REFACTOR.
> NEVER weaken tests to pass — fix implementation instead.
> Read these files, then execute the task:
> 1. `./artifacts/plans/full-codebase-audit-remediation/brief.md`
> 2. the current task card path from Task Index

**Template — Wave 2+:**

> MUST: write tests FIRST — RED (verify fails for behavioral reason, not config/import) → GREEN → REFACTOR.
> NEVER weaken tests to pass — fix implementation instead.
> ⚠️ If whiteboard shows contract deviations or new downstream constraints, use ACTUAL over planned.
> ⚠️ If whiteboard says `amend` or `escalate` for your dependency chain, stop and follow runbook handling instead of implementing blindly.
> Read these files, then execute the task:
> 1. `./artifacts/plans/full-codebase-audit-remediation/brief.md`
> 2. `./artifacts/plans/full-codebase-audit-remediation/whiteboard.md`
> 3. the current task card path from Task Index

**clio dispatch (AGENTS.md sync):**

BECAUSE clio has its own autonomous UPDATE workflow (reads git diff, self-detects changes), orchestrator MUST send ONLY the brief path — NEVER summarize code, describe structure, or add custom instructions.

> `./artifacts/plans/full-codebase-audit-remediation/brief.md`

### Step 2: Verify

After each executor completes:
1. Run the **Acceptance** command from Task Index for that task.
2. If PASS → validate executor **Report** has ALL required fields:
   - **Actual outputs**: files created/modified with paths
   - **Test evidence**: exact command + PASS/FAIL + scope (or skip reason)
   - **Resolved review items**: ID → files → verification (or `None`)
   - **Contract amendments**: planned vs actual signature + reason + whether amendment is bug-fix or plan-correction (or `None`)
   - **New constraints or prerequisites**: newly discovered downstream facts (or `None`)
   - **Deviations**: other differences from planned behavior (or `None`)
   - **Discoveries**: patterns/gotchas affecting other tasks — include **Recommendation** + **Rationale**
   - **Warnings**: anything downstream tasks should know
   - **Downstream action**: `continue` | `amend` | `escalate`
   - **Prerequisites confirmed**: runtime prerequisites verified (if applicable)
3. If Report has Contract amendments → check Contract Dependencies table for consumers of that contract → note in whiteboard before dispatching consumers.
4. If Report says **Downstream action = amend** → invoke Plan Amendment before dispatching affected downstream tasks.
5. If Report says **Downstream action = escalate** → STOP and report to user before dispatching affected downstream tasks.
6. If FAIL → classify failure type and handle (see Failure Handling).
7. Mark Status as `done` only after Step 2.5 review passes (for tasks with Review = `per-task`) or immediately after Step 2 (for tasks with Review = `skip`).

### Step 2.5: Review

For each task where Task Index → Review = `per-task` AND Acceptance = PASS:

**Dispatch Heimdall using this template:**

> Review this task for spec compliance and code quality.
> 1. Read brief: `./artifacts/plans/full-codebase-audit-remediation/brief.md`
> 2. Read the current task card path from Task Index
> 3. Review the changed files listed for that task in the File Ownership Matrix and the task’s Owns section
> Spec Compliance first, Code Quality second.

**After Heimdall returns** (save Heimdall's `task_id` as `heimdall_task_id` for re-reviews):
1. If no unresolved Critical/Important → mark task `done`
2. If Critical/Important found:
   a. **Re-dispatch executor** (same session via `task_id`) for ALL fixes — orchestrator NEVER reads or edits source code. Include the full Heimdall CRIT/IMP finding rows (ID, file:line, problem, fix direction) in the retry prompt and require ID → files → verification mapping in the reply.
   b. **Re-run Acceptance** command
   c. **Re-review via Heimdall** (same session via `heimdall_task_id`) with the fixed issue IDs and changed-file summary.
   d. Repeat until no unresolved Critical/Important (max 3 review cycles per task)
3. Require executor to return `Resolved review items` mapping each `CRIT-*`/`IMP-*` ID → changed files + verification
4. Mark task `done` only when: Acceptance PASS + Heimdall verdict `Ready` or `Ready with fixes` + `Resolved review items` provided

Tasks with Review = `skip` → mark `done` immediately after Acceptance PASS.

### Step 3: Failure Handling

| Failure Type | Signal | Action |
|--------------|--------|--------|
| **Crash** | Executor errors out, no usable output | Retry same session via `task_id` (max 2 retries). If still fails → escalate to hades with crash context |
| **Wrong output** | Acceptance command fails, code exists but incorrect | Analyze failure. Re-dispatch same session with the exact failing command output and the narrow failing criterion (max 2 retries) |
| **Plan defect** | Executor reports file path doesn't exist, contract impossible, requirements contradictory, or referenced code doesn't match plan description | Do NOT retry executor. Invoke Plan Amendment flow with executor's error report as input. Re-dispatch affected tasks after amendment |
| **Review fail** | Heimdall reports unresolved Critical/Important issues | Re-dispatch executor via `task_id` with full finding table (ID, File:Line, Problem, Fix Direction) → re-run Acceptance → re-review via Heimdall `heimdall_task_id` |
| **Review evidence missing** | Executor response lacks `Resolved review items` mapping for fixed review IDs | Re-dispatch same session: `"Provide review traceability: ID → files → verification command/result"` then re-check report |
| **Blocked** | Missing prerequisite, upstream contract not available | Mark task as `blocked`. Resolve blocker first, then re-dispatch |
| **Partial** | Some acceptance criteria pass, others fail | Re-dispatch same session targeting only failed criteria |
| **Owns violation** | Executor modified files outside its Owns list | Revert unauthorized changes. Re-dispatch with the exact allowed Owns list pasted from the task card |
| **Environment failure** | Missing env var, service down, dependency install fails | Check Wave Prerequisites. If prerequisite gap → treat as Plan defect. If transient → retry after fixing environment |

**Cascade rule**: If Task X fails after max retries, look up Contract Dependencies table → find all consumers → mark as `blocked`. Report blocked chain to user before proceeding.

**Wave gate**: ALL tasks in a wave must reach `done` before dispatching next wave.

**Max retries**: 2 per task. After 2 retries with same failure → STOP, report to user with failure context and ask for direction.

### Step 4: Update Whiteboard

After ALL tasks in a wave are verified:
1. From each executor's Report, extract whiteboard-relevant fields only: **Actual outputs**, **Contract amendments**, **New constraints or prerequisites**, **Deviations**, **Discoveries**, **Warnings**, **Downstream action**
2. Synthesize **Blockers or failures affecting later work** from extracted Deviations, Discoveries, and Warnings where Downstream action is `amend` or `escalate`
3. Append to `whiteboard.md` under `## After Wave N` heading using Whiteboard Schema field structure
4. Resolve conflicting discoveries between tasks before writing them
5. Write updated `whiteboard.md` BEFORE dispatching next wave

### Plan Amendment (after partial execution)

When plan needs changes after some waves completed:
1. Keep completed waves and their whiteboard entries as-is
2. Re-invoke planner with: `whiteboard.md` + `brief.md` + change description
3. Planner produces ONLY remaining waves (new task cards numbered from last completed + 1)
4. Append new tasks to existing `tasks/` directory
5. Update `runbook.md` Wave Schedule and Task Index for remaining waves only
6. Record amendment reason in Context section

## Verification Strategy
> TDD (Red→Green→Refactor) is the default for all behavior-changing tasks.
> Frontend: Vitest 3.2.4 + jsdom under `ui/src/__tests__/`.
> Rust: `cargo test --manifest-path src/Cargo.toml`, with unit tests in source modules and integration tests in `src/tests/`.
> Manual verification is REQUIRED for Wave 3 dev/runtime and packaged-build smoke because packaged builds are side-effectful and cannot be an automated acceptance command.

## Risks
- Wave 3 depends on real macOS TCC/runtime conditions and valid Soniox credentials; missing runtime prerequisites block final verification.
- Task 06 depends on Task 05’s actual controller/view contract. If Task 05 changes the public callback/API surface more than expected, Wave 2 may need plan amendment.
- Task 07 is the single owner of bridge/command/types/build exposure; any unreported boundary drift from Wave 1 will surface there.
- Broad modernization is allowed, but executors must tie each upgrade or structural change to a concrete finding; otherwise scope inflation will create unnecessary churn.
- Packaged-only defects may still appear after all static and test gates; Task 08 must escalate instead of masking them.

## Commit Strategy
> One shippable commit per logical task cluster after green verification:
> 1. native shell/window/packaging
> 2. permissions/text insertion
> 3. credentials/config/LLM
> 4. main window/preferences UI
> 5. HUD session pipeline
> 6. HUD shell rendering/tokens
> 7. bridge/command integration
> 8. verification fixes only if Task 08 uncovers a root-cause defect and amendment is approved

## Success Criteria
- The codebase’s shipped macOS path has been reviewed and remediated across architecture, SOLID, correctness, security, accessibility, reliability, and packaging.
- Shared Rust↔Tauri↔UI boundaries are explicit, typed, least-privilege, and covered by tests.
- All automated tests pass, and Wave 3 manual smoke passes in both dev and packaged contexts.
- No unresolved Critical/Important Heimdall findings remain.
- AGENTS memory is updated to reflect the new implementation reality.
