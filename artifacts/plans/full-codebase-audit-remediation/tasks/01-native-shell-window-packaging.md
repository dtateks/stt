# Task 01: Harden native shell, window, capability, and packaging boundaries

- **Agent**: titan
- **Skills**: tauri-v2, arch-best-practices
- **Wave**: 1
- **Complexity**: L

## Owns
- `src/src/lib.rs` (modify)
- `src/tauri.conf.json` (modify)
- `src/capabilities/default.json` (modify)
- `src/Cargo.toml` (modify)
- `src/Entitlements.plist` (modify)
- `src/Info.plist` (modify)
- `src/tests/window_shell.rs` (create)

## Entry References
- `src/src/lib.rs:35` — shared window config lookup and bar constants
- `src/src/lib.rs:73` — macOS bar-window configuration path
- `src/src/lib.rs:185` — main/bar window construction and close-hide behavior
- `src/src/lib.rs:242` — global shortcut registration and event emission
- `src/tauri.conf.json:12` — window/security/bundle config for shipped app

## Exemplar
- `src/src/lib.rs` — current split between bootstrap, window creation, tray/shortcut setup, and macOS-specific helpers is the in-repo pattern to preserve while cleaning architecture

## Produces
- `C-01-window-runtime-invariants`:
  - Signature: `WindowRuntimeInvariants = { mainClose: "hide", barStartHidden: true, barShowOrder: ["configure", "position", "show", "front"], barDefaultIgnoreCursorEvents: true, bundleSettings: { macOSPrivateApi: boolean, entitlementsPath: string, infoPlistUsageDescriptions: string[] }, capabilityScope: { windows: string[], permissions: string[] } }`
  - Behavior: Native shell and packaged config expose one coherent source of truth for window lifecycle, capability scope, and macOS bundle requirements; packaged/runtime-specific constraints are explicit instead of implied.
  - Validate: `cargo test --manifest-path src/Cargo.toml` passes with new window-shell coverage, and JSON/plist config remains syntactically valid.

## Consumes
- `None`

## Tests
- **Skip reason**: None

## Steps
1. Audit `src/src/lib.rs`, `src/tauri.conf.json`, `src/capabilities/default.json`, `src/Cargo.toml`, `src/Entitlements.plist`, and `src/Info.plist` for boundary drift, duplicated window policy, over-broad capability scope, dead packaging config, and Tauri v2/security mismatches.
2. Refactor owned files so native bootstrap is easier to reason about: keep the bar hidden at boot, keep configure/position-before-show invariant intact, keep main-window close→hide behavior intact, and make any macOS packaging assumptions explicit and centralized.
3. Tighten capability and packaging configuration only as far as proven safe for the current macOS shipped path; if a change would require editing `src/src/commands.rs` or `ui/tauri-bridge.js`, report the required contract change for Task 07 instead of touching shared boundary files.
4. Add focused Rust coverage in `src/tests/window_shell.rs` for window/runtime invariants, config expectations, and any regression-prone macOS helper behavior introduced by the refactor.

## Failure Modes
- **If runtime safety depends on changing shared command/bridge files**: stop at the owned-file boundary, record the required change in Report, and set Recommendation for Task 07 rather than violating Owns.
- **If capability tightening breaks a currently required flow**: keep the smallest verified permission set that preserves the flow, document the rejected narrower option, and avoid broad fallback grants.
- **If packaged-only behavior cannot be proven statically**: lock the invariant with tests where possible and explicitly surface the remaining packaged-build check for Task 08.

## Guardrails
- Do not weaken the bar show-order invariant or reintroduce hover-driven passthrough behavior.
- Do not broaden permissions/capabilities just to make the task easier; least privilege wins.
- Do not add mobile/cross-platform work — this task is macOS shipped-path only.

## Acceptance
- `python -m json.tool src/tauri.conf.json >/dev/null`
- `python -m json.tool src/capabilities/default.json >/dev/null`
- `cargo test --manifest-path src/Cargo.toml`

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
