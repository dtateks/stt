# Task 02: Remove repeated session/audio churn without changing the HUD’s listening UX

- **Agent**: golem
- **Skills**: —
- **Wave**: 1
- **Complexity**: M

## Owns
- `ui/src/bar-session-controller.ts` (modify)
- `ui/src/soniox-client.ts` (modify)
- `ui/src/__tests__/bar-session-controller.test.ts` (modify)

## Entry References
- `ui/src/bar-session-controller.ts:414-431` — current start/stop audio pipeline wiring
- `ui/src/bar-session-controller.ts:551-705` — stop-word finalization, insert, and restart-listening loop
- `ui/src/soniox-client.ts:62-80` — `start()` / `stop()` lifecycle boundary
- `ui/src/soniox-client.ts:124-159` — current `AudioContext` / analyser / worklet initialization
- `ui/src/soniox-client.ts:300-336` — WebSocket close and audio resource release path

## Exemplar
- `ui/src/bar-session-controller.ts:887-989` — existing temporary-key cache and single-refresh-promise pattern; follow this “reuse before rebuild, dedupe concurrent work, clear timers explicitly” lifecycle style
- `ui/src/bar-session-controller.ts:121-136` and `ui/src/bar-session-controller.ts:157-162` — explicit event-listener registration/cleanup pattern to preserve for any new lifecycle hooks

## Research Notes
- **Audio resource churn is a secondary but real pressure source**: repeated teardown/rebuild of `AudioContext`, analyser, worklet, and WebSocket increases native-resource churn even when cleanup exists. Prefer reuse within a visible HUD session or a deterministic one-graph-per-session teardown barrier over rebuilding per utterance. (source: `artifacts/libs/wkwebview-hud-cpu-ram-spike_23.41_01-04-2026.md`)

## Produces
- None

## Consumes
- None

## Tests
- **Skip reason**: None
- **Build evidence**: run `npm run build` after the targeted UI tests pass and include the result in the final report.

## Steps
1. Keep the current user-visible session contract — same toggle flow, same HUD visibility, same transcript finalization/insertion behavior — but eliminate unnecessary heavy-resource churn across stop-word finalization, pause/resume, clear, and stream-restart paths.
2. Rework `bar-session-controller.ts` and `soniox-client.ts` so the app either reuses the heavy audio graph/resources across a visible session or enforces a single deterministic teardown barrier instead of repeatedly thrashing those resources per utterance.
3. Preserve stale-callback protection (`startAttemptId`, `transcriptGeneration`) and existing error/state transitions while changing the lifecycle internals. This is a bug fix, not a UX rewrite.
4. Update `ui/src/__tests__/bar-session-controller.test.ts` to lock the new lifecycle behavior, especially around restart-after-insert, clear, stop-word finalization, and cleanup ordering.
5. Run the targeted UI test command, then `npm run build`, and report the exact lifecycle change that removed the churn.

## Failure Modes
- **If full graph reuse is unsafe with current WebAudio / Soniox semantics**: keep the user-visible contract unchanged and implement a deterministic teardown barrier that limits rebuild frequency to session boundaries rather than utterance boundaries.
- **If stale transcript or restart callbacks reappear after lifecycle changes**: strengthen the existing invalidation guards and prove the fix with regression tests before finishing.

## Guardrails
- Do not change stop-word behavior, insert behavior, pause/resume UX, or HUD visibility semantics.
- Do not weaken lifecycle tests to make churn appear acceptable.
- Do not add speculative caching that can leak credentials, transcript data, or stale audio state across sessions.

## Acceptance
- `npx vitest run ui/src/__tests__/bar-session-controller.test.ts`
- Expected: all targeted controller/session lifecycle regression tests pass.

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
