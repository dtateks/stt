# Task 06: Harden HUD shell rendering, accessibility, and visual tokens

- **Agent**: venus
- **Skills**: web-best-practices
- **Wave**: 2
- **Complexity**: M

## Owns
- `ui/bar.html` (modify)
- `ui/src/bar.ts` (modify)
- `ui/src/bar.css` (modify)
- `ui/src/tokens.css` (modify)
- `ui/src/__tests__/bar-ui.test.ts` (create)

## Entry References
- `ui/bar.html:39` — HUD live region, transcript content, and action controls shell
- `ui/src/bar.ts:40` — render-state entrypoint and transcript/prompt sync
- `ui/src/bar.ts:95` — waveform RAF lifecycle
- `ui/src/bar.ts:238` — canvas resize / DPR handling
- `ui/src/bar.css:27` — HUD shell visual contract and state-driven styling

## Exemplar
- `ui/src/bar.ts` — current render-only structure (DOM refs + render functions + controller callbacks) is the pattern to keep while fixing UI/a11y/perf defects

## Produces
- `C-06-hud-view-contract`:
  - Signature: `HudViewContract = { #hud[data-state][data-overlay], applyState(state), applyTranscript(result), applyErrorMessage(message), applyOverlayMode(mode), resizeCanvas(): void }`
  - Behavior: HUD shell remains render-only; state and overlay are reflected through DOM/data attributes; controls remain accessible when interactive; waveform animation starts/stops deterministically; token/focus/contrast choices remain explicit and shared.
  - Validate: `npx tsc -p ui/tsconfig.json --noEmit && npm run test:ui` passes with new HUD-shell coverage.

## Consumes
- `C-05-bar-controller-view-contract` from Task 05:
  - Signature: `BarSessionController { init(): Promise<void>, destroy(): void, getAnalyserNode(): AnalyserNode | null, getCurrentState(): BarState, getOverlayMode(): OverlayMode, handleToggle(): Promise<void>, handleClose(): Promise<void>, onStateChange?, onTranscriptChange?, onOverlayModeChange?, onErrorMessageChange? }`
  - Behavior: controller remains the sole owner of runtime/session lifecycle; view layer consumes callbacks and getters only.

## Tests
- **Skip reason**: None

## Steps
1. Read Task 05’s actual contract from `whiteboard.md`, then audit `ui/bar.html`, `ui/src/bar.ts`, `ui/src/bar.css`, and `ui/src/tokens.css` for render purity, accessibility semantics, focus/contrast gaps, and canvas/performance bugs.
2. Remediate owned files so the HUD shell stays visually correct and accessible without taking orchestration responsibility away from the controller.
3. Fix any render-layer performance defects in owned files (for example stale RAF lifecycle, DPR scaling/reset issues, or hidden-state rendering artifacts) without introducing CSS/JS band-aids that hide root causes.
4. Add jsdom coverage in `ui/src/__tests__/bar-ui.test.ts` for HUD render states, prompt/error visibility, overlay affordances, and deterministic waveform lifecycle hooks with mocked dependencies.

## Failure Modes
- **If Task 05 delivered a controller contract that differs materially from the planned one**: use the whiteboard actual contract and stop for amendment if the new surface makes the planned HUD work invalid.
- **If a visual fix requires moving orchestration into `bar.ts`**: redesign the boundary instead of mixing concerns.
- **If a bug only reproduces in live runtime**: capture the exact reproduction and leave it for Task 08 rather than masking it with CSS clipping or timing hacks.

## Guardrails
- Keep the HUD transparent/clipped pill; do not regress the current shell/window visual invariant.
- Do not move session orchestration, bridge calls, or business policy into `ui/src/bar.ts`.
- Do not use global overflow clipping or other visual band-aids that hide layout/render bugs.

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
