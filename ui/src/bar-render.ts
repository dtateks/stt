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
  PAUSED:     "Paused",
  RESUMING:   "Resuming",
  PROCESSING: "Processing",
  INSERTING:  "Inserting",
  SUCCESS:    "Inserted",
  ERROR:      "Error",
};

const LIVE_TRANSCRIPT_PENDING_SUFFIX = "…";
const LIVE_TRANSCRIPT_TERMINAL_PUNCTUATION_PATTERN = /(?:\.{3}|…|[.!?。！？])+\s*$/;
const INTERIM_TRANSCRIPT_MEANINGFUL_CONTENT_PATTERN = /[\p{L}\p{N}]/u;
const WAVEFORM_POINT_COUNT = 128;
const WAVEFORM_LINE_WIDTH = 2.4;
const WAVEFORM_MAX_AMPLITUDE_RATIO = 0.92;

// ─── Waveform runtime params ──────────────────────────────────────────────────

export const HEARTBEAT_IDLE_BPM = 30;
export const HEARTBEAT_ACTIVE_BPM_BOOST = 25;
export const HEARTBEAT_ENERGY_SMOOTHING = 0.12;
export const HEARTBEAT_GLOW_WIDTH = 7;
export const HEARTBEAT_MIN_AMPLITUDE = 0.36;
export const ECG_CLUSTER_TRAVEL_RATIO = 0.08;
export const HEARTBEAT_INTENSITY_FLOOR = 0.12;
const AUDIO_REACTIVE_NOISE_FLOOR = 0.08;

export interface HeartbeatParams {
  bpm: number;
  amplitude: number;
}

export const HEARTBEAT_IDLE_AMPLITUDE = 0.46;
export const ACTIVE_ECG_REGION_WIDTH_RATIO = 0.985;
const ACTIVE_SPEECH_FOLD_COUNT = 10.8;
const ACTIVE_SPEECH_FOLD_STRENGTH = 0.56;
const LEFT_SIDE_FOLD_BOOST = 9.4;

// ─── ECG pulse shape ──────────────────────────────────────────────────────────

/**
 * Piecewise-linear ECG heartbeat shape over local phase [0..1].
 *
 * Keyframes model a simplified P-QRS-T complex:
 *   flat → P(+) → baseline → Q(-) → R(+1.0) → S(-) → baseline → T(+) → flat
 *
 * Canvas convention: negative displacement = upward (R-wave),
 *                    positive displacement = downward (S-wave).
 */

/** Width of the ECG pulse region relative to the full canvas, centered. */
export const ECG_REGION_WIDTH_RATIO = 0.72;

interface EcgKeyframe {
  /** Position within the ECG region [0..1]. */
  t: number;
  /** Vertical displacement [-1..+1]. Negative = up (R-wave), positive = down. */
  d: number;
}

/**
 * P-QRS-T keyframes within the ECG region.
 * Multiple consecutive angular turns create the recognizable heartbeat zigzag.
 */
export const ECG_KEYFRAMES: readonly EcgKeyframe[] = [
  { t: 0.00, d:  0.00 },  // flat baseline start
  { t: 0.04, d: -0.18 },  // early left-side bump — stronger
  { t: 0.10, d:  0.12 },  // settle back through baseline — deeper
  { t: 0.18, d: -0.28 },  // second left-side lift — much stronger
  { t: 0.26, d:  0.20 },  // left-side dip — deeper
  { t: 0.32, d:  0.00 },  // brief baseline before the stronger complex
  { t: 0.38, d:  0.28 },  // Q-wave dip (downward) — deeper
  { t: 0.46, d: -0.72 },  // pre-R rise — stronger
  { t: 0.54, d:  0.36 },  // rebound before the tallest spike — deeper
  { t: 0.60, d: -1.00 },  // R-wave spike (sharp upward — tallest peak)
  { t: 0.68, d:  0.95 },  // S-wave dip (sharp downward) — deeper
  { t: 0.76, d: -0.68 },  // rebound turn — stronger
  { t: 0.86, d:  0.22 },  // settling dip — slightly deeper
  { t: 0.96, d:  0.00 },  // return to baseline
  { t: 1.00, d:  0.00 },  // flat baseline end
] as const;

/**
 * Interpolates the ECG keyframe displacement at a given local parameter `p` ∈ [0..1].
 * Pure piecewise-linear interpolation — no side effects.
 */
export function ecgDisplacement(p: number): number {
  if (p <= 0) return ECG_KEYFRAMES[0].d;
  if (p >= 1) return ECG_KEYFRAMES[ECG_KEYFRAMES.length - 1].d;

  for (let i = 1; i < ECG_KEYFRAMES.length; i++) {
    const prev = ECG_KEYFRAMES[i - 1];
    const curr = ECG_KEYFRAMES[i];
    if (p <= curr.t) {
      const segmentProgress = (p - prev.t) / (curr.t - prev.t);
      return prev.d + segmentProgress * (curr.d - prev.d);
    }
  }

  return 0;
}

// ─── Audio energy / heartbeat params ──────────────────────────────────────────

/**
 * Derives heartbeat rendering params from audio energy (0..1).
 * Pure — no audio API dependency. Energy 0 produces idle-level values.
 */
export function computeAudioHeartbeatParams(energy: number): HeartbeatParams {
  const clampedEnergy = Math.max(0, Math.min(1, energy));
  const reactiveEnergy = Math.max(0, clampedEnergy - AUDIO_REACTIVE_NOISE_FLOOR) / (1 - AUDIO_REACTIVE_NOISE_FLOOR);
  const emphasizedEnergy = Math.sqrt(reactiveEnergy);

  return {
    bpm: HEARTBEAT_IDLE_BPM + emphasizedEnergy * HEARTBEAT_ACTIVE_BPM_BOOST,
    amplitude: HEARTBEAT_MIN_AMPLITUDE + emphasizedEnergy * (1 - HEARTBEAT_MIN_AMPLITUDE),
  };
}

function computeSpeechActiveRatio(amplitude: number): number {
  const clampedAmplitude = Math.max(HEARTBEAT_MIN_AMPLITUDE, Math.min(1, amplitude));
  return (clampedAmplitude - HEARTBEAT_MIN_AMPLITUDE) / (1 - HEARTBEAT_MIN_AMPLITUDE);
}

function triangleWave(phase: number): number {
  const wrappedPhase = ((phase % 1) + 1) % 1;
  return 1 - 4 * Math.abs(wrappedPhase - 0.5);
}

function computeSpeechFoldDisplacement(localP: number, amplitude: number): number {
  const speakingFoldRatio = Math.max(0, (amplitude - HEARTBEAT_IDLE_AMPLITUDE) / (1 - HEARTBEAT_IDLE_AMPLITUDE));
  if (speakingFoldRatio <= 0) {
    return 0;
  }

  const detailStrength = ACTIVE_SPEECH_FOLD_STRENGTH * (0.45 + 0.55 * Math.sqrt(speakingFoldRatio));
  const baseFold = triangleWave(localP * ACTIVE_SPEECH_FOLD_COUNT + 0.02);
  const leftFoldWeight = Math.max(0, 1 - localP / 0.64);
  const leftFold = triangleWave(localP * (ACTIVE_SPEECH_FOLD_COUNT + LEFT_SIDE_FOLD_BOOST) + 0.14) * leftFoldWeight;
  const foldSignal = baseFold * 0.78 + leftFold * 0.62;
  const foldEnvelope = 0.38 + 0.62 * Math.pow(Math.sin(Math.PI * localP), 0.82);
  const leftBias = 1.55 - 0.6 * localP;

  return foldSignal * foldEnvelope * leftBias * detailStrength;
}

/**
 * RMS energy from raw byte-domain audio data.
 * Pure — no Web Audio dependency. Accepts the same Uint8Array shape that
 * AnalyserNode.getByteTimeDomainData() fills.
 */
export function computeRmsEnergy(data: Uint8Array<ArrayBuffer>): number {
  let sumSquares = 0;
  for (let i = 0; i < data.length; i++) {
    const normalized = (data[i] - 128) / 128;
    sumSquares += normalized * normalized;
  }
  return Math.min(1.0, Math.sqrt(sumSquares / data.length) * 3.5);
}

/**
 * Computes beat intensity from elapsed time and BPM.
 * Returns a value in [0..1] that peaks sharply at each beat,
 * then decays quickly — mimicking the sharp contraction of a heartbeat.
 *
 * Pure — no animation or time dependencies. Caller provides elapsed time.
 */
export function computeBeatIntensity(elapsedMs: number, bpm: number): number {
  const beatPeriodMs = 60_000 / bpm;
  const phase = (elapsedMs % beatPeriodMs) / beatPeriodMs;

  // Short attack, then eased decay. Keep a visible floor so the ECG cluster
  // remains legible between beats instead of collapsing into a tiny center blip.
  const ATTACK_RATIO = 0.16;
  const pulse = phase < ATTACK_RATIO
    ? phase / ATTACK_RATIO
    : Math.pow(1 - (phase - ATTACK_RATIO) / (1 - ATTACK_RATIO), 2);

  return HEARTBEAT_INTENSITY_FLOOR + pulse * (1 - HEARTBEAT_INTENSITY_FLOOR);
}

/**
 * Computes the horizontal ECG-cluster offset ratio for the current beat phase.
 * The cluster drifts subtly from right to left during each beat cycle, then
 * resets near center-right on the next beat.
 */
export function computeHeartbeatClusterOffset(
  elapsedMs: number,
  bpm: number,
  amplitude = 1,
): number {
  const beatPeriodMs = 60_000 / bpm;
  const beatPhase = (elapsedMs % beatPeriodMs) / beatPeriodMs;
  const activeRatio = computeSpeechActiveRatio(amplitude);
  const travelRatio = ECG_CLUSTER_TRAVEL_RATIO * (1 - activeRatio * 0.8);

  return -beatPhase * travelRatio;
}

interface EcgRegionBounds {
  start: number;
  end: number;
}

export function computeEcgRegionWidthRatio(amplitude: number): number {
  const activeRatio = computeSpeechActiveRatio(amplitude);
  const expandedActiveRatio = Math.sqrt(activeRatio);

  return ECG_REGION_WIDTH_RATIO
    + expandedActiveRatio * (ACTIVE_ECG_REGION_WIDTH_RATIO - ECG_REGION_WIDTH_RATIO);
}

export function getEcgRegionBounds(
  clusterOffsetRatio = 0,
  regionWidthRatio = ECG_REGION_WIDTH_RATIO,
): EcgRegionBounds {
  const centeredStart = (1 - regionWidthRatio) / 2;
  const maxOffsetMagnitude = centeredStart;
  const clampedOffset = Math.max(-maxOffsetMagnitude, Math.min(maxOffsetMagnitude, clusterOffsetRatio));
  const start = centeredStart + clampedOffset;

  return {
    start,
    end: start + regionWidthRatio,
  };
}

// ─── Waveform Y sampling ─────────────────────────────────────────────────────

/**
 * Samples the heartbeat Y position at horizontal parameter t ∈ [0..1].
 *
 * The ECG pulse occupies a region of width ECG_REGION_WIDTH_RATIO.
 * With clusterOffsetRatio=0 it is centered; non-zero offsets shift the region
 * left/right while preserving a flat baseline outside it.
 * Outside that region the line sits on centerY (flat baseline).
 * beatIntensity (0..1) gates the pulse — 0 produces a flat line,
 * 1 produces full-height ECG displacement.
 *
 * Canvas convention: y < centerY = upward (R-wave), y > centerY = downward (S-wave).
 */
export function sampleWaveformY(
  t: number,
  centerY: number,
  maxAmplitude: number,
  amplitude: number,
  beatIntensity: number,
  clusterOffsetRatio = 0,
): number {
  const regionWidthRatio = computeEcgRegionWidthRatio(amplitude);
  const { start: regionStart, end: regionEnd } = getEcgRegionBounds(clusterOffsetRatio, regionWidthRatio);

  if (t < regionStart || t > regionEnd) {
    return centerY;
  }

  const localP = (t - regionStart) / regionWidthRatio;
  const displacement = Math.max(
    -1.2,
    Math.min(1.2, ecgDisplacement(localP) + computeSpeechFoldDisplacement(localP, amplitude)),
  );

  return centerY + displacement * maxAmplitude * amplitude * beatIntensity;
}

export interface StatePresentationOptions {
  showConnectingLabel?: boolean;
}

export interface WaveformLayout {
  width: number;
  height: number;
  centerY: number;
  pointCount: number;
  lineWidth: number;
  maxAmplitude: number;
}

export interface WaveformTracePoint {
  x: number;
  y: number;
}

export function createWaveformLayout(width: number, height: number): WaveformLayout {
  return {
    width,
    height,
    centerY: height / 2,
    pointCount: WAVEFORM_POINT_COUNT,
    lineWidth: WAVEFORM_LINE_WIDTH,
    maxAmplitude: (height / 2) * WAVEFORM_MAX_AMPLITUDE_RATIO,
  };
}

export function buildHeartbeatTracePoints(
  layout: WaveformLayout,
  amplitude: number,
  beatIntensity: number,
  clusterOffsetRatio = 0,
): WaveformTracePoint[] {
  return Array.from({ length: layout.pointCount }, (_, index) => {
    const t = index / (layout.pointCount - 1);

    return {
      x: t * layout.width,
      y: sampleWaveformY(
        t,
        layout.centerY,
        layout.maxAmplitude,
        amplitude,
        beatIntensity,
        clusterOffsetRatio,
      ),
    };
  });
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
  options: StatePresentationOptions = {},
): void {
  hud.dataset.state = state;
  stateLabelEl.textContent = getPresentedStateLabel(state, options);

  if (state === "HIDDEN" || state === "CONNECTING") {
    transcriptFinalEl.textContent = "";
    transcriptInterimEl.textContent = "";
  }

  if (state === "PAUSED") {
    transcriptInterimEl.textContent = "";
  }

  syncPromptVisibility(hud, transcriptFinalEl, transcriptInterimEl, transcriptPromptEl);
}

export function getPresentedStateLabel(
  state: BarState,
  options: StatePresentationOptions = {},
): string {
  if ((state === "CONNECTING" || state === "RESUMING") && options.showConnectingLabel === false) {
    return "";
  }

  return STATE_LABELS[state];
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
    state === "PAUSED" ||
    state === "RESUMING" ||
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
  return state !== "HIDDEN";
}
