# Task 05: Harden HUD session orchestration and STT pipeline

- **Agent**: titan
- **Skills**: arch-best-practices
- **Wave**: 1
- **Complexity**: L

## Owns
- `ui/src/bar-session-controller.ts` (modify)
- `ui/src/bar-state-machine.ts` (modify)
- `ui/src/soniox-client.ts` (modify)
- `ui/src/stop-word.ts` (modify)
- `ui/src/pcm-capture-processor.js` (modify)
- `ui/src/__tests__/logic.test.ts` (modify)
- `ui/src/__tests__/bar-session-controller.test.ts` (create)

## Entry References
- `ui/src/bar-session-controller.ts:69` — config load and toggle subscription
- `ui/src/bar-session-controller.ts:115` — overlay interaction lifecycle
- `ui/src/bar-session-controller.ts:179` — startup/session happy path
- `ui/src/bar-session-controller.ts:282` — stream recovery path
- `ui/src/soniox-client.ts:79` — audio capture/worklet/websocket lifecycle

## Exemplar
- `ui/src/bar-state-machine.ts` + `ui/src/__tests__/logic.test.ts` — pure transition logic with explicit regression coverage is the pattern to preserve while refactoring the side-effectful controller/client layer

## Produces
- `C-05-bar-controller-view-contract`:
  - Signature: `BarSessionController { init(): Promise<void>, destroy(): void, getAnalyserNode(): AnalyserNode | null, getCurrentState(): BarState, getOverlayMode(): OverlayMode, handleToggle(): Promise<void>, handleClose(): Promise<void>, onStateChange?, onTranscriptChange?, onOverlayModeChange?, onErrorMessageChange? }`
  - Behavior: controller owns timers, bridge calls, audio/client lifecycle, and recovery policy; state-machine transitions remain pure; transcript flow stays `LISTENING → PROCESSING → INSERTING → SUCCESS|ERROR`; overlay mode remains explicit app state, not DOM inference.
  - Validate: `npx tsc -p ui/tsconfig.json --noEmit && npm run test:ui` passes with controller-focused regression coverage.

## Consumes
- `None`

## Tests
- **Skip reason**: None

## Steps
1. Audit the owned controller/client/state-machine/worklet files for SRP drift, cleanup leaks, brittle retry logic, protocol ambiguity, and hidden coupling between pure and side-effectful layers.
2. Refactor so the controller remains the orchestration owner, the state machine stays pure, and the Soniox client stays a transport adapter instead of accumulating policy.
3. Tighten recovery, transcript-reset, stop-word, and audio/websocket lifecycle behavior without changing shared bridge/types files; if a public contract change is truly required, capture the exact actual contract in your Report for Task 06/07.
4. Add or expand Vitest coverage for controller lifecycle, recovery/error paths, transcript reset behavior, Soniox parsing/resource cleanup, and any new pure logic extracted during the refactor.

## Failure Modes
- **If the clean fix tries to push DOM or bridge details into pure modules**: stop and split responsibilities instead of collapsing boundaries.
- **If audio/websocket cleanup cannot be fully proven in jsdom**: cover deterministic state/contract behavior with tests and flag remaining runtime checks for Task 08.
- **If the public controller/view callback surface must change**: document the actual contract in Report so Task 06 and Task 07 consume the real shape instead of the planned one.

## Guardrails
- Keep `ui/src/bar-state-machine.ts` pure and side-effect free.
- Do not move orchestration back into `ui/src/bar.ts` or raw bridge calls into render code.
- Do not weaken or delete existing logic regressions; extend them.

## Acceptance
- `npx tsc -p ui/tsconfig.json --noEmit`
- `npm run test:ui`

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
