# Task 01: Reduce HUD render/compositor load while preserving current HUD UX

- **Agent**: venus
- **Skills**: web-best-practices
- **Wave**: 1
- **Complexity**: M

## Owns
- `ui/src/bar.ts` (modify)
- `ui/src/bar-render.ts` (modify)
- `ui/src/__tests__/bar-ui.test.ts` (modify)

## Entry References
- `ui/src/bar.ts:169-214` — waveform start/stop loop and per-frame draw entry point
- `ui/src/bar.ts:216-294` — per-frame `Path2D`, gradient, and stroke work
- `ui/src/bar.ts:361-384` — current state-change hook starts waveform for every non-hidden state
- `ui/src/bar-render.ts:302-333` — waveform layout / point generation helpers and allocation shape
- `ui/src/bar-render.ts:486-488` — current `waveformShouldRun` predicate

## Exemplar
- `ui/src/bar.ts:146-167` — existing cache/reuse pattern for waveform layout and analyser sample buffer; extend this reuse-first pattern instead of adding new per-frame allocation
- `ui/src/__tests__/bar-ui.test.ts:649-738` — existing regression pattern that locks waveform runtime policy and RAF lifecycle without mirroring production code

## Research Notes
- **Visible WKWebView windows do not get useful background throttling**: a visible overlay HUD keeps WebKit’s Browser Helper on the rendering path, so the fix must remove real visible-state work rather than rely on hidden/offscreen heuristics (source: `artifacts/libs/wkwebview-hud-cpu-second-pass_00.01_02-04-2026.md`)
- **Canvas work maps to Browser Helper/GPU pressure**: per-frame `Path2D`/gradient allocation plus continuous stroke work is a thermal bug in this context, not harmless polish (source: `artifacts/libs/wkwebview-hud-cpu-ram-spike_23.41_01-04-2026.md`)

## Produces
- None

## Consumes
- None

## Tests
- **Skip reason**: None
- **Build evidence**: run `npm run build` after the targeted UI tests pass and include the result in the final report; build evidence is mandatory for this repo but is executor evidence, not the orchestrator acceptance command.

## Steps
1. Keep the HUD visually polished and behaviorally identical for transcript, controls, state labels, placement, and visibility timing, but remove wasted render work from the waveform path. Start by ensuring visible non-listening states are not paying the same continuous render cost as active listening unless the work is actually needed to preserve the existing UX.
2. Remove avoidable per-frame work in `ui/src/bar.ts` / `ui/src/bar-render.ts`: extend existing reuse/caching patterns, avoid rebuilding canvas resources that can be retained, and keep the waveform path cheap when audio energy is absent or unchanged.
3. Update `ui/src/__tests__/bar-ui.test.ts` so the new runtime policy is locked by regression tests. Tests must prove the old hot-path behavior is no longer required while preserving the intended HUD UX contract.
4. If invisible fixes alone are insufficient, apply only the user-approved fallback: minor adaptive waveform tuning limited to waveform motion/detail outside active speech. If this fallback is used, state exactly what changed and why in the report.
5. Run the targeted UI test command, then `npm run build`, and report whether the final implementation stayed fully invisible or required the minor waveform-only fallback.

## Failure Modes
- **If existing tests encode the old “every visible state animates” implementation detail**: update the tests to lock the preserved UX contract and the new thermal-safe runtime policy; do not preserve hot behavior just to satisfy stale tests.
- **If render-budget fixes appear to require transcript/control UX changes**: stop before changing transcript flow, controls, placement, or transparency; only waveform-only adaptive tuning is allowed without amendment.

## Guardrails
- Do not change transcript semantics, HUD controls, placement, visibility timing, or overall polished visual design.
- Do not hide the HUD during processing/inserting or remove transparency/always-on-top behavior as a render shortcut.
- Do not use hacks (`setTimeout` masking, disabled tests, fake static canvas) that only hide the symptom.

## Acceptance
- `npx vitest run ui/src/__tests__/bar-ui.test.ts`
- Expected: all targeted HUD render/runtime regression tests pass.

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
