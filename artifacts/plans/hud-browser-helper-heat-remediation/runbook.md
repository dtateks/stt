# HUD Browser Helper Heat Remediation

## TL;DR
> Preserve the current polished HUD UX while removing the main heat drivers behind the macOS Browser Helper spike: continuous visible-state waveform rendering, repeated session/audio churn, and a hostile macOS HUD runtime/config path. Deliver 3 implementation tasks in Wave 1 plus a final `clio` memory sync in Wave 2. Estimated effort: M overall, with one L-risk macOS runtime task.

## Context
### Original Request
- Deep-audit the severe long-running HUD heat issue where the machine heats up within ~10 minutes and the macOS Browser Helper process consumes excessive CPU/RAM.
- Preserve the current seamless HUD UI/UX; plan the best fix rather than shipping a degraded experience.

### Key Decisions (from interview)
- Scope: **cross-platform shared** where the same HUD/render/audio code paths are shared, while prioritizing the macOS Browser Helper issue.
- UX goal: preserve the existing polished HUD UX by default.
- Fallback: if invisible fixes are insufficient, only **minor adaptive waveform tuning** is allowed; no broader HUD simplification.

### Assumptions (evidence-based defaults applied — user did not explicitly decide)
- Thermal success is judged primarily on a macOS reproduction run because the Browser Helper symptom is macOS-specific, even though shared render/audio fixes should also benefit Windows.
- No new user setting or debug toggle is acceptable for this bug fix; the fix should be runtime-internal.
- Project build evidence will be collected by executors (`npm run build`) because the repo requires build verification after changes, but orchestrator acceptance commands remain side-effect-free.

## Objectives
### Must Have (exact deliverables)
- Remove the dominant continuous HUD render/compositor waste without changing transcript flow, placement, transparency feel, or controls.
- Reduce repeated session/audio resource churn across stop-word finalization, insert/restart, clear, and pause/resume paths.
- Harden the macOS HUD window/runtime path against known high-CPU configurations while preserving the current fixed-size transparent overlay contract.
- Add regression coverage that locks the new safe behavior.

### Must NOT Have (explicit exclusions)
- No opaque HUD, no hide-during-processing behavior, no removal of always-on-top/fullscreen overlay behavior.
- No new user-visible settings, feature flags, or debug-only UX.
- No speculative suppressions, disabled tests, or symptom-only workarounds.

### Definition of Done
- Wave 1 targeted UI/Rust regression suites pass.
- Executors report successful `npm run build` evidence for each implementation task.
- The final implementation keeps the current polished HUD contract; only waveform-only minor adaptive tuning is allowed if necessary.
- Post-fix macOS validation shows the Browser Helper no longer exhibits the prior runaway heat/CPU profile during a 10-minute continuous HUD session.

## Execution Graph

### File Ownership Matrix
| File Path | Wave | Task | Action (create/modify/delete/rename/generate) | Merge Risk |
|-----------|------|------|-----------------------------------------------|------------|
| `ui/src/bar.ts` | 1 | 01 | modify | — |
| `ui/src/bar-render.ts` | 1 | 01 | modify | — |
| `ui/src/__tests__/bar-ui.test.ts` | 1 | 01 | modify | — |
| `ui/src/bar-session-controller.ts` | 1 | 02 | modify | — |
| `ui/src/soniox-client.ts` | 1 | 02 | modify | — |
| `ui/src/__tests__/bar-session-controller.test.ts` | 1 | 02 | modify | — |
| `src/tauri.conf.json` | 1 | 03 | modify | — |
| `src/src/lib.rs` | 1 | 03 | modify | — |
| `src/tests/window_shell.rs` | 1 | 03 | modify | — |
| `AGENTS.md` | 2 | 04 (`clio`) | modify | — |

### Wave Schedule
| Wave | Tasks (parallel) | Glue Task (sequential) | Depends On | Est. Complexity |
|------|------------------|------------------------|------------|-----------------|
| 1 | 01, 02, 03 | — | — | L |
| 2 | 04 (`clio`) | — | Wave 1 | S |

### Contract Dependencies
> No cross-task contracts — the three implementation tasks are file-isolated and acceptance-verified independently.
| Contract ID | Producer (Task) | Consumer (Tasks) | Signature (abbreviated) |
|-------------|----------------|-------------------|------------------------|
| — | — | — | No cross-task contracts in this plan |

### Wave Prerequisites
| Wave | Task | Prerequisite | Verify Command |
|------|------|-------------|----------------|
| 1 | 01, 02, 03 | No additional runtime prerequisite beyond the checked-out repo and existing toolchain state | `test -f package.json && test -f src/Cargo.toml` |
| 2 | 04 | Root memory file exists for `clio` update mode | `test -f AGENTS.md` |

### Task Index
> Grouped by wave. Orchestrator dispatches, verifies, and cascade-blocks using ONLY this table + Contract Dependencies.

#### Wave 1 (parallel)
| # | Task | File | Agent | Skills | Review | Acceptance | Status |
|---|------|------|-------|--------|--------|------------|--------|
| 01 | Reduce HUD render/compositor load while preserving current HUD UX | [tasks/01-hud-render-budget.md](tasks/01-hud-render-budget.md) | venus | web-best-practices | per-task | `npx vitest run ui/src/__tests__/bar-ui.test.ts` | pending |
| 02 | Remove repeated session/audio churn without changing the HUD’s listening UX | [tasks/02-session-audio-lifecycle.md](tasks/02-session-audio-lifecycle.md) | golem | — | per-task | `npx vitest run ui/src/__tests__/bar-session-controller.test.ts` | pending |
| 03 | Harden the macOS HUD window/runtime path without changing the fixed-size polished HUD contract | [tasks/03-macos-hud-runtime-hardening.md](tasks/03-macos-hud-runtime-hardening.md) | hades | tauri-v2 | per-task | `cargo test --manifest-path src/Cargo.toml tauri_config_keeps_window_and_packaging_runtime_invariants && cargo test --manifest-path src/Cargo.toml runtime_invariant_keeps_bar_show_order_configure_position_show_front` | pending |

#### Wave 2 (depends on Wave 1)
| # | Task | File | Agent | Skills | Review | Acceptance | Status |
|---|------|------|-------|--------|--------|------------|--------|
| 04 | Sync AGENTS memory with the final HUD heat fix decisions | — (`clio` reads brief only) | clio | — | skip | `git diff --name-only -- AGENTS.md` (or clio reports no update needed) | pending |

## Dispatch Protocol

> **For the orchestrator**: read this runbook only. Write `whiteboard.md` between waves. Never summarize task cards from memory; subagents read the files directly.

### Per-Wave Flow
```
FOR each wave in Wave Schedule:
  1. PREFLIGHT — verify Wave Prerequisites for this wave
  2. DISPATCH  — launch all tasks in this wave as parallel subagents
  3. VERIFY    — run each task's Acceptance command from Task Index
  4. REVIEW    — for tasks with Review = per-task, dispatch Heimdall
  5. TRIAGE    — if any task failed, classify and handle per Failure Handling
  6. UPDATE    — append downstream-relevant findings to whiteboard.md
  7. NEXT      — proceed only after all tasks are done or explicitly escalated
```

### Step 1: Dispatch

**Template — Wave 1:**

> MUST: write tests FIRST — RED (verify fails for behavioral reason, not config/import) → GREEN → REFACTOR. NEVER weaken tests to pass — fix implementation instead.
> Read these files, then execute the task:
> 1. `./artifacts/plans/hud-browser-helper-heat-remediation/brief.md`
> 2. `./artifacts/plans/hud-browser-helper-heat-remediation/tasks/XX-{slug}.md`

**Template — Wave 2+:**

> MUST: write tests FIRST — RED (verify fails for behavioral reason, not config/import) → GREEN → REFACTOR. NEVER weaken tests to pass — fix implementation instead.
> ⚠️ If whiteboard shows contract deviations or new downstream constraints, use ACTUAL over planned.
> ⚠️ If whiteboard says `amend` or `escalate` for your dependency chain, stop and follow runbook handling instead of implementing blindly.
> Read these files, then execute the task:
> 1. `./artifacts/plans/hud-browser-helper-heat-remediation/brief.md`
> 2. `./artifacts/plans/hud-browser-helper-heat-remediation/whiteboard.md`
> 3. `./artifacts/plans/hud-browser-helper-heat-remediation/tasks/XX-{slug}.md`

**clio dispatch (AGENTS.md sync):**

> `./artifacts/plans/hud-browser-helper-heat-remediation/brief.md`

### Step 2: Verify

After each executor completes:
1. Run the **Acceptance** command from Task Index.
2. If PASS, validate the executor **Report** contains: Actual outputs, Test evidence, Resolved review items, Contract amendments, New constraints or prerequisites, Deviations, Discoveries, Warnings, Downstream action, and Prerequisites confirmed.
   - **clio exception**: Task 04 does not use the standard executor report shape. Accept clio's completion summary if it states which `AGENTS.md` files were updated (or explicitly says no update was needed) and why.
3. If Report says **Downstream action = amend** → stop and invoke Plan Amendment before dispatching affected downstream tasks.
4. If Report says **Downstream action = escalate** → stop and report to user before dispatching affected downstream tasks.
5. Mark task `done` only after Acceptance PASS + review PASS (if review required).

### Step 2.5: Review

For each task where Review = `per-task` and Acceptance = PASS, dispatch Heimdall:

> Review this task for spec compliance and code quality.
> 1. Read brief: `./artifacts/plans/hud-browser-helper-heat-remediation/brief.md`
> 2. Read task spec: `./artifacts/plans/hud-browser-helper-heat-remediation/tasks/XX-{slug}.md`
> 3. Review changed files (from task's Owns): {file list from File Ownership Matrix}
> Spec Compliance first, Code Quality second.

If Heimdall reports unresolved Critical/Important issues, re-dispatch the same executor session with the finding table, re-run Acceptance, then re-review. Maximum 3 review cycles per task.

### Step 3: Failure Handling

| Failure Type | Signal | Action |
|--------------|--------|--------|
| Crash | Executor errors out with no usable output | Retry same session via `task_id` once; if repeated, escalate to hades except for Task 03 which is already hades and should escalate to user |
| Wrong output | Acceptance fails | Re-dispatch same session with the exact failing acceptance context |
| Plan defect | Executor reports impossible file path, contradictory requirement, or contract mismatch | Stop retries, amend plan, update whiteboard, then re-dispatch |
| Review fail | Heimdall reports Critical/Important issues | Re-dispatch same session with full finding table, then re-run Acceptance + Heimdall |
| Blocked | Missing prerequisite or upstream finding requires scope decision | Mark blocked, stop wave completion, report to user if not locally resolvable |
| Owns violation | Executor edited files outside Owns | Revert unauthorized files, re-dispatch with explicit Owns warning |

**Cascade rule**: because there are no cross-task contracts in this plan, one task failure does not block sibling wave tasks by dependency, but the wave still cannot complete until every task is done or explicitly escalated.

### Step 4: Update Whiteboard

After all Wave 1 tasks are verified:
1. Extract only downstream-relevant Report fields: Actual outputs, Contract amendments, New constraints or prerequisites, Deviations, Discoveries, Warnings, Downstream action.
2. Append `## After Wave 1` to `whiteboard.md` with one concise subsection per task.
3. Resolve conflicting discoveries before writing them down.
4. Dispatch Wave 2 only after the whiteboard is written.

### Plan Amendment (after partial execution)

When plan needs changes after some waves completed:
1. Keep completed-wave whiteboard entries as actual state.
2. Re-invoke planner with `brief.md`, `whiteboard.md`, and the amendment reason.
3. Append only remaining tasks/waves; do not rewrite completed ones.

## Verification Strategy
> **TDD applies to**: all three Wave 1 tasks — this is a behavior-changing bug fix touching non-obvious logic/runtime contracts.
> **Executor build evidence**: each Wave 1 executor must also run `npm run build` and report the result because project rules require bundled verification after changes. This is report evidence, not orchestrator Acceptance.
> **Manual thermal verification**: after Wave 1, run a 10-minute macOS HUD session on the built app and compare Browser Helper CPU/thermal behavior against the reported baseline. This is required for final success but cannot be fully automated in runbook acceptance.

## Risks
- **macOS window-config conflict**: upstream evidence says both `resizable:false` and borderless + `resizable:true` can be pathological in different macOS/Tauri paths. Task 03 must resolve this carefully; if not, the plan may require amendment.
- **Thermal evidence gap**: targeted tests and build evidence prove behavior/invariants, but only manual macOS runtime validation proves the 10-minute heat regression is fixed.
- **Waveform fallback risk**: if invisible render fixes are insufficient, only minor waveform-only tuning is allowed. Anything broader is out of scope and requires user escalation.

## Commit Strategy
- Commit 1: `fix: reduce HUD render budget without changing UX`
- Commit 2: `fix: reuse session audio lifecycle across HUD restarts`
- Commit 3: `fix: harden macOS HUD window runtime against browser helper spikes`
- Commit 4: `docs: refresh AGENTS memory for HUD thermal constraints` (only if `clio` updates AGENTS.md)

## Success Criteria
- The current polished HUD UX is preserved; only waveform-only minor adaptive tuning is allowed if strictly necessary.
- `ui/src/__tests__/bar-ui.test.ts` passes.
- `ui/src/__tests__/bar-session-controller.test.ts` passes.
- The targeted Rust invariant tests pass.
- Each implementation task reports a successful `npm run build`.
- Manual macOS validation confirms the Browser Helper no longer reproduces the prior severe heat/CPU profile during a 10-minute continuous HUD run.
