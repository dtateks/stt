/**
 * Bar session controller.
 *
 * Orchestrates the full transcript pipeline:
 *   start audio → Soniox WS → stop-word detect → LLM correct → insert text
 *
 * All side effects (bridge calls, timers) live here. The state machine and
 * pure logic modules remain side-effect-free.
 *
 * Overlay interaction modes
 * ─────────────────────────
 * PASSIVE  — native window ignores cursor events (default, click-through).
 * INTERACTIVE — cursor events enabled so buttons are reachable by pointer.
 *
 * Mode is owned here as explicit app state, not inferred from DOM hover.
 * The bar enters INTERACTIVE on session start and reverts to PASSIVE after
 * OVERLAY_IDLE_MS of no pointer activity (reset by pointermove/pointerdown).
 */

import type { BarState, AppConfig, TranscriptResult } from "./types.ts";
import { transition, type BarEvent } from "./bar-state-machine.ts";
import { detectStopWord, stripStopWord } from "./stop-word.ts";
import { SonioxClient } from "./soniox-client.ts";
import { loadPreferences } from "./storage.ts";

const REMINDER_INTERVAL_MS   = 60_000;
const SUCCESS_AUTO_RETURN_MS  = 1_500;
const ERROR_AUTO_RETURN_MS    = 2_000;
/** Revert to passive (click-through) after this many ms of pointer inactivity. */
const OVERLAY_IDLE_MS         = 4_000;

export type OverlayMode = "PASSIVE" | "INTERACTIVE";

export type StateChangeCallback        = (state: BarState) => void;
export type TranscriptChangeCallback   = (result: TranscriptResult) => void;
export type OverlayModeChangeCallback  = (mode: OverlayMode) => void;

export class BarSessionController {
  private state: BarState = "HIDDEN";
  private config: AppConfig | null = null;
  private client: SonioxClient;
  private reminderTimer: ReturnType<typeof setInterval> | null = null;
  private unlistenToggle: (() => void) | null = null;

  // Overlay interaction mode
  private overlayMode: OverlayMode = "PASSIVE";
  private overlayIdleTimer: ReturnType<typeof setTimeout> | null = null;
  private boundPointerActivity: (() => void) | null = null;

  onStateChange:        StateChangeCallback       | null = null;
  onTranscriptChange:   TranscriptChangeCallback  | null = null;
  onOverlayModeChange:  OverlayModeChangeCallback | null = null;

  constructor() {
    this.client = new SonioxClient();
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  async init(): Promise<void> {
    this.config = await window.voiceToText.getConfig();
    this.client.setConfig(this.config.soniox);

    this.unlistenToggle = window.voiceToText.onToggleMic(() => {
      void this.handleToggle();
    });
  }

  destroy(): void {
    this.unlistenToggle?.();
    this.stopOverlayInteractive();
    void this.stopSession();
  }

  getAnalyserNode(): AnalyserNode | null {
    return this.client.getAnalyser();
  }

  getCurrentState(): BarState {
    return this.state;
  }

  getOverlayMode(): OverlayMode {
    return this.overlayMode;
  }

  async handleToggle(): Promise<void> {
    if (this.state === "HIDDEN") {
      await this.startSession();
    } else {
      await this.stopSession();
    }
  }

  async handleClose(): Promise<void> {
    await this.stopSession();
  }

  // ─── Overlay interaction mode ─────────────────────────────────────────────

  /**
   * Enter INTERACTIVE mode: disable native click-through so buttons are
   * reachable. Starts an idle timer that reverts to PASSIVE automatically.
   * Pointer activity on the document resets the timer.
   */
  private async enterOverlayInteractive(): Promise<void> {
    if (this.overlayMode === "INTERACTIVE") {
      // Already interactive — just reset the idle timer.
      this.resetOverlayIdleTimer();
      return;
    }

    this.overlayMode = "INTERACTIVE";
    this.onOverlayModeChange?.(this.overlayMode);
    await window.voiceToText.setMouseEvents(false);

    // Track pointer activity to reset the idle countdown.
    this.boundPointerActivity = () => { this.resetOverlayIdleTimer(); };
    document.addEventListener("pointermove", this.boundPointerActivity, { passive: true });
    document.addEventListener("pointerdown", this.boundPointerActivity, { passive: true });

    this.resetOverlayIdleTimer();
  }

  /**
   * Revert to PASSIVE mode: restore native click-through.
   * Called automatically by the idle timer, or explicitly on session end.
   */
  private async revertOverlayPassive(): Promise<void> {
    if (this.overlayMode === "PASSIVE") return;

    this.overlayMode = "PASSIVE";
    this.onOverlayModeChange?.(this.overlayMode);
    await window.voiceToText.setMouseEvents(true);
  }

  private resetOverlayIdleTimer(): void {
    if (this.overlayIdleTimer !== null) {
      clearTimeout(this.overlayIdleTimer);
    }
    this.overlayIdleTimer = setTimeout(() => {
      void this.revertOverlayPassive();
    }, OVERLAY_IDLE_MS);
  }

  /** Full cleanup of overlay interactive state — called on session end. */
  private stopOverlayInteractive(): void {
    if (this.overlayIdleTimer !== null) {
      clearTimeout(this.overlayIdleTimer);
      this.overlayIdleTimer = null;
    }
    if (this.boundPointerActivity) {
      document.removeEventListener("pointermove", this.boundPointerActivity);
      document.removeEventListener("pointerdown", this.boundPointerActivity);
      this.boundPointerActivity = null;
    }
  }

  // ─── Session lifecycle ────────────────────────────────────────────────────

  private async startSession(): Promise<void> {
    await this.applyEvent("TOGGLE"); // HIDDEN → CONNECTING

    try {
      await window.voiceToText.showBar();
      // Enter interactive mode so HUD buttons are reachable immediately.
      await this.enterOverlayInteractive();

      const perm = await window.voiceToText.ensureMicrophonePermission();
      if (!perm.granted) {
        // Startup failure: ERROR with no stream to recover; close after delay.
        await this.applyEvent("PERMISSION_DENIED");
        await this.handleStartupError();
        return;
      }

      const apiKey = await window.voiceToText.getSonioxKey();
      if (!apiKey) {
        await this.applyEvent("CONNECTION_ERROR");
        await this.handleStartupError();
        return;
      }

      const prefs = loadPreferences();
      const context = {
        terms: prefs.sonioxTerms,
        translationTerms: prefs.sonioxTranslationTerms,
      };

      this.client.onTranscript = (result) => {
        this.onTranscriptChange?.(result);

        if (this.state !== "LISTENING") return;
        if (!this.config) return;

        const stopWord = this.config.voice.stop_word;
        if (detectStopWord(result.finalText, stopWord)) {
          void this.handleStopWordDetected(result.finalText, stopWord);
        }
      };

      this.client.onError = (error) => {
        console.error("[soniox]", error);
        // Route mid-session stream failure through the state machine.
        // LISTENING/PROCESSING both handle CONNECTION_ERROR → ERROR.
        void this.handleStreamError();
      };

      await this.client.start(apiKey, context);
      await window.voiceToText.setMicState(true);

      await this.applyEvent("CONNECTED"); // CONNECTING → LISTENING
      this.startReminderBeep();
    } catch (error) {
      console.error("[session] start failed", error);
      await this.applyEvent("CONNECTION_ERROR");
      await this.handleStartupError();
    }
  }

  private async stopSession(): Promise<void> {
    this.stopReminderBeep();
    this.client.stop();
    await window.voiceToText.setMicState(false);
    await this.applyEvent("CLOSE"); // → HIDDEN
    await window.voiceToText.hideBar();
    // Restore pass-through and tear down overlay interaction.
    this.stopOverlayInteractive();
    await this.revertOverlayPassive();
  }

  // ─── Error recovery ───────────────────────────────────────────────────────

  /**
   * Startup error — session never reached LISTENING.
   * Show ERROR for the contract duration, then close entirely (no stream to
   * resume, no meaningful LISTENING state to return to).
   */
  private async handleStartupError(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ERROR_AUTO_RETURN_MS));
    // Only act if we're still in ERROR (not if user pressed close in the meantime).
    if (this.state === "ERROR") {
      await this.stopSession();
    }
  }

  /**
   * Mid-session stream error — session was live.
   * Show ERROR for the contract duration, then auto-return to LISTENING per
   * contract (ERROR → AUTO_RETURN → LISTENING), resuming the reminder beep.
   */
  private async handleStreamError(): Promise<void> {
    this.stopReminderBeep();
    this.client.stop();
    await window.voiceToText.setMicState(false);
    await this.applyEvent("CONNECTION_ERROR"); // LISTENING/PROCESSING → ERROR

    await new Promise<void>((resolve) => setTimeout(resolve, ERROR_AUTO_RETURN_MS));

    if (this.state !== "ERROR") return; // User closed during error display.

    // Attempt to restart the stream.
    try {
      const apiKey = await window.voiceToText.getSonioxKey();
      if (!apiKey) {
        await this.stopSession();
        return;
      }

      const prefs = loadPreferences();
      await this.client.start(apiKey, {
        terms: prefs.sonioxTerms,
        translationTerms: prefs.sonioxTranslationTerms,
      });
      await window.voiceToText.setMicState(true);

      await this.applyEvent("AUTO_RETURN"); // ERROR → LISTENING
      this.startReminderBeep();
    } catch (restartError) {
      console.error("[session] stream restart failed", restartError);
      await this.stopSession();
    }
  }

  // ─── Transcript pipeline ──────────────────────────────────────────────────

  private async handleStopWordDetected(
    rawFinal: string,
    stopWord: string
  ): Promise<void> {
    const commandText = stripStopWord(rawFinal, stopWord);
    this.client.resetTranscript();

    if (!commandText.trim()) {
      await this.stopSession();
      return;
    }

    await this.applyEvent("STOP_WORD_DETECTED"); // LISTENING → PROCESSING
    this.stopReminderBeep();

    const prefs = loadPreferences();
    let correctedText = commandText;

    const hasXai = await window.voiceToText.hasXaiKey();
    if (hasXai && !prefs.skipLlm) {
      try {
        correctedText = await window.voiceToText.correctTranscript(
          commandText,
          prefs.outputLang
        );
        await this.applyEvent("LLM_DONE"); // PROCESSING → INSERTING
      } catch (error) {
        console.error("[llm] correction failed, using raw text", error);
        await this.applyEvent("LLM_ERROR"); // PROCESSING → INSERTING (raw)
      }
    } else {
      await this.applyEvent("LLM_DONE"); // PROCESSING → INSERTING
    }

    const result = await window.voiceToText.insertText(correctedText, {
      enterMode: prefs.enterMode,
    });

    if (result.success) {
      await this.applyEvent("INSERT_SUCCESS"); // INSERTING → SUCCESS
      await new Promise<void>((resolve) =>
        setTimeout(resolve, SUCCESS_AUTO_RETURN_MS)
      );
      await this.applyEvent("AUTO_RETURN"); // SUCCESS → LISTENING
      this.client.resetTranscript();
      this.startReminderBeep();
    } else {
      console.error("[insert] failed", result.error);
      await this.applyEvent("INSERT_ERROR"); // INSERTING → ERROR
      await new Promise<void>((resolve) =>
        setTimeout(resolve, ERROR_AUTO_RETURN_MS)
      );
      await this.applyEvent("AUTO_RETURN"); // ERROR → LISTENING
      this.startReminderBeep();
    }
  }

  // ─── Reminder beep ───────────────────────────────────────────────────────

  private startReminderBeep(): void {
    this.stopReminderBeep();
    this.reminderTimer = setInterval(() => {
      if (this.state === "LISTENING") {
        playReminderBeep();
      }
    }, REMINDER_INTERVAL_MS);
  }

  private stopReminderBeep(): void {
    if (this.reminderTimer !== null) {
      clearInterval(this.reminderTimer);
      this.reminderTimer = null;
    }
  }

  // ─── State machine ────────────────────────────────────────────────────────

  private async applyEvent(event: BarEvent): Promise<void> {
    const result = transition(this.state, event);
    this.state = result.next;
    this.onStateChange?.(this.state);
  }
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function playReminderBeep(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);

    osc.onended = () => { void ctx.close(); };
  } catch {
    // Non-critical — audio context may be suspended.
  }
}
