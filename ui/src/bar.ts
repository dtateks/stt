/**
 * Bar HUD entry point.
 *
 * Owns: DOM rendering, waveform animation, state-driven UI updates,
 *       overlay mode indicator, button keyboard reachability.
 * Delegates: session orchestration → BarSessionController.
 *            pure render logic → bar-render.ts (imported, tested independently).
 */

import "./bar.css";
import type { BarState, TranscriptResult } from "./types.ts";
import { waitForVoiceToTextBridge } from "./bridge-ready.ts";
import { BarSessionController, type OverlayMode } from "./bar-session-controller.ts";
import {
  applyState as renderApplyState,
  applyTranscript as renderApplyTranscript,
  applyErrorMessage as renderApplyErrorMessage,
  applyOverlayMode as renderApplyOverlayMode,
  createWaveformLayout,
  type WaveformLayout,
  resizeCanvasWithContext,
  waveformShouldRun,
  waveformShouldBeVisible,
  sampleWaveformY,
  computeRmsEnergy,
  computeAudioHeartbeatParams,
  computeBeatIntensity,
  computeHeartbeatClusterOffset,
  HEARTBEAT_IDLE_BPM,
  HEARTBEAT_IDLE_AMPLITUDE,
  HEARTBEAT_ENERGY_SMOOTHING,
  HEARTBEAT_GLOW_WIDTH,
  HEARTBEAT_MIN_AMPLITUDE,
} from "./bar-render.ts";

const CONNECTING_LABEL_DELAY_MS = 150;

// ─── DOM refs ─────────────────────────────────────────────────────────────

const hud             = document.getElementById("hud")               as HTMLDivElement;
const waveformCanvas  = document.getElementById("waveform")          as HTMLCanvasElement;
const transcriptFinalEl   = document.getElementById("transcript-final")   as HTMLSpanElement;
const transcriptInterimEl = document.getElementById("transcript-interim") as HTMLSpanElement;
const transcriptPromptEl  = document.getElementById("transcript-prompt")  as HTMLSpanElement;
const stateLabelEl    = document.getElementById("hud-state-label")   as HTMLSpanElement;
const clearBtn        = document.getElementById("hud-clear-btn")     as HTMLButtonElement;
const closeBtn        = document.getElementById("hud-close-btn")     as HTMLButtonElement;
const pauseBtn        = document.getElementById("hud-pause-btn")     as HTMLButtonElement;

const HUD_BUTTONS: HTMLButtonElement[] = [
  pauseBtn,
  clearBtn,
  closeBtn,
];

// ─── Controller ───────────────────────────────────────────────────────────

const controller = new BarSessionController();
let connectingLabelTimer: ReturnType<typeof setTimeout> | null = null;
let shouldShowConnectingLabel = true;
let smoothedEnergy = 0;

// ─── State rendering — thin wrappers that bind module DOM refs ────────────

function applyState(state: BarState): void {
  renderApplyState(
    state,
    hud,
    stateLabelEl,
    transcriptFinalEl,
    transcriptInterimEl,
    transcriptPromptEl,
    { showConnectingLabel: shouldShowConnectingLabel },
  );
}

function clearConnectingLabelTimer(): void {
  if (connectingLabelTimer === null) {
    return;
  }

  clearTimeout(connectingLabelTimer);
  connectingLabelTimer = null;
}

function scheduleConnectingLabelPresentation(): void {
  clearConnectingLabelTimer();
  connectingLabelTimer = setTimeout(() => {
    const currentState = controller.getCurrentState();
    if (currentState !== "CONNECTING" && currentState !== "RESUMING") {
      return;
    }

    shouldShowConnectingLabel = true;
    applyState(currentState);
  }, CONNECTING_LABEL_DELAY_MS);
}

function applyTranscript(result: TranscriptResult): void {
  renderApplyTranscript(result, hud, transcriptFinalEl, transcriptInterimEl, transcriptPromptEl);
}

function applyErrorMessage(message: string | null): void {
  renderApplyErrorMessage(message, hud, transcriptFinalEl, transcriptInterimEl, transcriptPromptEl);
}

// ─── Overlay mode ──────────────────────────────────────────────────────────

function applyOverlayMode(mode: OverlayMode): void {
  renderApplyOverlayMode(mode, hud, HUD_BUTTONS);
}

function clearHudButtonFocus(): void {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) {
    return;
  }

  if (!HUD_BUTTONS.includes(activeElement as HTMLButtonElement)) {
    return;
  }

  activeElement.blur();
}

function suppressHudButtonHover(button: HTMLButtonElement): void {
  button.dataset.hoverSuppressed = "true";
}

function clearHudButtonHoverSuppression(button: HTMLButtonElement): void {
  delete button.dataset.hoverSuppressed;
}

function clearAllHudButtonHoverSuppression(): void {
  for (const button of HUD_BUTTONS) {
    clearHudButtonHoverSuppression(button);
  }
}

// ─── Waveform ─────────────────────────────────────────────────────────────

let rafId: number | null = null;
const canvasCtx = waveformCanvas.getContext("2d");
let waveformLayoutCache: WaveformLayout | null = null;
let analyserDataBuffer: Uint8Array<ArrayBuffer> | null = null;
let waveformStartTime: number | null = null;

// Gradient cache — avoids per-frame createLinearGradient calls.
// Invalidated when canvas width or opacity threshold changes.
let cachedGradientWidth = 0;
let cachedLineOpacityBucket = -1;
let cachedGlowOpacityBucket = -1;
let cachedLineGradient: CanvasGradient | null = null;
let cachedGlowGradient: CanvasGradient | null = null;

// Opacity bucketing granularity — gradients are rebuilt only when opacity
// crosses a bucket boundary, not on every sub-pixel energy change.
const GRADIENT_OPACITY_BUCKET_SIZE = 0.04;

function getWaveformLayout(width: number, height: number): WaveformLayout {
  if (
    waveformLayoutCache !== null
    && waveformLayoutCache.width === width
    && waveformLayoutCache.height === height
  ) {
    return waveformLayoutCache;
  }

  waveformLayoutCache = createWaveformLayout(width, height);
  return waveformLayoutCache;
}

function getAnalyserSampleBuffer(analyser: AnalyserNode): Uint8Array<ArrayBuffer> {
  const nextLength = analyser.frequencyBinCount;
  if (analyserDataBuffer?.length === nextLength) {
    return analyserDataBuffer;
  }

  analyserDataBuffer = new Uint8Array(new ArrayBuffer(nextLength));
  return analyserDataBuffer;
}

/** Start the animation loop; idempotent — ignores duplicate calls. */

function startWaveform(): void {
  if (rafId !== null) return;
  waveformStartTime = performance.now();
  drawWaveform();
}

function stopWaveform(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  waveformStartTime = null;
  invalidateGradientCache();
  clearWaveform();
}

function clearWaveform(): void {
  if (!canvasCtx) return;
  const dpr = window.devicePixelRatio || 1;
  canvasCtx.clearRect(0, 0, waveformCanvas.width / dpr, waveformCanvas.height / dpr);
}

function invalidateGradientCache(): void {
  cachedGradientWidth = 0;
  cachedLineOpacityBucket = -1;
  cachedGlowOpacityBucket = -1;
  cachedLineGradient = null;
  cachedGlowGradient = null;
}

/**
 * Returns a cached or fresh gradient pair for the audio heartbeat.
 * Gradients are rebuilt only when the canvas width changes or the
 * opacity bucket crosses a threshold — not on every frame.
 */
function getAudioGradients(
  width: number,
  lineOpacity: number,
  glowOpacity: number,
): { lineGradient: CanvasGradient; glowGradient: CanvasGradient } {
  const lineBucket = Math.round(lineOpacity / GRADIENT_OPACITY_BUCKET_SIZE);
  const glowBucket = Math.round(glowOpacity / GRADIENT_OPACITY_BUCKET_SIZE);

  if (
    cachedLineGradient !== null
    && cachedGlowGradient !== null
    && cachedGradientWidth === width
    && cachedLineOpacityBucket === lineBucket
    && cachedGlowOpacityBucket === glowBucket
  ) {
    return { lineGradient: cachedLineGradient, glowGradient: cachedGlowGradient };
  }

  const bucketedLineOpacity = lineBucket * GRADIENT_OPACITY_BUCKET_SIZE;
  const bucketedGlowOpacity = glowBucket * GRADIENT_OPACITY_BUCKET_SIZE;

  const lineGradient = canvasCtx!.createLinearGradient(0, 0, width, 0);
  lineGradient.addColorStop(0, `rgba(255, 255, 255, ${bucketedLineOpacity})`);
  lineGradient.addColorStop(1, `rgba(200, 200, 200, ${bucketedLineOpacity * 0.85})`);

  const glowGradient = canvasCtx!.createLinearGradient(0, 0, width, 0);
  glowGradient.addColorStop(0, `rgba(255, 255, 255, ${bucketedGlowOpacity})`);
  glowGradient.addColorStop(1, `rgba(200, 200, 200, ${bucketedGlowOpacity * 0.8})`);

  cachedGradientWidth = width;
  cachedLineOpacityBucket = lineBucket;
  cachedGlowOpacityBucket = glowBucket;
  cachedLineGradient = lineGradient;
  cachedGlowGradient = glowGradient;

  return { lineGradient, glowGradient };
}

/**
 * Renders a single static idle heartbeat frame — no RAF loop.
 * Used for visible non-audio states (PROCESSING, INSERTING, etc.)
 * where continuous animation is thermal waste.
 */
function drawStaticIdleFrame(): void {
  if (!canvasCtx) return;

  waveformStartTime = performance.now();
  const dpr = window.devicePixelRatio || 1;
  const logicalWidth = waveformCanvas.width / dpr;
  const logicalHeight = waveformCanvas.height / dpr;
  const layout = getWaveformLayout(logicalWidth, logicalHeight);

  canvasCtx.clearRect(0, 0, logicalWidth, logicalHeight);
  drawIdleHeartbeat(layout);
}

function drawWaveform(): void {
  rafId = requestAnimationFrame(drawWaveform);

  if (!canvasCtx) return;

  const analyser = controller.getAnalyserNode();
  const dpr = window.devicePixelRatio || 1;
  const logicalWidth = waveformCanvas.width / dpr;
  const logicalHeight = waveformCanvas.height / dpr;
  const layout = getWaveformLayout(logicalWidth, logicalHeight);

  canvasCtx.clearRect(0, 0, logicalWidth, logicalHeight);

  if (!analyser) {
    drawIdleHeartbeat(layout);
    return;
  }

  const dataArray = getAnalyserSampleBuffer(analyser);
  analyser.getByteTimeDomainData(dataArray);

  drawAudioHeartbeat(dataArray, layout);
}

function drawHeartbeatTrace(
  layout: WaveformLayout,
  bpm: number,
  amplitude: number,
  strokeStyle: string | CanvasGradient,
  glowStyle: string | CanvasGradient | null,
): void {
  if (!canvasCtx) return;

  const elapsedMs = waveformStartTime !== null
    ? performance.now() - waveformStartTime
    : 0;
  const beatIntensity = computeBeatIntensity(elapsedMs, bpm);
  const clusterOffsetRatio = computeHeartbeatClusterOffset(elapsedMs, bpm, amplitude);

  canvasCtx.lineCap = "round";
  canvasCtx.lineJoin = "miter";
  const path = new Path2D();

  for (let i = 0; i < layout.pointCount; i++) {
    const t = i / (layout.pointCount - 1);
    const x = t * layout.width;
    const y = sampleWaveformY(
      t,
      layout.centerY,
      layout.maxAmplitude,
      amplitude,
      beatIntensity,
      clusterOffsetRatio,
    );

    if (i === 0) {
      path.moveTo(x, y);
    } else {
      path.lineTo(x, y);
    }
  }

  if (glowStyle !== null) {
    canvasCtx.strokeStyle = glowStyle;
    canvasCtx.lineWidth = HEARTBEAT_GLOW_WIDTH;
    canvasCtx.stroke(path);
  }

  canvasCtx.strokeStyle = strokeStyle;
  canvasCtx.lineWidth = layout.lineWidth;
  canvasCtx.stroke(path);
}

function drawIdleHeartbeat(layout: WaveformLayout): void {
  drawHeartbeatTrace(
    layout,
    HEARTBEAT_IDLE_BPM,
    HEARTBEAT_IDLE_AMPLITUDE,
    "rgba(110, 117, 129, 0.65)",
    "rgba(110, 117, 129, 0.15)",
  );
}

function drawAudioHeartbeat(data: Uint8Array<ArrayBuffer>, layout: WaveformLayout): void {
  const rawEnergy = computeRmsEnergy(data);
  smoothedEnergy += (rawEnergy - smoothedEnergy) * HEARTBEAT_ENERGY_SMOOTHING;

  const { bpm, amplitude } = computeAudioHeartbeatParams(smoothedEnergy);
  const activeEnergy = Math.max(0, (amplitude - HEARTBEAT_MIN_AMPLITUDE) / (1 - HEARTBEAT_MIN_AMPLITUDE));

  const glowOpacity = 0.05 + activeEnergy * 0.18;
  const lineOpacity = 0.36 + activeEnergy * 0.42;

  const { lineGradient, glowGradient } = getAudioGradients(layout.width, lineOpacity, glowOpacity);

  drawHeartbeatTrace(layout, bpm, amplitude, lineGradient, glowGradient);
}

// ─── Pause button affordance ──────────────────────────────────────────────

const PAUSE_ENABLED_STATES = new Set<BarState>(["LISTENING", "PAUSED"]);

function syncPauseButtonAffordance(state: BarState): void {
  const isPaused = state === "PAUSED";
  pauseBtn.disabled = !PAUSE_ENABLED_STATES.has(state);
  pauseBtn.dataset.paused = isPaused ? "true" : "false";
  pauseBtn.setAttribute("aria-label", isPaused ? "Resume listening" : "Pause listening");
}

// ─── Controls ─────────────────────────────────────────────────────────────

function bindControls(): void {
  for (const button of HUD_BUTTONS) {
    button.addEventListener("pointermove", () => {
      clearHudButtonHoverSuppression(button);
    });

    button.addEventListener("pointerleave", () => {
      clearHudButtonHoverSuppression(button);
    });
  }

  clearBtn.addEventListener("click", () => {
    if (!window.voiceToText) {
      return;
    }

    suppressHudButtonHover(clearBtn);
    clearHudButtonFocus();
    void controller.handleClear().catch((error: unknown) => {
      console.error("[bar] clear handler failed", error);
    });
  });

  pauseBtn.addEventListener("click", () => {
    if (!window.voiceToText) {
      return;
    }

    suppressHudButtonHover(pauseBtn);
    clearHudButtonFocus();
    void controller.handlePauseResume().catch((error: unknown) => {
      console.error("[bar] pause/resume handler failed", error);
    });
  });

  closeBtn.addEventListener("click", () => {
    if (!window.voiceToText) {
      return;
    }

    suppressHudButtonHover(closeBtn);
    clearHudButtonFocus();
    void controller.handleClose().catch((error: unknown) => {
      console.error("[bar] close handler failed; retrying hideBar", error);
      void window.voiceToText?.hideBar();
    });
  });

}

// ─── State transitions ────────────────────────────────────────────────────

controller.onStateChange = (state) => {
  if (state === "CONNECTING" || state === "RESUMING") {
    shouldShowConnectingLabel = false;
    scheduleConnectingLabelPresentation();
  } else {
    shouldShowConnectingLabel = true;
    clearConnectingLabelTimer();
  }

  applyState(state);
  syncPauseButtonAffordance(state);

  if (state === "HIDDEN" || state === "CONNECTING") {
    clearAllHudButtonHoverSuppression();
    clearHudButtonFocus();
  }

  if (waveformShouldRun(state)) {
    startWaveform();
  } else if (waveformShouldBeVisible(state)) {
    // Non-audio visible states: render one static idle frame, then stop
    // the RAF loop. Visually identical but eliminates continuous compositor load.
    stopWaveform();
    drawStaticIdleFrame();
  } else {
    stopWaveform();
  }
};

controller.onTranscriptChange = (result: TranscriptResult) => {
  applyTranscript(result);
};

controller.onOverlayModeChange = (mode: OverlayMode) => {
  applyOverlayMode(mode);
};

controller.onErrorMessageChange = (message: string | null) => {
  applyErrorMessage(message);
};

// ─── Canvas sizing ────────────────────────────────────────────────────────

function resizeCanvas(): void {
  resizeCanvasWithContext(waveformCanvas, canvasCtx, window.devicePixelRatio || 1);
  waveformLayoutCache = null;
  invalidateGradientCache();
}

// ─── Boot ─────────────────────────────────────────────────────────────────

async function bootstrapBar(): Promise<void> {
  bindControls();

  try {
    await waitForVoiceToTextBridge();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    applyState("ERROR");
    applyErrorMessage(`Startup bridge failed: ${message}`);
    return;
  }

  resizeCanvas();

  // Initialise in HIDDEN — no waveform animation until a session starts.
  applyState("HIDDEN");
  applyOverlayMode("PASSIVE");
  syncPauseButtonAffordance("HIDDEN");
  clearAllHudButtonHoverSuppression();
  stopWaveform();

  void controller.init();
}

document.addEventListener("DOMContentLoaded", () => {
  void bootstrapBar();
});
