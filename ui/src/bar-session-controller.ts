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
 * The bar stays INTERACTIVE for the full visible lifecycle and only reverts
 * to PASSIVE after hide/stop.
 */

import type { BarState, AppConfig, LlmRequestOptions, TranscriptResult } from "./types.ts";
import { transition, type BarEvent } from "./bar-state-machine.ts";
import { detectStopWord, stripStopWord } from "./stop-word.ts";
import { SonioxClient } from "./soniox-client.ts";
import {
  loadCustomStopWordPreference,
  loadLlmBaseUrlPreference,
  loadLlmModelPreference,
  loadLlmProviderPreference,
  loadPreferences,
  loadReminderBeepEnabledPreference,
} from "./storage.ts";

const REMINDER_INTERVAL_MS   = 60_000;
const SUCCESS_AUTO_RETURN_MS  = 450;
const ERROR_AUTO_RETURN_MS    = 2_000;
const STARTUP_MISSING_KEY_ERROR_MESSAGE = "Soniox API key is missing. Open Settings and add your key.";
const STREAM_INTERRUPTED_ERROR_MESSAGE = "Connection interrupted. Retrying…";
const STREAM_RESTART_FAILED_ERROR_MESSAGE = "Could not reconnect to Soniox. Check your key/network, then retry.";
const INSERT_FAILED_ERROR_MESSAGE = "Could not insert text. Check accessibility permission, then retry.";
const SESSION_START_FAILED_PREFIX = "Could not start listening";
const XAI_PROVIDER = "xai";
const GEMINI_PROVIDER = "gemini";
const OPENAI_COMPATIBLE_PROVIDER = "openai_compatible";
const DEFAULT_XAI_MODEL = "grok-4-1-fast-non-reasoning";
const DEFAULT_OPENAI_COMPATIBLE_MODEL = "gpt-4o-mini";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = "https://api.openai.com/v1";

export type OverlayMode = "PASSIVE" | "INTERACTIVE";

export type StateChangeCallback        = (state: BarState) => void;
export type TranscriptChangeCallback   = (result: TranscriptResult) => void;
export type OverlayModeChangeCallback  = (mode: OverlayMode) => void;
export type ErrorMessageChangeCallback = (message: string | null) => void;

export class BarSessionController {
  private state: BarState = "HIDDEN";
  private config: AppConfig | null = null;
  private client: SonioxClient;
  private reminderTimer: ReturnType<typeof setInterval> | null = null;
  private unlistenToggle: (() => void) | null = null;
  private startAttemptId = 0;
  private isFinalizingAfterStopWord = false;

  // Overlay interaction mode
  private overlayMode: OverlayMode = "PASSIVE";
  private currentErrorMessage: string | null = null;

  onStateChange:        StateChangeCallback       | null = null;
  onTranscriptChange:   TranscriptChangeCallback  | null = null;
  onOverlayModeChange:  OverlayModeChangeCallback | null = null;
  onErrorMessageChange: ErrorMessageChangeCallback | null = null;

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
      const startAttemptId = this.nextStartAttemptId();
      await this.startSession(startAttemptId);
    } else {
      this.invalidateStartAttempt();
      await this.stopSession();
    }
  }

  async handleClose(): Promise<void> {
    await this.stopSession();
  }

  // ─── Overlay interaction mode ─────────────────────────────────────────────

  /** Enter INTERACTIVE mode: disable native click-through while HUD is visible. */
  private async enterOverlayInteractive(): Promise<void> {
    await window.voiceToText.setMouseEvents(false).catch((error: unknown) => {
      console.error("[session] setMouseEvents(false) failed", error);
    });

    if (this.overlayMode === "INTERACTIVE") return;

    this.overlayMode = "INTERACTIVE";
    this.onOverlayModeChange?.(this.overlayMode);
  }

  /** Revert to PASSIVE mode: restore native click-through when HUD hides/stops. */
  private async revertOverlayPassive(): Promise<void> {
    if (this.overlayMode === "PASSIVE") return;

    await window.voiceToText.setMouseEvents(true);
    this.overlayMode = "PASSIVE";
    this.onOverlayModeChange?.(this.overlayMode);
  }

  // ─── Session lifecycle ────────────────────────────────────────────────────

  private async startSession(startAttemptId: number): Promise<void> {
    this.isFinalizingAfterStopWord = false;
    await this.applyEvent("TOGGLE"); // HIDDEN → CONNECTING
    if (!this.isStartAttemptCurrent(startAttemptId)) return;

    try {
      await window.voiceToText.showBar();
      if (!this.isStartAttemptCurrent(startAttemptId)) return;
      // Enter interactive mode so HUD buttons are reachable immediately.
      await this.enterOverlayInteractive();
      if (!this.isStartAttemptCurrent(startAttemptId)) return;

      const perm = await window.voiceToText.ensureMicrophonePermission();
      if (!this.isStartAttemptCurrent(startAttemptId)) return;
      if (!perm.granted) {
        await this.handleStartupPermissionDenied("PERMISSION_DENIED");
        return;
      }

      // Pre-check accessibility before the user speaks — fail early with
      // actionable guidance instead of waiting until text insertion.
      const accessibility = await window.voiceToText.ensureAccessibilityPermission();
      if (!this.isStartAttemptCurrent(startAttemptId)) return;
      if (!accessibility.granted) {
        await this.handleStartupPermissionDenied("CONNECTION_ERROR");
        return;
      }

      const apiKey = await window.voiceToText.getSonioxKey();
      if (!this.isStartAttemptCurrent(startAttemptId)) return;
      if (!apiKey) {
        await this.applyEvent("CONNECTION_ERROR");
        await this.handleStartupError(STARTUP_MISSING_KEY_ERROR_MESSAGE);
        return;
      }

      const prefs = loadPreferences();
      const context = {
        terms: prefs.sonioxTerms,
        translationTerms: prefs.sonioxTranslationTerms,
      };

      this.client.onTranscript = (result) => {
        if (this.state !== "LISTENING") return;
        if (!this.config) return;
        if (this.isFinalizingAfterStopWord) return;

        const stopWord = loadCustomStopWordPreference(this.config.voice.stop_word);
        const liveTranscript = combineTranscriptText(result.finalText, result.interimText);
        if (detectStopWord(liveTranscript, stopWord)) {
          this.isFinalizingAfterStopWord = true;
          void this.handleStopWordDetected(liveTranscript, stopWord);
          return;
        }

        this.onTranscriptChange?.(result);
      };

      this.client.onError = (error) => {
        console.error("[soniox]", error);
        // Route mid-session stream failure through the state machine.
        // LISTENING/PROCESSING both handle CONNECTION_ERROR → ERROR.
        void this.handleStreamError();
      };

      await this.client.start(apiKey, context);
      if (!this.isStartAttemptCurrent(startAttemptId)) {
        await this.stopAudioPipeline();
        return;
      }
      await window.voiceToText.setMicState(true);
      if (!this.isStartAttemptCurrent(startAttemptId)) {
        await this.stopAudioPipeline();
        return;
      }

      await this.applyEvent("CONNECTED"); // CONNECTING → LISTENING
      this.startReminderBeep();
    } catch (error) {
      if (!this.isStartAttemptCurrent(startAttemptId)) return;
      console.error("[session] start failed", error);
      await this.applyEvent("CONNECTION_ERROR");
      await this.handleStartupError(
        `${SESSION_START_FAILED_PREFIX}: ${formatErrorMessage(error)}`
      );
    }
  }

  private async stopAudioPipeline(): Promise<void> {
    this.stopReminderBeep();
    this.client.stop();
    await window.voiceToText.setMicState(false);
  }

  private async stopSession(): Promise<void> {
    this.invalidateStartAttempt();
    this.isFinalizingAfterStopWord = false;
    await this.stopAudioPipeline().catch((error: unknown) => {
      console.error("[session] stopAudioPipeline failed", error);
    });
    await this.applyEvent("CLOSE").catch((error: unknown) => {
      console.error("[session] CLOSE transition failed", error);
    });
    await window.voiceToText.hideBar().catch((error: unknown) => {
      console.error("[session] hideBar failed", error);
    });
    // Restore pass-through only when the HUD has been hidden/stopped.
    await this.revertOverlayPassive().catch((error: unknown) => {
      console.error("[session] revertOverlayPassive failed", error);
    });
  }

  // ─── Error recovery ───────────────────────────────────────────────────────

  /**
   * Startup error — session never reached LISTENING.
   * Keep the HUD visible with an actionable error until user close/retry.
   */
  private async handleStartupError(message: string): Promise<void> {
    await this.stopAudioPipeline().catch((error: unknown) => {
      console.error("[session] stopAudioPipeline failed during startup error", error);
    });
    this.setErrorMessage(message);
  }

  private async handleStartupPermissionDenied(event: BarEvent): Promise<void> {
    await this.applyEvent(event);
    await this.stopSession();
  }

  /**
   * Mid-session stream error — session was live.
   * Show ERROR for the contract duration, then auto-return to LISTENING per
   * contract (ERROR → AUTO_RETURN → LISTENING), resuming the reminder beep.
   */
  private async handleStreamError(): Promise<void> {
    await this.stopAudioPipeline().catch((error: unknown) => {
      console.error("[session] stopAudioPipeline failed during stream error", error);
    });
    await this.applyEvent("CONNECTION_ERROR"); // LISTENING/PROCESSING → ERROR
    this.setErrorMessage(STREAM_INTERRUPTED_ERROR_MESSAGE);

    await new Promise<void>((resolve) => setTimeout(resolve, ERROR_AUTO_RETURN_MS));

    if (this.state !== "ERROR") return; // User closed during error display.

    // Attempt to restart the stream.
    try {
      const apiKey = await window.voiceToText.getSonioxKey();
      if (!apiKey) {
        this.setErrorMessage(STARTUP_MISSING_KEY_ERROR_MESSAGE);
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
      this.setErrorMessage(
        `${STREAM_RESTART_FAILED_ERROR_MESSAGE} ${formatErrorMessage(restartError)}`
      );
    }
  }

  // ─── Transcript pipeline ──────────────────────────────────────────────────

  private async handleStopWordDetected(
    rawTranscript: string,
    stopWord: string
  ): Promise<void> {
    const commandText = stripStopWord(rawTranscript, stopWord);
    this.client.resetTranscript();

    if (!commandText.trim()) {
      this.isFinalizingAfterStopWord = false;
      await this.stopSession();
      return;
    }

    this.onTranscriptChange?.({ finalText: commandText, interimText: "" });

    await this.applyEvent("STOP_WORD_DETECTED"); // LISTENING → PROCESSING
    this.stopReminderBeep();

    const prefs = loadPreferences();
    let correctedText = commandText;

    if (!prefs.skipLlm) {
      const llmOptions = this.resolveLlmRequestOptions();
      const hasProviderKey =
        llmOptions.provider === OPENAI_COMPATIBLE_PROVIDER
          ? await window.voiceToText.hasOpenaiCompatibleKey()
          : llmOptions.provider === GEMINI_PROVIDER
            ? await window.voiceToText.hasGeminiKey()
            : await window.voiceToText.hasXaiKey();

      if (!hasProviderKey) {
        await this.applyEvent("LLM_DONE"); // PROCESSING → INSERTING
      } else {
        try {
          correctedText = await window.voiceToText.correctTranscript(
            commandText,
            prefs.outputLang,
            llmOptions,
          );
          await this.applyEvent("LLM_DONE"); // PROCESSING → INSERTING
        } catch (error) {
          console.error("[llm] correction failed, using raw text", error);
          await this.applyEvent("LLM_ERROR"); // PROCESSING → INSERTING (raw)
        }
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
      this.isFinalizingAfterStopWord = false;
      this.client.resetTranscript();
      this.startReminderBeep();
    } else {
      console.error("[insert] failed", result.error);
      await this.applyEvent("INSERT_ERROR"); // INSERTING → ERROR
      await this.stopAudioPipeline();
      this.setErrorMessage(result.error ?? INSERT_FAILED_ERROR_MESSAGE);
    }
  }

  // ─── Reminder beep ───────────────────────────────────────────────────────

  private startReminderBeep(): void {
    this.stopReminderBeep();

    if (!loadReminderBeepEnabledPreference()) {
      return;
    }

    this.reminderTimer = setInterval(() => {
      if (this.state === "LISTENING") {
        playReminderBeep();
      }
    }, REMINDER_INTERVAL_MS);
  }

  private resolveLlmRequestOptions(): LlmRequestOptions {
    const config = this.config;
    const provider = loadLlmProviderPreference(
      config?.llm.provider ?? XAI_PROVIDER,
    );
    const model = loadLlmModelPreference(configuredDefaultModelForProvider(config, provider));
    const baseUrl = loadLlmBaseUrlPreference(
      config?.llm.base_url ?? DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
    );

    return {
      provider,
      model,
      baseUrl,
    };
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

    if (this.state === "HIDDEN") {
      await this.revertOverlayPassive();
      this.clearErrorMessage();
    } else {
      await this.enterOverlayInteractive();
      if (this.state !== "ERROR") {
        this.clearErrorMessage();
      }
    }

    this.onStateChange?.(this.state);
  }

  private setErrorMessage(message: string): void {
    this.currentErrorMessage = message;
    this.onErrorMessageChange?.(message);
  }

  private clearErrorMessage(): void {
    if (this.currentErrorMessage === null) return;
    this.currentErrorMessage = null;
    this.onErrorMessageChange?.(null);
  }

  private nextStartAttemptId(): number {
    this.startAttemptId += 1;
    return this.startAttemptId;
  }

  private invalidateStartAttempt(): void {
    this.startAttemptId += 1;
  }

  private isStartAttemptCurrent(startAttemptId: number): boolean {
    return this.startAttemptId === startAttemptId;
  }
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function combineTranscriptText(finalText: string, interimText: string): string {
  return `${finalText} ${interimText}`.trim();
}

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
  } catch (error) {
    console.warn("[audio] reminder beep skipped", formatErrorMessage(error));
  }
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error.trim();
  }

  return "Unknown error";
}

function defaultModelForProvider(provider: string): string {
  if (provider === OPENAI_COMPATIBLE_PROVIDER) {
    return DEFAULT_OPENAI_COMPATIBLE_MODEL;
  }
  if (provider === GEMINI_PROVIDER) {
    return DEFAULT_GEMINI_MODEL;
  }

  return DEFAULT_XAI_MODEL;
}

function configuredDefaultModelForProvider(config: AppConfig | null, provider: string): string {
  if (config?.llm.provider === provider && config.llm.model.trim().length > 0) {
    return config.llm.model;
  }

  return defaultModelForProvider(provider);
}
