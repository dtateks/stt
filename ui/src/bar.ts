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
const settingsBtn     = document.getElementById("hud-settings-btn")  as HTMLButtonElement;
const closeBtn        = document.getElementById("hud-close-btn")     as HTMLButtonElement;

const HUD_BUTTONS: HTMLButtonElement[] = [settingsBtn, closeBtn];

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

// ─── Waveform ─────────────────────────────────────────────────────────────

let rafId: number | null = null;
const canvasCtx = waveformCanvas.getContext("2d");

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
  const W = waveformCanvas.width;
  const H = waveformCanvas.height;

  canvasCtx.clearRect(0, 0, W, H);

  if (!analyser) {
    drawIdleWaveform(W, H);
    return;
  }

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  analyser.getByteFrequencyData(dataArray);

  drawAudioWaveform(dataArray, W, H);
}

function drawIdleWaveform(W: number, H: number): void {
  if (!canvasCtx) return;

  const centerY = H / 2;
  const now = performance.now() / 1000;
  const bars = 12;
  const barW = 2;
  const gap = (W - bars * barW) / (bars + 1);

  for (let i = 0; i < bars; i++) {
    const x = gap + i * (barW + gap);
    const phase = (i / bars) * Math.PI * 2;
    const amplitude = (Math.sin(now * 1.2 + phase) * 0.5 + 0.5) * 4 + 2;

    canvasCtx.fillStyle = "rgba(110, 117, 129, 0.4)";
    canvasCtx.beginPath();
    canvasCtx.roundRect(x, centerY - amplitude / 2, barW, amplitude, 1);
    canvasCtx.fill();
  }
}

function drawAudioWaveform(data: Uint8Array, W: number, H: number): void {
  if (!canvasCtx) return;

  const state = hud.dataset.state as BarState;
  const isListening = state === "LISTENING";
  const centerY = H / 2;
  const bars = 12;
  const barW = 2;
  const gap = (W - bars * barW) / (bars + 1);
  const maxBarH = H * 0.85;

  const bucketSize = Math.floor(data.length / bars);

  for (let i = 0; i < bars; i++) {
    let sum = 0;
    for (let j = 0; j < bucketSize; j++) {
      sum += data[i * bucketSize + j];
    }
    const avg = sum / bucketSize / 255;
    const barH = Math.max(2, avg * maxBarH);
    const x = gap + i * (barW + gap);

    if (isListening) {
      const gradient = canvasCtx.createLinearGradient(x, centerY - barH / 2, x, centerY + barH / 2);
      gradient.addColorStop(0, `rgba(56, 232, 255, ${0.4 + avg * 0.6})`);
      gradient.addColorStop(1, `rgba(167, 139, 250, ${0.3 + avg * 0.5})`);
      canvasCtx.fillStyle = gradient;
    } else {
      canvasCtx.fillStyle = "rgba(110, 117, 129, 0.35)";
    }

    canvasCtx.beginPath();
    canvasCtx.roundRect(x, centerY - barH / 2, barW, barH, 1);
    canvasCtx.fill();
  }
}

// ─── Controls ─────────────────────────────────────────────────────────────

function bindControls(): void {
  settingsBtn.addEventListener("click", () => {
    if (!window.voiceToText) {
      return;
    }

    void window.voiceToText.showSettings();
  });

  closeBtn.addEventListener("click", () => {
    if (!window.voiceToText) {
      return;
    }

    void controller.handleClose().catch((error: unknown) => {
      console.error("[bar] close handler failed; retrying hideBar", error);
      void window.voiceToText?.hideBar();
    });
  });
}

// ─── State transitions ────────────────────────────────────────────────────

controller.onStateChange = (state) => {
  applyState(state);

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
  stopWaveform();

  void controller.init();
}

document.addEventListener("DOMContentLoaded", () => {
  void bootstrapBar();
});
