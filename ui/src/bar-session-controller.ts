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

import type {
  BarState,
  AppConfig,
  LlmRequestOptions,
  SonioxTemporaryApiKeyResult,
  TranscriptResult,
} from "./types.ts";
import { transition, type BarEvent } from "./bar-state-machine.ts";
import {
  detectStopWordWithNormalizedStopWord,
  normalizeStopWord,
  stripStopWord,
} from "./stop-word.ts";
import { SonioxClient } from "./soniox-client.ts";
import {
  loadCustomStopWordPreference,
  loadLlmBaseUrlPreference,
  loadLlmModelPreference,
  loadLlmProviderPreference,
  loadPreferences,
  loadReminderBeepEnabledPreference,
  loadSonioxModelPreference,
} from "./storage.ts";

const REMINDER_INTERVAL_MS   = 60_000;
const ERROR_AUTO_RETURN_MS    = 2_000;
const LLM_CORRECTION_ATTEMPT_COUNT = 3;
const RETRYABLE_LLM_HTTP_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const PROVIDER_API_ERROR_STATUS_PATTERN = /API error \((\d{3})(?: [A-Z_]+)?\):/i;
const RETRYABLE_LLM_ERROR_MESSAGE_PATTERNS = [
  /timed out after/i,
  /error sending request/i,
  /error trying to connect/i,
  /connection reset/i,
  /connection refused/i,
  /dns error/i,
  /network/i,
];
const STARTUP_MISSING_KEY_ERROR_MESSAGE = "Soniox API key is missing. Open Settings and add your key.";
const STREAM_INTERRUPTED_ERROR_MESSAGE = "Connection interrupted. Retrying…";
const STREAM_RESTART_FAILED_ERROR_MESSAGE = "Could not reconnect to Soniox. Check your key/network, then retry.";
const INSERT_FAILED_ERROR_MESSAGE = "Could not insert text. Check accessibility permission, then retry.";
const SESSION_START_FAILED_PREFIX = "Could not start listening";
const XAI_PROVIDER = "xai";
const GEMINI_PROVIDER = "gemini";
const OPENAI_COMPATIBLE_PROVIDER = "openai_compatible";
const DEFAULT_XAI_MODEL = "grok-4-1-fast-non-reasoning";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";
const DEFAULT_SONIOX_MODEL = "stt-rt-v4";
const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = "https://api.openai.com/v1";
const STOP_WORD_FINALIZE_TIMEOUT_MS = 1_000;
const TEMPORARY_API_KEY_REFRESH_LEAD_MS = 60_000;
const TEMPORARY_API_KEY_MINT_RETRY_COUNT = 1;

export type OverlayMode = "PASSIVE" | "INTERACTIVE";

interface ActiveSessionPreferences {
  enterMode: boolean;
  outputLang: "auto" | "english" | "vietnamese";
  skipLlm: boolean;
  stopWord: string;
  normalizedStopWord: string;
  sonioxTerms: string[];
  llmOptions: LlmRequestOptions | null;
}

interface CachedTemporaryApiKey {
  apiKey: string;
  expiresAtMs: number;
}

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
  private transcriptGeneration = 0;
  private pendingActiveSessionPreferencesRefresh = false;
  private isFinalizingAfterStopWord = false;
  private activeSessionPreferences: ActiveSessionPreferences | null = null;
  private cachedTemporaryApiKey: CachedTemporaryApiKey | null = null;
  private temporaryApiKeyRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private temporaryApiKeyRefreshPromise: Promise<string> | null = null;
  private pausedTranscript: TranscriptResult | null = null;
  private accumulatedTranscript: TranscriptResult = { finalText: "", interimText: "" };

  // Overlay interaction mode
  private overlayMode: OverlayMode = "PASSIVE";
  private currentErrorMessage: string | null = null;

  onStateChange:        StateChangeCallback       | null = null;
  onTranscriptChange:   TranscriptChangeCallback  | null = null;
  onOverlayModeChange:  OverlayModeChangeCallback | null = null;
  onErrorMessageChange: ErrorMessageChangeCallback | null = null;

  private readonly handleStorageChange = (event: StorageEvent): void => {
    if (event.storageArea !== null && event.storageArea !== window.localStorage) {
      return;
    }

    if (!this.activeSessionPreferences) {
      return;
    }

    if (this.isFinalizingAfterStopWord) {
      this.pendingActiveSessionPreferencesRefresh = true;
      return;
    }

    this.refreshActiveSessionPreferences();
  };

  constructor() {
    this.client = new SonioxClient();
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  async init(): Promise<void> {
    this.config = await window.voiceToText.getConfig();
    this.client.setConfig(this.config.soniox);
    window.addEventListener("storage", this.handleStorageChange);
    void this.prewarmTemporaryApiKey().catch((error: unknown) => {
      console.error("[session] temporary key prewarm failed", error);
    });

    this.unlistenToggle = window.voiceToText.onToggleMic(() => {
      void this.handleToggle();
    });
  }

  destroy(): void {
    window.removeEventListener("storage", this.handleStorageChange);
    this.unlistenToggle?.();
    this.clearTemporaryApiKeyRefreshTimer();
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

  /**
   * Clear current transcript/error state and resume a fresh listening session.
   *
   * Safe to call from any visible state (LISTENING, PROCESSING, INSERTING,
   * SUCCESS, ERROR, CONNECTING). Invalidates the active transcript generation
   * so stale async callbacks (LLM, insert, stream) cannot re-apply after reset.
   *
   * Hidden state is a no-op — the HUD is not visible and there is nothing to
   * clear.
   */
  async handleClear(): Promise<void> {
    if (this.state === "HIDDEN") return;

    const restartAttemptId = this.nextStartAttemptId();

    // Abandon any in-flight async work from the current session.
    this.isFinalizingAfterStopWord = false;
    this.pendingActiveSessionPreferencesRefresh = false;
    this.pausedTranscript = null;
    this.accumulatedTranscript = { finalText: "", interimText: "" };

    // Stop audio pipeline without affecting overlay mode — the HUD stays
    // visible and interactive throughout the reset.
    await this.stopAudioPipeline().catch((error: unknown) => {
      console.error("[session] stopAudioPipeline failed during clear", error);
    });

    // Transition to CONNECTING so render layer clears transcript/error slots.
    await this.applyEvent("CLEAR"); // any visible state → CONNECTING

    // Rebuild fresh session preferences from current storage values.
    const prefs = loadPreferences();
    this.activeSessionPreferences = this.createActiveSessionPreferences(prefs);
    const sessionPreferences = this.activeSessionPreferences;

    try {
      const apiKey = await this.createTemporaryApiKey();
      if (!this.isStartAttemptCurrent(restartAttemptId)) {
        return;
      }
      if (!apiKey) {
        await this.applyEvent("CONNECTION_ERROR");
        await this.handleStartupError(STARTUP_MISSING_KEY_ERROR_MESSAGE);
        return;
      }

      await this.startAudioPipeline(apiKey, sessionPreferences);
      if (!this.isStartAttemptCurrent(restartAttemptId)) {
        await this.stopAudioPipeline().catch((error: unknown) => {
          console.error("[session] stopAudioPipeline failed during stale clear restart", error);
        });
        return;
      }
      await this.applyEvent("CONNECTED"); // CONNECTING → LISTENING
      this.syncReminderBeepForCurrentState();
    } catch (error) {
      console.error("[session] clear restart failed", error);
      await this.applyEvent("CONNECTION_ERROR");
      await this.handleStartupError(
        `${SESSION_START_FAILED_PREFIX}: ${formatErrorMessage(error)}`
      );
    }
  }

  async handlePauseResume(): Promise<void> {
    if (this.state === "LISTENING") {
      await this.handlePause();
    } else if (this.state === "PAUSED") {
      await this.handleResume();
    }
  }

  private async handlePause(): Promise<void> {
    if (this.state !== "LISTENING") return;

    this.pausedTranscript = { ...this.accumulatedTranscript };

    await this.stopAudioPipeline().catch((error: unknown) => {
      console.error("[session] stopAudioPipeline failed during pause", error);
    });

    await this.applyEvent("PAUSE");
    this.onTranscriptChange?.(this.pausedTranscript);
  }

  private async handleResume(): Promise<void> {
    if (this.state !== "PAUSED") return;

    const restartAttemptId = this.nextStartAttemptId();
    const preservedTranscript = this.pausedTranscript;

    this.onTranscriptChange?.(preservedTranscript ?? { finalText: "", interimText: "" });
    await this.applyEvent("RESUME");

    const prefs = loadPreferences();
    this.activeSessionPreferences = this.createActiveSessionPreferences(prefs);
    const sessionPreferences = this.activeSessionPreferences;

    try {
      const apiKey = await this.createTemporaryApiKey();
      if (!this.isStartAttemptCurrent(restartAttemptId)) {
        return;
      }
      if (!apiKey) {
        await this.applyEvent("CONNECTION_ERROR");
        await this.handleStartupError(STARTUP_MISSING_KEY_ERROR_MESSAGE);
        return;
      }

      await this.startAudioPipeline(apiKey, sessionPreferences);
      if (!this.isStartAttemptCurrent(restartAttemptId)) {
        await this.stopAudioPipeline().catch((error: unknown) => {
          console.error("[session] stopAudioPipeline failed during stale resume restart", error);
        });
        return;
      }
      await this.applyEvent("CONNECTED");
      this.syncReminderBeepForCurrentState();
    } catch (error) {
      console.error("[session] resume restart failed", error);
      await this.applyEvent("CONNECTION_ERROR");
      await this.handleStartupError(
        `${SESSION_START_FAILED_PREFIX}: ${formatErrorMessage(error)}`
      );
    }
  }

  private composeTranscript(live: TranscriptResult): TranscriptResult {
    if (!this.pausedTranscript) return live;

    const preserved = this.pausedTranscript;
    const finalText = combineTranscriptText(
      combineTranscriptText(preserved.finalText, preserved.interimText),
      live.finalText,
    );
    return { finalText, interimText: live.interimText };
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
    this.pendingActiveSessionPreferencesRefresh = false;
    this.activeSessionPreferences = null;
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

      const apiKey = await this.createTemporaryApiKey();
      if (!this.isStartAttemptCurrent(startAttemptId)) return;
      if (!apiKey) {
        await this.applyEvent("CONNECTION_ERROR");
        await this.handleStartupError(STARTUP_MISSING_KEY_ERROR_MESSAGE);
        return;
      }

      const prefs = loadPreferences();
      this.activeSessionPreferences = this.createActiveSessionPreferences(prefs);
      const sessionPreferences = this.activeSessionPreferences;
      await this.startAudioPipeline(apiKey, sessionPreferences);
      if (!this.isStartAttemptCurrent(startAttemptId)) {
        await this.stopAudioPipeline();
        return;
      }

      await this.applyEvent("CONNECTED"); // CONNECTING → LISTENING
      this.syncReminderBeepForCurrentState();
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
    this.invalidateTranscriptGeneration();
    this.stopReminderBeep();
    this.client.stop();
    await window.voiceToText.setMicState(false);
  }

  private async startAudioPipeline(
    apiKey: string,
    sessionPreferences: ActiveSessionPreferences,
  ): Promise<void> {
    this.client.setConfig(this.resolveSonioxConfigForSession());
    this.bindTranscriptHandlers();
    await this.client.start(apiKey, {
      terms: sessionPreferences.sonioxTerms,
    });
    await window.voiceToText.setMicState(true);
  }

  private bindTranscriptHandlers(): void {
    const transcriptGeneration = this.nextTranscriptGeneration();

    this.client.onTranscript = (result) => {
      if (transcriptGeneration !== this.transcriptGeneration) return;
      if (this.state !== "LISTENING") return;
      const currentSessionPreferences = this.activeSessionPreferences;
      if (!currentSessionPreferences) return;
      if (this.isFinalizingAfterStopWord) return;

      const composed = this.composeTranscript(result);
      this.accumulatedTranscript = composed;
      const liveTranscript = combineTranscriptText(composed.finalText, composed.interimText);
      if (
        detectStopWordWithNormalizedStopWord(
          liveTranscript,
          currentSessionPreferences.normalizedStopWord,
        )
      ) {
        this.isFinalizingAfterStopWord = true;
        const currentSessionTranscript = combineTranscriptText(result.finalText, result.interimText);
        void this.handleStopWordDetected(liveTranscript, currentSessionTranscript, currentSessionPreferences);
        return;
      }

      this.onTranscriptChange?.(composed);
    };

    this.client.onError = (error) => {
      if (transcriptGeneration !== this.transcriptGeneration) return;
      console.error("[soniox]", error);
      // Route mid-session stream failure through the state machine.
      // LISTENING/PROCESSING both handle CONNECTION_ERROR → ERROR.
      void this.handleStreamError();
    };
  }

  private async stopSession(): Promise<void> {
    this.invalidateStartAttempt();
    this.isFinalizingAfterStopWord = false;
    this.pendingActiveSessionPreferencesRefresh = false;
    this.activeSessionPreferences = null;
    this.pausedTranscript = null;
    this.accumulatedTranscript = { finalText: "", interimText: "" };
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
      const apiKey = await this.createTemporaryApiKey();
      if (!apiKey) {
        this.setErrorMessage(STARTUP_MISSING_KEY_ERROR_MESSAGE);
        return;
      }

      const sessionPreferences = this.activeSessionPreferences;
      if (!sessionPreferences) {
        this.setErrorMessage(STREAM_RESTART_FAILED_ERROR_MESSAGE);
        return;
      }

      await this.startAudioPipeline(apiKey, sessionPreferences);

      await this.applyEvent("AUTO_RETURN"); // ERROR → LISTENING
      this.syncReminderBeepForCurrentState();
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
    currentSessionTranscript: string,
    sessionPreferences: ActiveSessionPreferences,
  ): Promise<void> {
    const finalizationAttemptId = this.startAttemptId;
    await this.applyEvent("STOP_WORD_DETECTED"); // LISTENING → PROCESSING
    this.stopReminderBeep();

    const previewCommandText = stripStopWord(rawTranscript, sessionPreferences.stopWord);

    if (previewCommandText.trim()) {
      this.onTranscriptChange?.({ finalText: previewCommandText, interimText: "" });
    }

    const finalizedCurrentSession = await this.finalizeStopWordTranscript(currentSessionTranscript);
    if (!this.isStartAttemptCurrent(finalizationAttemptId)) {
      return;
    }

    const preservedPrefix = this.pausedTranscript
      ? combineTranscriptText(this.pausedTranscript.finalText, this.pausedTranscript.interimText)
      : "";
    const fullFinalizedTranscript = combineTranscriptText(preservedPrefix, finalizedCurrentSession);

    const commandText = stripStopWord(fullFinalizedTranscript, sessionPreferences.stopWord);
    this.client.resetTranscript();

    if (!commandText.trim()) {
      this.isFinalizingAfterStopWord = false;
      await this.stopSession();
      return;
    }

    if (commandText !== previewCommandText) {
      this.onTranscriptChange?.({ finalText: commandText, interimText: "" });
    }

    await this.stopAudioPipeline().catch((error: unknown) => {
      console.error("[session] stopAudioPipeline failed during stop-word finalization", error);
    });
    if (!this.isStartAttemptCurrent(finalizationAttemptId)) {
      return;
    }

    let correctedText = commandText;

    if (!sessionPreferences.skipLlm && sessionPreferences.llmOptions) {
      try {
        for (let attempt = 0; attempt < LLM_CORRECTION_ATTEMPT_COUNT; attempt += 1) {
          try {
            correctedText = await window.voiceToText.correctTranscript(
              commandText,
              sessionPreferences.outputLang,
              sessionPreferences.llmOptions,
            );
            if (!this.isStartAttemptCurrent(finalizationAttemptId)) {
              return;
            }
            break;
          } catch (error) {
            if (!this.isStartAttemptCurrent(finalizationAttemptId)) {
              return;
            }
            if (
              attempt === LLM_CORRECTION_ATTEMPT_COUNT - 1
              || !shouldRetryLlmCorrectionError(error)
            ) {
              throw error;
            }
          }
        }
        await this.applyEvent("LLM_DONE"); // PROCESSING → INSERTING
      } catch (error) {
        console.error("[llm] correction failed, using raw text", error);
        await this.applyEvent("LLM_ERROR"); // PROCESSING → INSERTING (raw)
      }
    } else {
      await this.applyEvent("LLM_DONE"); // PROCESSING → INSERTING
    }

    if (!this.isStartAttemptCurrent(finalizationAttemptId)) {
      return;
    }

    await this.executeInsertionAndRestartListening(
      correctedText,
      sessionPreferences.enterMode,
      finalizationAttemptId,
    );
  }

  private async executeInsertionAndRestartListening(
    text: string,
    enterMode: boolean,
    startAttemptId: number,
  ): Promise<void> {
    const result = await window.voiceToText.insertText(text, {
      enterMode,
    });
    if (!this.isStartAttemptCurrent(startAttemptId)) {
      return;
    }

    if (!result.success) {
      console.error("[insert] failed", result.error);
      await this.applyEvent("INSERT_ERROR"); // INSERTING → ERROR
      this.setErrorMessage(result.error ?? INSERT_FAILED_ERROR_MESSAGE);
      this.isFinalizingAfterStopWord = false;
      this.applyPendingActiveSessionPreferencesRefresh();
      return;
    }

    const sessionPreferences = this.activeSessionPreferences;
    if (!sessionPreferences) {
      await this.applyEvent("INSERT_ERROR"); // INSERTING → ERROR
      this.setErrorMessage(STREAM_RESTART_FAILED_ERROR_MESSAGE);
      this.isFinalizingAfterStopWord = false;
      this.applyPendingActiveSessionPreferencesRefresh();
      return;
    }

    try {
      const apiKey = await this.createTemporaryApiKey();
      if (!this.isStartAttemptCurrent(startAttemptId)) {
        return;
      }
      if (!apiKey) {
        throw new Error(STARTUP_MISSING_KEY_ERROR_MESSAGE);
      }

      await this.startAudioPipeline(apiKey, sessionPreferences);
      if (!this.isStartAttemptCurrent(startAttemptId)) {
        await this.stopAudioPipeline().catch((error: unknown) => {
          console.error("[session] stopAudioPipeline failed during stale finalization restart", error);
        });
        return;
      }
    } catch (restartError) {
      console.error("[session] listening restart failed after insert", restartError);
      await this.applyEvent("INSERT_ERROR"); // INSERTING → ERROR
      this.setErrorMessage(
        `${STREAM_RESTART_FAILED_ERROR_MESSAGE} ${formatErrorMessage(restartError)}`,
      );
      this.isFinalizingAfterStopWord = false;
      this.applyPendingActiveSessionPreferencesRefresh();
      return;
    }

    await this.applyEvent("INSERT_SUCCESS"); // INSERTING → SUCCESS
    this.client.resetTranscript();
    this.pausedTranscript = null;
    this.accumulatedTranscript = { finalText: "", interimText: "" };
    this.onTranscriptChange?.({ finalText: "", interimText: "" });
    if (!this.isStartAttemptCurrent(startAttemptId)) {
      return;
    }

    this.isFinalizingAfterStopWord = false;
    await this.applyEvent("AUTO_RETURN"); // SUCCESS → LISTENING
    this.applyPendingActiveSessionPreferencesRefresh();
    this.syncReminderBeepForCurrentState();
  }

  private async finalizeStopWordTranscript(rawTranscript: string): Promise<string> {
    const finalizeTimedOut = Symbol("stop-word-finalize-timeout");

    try {
      const finalizedTranscript = await Promise.race<string | typeof finalizeTimedOut>([
        this.client.finalizeCurrentUtterance(rawTranscript),
        delay(STOP_WORD_FINALIZE_TIMEOUT_MS).then(() => finalizeTimedOut),
      ]);

      if (finalizedTranscript === finalizeTimedOut) {
        console.error("[session] stop-word finalization timed out; using detected transcript");
        return rawTranscript;
      }

      return finalizedTranscript;
    } catch (error) {
      console.error("[session] stop-word finalization failed; using detected transcript", error);
      return rawTranscript;
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
    const model = loadLlmModelPreference(provider) ?? defaultModelForProvider(provider);
    if (!model) {
      throw new Error(`No ${providerLabel(provider)} model selected. Open Settings, refresh models, and choose one.`);
    }
    const baseUrl = loadLlmBaseUrlPreference(
      config?.llm.base_url ?? DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
    );

    return {
      provider,
      model,
      baseUrl,
    };
  }

  private resolveSonioxConfigForSession(): AppConfig["soniox"] {
    if (!this.config) {
      throw new Error("App config is not loaded");
    }

    const selectedModel = loadSonioxModelPreference() ?? DEFAULT_SONIOX_MODEL;

    return {
      ...this.config.soniox,
      model: selectedModel,
    };
  }

  private createActiveSessionPreferences(
    prefs: ReturnType<typeof loadPreferences>,
  ): ActiveSessionPreferences {
    const stopWord = loadCustomStopWordPreference(this.config?.voice.stop_word ?? "");
    return {
      enterMode: prefs.enterMode,
      outputLang: prefs.outputLang,
      skipLlm: prefs.skipLlm,
      stopWord,
      normalizedStopWord: normalizeStopWord(stopWord),
      sonioxTerms: prefs.sonioxTerms,
      llmOptions: prefs.skipLlm ? null : this.resolveLlmRequestOptions(),
    };
  }

  private refreshActiveSessionPreferences(): void {
    if (!this.activeSessionPreferences) {
      return;
    }

    try {
      this.activeSessionPreferences = this.createActiveSessionPreferences(loadPreferences());
    } catch (error) {
      console.error("[session] could not refresh preferences", error);
      this.setErrorMessage(formatErrorMessage(error));
      return;
    }

    this.pendingActiveSessionPreferencesRefresh = false;
    this.syncReminderBeepForCurrentState();
  }

  private applyPendingActiveSessionPreferencesRefresh(): void {
    if (!this.pendingActiveSessionPreferencesRefresh) {
      return;
    }

    this.refreshActiveSessionPreferences();
  }

  private syncReminderBeepForCurrentState(): void {
    if (this.state !== "LISTENING") {
      return;
    }

    if (!loadReminderBeepEnabledPreference()) {
      this.stopReminderBeep();
      return;
    }

    if (this.reminderTimer === null) {
      this.startReminderBeep();
    }
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

  private nextTranscriptGeneration(): number {
    this.transcriptGeneration += 1;
    return this.transcriptGeneration;
  }

  private invalidateStartAttempt(): void {
    this.startAttemptId += 1;
  }

  private invalidateTranscriptGeneration(): void {
    this.transcriptGeneration += 1;
  }

  private async createTemporaryApiKey(): Promise<string> {
    const reusableTemporaryApiKey = this.getReusableTemporaryApiKey();
    if (reusableTemporaryApiKey) {
      return reusableTemporaryApiKey.apiKey;
    }

    return this.refreshTemporaryApiKey();
  }

  private async prewarmTemporaryApiKey(): Promise<void> {
    await this.refreshTemporaryApiKey();
  }

  private getReusableTemporaryApiKey(): CachedTemporaryApiKey | null {
    if (!this.cachedTemporaryApiKey) {
      return null;
    }

    if (this.cachedTemporaryApiKey.expiresAtMs - Date.now() <= TEMPORARY_API_KEY_REFRESH_LEAD_MS) {
      this.cachedTemporaryApiKey = null;
      return null;
    }

    return this.cachedTemporaryApiKey;
  }

  private async refreshTemporaryApiKey(): Promise<string> {
    if (this.temporaryApiKeyRefreshPromise) {
      return this.temporaryApiKeyRefreshPromise;
    }

    const refreshPromise = this.mintTemporaryApiKey(TEMPORARY_API_KEY_MINT_RETRY_COUNT);
    this.temporaryApiKeyRefreshPromise = refreshPromise;

    try {
      return await refreshPromise;
    } finally {
      if (this.temporaryApiKeyRefreshPromise === refreshPromise) {
        this.temporaryApiKeyRefreshPromise = null;
      }
    }
  }

  private async mintTemporaryApiKey(remainingRetryCount: number): Promise<string> {
    const hasSonioxKey = await window.voiceToText.hasSonioxKey();
    if (!hasSonioxKey) {
      this.clearCachedTemporaryApiKey();
      return "";
    }

    const temporaryKey = await window.voiceToText.createSonioxTemporaryKey();
    const apiKey = temporaryKey.apiKey.trim();
    if (!apiKey) {
      this.clearCachedTemporaryApiKey();
      return "";
    }

    const expiresAtMs = resolveTemporaryApiKeyExpiryMs(temporaryKey);
    if (expiresAtMs === null) {
      this.clearCachedTemporaryApiKey();
      return apiKey;
    }

    if (expiresAtMs - Date.now() <= TEMPORARY_API_KEY_REFRESH_LEAD_MS) {
      this.clearCachedTemporaryApiKey();
      if (remainingRetryCount > 0) {
        return this.mintTemporaryApiKey(remainingRetryCount - 1);
      }
      return "";
    }

    this.cachedTemporaryApiKey = {
      apiKey,
      expiresAtMs,
    };
    this.scheduleTemporaryApiKeyRefresh(expiresAtMs);

    return apiKey;
  }

  private scheduleTemporaryApiKeyRefresh(expiresAtMs: number): void {
    this.clearTemporaryApiKeyRefreshTimer();
    const refreshDelayMs = Math.max(0, expiresAtMs - Date.now() - TEMPORARY_API_KEY_REFRESH_LEAD_MS);
    this.temporaryApiKeyRefreshTimer = setTimeout(() => {
      void this.refreshTemporaryApiKey().catch((error: unknown) => {
        console.error("[session] temporary key refresh failed", error);
      });
    }, refreshDelayMs);
  }

  private clearTemporaryApiKeyRefreshTimer(): void {
    if (this.temporaryApiKeyRefreshTimer === null) {
      return;
    }

    clearTimeout(this.temporaryApiKeyRefreshTimer);
    this.temporaryApiKeyRefreshTimer = null;
  }

  private clearCachedTemporaryApiKey(): void {
    this.cachedTemporaryApiKey = null;
    this.clearTemporaryApiKeyRefreshTimer();
  }

  private isStartAttemptCurrent(startAttemptId: number): boolean {
    return this.startAttemptId === startAttemptId;
  }
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function combineTranscriptText(finalText: string, interimText: string): string {
  return `${finalText} ${interimText}`.trim();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveTemporaryApiKeyExpiryMs(result: SonioxTemporaryApiKeyResult): number | null {
  if (result.expiresAt) {
    const expiresAtMs = Date.parse(result.expiresAt);
    if (Number.isFinite(expiresAtMs)) {
      return expiresAtMs;
    }
  }

  if (typeof result.expiresInSeconds === "number" && result.expiresInSeconds > 0) {
    return Date.now() + result.expiresInSeconds * 1_000;
  }

  return null;
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

function shouldRetryLlmCorrectionError(error: unknown): boolean {
  const message = formatErrorMessage(error);
  const statusCode = extractProviderApiErrorStatusCode(message);

  if (statusCode !== null) {
    return RETRYABLE_LLM_HTTP_STATUS_CODES.has(statusCode);
  }

  return RETRYABLE_LLM_ERROR_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

function extractProviderApiErrorStatusCode(message: string): number | null {
  const matchedStatusCode = message.match(PROVIDER_API_ERROR_STATUS_PATTERN)?.[1];
  if (!matchedStatusCode) {
    return null;
  }

  const statusCode = Number.parseInt(matchedStatusCode, 10);
  return Number.isNaN(statusCode) ? null : statusCode;
}

function providerLabel(provider: string): string {
  if (provider === OPENAI_COMPATIBLE_PROVIDER) {
    return "OpenAI-compatible";
  }
  if (provider === GEMINI_PROVIDER) {
    return "Gemini";
  }

  return "xAI";
}

function defaultModelForProvider(provider: string): string | null {
  if (provider === XAI_PROVIDER) {
    return DEFAULT_XAI_MODEL;
  }
  if (provider === GEMINI_PROVIDER) {
    return DEFAULT_GEMINI_MODEL;
  }

  return null;
}
