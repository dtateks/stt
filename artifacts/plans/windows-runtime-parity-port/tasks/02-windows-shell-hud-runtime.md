# Task 02: Implement Windows shell/HUD/tray runtime

- **Agent**: hades
- **Skills**: tauri-v2
- **Wave**: 2
- **Complexity**: L

## Owns
> Files this task exclusively modifies — verified workspace-relative paths, no overlap in wave.
> Task-local dependencies must be inlined in this card. References to other tasks may describe coordination edges, but must never be required reading for execution.
- `src/src/windows_app_shell.rs` (modify)
- `src/tests/windows_shell_runtime.rs` (create)

## Prerequisites
> Runtime requirements beyond code — what must be true BEFORE this task runs.
- Interactive Windows VM/PC is available for fullscreen HUD and tray recovery spot-checks.

## Entry References
> 2-5 starting points — ALL VERIFIED via tools.
- `src/src/lib.rs:318` — current `show_bar` path preserves configure → position → show → order-front sequencing
- `src/src/lib.rs:457` — current whole-window mouse-event passthrough model (passive vs interactive)
- `src/src/lib.rs:509` — current monitor-aware bottom-center positioning math
- `src/src/lib.rs:702` — plugin/setup/runtime-event entrypoint that task 01 will route through the app-shell port
- `src/tests/window_shell.rs:78` — config/runtime invariants already locked in tests and must remain meaningful after Windows support lands

## Exemplar
> Similar implementation in codebase to copy pattern from — verified path.
- `src/src/lib.rs` — use the existing hidden-build → position → show sequencing as the Windows shell exemplar rather than inventing a second lifecycle

## Research Notes
- **Windows HUD baseline**: use a transparent, always-on-top HUD with whole-window passive/interactive toggling; keep acrylic/blur out of the phase-1 critical path. (source: muninn artifact `artifacts/researches/windows-porting-strategy_09.03_30-03-2026.md`, lines 39-59)
- **Fullscreen expectation**: target the closest safe Windows behavior above fullscreen apps; do not assume macOS NSPanel semantics are portable. (source: muninn artifact `artifacts/researches/windows-porting-strategy_09.03_30-03-2026.md`, lines 39-59; local artifact `artifacts/libs/tauri-v2-transparent-window_20.04_27-03-2026.md`)
- **Background recovery**: Windows should use a tray-assisted background model, not a hidden-only dockless clone. (source: user interview + oracle recommendation)

## Produces
- `C-02-windows-shell-behavior`:
  - Signature: `WindowsAppShell implements C-01-app-shell-port`
  - Behavior: supports tray-assisted background recovery, non-focus-stealing bar show, whole-window passive/interactive mouse toggling, autostart wiring on Windows, and the closest safe fullscreen-capable HUD behavior the Windows shell allows.
  - Validate: Windows shell tests pass and Windows VM spot-checks demonstrate tray recovery + fullscreen HUD visibility.

## Consumes
- `C-01-app-shell-port` from Task 01:
  - Signature: `platform_app_shell::{build_main_window(app), build_bar_window(app), show_bar(app, &WebviewWindow), hide_bar(app), set_bar_mouse_events(app, ignore), show_settings(&WebviewWindow), handle_runtime_event(app, event)}`
  - Behavior: provides the stable shell boundary this task must implement for Windows without reopening `lib.rs`.

## Tests
> BECAUSE test-FIRST ordering prevents "implementation without tests" drift, MUST follow RED (verify fails for behavioral reason, not config/import) → GREEN → REFACTOR.
> BECAUSE AI RLHF bias makes "weaken test to pass" the path of least resistance, NEVER modify tests to match buggy output — fix implementation instead.
- **Skip reason**: None

## Steps
1. Start with failing task-local tests in `src/tests/windows_shell_runtime.rs` for tray recovery, runtime-event sequencing, and fullscreen/monitor placement expectations that can be asserted without rewriting shared tests yet.
2. Fill in `src/src/windows_app_shell.rs` so the `C-01-app-shell-port` boundary provides a real Windows implementation for show/hide/settings/runtime-event handling while preserving the existing hidden-build → position → show discipline.
3. Deliver the confirmed Windows UX model: tray-assisted background recovery, non-focus-stealing HUD show, and the current whole-window passive/interactive mouse toggle. Keep the implementation Windows-native; do not attempt to emulate NSPanel APIs.
4. Use the shared `windows` crate only where stock Tauri shell behavior cannot satisfy fullscreen visibility or focus rules. If Windows cannot safely match a macOS behavior, choose the cleanest conservative implementation and report the exact limitation rather than hacking around it.
5. Run automated tests and `npm run build`, then perform the required Windows VM spot-checks for fullscreen visibility, tray restore, and shortcut-driven HUD show.

## Failure Modes
- **If fullscreen coverage still fails on Windows after a clean implementation attempt**: capture the exact failing shell case, keep the best safe always-on-top behavior, and report `amend` instead of adding unsupported overlay hacks.
- **If tray restore steals focus or creates duplicate windows**: preserve the single hidden-window model and fix the runtime-event/tray sequencing before claiming success.
- **If HUD buttons become unreachable because of click-through**: keep the whole-window passive/interactive toggle model; do not add per-control hit-testing workarounds in this task.

## Guardrails
- No NSPanel/Cocoa emulation or macOS private-API assumptions on Windows.
- Do not make acrylic/blur or release/distribution work a dependency of runtime parity.
- No focus-stealing show path; preserve the current UX expectation that the destination app remains active unless the user explicitly opens settings.

## Acceptance
> Command + expected output — automation-first.
> Commands MUST be non-destructive, idempotent, side-effect-free (read-only checks, test runs — never mutations).
> If manual verification needed: mark with reason + what to check.
- `cargo test --manifest-path src/Cargo.toml windows_shell_runtime && npm run build`
- Manual (Windows VM/PC): verify HUD appears above a fullscreen app as closely as Windows allows, tray restore reopens the app predictably, and global shortcut → HUD show does not steal focus.

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
