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

const LIVE_TRANSCRIPT_PENDING_SUFFIX = "…";
const LIVE_TRANSCRIPT_TERMINAL_PUNCTUATION_PATTERN = /(?:\.{3}|…|[.!?。！？])+\s*$/;
const INTERIM_TRANSCRIPT_MEANINGFUL_CONTENT_PATTERN = /[\p{L}\p{N}]/u;
const WAVEFORM_BAR_COUNT = 12;
const WAVEFORM_BAR_WIDTH = 2;
const WAVEFORM_MAX_BAR_HEIGHT_RATIO = 0.85;

export interface WaveformLayout {
  width: number;
  height: number;
  centerY: number;
  barCount: number;
  barWidth: number;
  gap: number;
  maxBarHeight: number;
}

export function createWaveformLayout(width: number, height: number): WaveformLayout {
  return {
    width,
    height,
    centerY: height / 2,
    barCount: WAVEFORM_BAR_COUNT,
    barWidth: WAVEFORM_BAR_WIDTH,
    gap: (width - WAVEFORM_BAR_COUNT * WAVEFORM_BAR_WIDTH) / (WAVEFORM_BAR_COUNT + 1),
    maxBarHeight: height * WAVEFORM_MAX_BAR_HEIGHT_RATIO,
  };
}

// ─── Pure render helpers ──────────────────────────────────────────────────────

export function syncPromptVisibility(
  _hud: HTMLElement,
  _transcriptFinalEl: HTMLElement,
  _transcriptInterimEl: HTMLElement,
  transcriptPromptEl: HTMLElement,
): void {
  // Always hide the "Listening…" prompt — LISTENING state label on the right is sufficient.
  (transcriptPromptEl as HTMLElement & { hidden: boolean }).hidden = true;
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
  const state = hud.dataset.state;
  const isTranscriptVisibleState =
    state === "LISTENING" ||
    state === "PROCESSING" ||
    state === "INSERTING" ||
    state === "SUCCESS";

  if (!isTranscriptVisibleState) return;

  transcriptFinalEl.textContent = buildVisibleTranscriptText(state, result);
  transcriptInterimEl.textContent = "";
  syncPromptVisibility(hud, transcriptFinalEl, transcriptInterimEl, transcriptPromptEl);
  scrollTranscriptToEnd(transcriptFinalEl);
}

export function buildVisibleTranscriptText(state: string | undefined, result: TranscriptResult): string {
  const hasMeaningfulInterimTranscript = hasMeaningfulTranscriptContent(result.interimText);
  const visibleTranscript = [result.finalText, hasMeaningfulInterimTranscript ? result.interimText : ""]
    .filter(Boolean)
    .join(" ");
  const hasPendingInterimTranscript = state === "LISTENING" && hasMeaningfulInterimTranscript;

  if (!hasPendingInterimTranscript || visibleTranscript.length === 0) {
    return visibleTranscript;
  }

  if (LIVE_TRANSCRIPT_TERMINAL_PUNCTUATION_PATTERN.test(visibleTranscript)) {
    return visibleTranscript;
  }

  return `${visibleTranscript}${LIVE_TRANSCRIPT_PENDING_SUFFIX}`;
}

function hasMeaningfulTranscriptContent(text: string): boolean {
  return INTERIM_TRANSCRIPT_MEANINGFUL_CONTENT_PATTERN.test(text.trim());
}

export function scrollTranscriptToEnd(textEl: HTMLElement): void {
  const container = textEl.parentElement;
  if (!container) return;
  container.scrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
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
