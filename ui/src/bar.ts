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
  waveformShouldRun,
  waveformShouldBeVisible,
} from "./bar-render.ts";
import { createWaveformAnimator, type WaveformAnimator } from "./waveform-animator.ts";

const CONNECTING_LABEL_DELAY_MS = 150;

// ─── DOM refs ─────────────────────────────────────────────────────────────

const hud             = document.getElementById("hud")               as HTMLDivElement;
const waveformCanvas  = document.getElementById("waveform")          as HTMLCanvasElement;
const transcriptFinalEl   = document.getElementById("transcript-final")   as HTMLSpanElement;
const transcriptInterimEl = document.getElementById("transcript-interim") as HTMLSpanElement;
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
const waveformAnimator: WaveformAnimator = createWaveformAnimator({
  canvas: waveformCanvas,
  getAnalyser: () => controller.getAnalyserNode(),
});
let connectingLabelTimer: ReturnType<typeof setTimeout> | null = null;
let shouldShowConnectingLabel = true;
let didBootstrap = false;

// ─── State rendering — thin wrappers that bind module DOM refs ────────────

function applyState(state: BarState): void {
  renderApplyState(
    state,
    hud,
    stateLabelEl,
    transcriptFinalEl,
    transcriptInterimEl,
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
  renderApplyTranscript(result, hud, transcriptFinalEl, transcriptInterimEl);
}

function applyErrorMessage(message: string | null): void {
  renderApplyErrorMessage(message, transcriptFinalEl, transcriptInterimEl);
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

async function consumePendingMicToggleIfNeeded(): Promise<void> {
  const shouldToggle = await window.voiceToText?.consumePendingMicToggle?.() ?? false;
  if (!shouldToggle) {
    return;
  }

  await controller.handleToggle();
}

function bindVisibilityRegainPendingToggleConsumer(): void {
  document.onvisibilitychange = () => {
    if (document.visibilityState !== "visible") {
      return;
    }

    void consumePendingMicToggleIfNeeded().catch((error: unknown) => {
      console.error("[bar] pending-toggle consume failed on visibility regain", error);
    });
  };
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
    waveformAnimator.start();
  } else if (waveformShouldBeVisible(state)) {
    // Non-audio visible states: render one static idle frame, then stop
    // the RAF loop. Visually identical but eliminates continuous compositor load.
    waveformAnimator.stop();
    waveformAnimator.drawStaticIdleFrame();
  } else {
    waveformAnimator.stop();
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

// ─── Boot ─────────────────────────────────────────────────────────────────

async function bootstrapBar(): Promise<void> {
  if (didBootstrap) {
    return;
  }
  didBootstrap = true;

  bindControls();
  bindVisibilityRegainPendingToggleConsumer();

  try {
    await waitForVoiceToTextBridge();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    applyState("ERROR");
    applyErrorMessage(`Startup bridge failed: ${message}`);
    return;
  }

  waveformAnimator.resize();

  // Initialise in HIDDEN — no waveform animation until a session starts.
  applyState("HIDDEN");
  applyOverlayMode("PASSIVE");
  syncPauseButtonAffordance("HIDDEN");
  clearAllHudButtonHoverSuppression();
  waveformAnimator.stop();

  void controller.init().then(() => {
    return consumePendingMicToggleIfNeeded();
  }).catch((error: unknown) => {
    console.error("[bar] pending-toggle bootstrap consume failed", error);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  void bootstrapBar();
});
