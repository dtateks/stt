# Whiteboard — HUD Browser Helper Heat Remediation

> Updated by orchestrator between waves. Executors read, never write directly.
> Contains ONLY actual findings from completed tasks that change downstream work — not planned, not stable shared context.

## Contract Deviations (cumulative — orchestrator maintains)
| Contract ID | Planned Signature | Actual Signature | Reason | Affected Consumers |
|-------------|------------------|------------------|--------|--------------------|
| _None yet_ | — | — | No waves completed yet | — |

## After Wave 1

### Task 01 (venus) — HUD render budget
- **Actual outputs**: `ui/src/bar-render.ts`, `ui/src/bar.ts`, `ui/src/__tests__/bar-ui.test.ts`
- **Contract amendments**: `waveformShouldRun` narrowed from 8→3 states (audio-active only). New `waveformShouldBeVisible(state !== "HIDDEN")` export added.
- **New constraints**: `waveformShouldRun === true` no longer implies HUD visibility — use `waveformShouldBeVisible` for that check.
- **Deviations**: None — fully invisible fix (no waveform fallback needed).
- **Discoveries**:
  - `drawHeartbeatTrace` still creates new `Path2D` per frame during audio-active states (micro-op, not primary heat source).
  - `smoothedEnergy` not reset when audio stops/starts — visual imperfection, not thermal issue.
- **Warnings**: Downstream code using `waveformShouldRun` as visibility proxy must switch to `waveformShouldBeVisible`.
- **Downstream action**: continue

### Task 02 (golem) — Session/audio lifecycle
- **Actual outputs**: `ui/src/soniox-client.ts`, `ui/src/bar-session-controller.ts`, `ui/src/__tests__/bar-session-controller.test.ts`
- **Contract amendments**: None
- **New constraints**: `startAudioPipeline`, `stopAudioPipeline`, `SonioxClient.start` remain CRITICAL-risk — preserve visible-session contract when editing.
- **Deviations**: None
- **Discoveries**:
  - Two-tier Soniox lifecycle works: "stop streaming, preserve graph" for visible-session paths; "full stop, release graph" only for true session boundaries.
  - Future tests should assert `stopStreamingSession` vs `stop` separately — counting only `start` calls is no longer sufficient.
  - GitNexus global change detection unreliable when workspace is already dirty.
- **Warnings**: Critical-risk lifecycle methods touched — regression-test all visible-session paths if edited.
- **Downstream action**: continue

### Task 03 (hades) — macOS HUD runtime hardening
- **Actual outputs**: `src/tauri.conf.json`, `src/src/lib.rs`, `src/tests/window_shell.rs`
- **Contract amendments**: New `run_macos_bar_runtime_configuration_sequence(...)` runtime seam added. `resizable: false` → `resizable: true` with fixed-size min/max constraints.
- **New constraints**: Bar config must keep `resizable: true` + `min/max` pinned to 600×56 — this preserves fixed-size UX while avoiding non-resizable builder path.
- **Deviations**: None
- **Discoveries**:
  - Safe fix requires config + runtime reassertion (not config alone).
  - Working tree already had unrelated modified UI files (`bar.ts`, `bar-render.ts`, `bar-ui.test.ts`) — affects change-scope attribution.
- **Warnings**: Pre-existing dirty working-tree state; validate per-task scope locally, not via global GitNexus.
- **Downstream action**: continue

## Contract Deviations (cumulative)
| Contract ID | Planned Signature | Actual Signature | Reason | Affected Consumers |
|-------------|------------------|------------------|--------|--------------------|
| `waveformShouldRun` | true for 8 visible states | true for 3 audio-active states | Thermal bug fix — "every visible state animates" was the bug | UI code using as visibility proxy |
| `waveformShouldBeVisible` | N/A (new) | true when state !== "HIDDEN" | Additive export for visibility checks | None (new) |
| `resizable` (bar config) | false | true with min/max lock | Avoid non-resizable builder path CPU risk | None (internal config) |
