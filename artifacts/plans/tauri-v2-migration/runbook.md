# Voice to Text — Tauri v2 Big-Bang Migration

## TL;DR
> Replace the Electron runtime with a macOS-only Tauri v2 shell while preserving the app’s tray-first UX, floating bar speech pipeline, AppleScript-based text insertion, and packaged `/Applications` behavior. Plan shape: 7 implementation tasks + 1 final `clio` memory sync across 6 waves. Estimated effort: L.

## Context
### Original Request
- `migrate 100% codebase to tauri-v2`

### Key Decisions (from interview)
- Target is **macOS only**.
- Migration target is **packaged-app parity**, not dev-only parity.
- User explicitly chose a **literal big-bang rewrite** instead of staged releases.
- Existing behavior should be **largely preserved**, but internal cleanup, small UX polish, and storage/flow cleanup are allowed.
- Existing plain HTML/JS renderer may be **refactored gradually**, but the migration should not become a framework rewrite.
- Fresh-app cutover is acceptable: **new app identity** is allowed and **existing stored app data does not need compatibility migration**.
- API keys must still support **app storage + inherited environment + startup-shell fallback**.
- **Soniox remains required** for setup; **xAI becomes optional** in setup.

### Assumptions (evidence-based defaults applied — user did not explicitly decide)
- The Tauri frontend will continue to use the existing `ui/` directory as a **static frontend** via `frontendDist`, with `app.withGlobalTauri: true`, instead of adding Vite. This is officially supported and avoids unnecessary scope (`artifacts/libs/tauri-v2-vanilla-html-js_20.25_26-03-2026.md:8-28`, `:44-88`, `:183-198`).
- The microphone/STT pipeline will stay **renderer-side** using Web Audio + WebSocket because Tauri has no built-in microphone plugin and the current pipeline is already browser-native (`ui/stt.js:38-158`; `artifacts/libs/tauri-v2-electron-migration_19.48_26-03-2026.md:299-327`).
- `config.json` remains a bundled runtime resource and is not folded into source constants (`electron/main.js:40-45`; `config.json:1-20`; `artifacts/libs/tauri-v2-electron-migration_19.48_26-03-2026.md:235-295`).

## Objectives
### Must Have (exact deliverables)
- A macOS-only `src-tauri/` runtime that replaces `electron/` for app lifecycle, tray, windows, global shortcut, permissions, credential/config access, LLM correction, and text insertion.
- A preload-compatible `window.voiceEverywhere` bridge for the existing vanilla JS renderer.
- Migrated setup/settings flow with **Soniox required** and **xAI optional**.
- Migrated floating bar/STT flow that preserves renderer-side Soniox streaming, stop-word handling, and insertion behavior.
- Tauri bundle/install configuration with `Info.plist`, `Entitlements.plist`, icons, and installer checks suitable for packaged `/Applications` use.
- Electron runtime code and Electron-only packaging artifacts removed after the Tauri replacement is in place.
- Automated verification updated for Tauri (`node --test` + `cargo test`) plus explicit packaged-app manual smoke notes in the final packaging task report.

### Must NOT Have (explicit exclusions)
- No Windows, Linux, iOS, or Android expansion.
- No React/Vite/frontend framework migration unless a task proves the static frontend path impossible.
- No native audio capture rewrite.
- No Electron/Tauri coexistence runtime or compatibility shims kept “temporarily” after cutover.
- No backwards-compatibility work for the old bundle identity or Electron-stored app data.

### Definition of Done
- `src-tauri/` is the only runtime shell.
- `npm test` passes for JS/UI/install contract coverage.
- `cargo test --manifest-path src-tauri/Cargo.toml` passes for Rust-side services.
- The updated installer/build configuration describes a packaged Tauri `.app` with microphone and Apple Events usage strings plus required entitlements.
- Final packaged-app smoke checklist is documented and reported as passing from `/Applications`: tray click, global shortcut, setup/settings windows, Soniox-only onboarding, optional xAI correction, mic permission flow, accessibility-gated paste, and bundled config loading.
- `electron/` runtime files and obsolete Electron-only tests/build plists are removed.

## Execution Graph

### File Ownership Matrix
| File Path | Wave | Task | Action (create/modify/delete/rename/generate) | Merge Risk |
|-----------|------|------|-----------------------------------------------|------------|
| `package.json` | 1 | 01 | modify | — |
| `package-lock.json` | 1 | 01 | modify | — |
| `src-tauri/Cargo.toml` | 1 | 01 | create | ⚠️ modified again in Wave 4 |
| `src-tauri/build.rs` | 1 | 01 | create | — |
| `src-tauri/tauri.conf.json` | 1 | 01 | create | ⚠️ modified again in Wave 4 |
| `src-tauri/capabilities/default.json` | 1 | 01 | create | ⚠️ modified again in Wave 2 |
| `src-tauri/src/main.rs` | 1 | 01 | create | — |
| `src-tauri/src/lib.rs` | 1 | 01 | create | ⚠️ modified again in Wave 2 |
| `ui/tauri-bridge.js` | 2 | 02 | create | — |
| `tests/tauri-bridge.test.js` | 2 | 02 | create | — |
| `src-tauri/src/commands.rs` | 2 | 03 | create | — |
| `src-tauri/src/credentials.rs` | 2 | 03 | create | — |
| `src-tauri/src/llm_service.rs` | 2 | 03 | create | — |
| `src-tauri/src/permissions.rs` | 2 | 03 | create | — |
| `src-tauri/src/shell_credentials.rs` | 2 | 03 | create | — |
| `src-tauri/src/text_inserter.rs` | 2 | 03 | create | — |
| `src-tauri/src/lib.rs` | 2 | 03 | modify | ⚠️ after Wave 1 foundation |
| `src-tauri/capabilities/default.json` | 2 | 03 | modify | ⚠️ after Wave 1 foundation |
| `src-tauri/tests/native_services.rs` | 2 | 03 | create | — |
| `ui/index.html` | 3 | 04 | modify | — |
| `ui/setup.html` | 3 | 04 | modify | — |
| `ui/renderer.js` | 3 | 04 | modify | — |
| `ui/setup.js` | 3 | 04 | modify | — |
| `ui/styles.css` | 3 | 04 | modify | — |
| `tests/settings-renderer.test.js` | 3 | 04 | create | — |
| `tests/setup-flow.test.js` | 3 | 04 | create | — |
| `ui/bar.html` | 3 | 05 | modify | — |
| `ui/bar-renderer.js` | 3 | 05 | modify | — |
| `ui/stt.js` | 3 | 05 | modify | — |
| `tests/bar-renderer.test.js` | 3 | 05 | modify | — |
| `tests/stt-renderer.test.js` | 3 | 05 | create | — |
| `src-tauri/tauri.conf.json` | 4 | 06 | modify | ⚠️ after Wave 1 foundation |
| `src-tauri/Cargo.toml` | 4 | 06 | modify | ⚠️ after Wave 1 foundation |
| `src-tauri/Info.plist` | 4 | 06 | create | — |
| `src-tauri/Entitlements.plist` | 4 | 06 | create | — |
| `src-tauri/icons/icon.icns` | 4 | 06 | create | — |
| `src-tauri/icons/icon.ico` | 4 | 06 | create | — |
| `src-tauri/icons/icon.png` | 4 | 06 | create | — |
| `install.sh` | 4 | 06 | modify | — |
| `tests/package-build-config.test.js` | 4 | 06 | modify | — |
| `README.md` | 5 | 07 | modify | — |
| `build/entitlements.mac.plist` | 5 | 07 | delete | — |
| `build/entitlements.mac.inherit.plist` | 5 | 07 | delete | — |
| `electron/credentials.js` | 5 | 07 | delete | — |
| `electron/llm-service.js` | 5 | 07 | delete | — |
| `electron/macos-permissions.js` | 5 | 07 | delete | — |
| `electron/main.js` | 5 | 07 | delete | — |
| `electron/preload.js` | 5 | 07 | delete | — |
| `electron/shell-credentials.js` | 5 | 07 | delete | — |
| `electron/text-inserter.js` | 5 | 07 | delete | — |
| `tests/credential-test-helpers.js` | 5 | 07 | delete | — |
| `tests/credentials-fallback.test.js` | 5 | 07 | delete | — |
| `tests/credentials.test.js` | 5 | 07 | delete | — |
| `tests/llm-service.test.js` | 5 | 07 | delete | — |
| `tests/macos-permissions.test.js` | 5 | 07 | delete | — |
| `tests/shell-credentials.test.js` | 5 | 07 | delete | — |

### Wave Schedule
| Wave | Tasks (parallel) | Glue Task (sequential) | Depends On | Est. Complexity |
|------|------------------|------------------------|------------|-----------------|
| 1 | 01 | — | — | L |
| 2 | 02, 03 | — | 01 | L |
| 3 | 04, 05 | — | 02, 03 | L |
| 4 | 06 | — | 04, 05 | L |
| 5 | 07 | — | 06 | M |
| 6 | 08 (`clio`) | — | 07 | S |

### Dependency DAG
- **Critical path**: `01 → (02 + 03) → (04 + 05) → 06 → 07 → 08`
- No circular dependencies are allowed in this plan.

### Contract Dependencies
| Contract ID | Producer (Task) | Consumer (Tasks) | Signature (abbreviated) |
|-------------|-----------------|------------------|--------------------------|
| `C-01-tauri-foundation` | 01 | 02, 03, 06 | `src-tauri skeleton + Tauri deps/scripts + static ui frontend` |
| `C-01-shell-contract` | 01 | 02, 03 | `window labels {main,bar}; event toggle-mic; canonical command names` |
| `C-02-voice-everywhere-bridge` | 02 | 04, 05 | `window.voiceEverywhere.{setMicState,insertText,...}` |
| `C-03-native-command-surface` | 03 | 04, 05, 06 | `get_config/get_soniox_key/has_xai_key/save_credentials/.../insert_text` |
| `C-04-settings-flow` | 04 | 06 | `settings/setup pages boot via bridge; Soniox required, xAI optional` |
| `C-05-bar-flow` | 05 | 06 | `bar boots via bridge; renderer STT preserved; optional xAI branch` |
| `C-06-packaged-tauri-distribution` | 06 | 07 | `tauri bundle config + installer + package config regression checks` |

### Wave Prerequisites
| Wave | Task | Prerequisite | Verify Command |
|------|------|--------------|----------------|
| 4 | 06 | macOS icon tooling available for bundle icon generation | `command -v iconutil >/dev/null && command -v sips >/dev/null` |

### Task Index
> Grouped by wave. `clio` is the only row without a task card; its File column points at the brief by design.

#### Wave 1 (parallel)
| # | Task | File | Agent | Skills | Review | Acceptance | Status |
|---|------|------|-------|--------|--------|------------|--------|
| 01 | Establish macOS Tauri v2 foundation | [tasks/01-tauri-foundation.md](tasks/01-tauri-foundation.md) | titan | tauri-v2 | per-task | `cargo check --manifest-path src-tauri/Cargo.toml` | pending |

#### Wave 2 (depends on Wave 1)
| # | Task | File | Agent | Skills | Review | Acceptance | Status |
|---|------|------|-------|--------|--------|------------|--------|
| 02 | Create preload-compatible Tauri bridge | [tasks/02-tauri-bridge.md](tasks/02-tauri-bridge.md) | golem | tauri-v2 | per-task | `node --test tests/tauri-bridge.test.js` | pending |
| 03 | Port privileged macOS services into Tauri commands | [tasks/03-tauri-native-services.md](tasks/03-tauri-native-services.md) | titan | tauri-v2 | per-task | `cargo test --manifest-path src-tauri/Cargo.toml` | pending |

#### Wave 3 (depends on Wave 2)
| # | Task | File | Agent | Skills | Review | Acceptance | Status |
|---|------|------|-------|--------|--------|------------|--------|
| 04 | Migrate setup and settings flows to the Tauri bridge | [tasks/04-settings-setup-ui.md](tasks/04-settings-setup-ui.md) | venus | tauri-v2, web-best-practices | per-task | `node --test tests/settings-renderer.test.js tests/setup-flow.test.js` | pending |
| 05 | Migrate floating bar and STT pipeline to the Tauri bridge | [tasks/05-bar-stt-ui.md](tasks/05-bar-stt-ui.md) | venus | tauri-v2, web-best-practices | per-task | `node --test tests/bar-renderer.test.js tests/stt-renderer.test.js tests/stopword.test.js` | pending |

#### Wave 4 (depends on Wave 3)
| # | Task | File | Agent | Skills | Review | Acceptance | Status |
|---|------|------|-------|--------|--------|------------|--------|
| 06 | Finalize Tauri packaging, installer, and bundle verification | [tasks/06-packaging-installer.md](tasks/06-packaging-installer.md) | titan | tauri-v2 | per-task | `node --test tests/package-build-config.test.js && cargo test --manifest-path src-tauri/Cargo.toml` | pending |

#### Wave 5 (depends on Wave 4)
| # | Task | File | Agent | Skills | Review | Acceptance | Status |
|---|------|------|-------|--------|--------|------------|--------|
| 07 | Remove Electron runtime and obsolete Electron-only artifacts | [tasks/07-cleanup-electron.md](tasks/07-cleanup-electron.md) | golem | — | skip | `npm test && cargo test --manifest-path src-tauri/Cargo.toml` | pending |

#### Wave 6 (depends on Wave 5)
| # | Task | File | Agent | Skills | Review | Acceptance | Status |
|---|------|------|-------|--------|--------|------------|--------|
| 08 | Sync AGENTS memory after migration | [brief.md](brief.md) | clio | — | skip | `test -f AGENTS.md` | pending |

## Dispatch Protocol

> **For the orchestrator**: read this runbook only. Write `whiteboard.md` between waves. Never read task cards, brief, or source code except through the executor workflow below.

### Per-Wave Flow

```text
FOR each wave in Wave Schedule:
  1. PREFLIGHT — verify Wave Prerequisites from this runbook
  2. DISPATCH  — launch all tasks in the wave using the Task Index agent/skills
  3. VERIFY    — run each task's Acceptance command from the Task Index
  4. REVIEW    — dispatch Heimdall for rows with Review = per-task
  5. TRIAGE    — handle failures via Failure Handling
  6. UPDATE    — append downstream-relevant deltas to whiteboard.md
  7. NEXT      — continue only after every task in the wave is done
```

### Step 1: Dispatch

Use the Task Index row for agent selection and skills.

**Template — Wave 1**

> MUST: write tests FIRST — RED (verify fails for behavioral reason, not config/import) → GREEN → REFACTOR.
> NEVER weaken tests to pass — fix implementation instead.
> Read these files, then execute the task:
> 1. `./artifacts/plans/tauri-v2-migration/brief.md`
> 2. `./artifacts/plans/tauri-v2-migration/tasks/XX-{slug}.md`

**Template — Wave 2+**

> MUST: write tests FIRST — RED (verify fails for behavioral reason, not config/import) → GREEN → REFACTOR.
> NEVER weaken tests to pass — fix implementation instead.
> ⚠️ If whiteboard shows contract deviations or downstream constraints, use ACTUAL over planned.
> ⚠️ If whiteboard says `amend` or `escalate` for your dependency chain, stop and follow the runbook instead of implementing blindly.
> Read these files, then execute the task:
> 1. `./artifacts/plans/tauri-v2-migration/brief.md`
> 2. `./artifacts/plans/tauri-v2-migration/whiteboard.md`
> 3. `./artifacts/plans/tauri-v2-migration/tasks/XX-{slug}.md`

**clio dispatch**

> `./artifacts/plans/tauri-v2-migration/brief.md`

### Step 2: Verify

After each executor completes:
1. Run the Acceptance command from the Task Index.
2. If PASS, require the executor report to include: Actual outputs, Test evidence, Resolved review items, Contract amendments, New constraints or prerequisites, Deviations, Discoveries (with Recommendation + Rationale), Warnings, Downstream action, and Prerequisites confirmed.
3. If Contract amendments are reported, update `whiteboard.md` before dispatching any consumer tasks.
4. If Downstream action is `amend`, stop and amend the remaining plan.
5. If Downstream action is `escalate`, stop and report to the user.
6. Only mark `done` after review passes for `per-task` rows.

### Step 2.5: Review

For each row with `Review = per-task` and passing Acceptance:

> Review this task for spec compliance and code quality.
> 1. Read brief: `./artifacts/plans/tauri-v2-migration/brief.md`
> 2. Read task spec: `./artifacts/plans/tauri-v2-migration/tasks/XX-{slug}.md`
> 3. Review changed files (from File Ownership Matrix)
> Spec Compliance first, Code Quality second.

If Heimdall returns Critical/Important findings, re-dispatch the same executor session with the full finding table, re-run Acceptance, and re-review. Max 3 review cycles per task.

### Step 3: Failure Handling

| Failure Type | Signal | Action |
|--------------|--------|--------|
| **Crash** | Executor errors out with no usable output | Retry same session via `task_id` (max 2). If repeated, escalate to hades with crash context. |
| **Wrong output** | Acceptance fails | Re-dispatch same session with the specific failing acceptance output (max 2 retries). |
| **Plan defect** | File path wrong, contract impossible, or task assumptions contradicted by reality | Do not retry executor. Amend the plan before continuing. |
| **Review fail** | Heimdall reports unresolved Critical/Important items | Re-dispatch executor with full finding table, then re-run Acceptance and Heimdall. |
| **Review evidence missing** | Executor omitted resolved review traceability | Re-dispatch same session and request ID → files → verification mapping. |
| **Blocked** | Missing prerequisite or upstream contract | Mark blocked, resolve the upstream issue, then re-dispatch. |
| **Partial** | Some acceptance criteria pass, others fail | Re-dispatch same session for failing criteria only. |
| **Owns violation** | Executor changed files outside Owns | Revert unauthorized changes and re-dispatch with an explicit file-boundary warning. |
| **Environment failure** | Missing tooling/service distinct from task logic | Verify Wave Prerequisites. If the plan missed one, treat as plan defect. |

**Cascade rule**: if a task ultimately fails, block every consumer in the Contract Dependencies table and report the blocked chain to the user.

### Step 4: Update Whiteboard

After all tasks in a wave are verified:
1. Extract from executor reports only the whiteboard-relevant fields: Actual outputs, Contract amendments, New constraints or prerequisites, Deviations, Discoveries, Warnings, Downstream action.
2. Resolve any conflicting discoveries before writing.
3. Append only downstream-impacting deltas to `whiteboard.md`.
4. If a finding becomes stable and cross-cutting, promote it into `brief.md` during plan amendment instead of overloading the whiteboard.

### Plan Amendment (after partial execution)

When the plan needs changes after one or more waves:
1. Keep completed waves and whiteboard history intact.
2. Re-invoke the planner with `brief.md`, `whiteboard.md`, and the change description.
3. Planner outputs remaining waves only, numbered after the last completed task.
4. Update `runbook.md` and append any new task cards.

## Verification Strategy
- Default workflow for behavior-changing tasks: **TDD (Red → Green → Refactor)**.
- JS/UI tasks keep using `node --test` and renderer-style tests under `tests/`.
- Rust backend tasks add `cargo test --manifest-path src-tauri/Cargo.toml` coverage.
- Cleanup-only tasks do not add new tests; they must pass the full JS + Rust suites after removals.
- Final packaged-app parity is partly manual because TCC, global shortcut, and `/Applications` behavior are not fully automatable inside the shared environment. Those manual checks must be called out explicitly in Task 06’s report.

## Risks
- **User-chosen big-bang strategy**: this intentionally accepts higher integration risk than the safer staged-cutover recommendation from oracle.
- **Floating bar parity**: Tauri documents most required window APIs, but truly non-focusable overlay behavior remains platform-sensitive (`artifacts/libs/tauri-v2-electron-migration_19.48_26-03-2026.md:150-157`, `:411-424`).
- **TCC/manual verification**: microphone, Apple Events, and packaged `/Applications` behavior require packaged-app smoke validation beyond automated tests.
- **Fresh-app cutover**: new identity means users may need to re-grant permissions and re-enter stored keys even though env/startup-shell fallback remains supported.
- **Static frontend discipline**: if executors import bundler-only npm APIs directly into `ui/` scripts instead of using `withGlobalTauri` through the bridge, scope will expand unnecessarily.

## Commit Strategy
- Commit 1: Tauri foundation + dependency/scripts migration.
- Commit 2: Bridge + native Rust services.
- Commit 3: Setup/settings UI + bar/STT UI.
- Commit 4: Packaging, installer, plist/entitlements, bundle verification.
- Commit 5: Electron removal + docs cleanup.

## Success Criteria
- `npm test` passes.
- `cargo test --manifest-path src-tauri/Cargo.toml` passes.
- `electron/` runtime no longer exists in the shipped code path.
- Updated `install.sh` and `tests/package-build-config.test.js` validate a Tauri bundle layout, `src-tauri/Info.plist`, and `src-tauri/Entitlements.plist`.
- Manual packaged-app smoke (reported by Task 06) confirms: tray icon, global shortcut, Soniox-only setup, optional xAI correction, mic permission handling, accessibility-gated paste, and bundled `config.json` loading from `/Applications`.
