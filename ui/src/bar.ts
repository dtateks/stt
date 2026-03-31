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
} from "./bar-render.ts";

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

// ─── State rendering — thin wrappers that bind module DOM refs ────────────

function applyState(state: BarState): void {
  renderApplyState(state, hud, stateLabelEl, transcriptFinalEl, transcriptInterimEl, transcriptPromptEl);
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

function getAnalyserFrequencyBuffer(analyser: AnalyserNode): Uint8Array<ArrayBuffer> {
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
    drawIdleWaveform(layout);
    return;
  }

  const dataArray = getAnalyserFrequencyBuffer(analyser);
  analyser.getByteFrequencyData(dataArray);

  drawAudioWaveform(dataArray, layout);
}

function drawIdleWaveform(layout: WaveformLayout): void {
  if (!canvasCtx) return;

  const now = performance.now() / 1000;

  for (let i = 0; i < layout.barCount; i++) {
    const x = layout.gap + i * (layout.barWidth + layout.gap);
    const phase = (i / layout.barCount) * Math.PI * 2;
    const amplitude = (Math.sin(now * 1.2 + phase) * 0.5 + 0.5) * 4 + 2;

    canvasCtx.fillStyle = "rgba(110, 117, 129, 0.4)";
    canvasCtx.beginPath();
    canvasCtx.roundRect(x, layout.centerY - amplitude / 2, layout.barWidth, amplitude, 1);
    canvasCtx.fill();
  }
}

function drawAudioWaveform(data: Uint8Array<ArrayBuffer>, layout: WaveformLayout): void {
  if (!canvasCtx) return;

  const state = hud.dataset.state as BarState;
  const isListening = state === "LISTENING";

  const bucketSize = Math.max(1, Math.floor(data.length / layout.barCount));

  for (let i = 0; i < layout.barCount; i++) {
    const bucketStart = i * bucketSize;
    if (bucketStart >= data.length) break;

    let sum = 0;
    const bucketEnd = Math.min(bucketStart + bucketSize, data.length);
    for (let j = bucketStart; j < bucketEnd; j++) {
      sum += data[j];
    }

    const avg = sum / (bucketEnd - bucketStart) / 255;
    const barH = Math.max(2, avg * layout.maxBarHeight);
    const x = layout.gap + i * (layout.barWidth + layout.gap);

    if (isListening) {
      const gradient = canvasCtx.createLinearGradient(
        x,
        layout.centerY - barH / 2,
        x,
        layout.centerY + barH / 2,
      );
      gradient.addColorStop(0, `rgba(56, 232, 255, ${0.4 + avg * 0.6})`);
      gradient.addColorStop(1, `rgba(167, 139, 250, ${0.3 + avg * 0.5})`);
      canvasCtx.fillStyle = gradient;
    } else {
      canvasCtx.fillStyle = "rgba(110, 117, 129, 0.35)";
    }

    canvasCtx.beginPath();
    canvasCtx.roundRect(x, layout.centerY - barH / 2, layout.barWidth, barH, 1);
    canvasCtx.fill();
  }
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
