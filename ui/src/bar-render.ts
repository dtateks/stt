/**
 * Pure HUD render helpers.
 *
 * Every function accepts explicit DOM element parameters and has no module-level
 * side effects — safe to import from tests without triggering bar.ts boot code.
 *
 * bar.ts wires these to its own module-level DOM refs; the test suite imports
 * them directly and passes elements from jsdom.
 */

import type { BarState, TranscriptResult } from "./types.ts";
import type { OverlayMode } from "./bar-session-controller.ts";

// ─── State label map ──────────────────────────────────────────────────────────

export const STATE_LABELS: Record<BarState, string> = {
  HIDDEN:     "",
  CONNECTING: "Connecting",
  LISTENING:  "Listening",
  PROCESSING: "Processing",
  INSERTING:  "Inserting",
  SUCCESS:    "Inserted",
  ERROR:      "Error",
};

// ─── Pure render helpers ──────────────────────────────────────────────────────

export function syncPromptVisibility(
  hud: HTMLElement,
  transcriptFinalEl: HTMLElement,
  transcriptInterimEl: HTMLElement,
  transcriptPromptEl: HTMLElement,
): void {
  const hasFinal   = Boolean(transcriptFinalEl.textContent);
  const hasInterim = Boolean(transcriptInterimEl.textContent);
  const isListening = hud.dataset.state === "LISTENING";
  (transcriptPromptEl as HTMLElement & { hidden: boolean }).hidden =
    hasFinal || hasInterim || !isListening;
}

export function applyState(
  state: BarState,
  hud: HTMLElement,
  stateLabelEl: HTMLElement,
  transcriptFinalEl: HTMLElement,
  transcriptInterimEl: HTMLElement,
  transcriptPromptEl: HTMLElement,
): void {
  hud.dataset.state = state;
  stateLabelEl.textContent = STATE_LABELS[state];

  if (state === "HIDDEN" || state === "CONNECTING") {
    transcriptFinalEl.textContent = "";
    transcriptInterimEl.textContent = "";
  }

  syncPromptVisibility(hud, transcriptFinalEl, transcriptInterimEl, transcriptPromptEl);
}

export function applyTranscript(
  result: TranscriptResult,
  hud: HTMLElement,
  transcriptFinalEl: HTMLElement,
  transcriptInterimEl: HTMLElement,
  transcriptPromptEl: HTMLElement,
): void {
  if (hud.dataset.state !== "LISTENING") return;
  transcriptFinalEl.textContent = result.finalText;
  transcriptInterimEl.textContent = result.interimText;
  syncPromptVisibility(hud, transcriptFinalEl, transcriptInterimEl, transcriptPromptEl);
}

export function applyErrorMessage(
  message: string | null,
  hud: HTMLElement,
  transcriptFinalEl: HTMLElement,
  transcriptInterimEl: HTMLElement,
  transcriptPromptEl: HTMLElement,
): void {
  if (!message) {
    transcriptFinalEl.textContent = "";
    transcriptInterimEl.textContent = "";
    syncPromptVisibility(hud, transcriptFinalEl, transcriptInterimEl, transcriptPromptEl);
    return;
  }
  transcriptFinalEl.textContent = message;
  transcriptInterimEl.textContent = "";
  (transcriptPromptEl as HTMLElement & { hidden: boolean }).hidden = true;
}

export function applyOverlayMode(
  mode: OverlayMode,
  hud: HTMLElement,
  buttons: HTMLButtonElement[],
): void {
  hud.dataset.overlay = mode.toLowerCase();
  const tabIndex = mode === "INTERACTIVE" ? 0 : -1;
  for (const btn of buttons) {
    btn.tabIndex = tabIndex;
  }
}

/**
 * Pure resize helper — accepts injected canvas shape + context for testability.
 * bar.ts calls this with the real canvas + canvasCtx; tests inject mocks.
 */
export function resizeCanvasWithContext(
  canvas: { width: number; height: number; getBoundingClientRect(): { width: number; height: number } },
  ctx: { setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void; scale(x: number, y: number): void } | null,
  dpr: number,
): void {
  const rect = canvas.getBoundingClientRect();
  canvas.width  = rect.width  * dpr;
  canvas.height = rect.height * dpr;
  // Identity reset prevents DPR accumulation on repeated resize calls.
  ctx?.setTransform(1, 0, 0, 1, 0, 0);
  ctx?.scale(dpr, dpr);
}

/**
 * Returns whether a given BarState should have the waveform animation running.
 * Pure function — tested without any DOM or RAF dependency.
 */
export function waveformShouldRun(state: BarState): boolean {
  return state === "LISTENING";
}
