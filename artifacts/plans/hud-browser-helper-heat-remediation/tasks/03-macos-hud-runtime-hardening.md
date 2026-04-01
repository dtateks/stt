# Task 03: Harden the macOS HUD window/runtime path without changing the fixed-size polished HUD contract

- **Agent**: hades
- **Skills**: tauri-v2
- **Wave**: 1
- **Complexity**: L

## Owns
- `src/tauri.conf.json` (modify)
- `src/src/lib.rs` (modify)
- `src/tests/window_shell.rs` (modify)

## Entry References
- `src/tauri.conf.json:28-47` — current bar window config (`decorations`, `resizable`, `transparent`, `alwaysOnTop`, `visibleOnAllWorkspaces`)
- `src/src/lib.rs:342-365` — current macOS show-bar runtime sequence
- `src/src/lib.rs:471-500` — NSPanel and WKWebView transparency configuration
- `src/tests/window_shell.rs:218-299` — current tauri-config runtime invariants test
- `src/tests/window_shell.rs:435-461` — show-order invariant test protecting configure → position → show → front

## Exemplar
- `src/src/windows_app_shell.rs:13-33` — platform-shell wrappers stay thin while preserving shared show/hide contract
- `src/tests/window_shell.rs:435-461` — runtime-invariant test style to preserve explicit ordering and contract checks when the macOS path changes

## Research Notes
- **Conflicting upstream evidence**: `tauri#11308` reports excessive CPU on macOS with `resizable(false)`; `tao#1191` reports excessive CPU on macOS 15 for borderless + resizable windows. This task must not blindly trade one known-bad configuration for another. Resolve the conflict against this repo’s actual Tauri/tao/NSPanel path and preserve fixed-size UX. (source: `artifacts/libs/wkwebview-hud-cpu-second-pass_00.01_02-04-2026.md`, direct dependency versions in `package.json:19-31`)
- **Visible transparent overlay windows stay on the compositor path**: Browser Helper pressure will remain if the runtime path keeps a hostile transparent overlay configuration even after frontend render fixes, so this task must target the macOS runtime/config root cause rather than cosmetic workarounds. (source: `artifacts/libs/wkwebview-hud-cpu-second-pass_00.01_02-04-2026.md`)

## Produces
- None

## Consumes
- None

## Tests
- **Skip reason**: None
- **Build evidence**: run `npm run build` after the targeted Rust tests pass and include the result in the final report.

## Steps
1. Eliminate the known-bad macOS HUD window/runtime combination while preserving the user-visible HUD contract: fixed-size appearance, transparency, always-on-top overlay behavior, fullscreen support, and non-focus-stealing show behavior.
2. Treat the `resizable` question as conflicting evidence, not a one-line fix. Choose the safest configuration/runtime adjustment for this repo’s actual macOS path instead of blindly flipping `resizable` and hoping upstream conflicts do not apply.
3. Keep the existing show-order and transparency invariants unless changing one of them is required for the CPU fix. If an invariant must change, update `src/tests/window_shell.rs` to document the new explicit runtime contract rather than silently weakening coverage.
4. Add or update Rust invariants that lock the chosen macOS HUD runtime contract and prove the fix path remains least-privilege, transparent, and correctly ordered.
5. Run the targeted cargo tests, then `npm run build`, and report exactly which macOS runtime/config invariant changed and why it is the safest UX-preserving fix.

## Failure Modes
- **If no safe macOS config/runtime change preserves both the fixed-size HUD contract and the CPU fix**: stop and escalate with the measured tradeoff instead of shipping a speculative AppKit workaround.
- **If a `tauri.conf.json`-only fix is insufficient**: move the fix into the explicit macOS runtime/panel configuration in `lib.rs`; do not pile on undocumented window flags or suppressions.
- **If the chosen macOS fix changes runtime invariants**: update the Rust invariant tests to the new explicit contract and explain the change in the report; do not leave the contract implicit.

## Guardrails
- Do not remove transparency, always-on-top/fullscreen overlay behavior, or the fixed-size polished HUD contract without an explicit amend/escalate decision.
- Do not ship speculative macOS-native hacks or suppressions without targeted Rust test evidence.
- Do not weaken invariant tests to preserve a broken runtime configuration.

## Acceptance
- `cargo test --manifest-path src/Cargo.toml tauri_config_keeps_window_and_packaging_runtime_invariants && cargo test --manifest-path src/Cargo.toml runtime_invariant_keeps_bar_show_order_configure_position_show_front`
- Expected: targeted Rust runtime/config invariant tests pass.

## Report (include in your final response to orchestrator)
- **Actual outputs**: files created/modified with paths
- **Test evidence**: exact test command(s) executed + PASS/FAIL summary + scope, plus `npm run build` result
- **Resolved review items**: for each fixed `CRIT-*`/`IMP-*` issue from Heimdall, provide `ID → changed files → verification command/result` (or `None`)
- **Contract amendments**: if Produces signatures changed from planned → actual signature + reason + classification (bug-fix or plan-correction) (or "None")
- **New constraints or prerequisites**: newly discovered downstream-affecting constraints/prereqs, or `None`
- **Deviations**: other differences from planned behavior (or "None")
- **Discoveries**: patterns found, gotchas, unexpected behavior affecting other tasks — include **Recommendation** (what downstream should do) + **Rationale** (why)
- **Warnings**: anything downstream tasks should know
- **Downstream action**: `continue` | `amend` | `escalate` — with short reason
- **Prerequisites confirmed**: runtime prerequisites that were verified during execution
