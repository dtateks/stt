/**
 * Bar HUD entry point.
 *
 * Owns: DOM rendering, waveform animation, state-driven UI updates,
 *       overlay mode indicator.
 * Delegates: session orchestration → BarSessionController.
 */

import "./bar.css";
import type { BarState, TranscriptResult } from "./types.ts";
import { BarSessionController, type OverlayMode } from "./bar-session-controller.ts";

// ─── DOM refs ─────────────────────────────────────────────────────────────

const hud             = document.getElementById("hud")               as HTMLDivElement;
const waveformCanvas  = document.getElementById("waveform")          as HTMLCanvasElement;
const transcriptFinalEl   = document.getElementById("transcript-final")   as HTMLSpanElement;
const transcriptInterimEl = document.getElementById("transcript-interim") as HTMLSpanElement;
const transcriptPromptEl  = document.getElementById("transcript-prompt")  as HTMLSpanElement;
const stateLabelEl    = document.getElementById("hud-state-label")   as HTMLSpanElement;
const settingsBtn     = document.getElementById("hud-settings-btn")  as HTMLButtonElement;
const closeBtn        = document.getElementById("hud-close-btn")     as HTMLButtonElement;

// ─── Controller ───────────────────────────────────────────────────────────

const controller = new BarSessionController();

// ─── State rendering ──────────────────────────────────────────────────────

const STATE_LABELS: Record<BarState, string> = {
  HIDDEN:     "",
  CONNECTING: "Connecting",
  LISTENING:  "Listening",
  PROCESSING: "Processing",
  INSERTING:  "Inserting",
  SUCCESS:    "Inserted",
  ERROR:      "Error",
};

function applyState(state: BarState): void {
  hud.dataset.state = state;
  stateLabelEl.textContent = STATE_LABELS[state];

  if (state === "HIDDEN" || state === "CONNECTING") {
    clearTranscript();
  }

  syncPromptVisibility();
}

function clearTranscript(): void {
  transcriptFinalEl.textContent = "";
  transcriptInterimEl.textContent = "";
  syncPromptVisibility();
}

function syncPromptVisibility(): void {
  const hasFinal   = Boolean(transcriptFinalEl.textContent);
  const hasInterim = Boolean(transcriptInterimEl.textContent);
  const isListening = hud.dataset.state === "LISTENING";

  transcriptPromptEl.hidden = hasFinal || hasInterim || !isListening;
}

function applyTranscript(result: TranscriptResult): void {
  if (hud.dataset.state !== "LISTENING") return;

  transcriptFinalEl.textContent = result.finalText;
  transcriptInterimEl.textContent = result.interimText;
  syncPromptVisibility();
}

// ─── Overlay mode ──────────────────────────────────────────────────────────

function applyOverlayMode(mode: OverlayMode): void {
  // Reflect mode on the HUD element so CSS can adjust affordances.
  hud.dataset.overlay = mode.toLowerCase();
}

// ─── Waveform ─────────────────────────────────────────────────────────────

let rafId: number | null = null;
const canvasCtx = waveformCanvas.getContext("2d");

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
  const analyser = controller.getAnalyserNode();

  rafId = requestAnimationFrame(drawWaveform);

  if (!canvasCtx) return;

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
    void window.voiceToText.showSettings();
  });

  closeBtn.addEventListener("click", () => {
    void controller.handleClose();
  });
}

// ─── State transitions ────────────────────────────────────────────────────

controller.onStateChange = (state) => {
  applyState(state);

  if (state === "LISTENING") {
    startWaveform();
  } else if (state === "HIDDEN") {
    // Stop animation completely — window may briefly remain visible during
    // the native hide transition; blank canvas prevents stale frames.
    stopWaveform();
  }
};

controller.onTranscriptChange = (result: TranscriptResult) => {
  applyTranscript(result);
};

controller.onOverlayModeChange = (mode: OverlayMode) => {
  applyOverlayMode(mode);
};

// ─── Canvas sizing ────────────────────────────────────────────────────────

function resizeCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = waveformCanvas.getBoundingClientRect();
  waveformCanvas.width  = rect.width  * dpr;
  waveformCanvas.height = rect.height * dpr;
  canvasCtx?.scale(dpr, dpr);
}

// ─── Boot ─────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  resizeCanvas();
  bindControls();

  // Initialise in HIDDEN — no waveform animation until a session starts.
  applyState("HIDDEN");
  applyOverlayMode("PASSIVE");
  stopWaveform();

  void controller.init();
});
