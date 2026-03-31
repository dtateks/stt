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
  ecgPulse,
  HEARTBEAT_IDLE_BPM,
  HEARTBEAT_ACTIVE_BPM_BOOST,
  HEARTBEAT_VISIBLE_CYCLES,
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

const HUD_BUTTONS: HTMLButtonElement[] = [
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
    if (controller.getCurrentState() !== "CONNECTING") {
      return;
    }

    shouldShowConnectingLabel = true;
    applyState("CONNECTING");
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
  drawWaveform();
}

function stopWaveform(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  clearWaveform();
}

function clearWaveform(): void {
  if (!canvasCtx) return;
  canvasCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
}

function drawWaveform(): void {
  rafId = requestAnimationFrame(drawWaveform);

  if (!canvasCtx) return;

  const analyser = controller.getAnalyserNode();
  const layout = getWaveformLayout(waveformCanvas.width, waveformCanvas.height);

  canvasCtx.clearRect(0, 0, layout.width, layout.height);

  if (!analyser) {
    drawIdleHeartbeat(layout);
    return;
  }

  const dataArray = getAnalyserSampleBuffer(analyser);
  analyser.getByteTimeDomainData(dataArray);

  drawAudioHeartbeat(dataArray, layout);
}

function computeRmsEnergy(data: Uint8Array<ArrayBuffer>): number {
  let sumSquares = 0;
  for (let i = 0; i < data.length; i++) {
    const normalized = (data[i] - 128) / 128;
    sumSquares += normalized * normalized;
  }
  return Math.min(1.0, Math.sqrt(sumSquares / data.length) * 3.5);
}

function drawHeartbeatTrace(
  layout: WaveformLayout,
  bpm: number,
  amplitude: number,
  strokeStyle: string | CanvasGradient,
  glowStyle: string | CanvasGradient | null,
): void {
  if (!canvasCtx) return;

  const now = performance.now() / 1000;
  const beatsPerSecond = bpm / 60;
  const windowDuration = HEARTBEAT_VISIBLE_CYCLES / beatsPerSecond;

  canvasCtx.lineCap = "round";
  canvasCtx.lineJoin = "round";

  const path = new Path2D();

  for (let i = 0; i < layout.pointCount; i++) {
    const t = i / (layout.pointCount - 1);
    const x = t * layout.width;

    const timeAtPoint = now - (1 - t) * windowDuration;
    const rawPhase = (timeAtPoint * beatsPerSecond) % 1;
    const phase = rawPhase < 0 ? rawPhase + 1 : rawPhase;

    const pulse = ecgPulse(phase);
    const y = layout.centerY - pulse * layout.maxAmplitude * amplitude;

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
    0.55,
    "rgba(110, 117, 129, 0.5)",
    null,
  );
}

function drawAudioHeartbeat(data: Uint8Array<ArrayBuffer>, layout: WaveformLayout): void {
  const rawEnergy = computeRmsEnergy(data);
  smoothedEnergy += (rawEnergy - smoothedEnergy) * HEARTBEAT_ENERGY_SMOOTHING;

  const energy = smoothedEnergy;
  const bpm = HEARTBEAT_IDLE_BPM + energy * HEARTBEAT_ACTIVE_BPM_BOOST;
  const amplitude = HEARTBEAT_MIN_AMPLITUDE + energy * (1 - HEARTBEAT_MIN_AMPLITUDE);

  const glowOpacity = 0.08 + energy * 0.12;
  const lineOpacity = 0.5 + energy * 0.4;

  const gradient = canvasCtx!.createLinearGradient(0, 0, layout.width, 0);
  gradient.addColorStop(0, `rgba(56, 232, 255, ${lineOpacity})`);
  gradient.addColorStop(1, `rgba(167, 139, 250, ${lineOpacity * 0.85})`);

  const glowGradient = canvasCtx!.createLinearGradient(0, 0, layout.width, 0);
  glowGradient.addColorStop(0, `rgba(56, 232, 255, ${glowOpacity})`);
  glowGradient.addColorStop(1, `rgba(167, 139, 250, ${glowOpacity * 0.8})`);

  drawHeartbeatTrace(layout, bpm, amplitude, gradient, glowGradient);
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
  if (state === "CONNECTING") {
    shouldShowConnectingLabel = false;
    scheduleConnectingLabelPresentation();
  } else {
    shouldShowConnectingLabel = true;
    clearConnectingLabelTimer();
  }

  applyState(state);

  if (state === "HIDDEN" || state === "CONNECTING") {
    clearAllHudButtonHoverSuppression();
    clearHudButtonFocus();
  }

  if (waveformShouldRun(state)) {
    startWaveform();
  } else {
    // Stop animation for every non-LISTENING state including HIDDEN, CONNECTING,
    // PROCESSING, INSERTING, SUCCESS, and ERROR. This prevents stale frames
    // from accumulating during non-audio states and blanks the canvas cleanly
    // before the native window hide transition completes.
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
  clearAllHudButtonHoverSuppression();
  stopWaveform();

  void controller.init();
}

document.addEventListener("DOMContentLoaded", () => {
  void bootstrapBar();
});
