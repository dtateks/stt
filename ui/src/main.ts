/**
 * Main window entry point.
 *
 * Single-panel settings screen + vocabulary dialog.
 * All bridge calls are funnelled through the window.voiceToText surface only.
 */

import "./main.css";
import type {
  AppUpdate,
  LlmProvider,
  OutputLang,
  PlatformRuntimeInfo,
} from "./types.ts";
import {
  renderShortcutRecorderState,
} from "./shortcut-recorder-logic.ts";
import type { ShortcutDisplayMode } from "./shortcut-display.ts";
import { shortcutCanonicalToDisplay } from "./shortcut-display.ts";
import {
  DEFAULT_MIC_TOGGLE_SHORTCUT,
  loadPreferences,
  loadCustomStopWordPreference,
  loadLlmBaseUrlPreference,
  loadLlmCorrectionEnabledPreference,
  loadLlmModelPreference,
  loadLlmProviderPreference,
  loadMicToggleShortcutPreference,
  loadReminderBeepEnabledPreference,
  loadSonioxModelPreference,
  resetCustomStopWordPreference,
  resetMicToggleShortcutPreference,
  saveEnterMode,
  saveCustomStopWordPreference,
  saveLlmBaseUrlPreference,
  saveLlmCorrectionEnabledPreference,
  saveLlmModelPreference,
  saveLlmProviderPreference,
  saveMicToggleShortcutPreference,
  saveOutputLang,
  saveReminderBeepEnabledPreference,
  saveSonioxModelPreference,
  saveSonioxTerms,
} from "./storage.ts";
import { requestStartupPermissions } from "./startup-permissions.ts";
import { waitForVoiceToTextBridge } from "./bridge-ready.ts";
import {
  applySetupError,
  clearSetupError,
  validateSonioxKey,
} from "./main-logic.ts";

// ─── Staged settings state ────────────────────────────────────────────────

interface StagedSettings {
  terms: string[];
}

let staged: StagedSettings = { terms: [] };
let settingsOpenedBy: HTMLElement | null = null;

// ─── Shortcut recorder state ──────────────────────────────────────────────

interface ShortcutRecorderState {
  isRecording: boolean;
  keys: Set<string>;
  modifiers: Set<string>;
}

let shortcutRecorderState: ShortcutRecorderState = {
  isRecording: false,
  keys: new Set(),
  modifiers: new Set(),
};

// ─── DOM refs ─────────────────────────────────────────────────────────────

function q<T extends Element>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);
  return el;
}

const settingsPanel = q<HTMLElement>("#settings-panel");

// Setup form
const sonioxInput = q<HTMLInputElement>("#setup-soniox-key");
const setupSubmitBtn = q<HTMLButtonElement>("#setup-submit");
const setupError = q<HTMLDivElement>("#setup-error");
const setupProgress = q<HTMLDivElement>("#setup-progress");
const setupProgressText = q<HTMLSpanElement>("#setup-progress-text");

// Prefs
const enterModeToggle = q<HTMLInputElement>("#pref-enter-mode");
const outputLangSelect = q<HTMLSelectElement>("#pref-output-lang");
const llmCorrectionToggle = q<HTMLInputElement>("#pref-llm-correction");
const reminderBeepToggle = q<HTMLInputElement>("#pref-reminder-beep");
const stopWordInput = q<HTMLInputElement>("#pref-stop-word");
const stopWordResetBtn = q<HTMLButtonElement>("#pref-stop-word-reset");
const micShortcutRecorder = q<HTMLButtonElement>("#pref-mic-shortcut");
const micShortcutResetBtn = q<HTMLButtonElement>("#pref-mic-shortcut-reset");
const micShortcutStatus = q<HTMLDivElement>("#pref-mic-shortcut-status");
const llmProviderSelect = q<HTMLSelectElement>("#pref-llm-provider");
const llmModelSelect = q<HTMLSelectElement>("#pref-llm-model");
const llmModelFetchBtn = q<HTMLButtonElement>("#pref-llm-model-fetch");
const llmModelStatus = q<HTMLDivElement>("#pref-llm-model-status");
const llmBaseUrlInput = q<HTMLInputElement>("#pref-llm-base-url");
const llmBaseUrlRow = q<HTMLDivElement>("#pref-llm-base-url-row");
const providerKeyInput = q<HTMLInputElement>("#pref-provider-key");
const providerKeySaveBtn = q<HTMLButtonElement>("#pref-provider-key-save");
const providerKeyStatus = q<HTMLDivElement>("#pref-provider-key-status");
const providerKeyLabel = q<HTMLLabelElement>("#pref-provider-key-label");
const sonioxKeyStatus = q<HTMLDivElement>("#pref-soniox-key-status");
const sonioxModelSelect = q<HTMLSelectElement>("#pref-soniox-model");
const sonioxModelFetchBtn = q<HTMLButtonElement>("#pref-soniox-model-fetch");
const sonioxModelStatus = q<HTMLDivElement>("#pref-soniox-model-status");

// Stop word status
const stopWordStatus = q<HTMLDivElement>("#pref-stop-word-status");

// AI status
const aiStatus = q<HTMLDivElement>("#ai-status");
const aiSettingsFieldset = q<HTMLFieldSetElement>("#ai-settings-fieldset");
const aiDisabledNote = q<HTMLDivElement>("#ai-disabled-note");

// Prefs ready card
const prefsReadyTitle = q<HTMLSpanElement>("#prefs-ready-title");
const prefsReadyShortcut = q<HTMLSpanElement>("#prefs-ready-shortcut");

// Permission banner
const permissionBanner = q<HTMLDivElement>("#prefs-permission-banner");
const permissionBannerText = q<HTMLSpanElement>("#prefs-permission-text");
const backgroundRecoveryText = q<HTMLParagraphElement>("#runtime-background-recovery");
const updateBanner = q<HTMLDivElement>("#update-banner");
const updateBannerText = q<HTMLSpanElement>("#update-banner-text");
const updateBannerAction = q<HTMLButtonElement>("#update-banner-action");

// Status hero
const statusHero = q<HTMLElement>(".status-hero");

// Vocabulary count badge
const vocabCountBadge = q<HTMLSpanElement>("#vocab-count");

// Dialog
const dialogBackdrop = q<HTMLDivElement>("#settings-dialog-backdrop");
const dialogEl = q<HTMLDivElement>("#settings-dialog");

// Dialog: terms
const termsTagList = q<HTMLDivElement>("#terms-tag-list");
const termsAddInput = q<HTMLInputElement>("#terms-add-input");
const termsAddBtn = q<HTMLButtonElement>("#terms-add-btn");

// Dialog footer
const dialogResetBtn = q<HTMLButtonElement>("#dialog-reset");
const dialogCancelBtn = q<HTMLButtonElement>("#dialog-cancel");
const dialogSaveBtn = q<HTMLButtonElement>("#dialog-save");
const dialogCloseBtn = q<HTMLButtonElement>("#dialog-close-btn");

// Action buttons
const openSettingsBtn = q<HTMLButtonElement>("#action-open-settings");

const OPENAI_COMPATIBLE_PROVIDER: LlmProvider = "openai_compatible";
const XAI_PROVIDER: LlmProvider = "xai";
const GEMINI_PROVIDER: LlmProvider = "gemini";
const DEFAULT_XAI_MODEL = "grok-4-1-fast-non-reasoning";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";
const DEFAULT_SONIOX_MODEL = "stt-rt-v4";
const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = "https://api.openai.com/v1";
const SONIOX_KEY_PLACEHOLDER = "sk-soniox-…";
const SONIOX_KEY_MASK_PLACEHOLDER = "••••••••••••••••";
const READY_TO_DICTATE_TITLE = "Ready to dictate";
const READY_TO_CONFIGURE_TITLE = "Activation required";
const READY_TO_CONFIGURE_COPY = "Add a Soniox key to start dictation";
const SETUP_BUTTON_LABEL = "Save key";
const SETUP_BUTTON_SAVING_LABEL = "Saving…";
const MISSING_SONIOX_KEY_SETUP_MESSAGE = "Soniox API key is missing. Add your key to activate dictation.";
const CREDENTIAL_VERIFICATION_FAILED_MESSAGE = "Saved credentials could not be verified. Soniox API key still appears to be missing.";
const UPDATE_BUTTON_LABEL = "Update";
const UPDATE_DOWNLOADING_LABEL = "Downloading…";
const UPDATE_RETRY_LABEL = "Retry";
const UPDATE_RESTARTING_LABEL = "Restarting…";
const MAIN_WINDOW_AUTO_FIT_DEBOUNCE_MS = 80;

let updateAvailable: AppUpdate | null = null;
let updateDownloading = false;
let defaultStopWord = "thank you";
let defaultLlmProvider: LlmProvider = XAI_PROVIDER;
let defaultLlmBaseUrl = DEFAULT_OPENAI_COMPATIBLE_BASE_URL;
let hasVerifiedSonioxKey = false;

const STATUS_AUTO_CLEAR_MS = 4_000;
const statusClearTimers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
let pendingMainWindowFitTimer: ReturnType<typeof setTimeout> | null = null;
const DEFAULT_PLATFORM_RUNTIME_INFO: PlatformRuntimeInfo = {
  os: "macos",
  shortcutDisplay: "macos",
  permissionFlow: "system-settings-privacy",
  backgroundRecovery: "dockless-reopen",
  supportsFullscreenHud: true,
  requiresPrivilegedInsertionHelper: false,
};
let platformRuntimeInfo: PlatformRuntimeInfo = DEFAULT_PLATFORM_RUNTIME_INFO;

// ─── Initialization ───────────────────────────────────────────────────────

async function init(): Promise<void> {
  bindSetupForm();
  bindPrefs();
  bindActionButtons();
  bindDialog();
  bindShortcutRecorder();
  bindUpdateBanner();
  loadPrefsUI();
  initializeMainWindowAutoFit();
  setSonioxConnectionState(false);

  let bridge: Awaited<ReturnType<typeof waitForVoiceToTextBridge>>;
  try {
    bridge = await waitForVoiceToTextBridge();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    applySetupError(`The app could not initialize. Try restarting. (${message})`, setupError, sonioxInput);
    return;
  }

  bindCredentialScreenRevalidation();

  platformRuntimeInfo = await loadPlatformRuntimeInfo(bridge);
  applyPlatformRuntimeInfo(platformRuntimeInfo);

  const shortcutSyncError = await syncStoredMicToggleShortcut(bridge);
  await hydrateRuntimeDefaults(bridge);
  loadPrefsUI();

  const keyCheck = await checkHasSonioxKey(bridge);
  hasVerifiedSonioxKey = keyCheck.hasKey;
  setSonioxConnectionState(hasVerifiedSonioxKey);
  await loadRuntimeMicToggleShortcut();
  await loadKeyStates();
  void fetchModels();

  let startupErrorMessage = keyCheck.error
    ? `Could not verify your API key. Check your connection and restart. (${keyCheck.error})`
    : null;

  if (shortcutSyncError) {
    startupErrorMessage = startupErrorMessage
      ? `${startupErrorMessage} — ${shortcutSyncError}`
      : shortcutSyncError;
  }

  if (hasVerifiedSonioxKey) {
    clearSetupError(setupError, sonioxInput);
    void fetchSonioxModels();
    void checkForAppUpdate();
  } else if (!startupErrorMessage) {
    applySetupError(MISSING_SONIOX_KEY_SETUP_MESSAGE, setupError, sonioxInput);
  }

  if (startupErrorMessage) {
    applySetupError(startupErrorMessage, setupError, sonioxInput);
  }

  // Trigger permission dialogs on first launch so the OS prompts upfront.
  // Surface an advisory on the setup screen if any permission was not granted.
  const permResults = await requestStartupPermissions(bridge);
  const anyDenied = permResults.some((r) => !r.granted);
  if (anyDenied) {
    const deniedResults = permResults.filter((result) => !result.granted);
    showPermissionBanner(deniedResults, platformRuntimeInfo);
    startPermissionPolling();
  } else {
    hidePermissionBanner();
  }
}

let mainWindowResizeObserver: ResizeObserver | null = null;

function initializeMainWindowAutoFit(): void {
  scheduleMainWindowFitToContent();

  if (typeof ResizeObserver === "undefined") {
    return;
  }

  mainWindowResizeObserver = new ResizeObserver(() => {
    if (!settingsPanel.isConnected) {
      teardownMainWindowAutoFit();
      return;
    }
    scheduleMainWindowFitToContent();
  });

  mainWindowResizeObserver.observe(settingsPanel);
}

function teardownMainWindowAutoFit(): void {
  if (pendingMainWindowFitTimer !== null) {
    clearTimeout(pendingMainWindowFitTimer);
    pendingMainWindowFitTimer = null;
  }
  if (mainWindowResizeObserver !== null) {
    mainWindowResizeObserver.disconnect();
    mainWindowResizeObserver = null;
  }
}

function scheduleMainWindowFitToContent(): void {
  if (pendingMainWindowFitTimer !== null) {
    clearTimeout(pendingMainWindowFitTimer);
  }

  pendingMainWindowFitTimer = setTimeout(() => {
    pendingMainWindowFitTimer = null;
    // Guard against the panel being detached (e.g. test teardown clearing
    // document.body). Without this, a late-firing timer would call into a
    // disposed jsdom environment or a missing bridge.
    if (!settingsPanel.isConnected) {
      return;
    }
    void fitMainWindowToContent();
  }, MAIN_WINDOW_AUTO_FIT_DEBOUNCE_MS);
}

async function fitMainWindowToContent(): Promise<void> {
  if (typeof window.voiceToText?.fitMainWindowToContent !== "function") {
    return;
  }

  const contentHeight = Math.ceil(settingsPanel.scrollHeight);
  try {
    await window.voiceToText.fitMainWindowToContent(contentHeight);
  } catch {
    // Non-fatal: sizing is best effort and should never block setup.
  }
}

async function loadPlatformRuntimeInfo(
  bridge: Pick<typeof window.voiceToText, "getPlatformRuntimeInfo">,
): Promise<PlatformRuntimeInfo> {
  try {
    return await bridge.getPlatformRuntimeInfo();
  } catch {
    return DEFAULT_PLATFORM_RUNTIME_INFO;
  }
}

function applyPlatformRuntimeInfo(runtimeInfo: PlatformRuntimeInfo): void {
  backgroundRecoveryText.textContent = getBackgroundRecoveryMessage(runtimeInfo);
}

function getShortcutDisplayMode(runtimeInfo: PlatformRuntimeInfo): ShortcutDisplayMode {
  return runtimeInfo.shortcutDisplay === "windows" ? "windows" : "macos";
}

function getPermissionSettingsLabel(runtimeInfo: PlatformRuntimeInfo): string {
  return runtimeInfo.os === "windows"
    ? "Windows Settings → Privacy & security"
    : "System Settings → Privacy & Security";
}

function getBackgroundRecoveryMessage(runtimeInfo: PlatformRuntimeInfo): string {
  return runtimeInfo.backgroundRecovery === "tray-reopen"
    ? "Reopen settings from the Windows notification area if running in the background."
    : "Reopen the app to show settings if running in the background.";
}

function formatPermissionName(permission: string): string {
  return permission === "textInsertion" ? "text insertion" : permission;
}

function buildPermissionSummary(deniedResults: Array<{ permission: string }>): string {
  return deniedResults.map((result) => formatPermissionName(result.permission)).join(", ");
}

function buildPermissionDetailMessage(
  deniedResults: Array<{ message?: string }>,
): string | null {
  const details = deniedResults
    .map((result) => result.message?.trim())
    .filter((message): message is string => Boolean(message));

  if (details.length === 0) {
    return null;
  }

  return details.join(" ");
}

function buildStartupPermissionMessage(
  deniedResults: Array<{ permission: string; message?: string }>,
  runtimeInfo: PlatformRuntimeInfo,
): string {
  const summary = buildPermissionSummary(deniedResults);
  const detailMessage = buildPermissionDetailMessage(deniedResults);
  const settingsLabel = getPermissionSettingsLabel(runtimeInfo);

  return [
    `Some permissions were not granted (${summary}). Voice to Text may not function correctly.`,
    detailMessage,
    `Review them in ${settingsLabel}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

async function checkHasSonioxKey(
  bridge: Pick<typeof window.voiceToText, "hasSonioxKey">,
): Promise<{ hasKey: boolean; error?: string }> {
  try {
    const hasKey = await bridge.hasSonioxKey();
    if (typeof hasKey !== "boolean") {
      return {
        hasKey: false,
        error: `hasSonioxKey returned ${typeof hasKey} instead of boolean`,
      };
    }

    return { hasKey };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { hasKey: false, error: message };
  }
}

// ─── Permission polling ───────────────────────────────────────────────────

const PERMISSION_POLL_INTERVAL_MS = 2_000;
let permissionPollTimer: ReturnType<typeof setInterval> | null = null;

function startPermissionPolling(): void {
  if (permissionPollTimer !== null) return;
  permissionPollTimer = setInterval(() => {
    void pollPermissions();
  }, PERMISSION_POLL_INTERVAL_MS);
}

function stopPermissionPolling(): void {
  if (permissionPollTimer !== null) {
    clearInterval(permissionPollTimer);
    permissionPollTimer = null;
  }
}

async function pollPermissions(): Promise<void> {
  try {
    const status = await window.voiceToText.checkPermissionsStatus();
    if (status.microphone && status.accessibility && status.automation) {
      stopPermissionPolling();
      hidePermissionBanner();
    }
  } catch {
    // Polling failure is not actionable — keep polling.
  }
}

// ─── Setup form ───────────────────────────────────────────────────────────

function bindSetupForm(): void {
  setupSubmitBtn.addEventListener("click", () => {
    void handleSetupSubmit();
  });

  sonioxInput.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") void handleSetupSubmit();
  });
}

async function handleSetupSubmit(): Promise<void> {
  clearSetupError(setupError, sonioxInput);
  clearSonioxKeyStatus();

  const sonioxKey = sonioxInput.value.trim();

  const validationError = validateSonioxKey(sonioxKey);
  if (validationError) {
    applySetupError(validationError, setupError, sonioxInput);
    sonioxInput.focus();
    return;
  }

  setSetupSaving(true);

  try {
    await window.voiceToText.updateSonioxKey(sonioxKey);
    const verificationError = await verifySavedSonioxCredential(window.voiceToText);
    if (verificationError) {
      applySetupError(verificationError, setupError, sonioxInput);
      hasVerifiedSonioxKey = false;
      sonioxInput.classList.remove("has-key");
      sonioxInput.placeholder = SONIOX_KEY_PLACEHOLDER;
      setSonioxConnectionState(false);
      return;
    }

    hasVerifiedSonioxKey = true;
    setSonioxConnectionState(true);
    clearSetupError(setupError, sonioxInput);
    sonioxInput.value = "";
    await loadKeyStates();
    setSonioxKeyStatus("Soniox API key saved.", false);
    await fetchSonioxModels();
    void checkForAppUpdate();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    applySetupError(`Could not save your API key. Please try again. (${msg})`, setupError, sonioxInput);
    await loadKeyStates();
  } finally {
    setSetupSaving(false);
  }
}

function setSetupSaving(saving: boolean): void {
  setupSubmitBtn.disabled = saving;
  setupSubmitBtn.textContent = saving ? SETUP_BUTTON_SAVING_LABEL : SETUP_BUTTON_LABEL;
  setSetupProgress(saving, "Verifying key…");
}

function setSetupProgress(visible: boolean, text?: string): void {
  setupProgress.classList.toggle("is-hidden", !visible);
  if (text !== undefined) {
    setupProgressText.textContent = text;
  }
}

// ─── Prefs UI ─────────────────────────────────────────────────────────────

function loadPrefsUI(): void {
  const prefs = loadPreferences();
  enterModeToggle.checked = prefs.enterMode;
  outputLangSelect.value = prefs.outputLang;
  const correctionEnabled = loadLlmCorrectionEnabledPreference();
  llmCorrectionToggle.checked = correctionEnabled;
  reminderBeepToggle.checked = loadReminderBeepEnabledPreference();
  stopWordInput.value = loadCustomStopWordPreference(defaultStopWord);

  const provider = loadLlmProviderPreference(defaultLlmProvider);
  llmProviderSelect.value = provider;
  llmBaseUrlInput.value = loadLlmBaseUrlPreference(defaultLlmBaseUrl);

  syncLlmBaseUrlVisibility();
  syncAiFieldsetDisabledState(correctionEnabled);
  syncProviderKeyLabel();
  updateVocabCount();
  clearShortcutStatus();
  clearStopWordStatus();
  clearAiStatus();
  clearSonioxKeyStatus();
  clearSonioxModelStatus();
  clearModelStatus();
  clearProviderKeyStatus();

  // Load saved shortcut into recorder
  const savedShortcut = loadMicToggleShortcutPreference();
  renderShortcutRecorder(savedShortcut);

  // Show placeholder in model select until fetch completes
  // Real models are fetched from endpoint in fetchModels()
  showModelPlaceholder();
  showSonioxModelPlaceholder();
}

function bindCredentialScreenRevalidation(): void {
  window.onfocus = () => {
    void revalidateCredentialScreenState();
  };

  document.onvisibilitychange = () => {
    if (document.visibilityState === "visible") {
      void revalidateCredentialScreenState();
    }
  };
}

async function verifySavedSonioxCredential(
  bridge: Pick<typeof window.voiceToText, "hasSonioxKey">,
): Promise<string | null> {
  const keyCheck = await checkHasSonioxKey(bridge);
  if (keyCheck.error) {
    return `Saved credentials could not be verified: ${keyCheck.error}`;
  }

  if (!keyCheck.hasKey) {
    return CREDENTIAL_VERIFICATION_FAILED_MESSAGE;
  }

  return null;
}

async function revalidateCredentialScreenState(): Promise<void> {
  const wasReady = hasVerifiedSonioxKey;
  const keyCheck = await checkHasSonioxKey(window.voiceToText);
  if (keyCheck.error) {
    return;
  }

  hasVerifiedSonioxKey = keyCheck.hasKey;
  setSonioxConnectionState(hasVerifiedSonioxKey);

  if (keyCheck.hasKey) {
    clearSetupError(setupError, sonioxInput);
    await loadKeyStates();
    if (!wasReady) {
      void fetchSonioxModels();
      void checkForAppUpdate();
    }
    return;
  }

  sonioxInput.classList.remove("has-key");
  sonioxInput.placeholder = SONIOX_KEY_PLACEHOLDER;
  showSonioxModelPlaceholder();
  clearSonioxModelStatus();
  applySetupError(MISSING_SONIOX_KEY_SETUP_MESSAGE, setupError, sonioxInput);
}

function bindPrefs(): void {
  enterModeToggle.addEventListener("change", () => {
    saveEnterMode(enterModeToggle.checked);
  });

  outputLangSelect.addEventListener("change", () => {
    saveOutputLang(outputLangSelect.value as OutputLang);
    setAiStatus("Output language saved.", false);
  });

  llmCorrectionToggle.addEventListener("change", () => {
    const enabled = llmCorrectionToggle.checked;
    saveLlmCorrectionEnabledPreference(enabled);
    syncAiFieldsetDisabledState(enabled);
  });

  reminderBeepToggle.addEventListener("change", () => {
    saveReminderBeepEnabledPreference(reminderBeepToggle.checked);
  });

  stopWordInput.addEventListener("blur", () => {
    handleStopWordSave();
  });

  stopWordResetBtn.addEventListener("click", () => {
    handleStopWordReset();
  });

  stopWordInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleStopWordSave();
    }
  });

  micShortcutResetBtn.addEventListener("click", () => {
    void handleMicShortcutReset();
  });

  llmProviderSelect.addEventListener("change", () => {
    const provider = llmProviderSelect.value as LlmProvider;
    saveLlmProviderPreference(provider);
    syncLlmBaseUrlVisibility();
    syncProviderKeyLabel();
    setAiStatus("Provider saved.", false);
    // Clear model selection until we fetch real models
    showModelPlaceholder();
    clearModelStatus();
    // Load key state for the new provider
    void loadProviderKeyState(provider);
    // Fetch real models from endpoint
    void fetchModels();
  });

  llmBaseUrlInput.addEventListener("change", () => {
    const baseUrl = llmBaseUrlInput.value.trim();
    if (baseUrl) {
      saveLlmBaseUrlPreference(baseUrl);
      setAiStatus("Base URL saved.", false);
    }
  });

  llmModelSelect.addEventListener("change", () => {
    const provider = llmProviderSelect.value as LlmProvider;
    const model = llmModelSelect.value;
    if (model) {
      saveLlmModelPreference(provider, model);
      setAiStatus("Model saved.", false);
    }
  });

  llmModelFetchBtn.addEventListener("click", () => {
    void fetchModels();
  });

  providerKeySaveBtn.addEventListener("click", () => {
    void handleProviderKeySave();
  });

  sonioxModelSelect.addEventListener("change", () => {
    const model = sonioxModelSelect.value;
    if (!model) {
      return;
    }

    saveSonioxModelPreference(model);
    setSonioxModelStatus("Soniox model saved.", false);
  });

  sonioxModelFetchBtn.addEventListener("click", () => {
    void fetchSonioxModels();
  });
}

async function syncStoredMicToggleShortcut(
  bridge: Pick<typeof window.voiceToText, "updateMicToggleShortcut">,
): Promise<string | null> {
  const storedShortcut = loadMicToggleShortcutPreference();
  try {
    const runtimeShortcut = await bridge.updateMicToggleShortcut(storedShortcut);
    if (runtimeShortcut !== storedShortcut) {
      const persisted = saveMicToggleShortcutPreference(runtimeShortcut);
      if (!persisted) {
        return "Global shortcut was applied but could not be saved locally.";
      }
    }
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Global mic shortcut sync failed: ${message}`;
  }
}

async function hydrateRuntimeDefaults(
  bridge: Pick<typeof window.voiceToText, "getConfig">,
): Promise<void> {
  try {
    const config = await bridge.getConfig();
    defaultStopWord = config.voice.stop_word || defaultStopWord;
    defaultLlmProvider = config.llm.provider || defaultLlmProvider;
    defaultLlmBaseUrl = config.llm.base_url || DEFAULT_OPENAI_COMPATIBLE_BASE_URL;
  } catch {
    // Keep baked defaults when config fetch fails.
  }
}

function syncLlmBaseUrlVisibility(): void {
  const selectedProvider = llmProviderSelect.value as LlmProvider;
  const shouldShowBaseUrl = selectedProvider === OPENAI_COMPATIBLE_PROVIDER;
  llmBaseUrlRow.classList.toggle("is-hidden", !shouldShowBaseUrl);
}

function syncProviderKeyLabel(): void {
  const provider = llmProviderSelect.value as LlmProvider;
  const labelText = provider === XAI_PROVIDER 
    ? "xAI API key" 
    : provider === GEMINI_PROVIDER 
      ? "Gemini API key" 
      : "OpenAI-compatible API key";
  providerKeyLabel.textContent = labelText;
}

function handleStopWordSave(): void {
  clearStopWordStatus();
  const stopWord = stopWordInput.value.trim();
  if (!stopWord) {
    setStopWordStatus("Stop word cannot be empty.", true);
    return;
  }

  const saved = saveCustomStopWordPreference(stopWord);
  if (!saved) {
    setStopWordStatus("Could not save stop word. Storage may be unavailable.", true);
    return;
  }

  stopWordInput.value = stopWord;
  setStopWordStatus("Stop word saved.", false);
}

function handleStopWordReset(): void {
  clearStopWordStatus();
  const resetOk = resetCustomStopWordPreference();
  if (!resetOk) {
    setStopWordStatus("Could not reset stop word. Storage may be unavailable.", true);
    return;
  }

  stopWordInput.value = defaultStopWord;
  setStopWordStatus("Stop word reset to default.", false);
}

async function handleProviderKeySave(): Promise<void> {
  clearProviderKeyStatus();
  const provider = llmProviderSelect.value as LlmProvider;
  const key = providerKeyInput.value.trim();

  try {
    if (provider === XAI_PROVIDER) {
      await window.voiceToText.updateXaiKey(key);
    } else if (provider === GEMINI_PROVIDER) {
      await window.voiceToText.updateGeminiKey(key);
    } else {
      await window.voiceToText.updateOpenaiCompatibleKey(key);
    }
    providerKeyInput.value = "";
    // Update key state indicator
    providerKeyInput.placeholder = "••••••••••••••••";
    providerKeyInput.classList.add("has-key");
    setProviderKeyStatus("API key saved.", false);
    // Auto-fetch models now that we have a key
    await fetchModels();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setProviderKeyStatus(`Could not save API key: ${message}`, true);
  }
}

async function fetchSonioxModels(): Promise<void> {
  clearSonioxModelStatus();
  setSonioxModelLoading(true);
  setSonioxModelStatus("Fetching Soniox realtime models…", false);

  try {
    const models = await window.voiceToText.listSonioxModels();
    const savedModel = loadSonioxModelPreference();
    const selectedModel = selectFetchedModel(models, savedModel, DEFAULT_SONIOX_MODEL) ?? models[0];
    populateSonioxModelSelect(models, selectedModel);
    saveSonioxModelPreference(selectedModel);
    setSonioxModelStatus(`Loaded ${models.length} Soniox models.`, false);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setSonioxModelStatus(message, true);
    showSonioxModelPlaceholder();
  } finally {
    setSonioxModelLoading(false);
  }
}

function populateSonioxModelSelect(models: string[], selectedModel: string): void {
  sonioxModelSelect.innerHTML = "";

  if (models.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No Soniox realtime models available — click refresh";
    option.disabled = true;
    sonioxModelSelect.appendChild(option);
    sonioxModelSelect.value = "";
    return;
  }

  for (const model of models) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    if (model === selectedModel) {
      option.selected = true;
    }
    sonioxModelSelect.appendChild(option);
  }
}

function setSonioxModelLoading(loading: boolean): void {
  sonioxModelFetchBtn.disabled = loading;
  sonioxModelFetchBtn.classList.toggle("is-loading", loading);
}

function showSonioxModelPlaceholder(): void {
  sonioxModelSelect.innerHTML = "";
  const option = document.createElement("option");
  option.value = "";
  option.textContent = "Click refresh to load Soniox realtime models";
  option.disabled = true;
  option.selected = true;
  sonioxModelSelect.appendChild(option);
}

async function fetchModels(): Promise<void> {
  clearModelStatus();
  const provider = llmProviderSelect.value as LlmProvider;
  const baseUrl = provider === OPENAI_COMPATIBLE_PROVIDER
    ? llmBaseUrlInput.value.trim() || undefined
    : undefined;

  setModelLoading(true);
  setModelStatus("Fetching models…", false);

  try {
    const models = await window.voiceToText.listModels(provider, baseUrl);
    const savedModel = loadLlmModelPreference(provider);
    const selectedModel = selectFetchedModel(models, savedModel, defaultModelForProvider(provider));
    populateModelSelect(models, selectedModel);
    if (selectedModel) {
      saveLlmModelPreference(provider, selectedModel);
    }
    setModelStatus(`Loaded ${models.length} models.`, false);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setModelStatus(message, true);
    // Show helpful placeholder when fetch fails
    showModelPlaceholder();
  } finally {
    setModelLoading(false);
  }
}

function selectFetchedModel(
  models: string[],
  savedModel: string | null,
  preferredDefaultModel: string | null,
): string | null {
  if (models.length === 0) {
    throw new Error("No models returned from provider.");
  }

  if (savedModel && models.includes(savedModel)) {
    return savedModel;
  }

  if (preferredDefaultModel && models.includes(preferredDefaultModel)) {
    return preferredDefaultModel;
  }

  if (preferredDefaultModel === null) {
    return null;
  }

  return models[0];
}

function populateModelSelect(models: string[], selectedModel: string | null): void {
  llmModelSelect.innerHTML = "";

  if (models.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No models available — click refresh";
    option.disabled = true;
    llmModelSelect.appendChild(option);
    llmModelSelect.value = "";
    return;
  }

  if (selectedModel === null) {
    const placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.textContent = "Choose a model";
    placeholderOption.disabled = true;
    placeholderOption.selected = true;
    llmModelSelect.appendChild(placeholderOption);
  }

  for (const model of models) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    if (model === selectedModel) {
      option.selected = true;
    }
    llmModelSelect.appendChild(option);
  }
}

function defaultModelForProvider(provider: LlmProvider): string | null {
  if (provider === XAI_PROVIDER) {
    return DEFAULT_XAI_MODEL;
  }
  if (provider === GEMINI_PROVIDER) {
    return DEFAULT_GEMINI_MODEL;
  }

  return null;
}

function setModelLoading(loading: boolean): void {
  llmModelFetchBtn.disabled = loading;
  llmModelFetchBtn.classList.toggle("is-loading", loading);
}

function showModelPlaceholder(): void {
  llmModelSelect.innerHTML = "";
  const option = document.createElement("option");
  option.value = "";
  option.textContent = "Click refresh to load models";
  option.disabled = true;
  option.selected = true;
  llmModelSelect.appendChild(option);
}

// ─── Key state indicators ──────────────────────────────────────────────────

async function loadKeyStates(): Promise<void> {
  try {
    const hasSonioxKey = await window.voiceToText.hasSonioxKey();
    hasVerifiedSonioxKey = hasSonioxKey;
    setSonioxConnectionState(hasSonioxKey);
    if (hasSonioxKey) {
      sonioxInput.placeholder = SONIOX_KEY_MASK_PLACEHOLDER;
      sonioxInput.classList.add("has-key");
    } else {
      sonioxInput.placeholder = SONIOX_KEY_PLACEHOLDER;
      sonioxInput.classList.remove("has-key");
    }
  } catch {
    hasVerifiedSonioxKey = false;
    setSonioxConnectionState(false);
    sonioxInput.placeholder = SONIOX_KEY_PLACEHOLDER;
    sonioxInput.classList.remove("has-key");
  }

  const provider = llmProviderSelect.value as LlmProvider;
  await loadProviderKeyState(provider);
}

async function loadProviderKeyState(provider: LlmProvider): Promise<void> {
  try {
    let hasKey = false;
    
    if (provider === XAI_PROVIDER) {
      hasKey = await window.voiceToText.hasXaiKey();
    } else if (provider === GEMINI_PROVIDER) {
      hasKey = await window.voiceToText.hasGeminiKey();
    } else {
      hasKey = await window.voiceToText.hasOpenaiCompatibleKey();
    }

    if (hasKey) {
      // Show masked placeholder to indicate key is present
      providerKeyInput.placeholder = "••••••••••••••••";
      providerKeyInput.classList.add("has-key");
      setProviderKeyStatus("Key loaded.", false);
    } else {
      providerKeyInput.placeholder = "";
      providerKeyInput.classList.remove("has-key");
    }
  } catch {
    // Key check failed
  }
}

async function loadRuntimeMicToggleShortcut(): Promise<void> {
  try {
    const runtimeShortcut = await window.voiceToText.getMicToggleShortcut();
    renderShortcutRecorder(runtimeShortcut);
    updateReadyCardShortcut(runtimeShortcut);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setShortcutStatus(`Could not load current shortcut: ${message}`, true);
  }
}

function updateReadyCardShortcut(canonical: string): void {
  if (!hasVerifiedSonioxKey) {
    prefsReadyShortcut.textContent = READY_TO_CONFIGURE_COPY;
    return;
  }

  const displayMode = getShortcutDisplayMode(platformRuntimeInfo);
  const label = shortcutCanonicalToDisplay(canonical, displayMode);
  prefsReadyShortcut.textContent = `Press ${label} to start`;
}

function setSonioxConnectionState(hasKey: boolean): void {
  prefsReadyTitle.textContent = hasKey ? READY_TO_DICTATE_TITLE : READY_TO_CONFIGURE_TITLE;
  statusHero.dataset.state = hasKey ? "ready" : "setup";
  updateReadyCardShortcut(loadMicToggleShortcutPreference());
}

// ─── Shortcut recorder ────────────────────────────────────────────────────

function bindShortcutRecorder(): void {
  micShortcutRecorder.addEventListener("click", () => {
    if (shortcutRecorderState.isRecording) {
      stopRecordingShortcut();
    } else {
      startRecordingShortcut();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (!shortcutRecorderState.isRecording) return;
    handleShortcutKeyDown(e);
  }, { capture: true });

  document.addEventListener("keyup", (e) => {
    if (!shortcutRecorderState.isRecording) return;
    handleShortcutKeyUp(e);
  }, { capture: true });
}

function startRecordingShortcut(): void {
  shortcutRecorderState = {
    isRecording: true,
    keys: new Set(),
    modifiers: new Set(),
  };
  micShortcutRecorder.classList.add("is-recording");
  micShortcutRecorder.setAttribute("aria-label", "Recording shortcut — press key combination");
  renderShortcutRecorder("");
}

function stopRecordingShortcut(): void {
  shortcutRecorderState.isRecording = false;
  micShortcutRecorder.classList.remove("is-recording");
  micShortcutRecorder.setAttribute("aria-label", "Global mic toggle shortcut — click to record");

  // Restore saved shortcut if recording was cancelled
  const savedShortcut = loadMicToggleShortcutPreference();
  renderShortcutRecorder(savedShortcut);
}

function handleShortcutKeyDown(e: KeyboardEvent): void {
  e.preventDefault();
  e.stopPropagation();

  const key = normalizeKey(e.key);
  if (isModifierKey(key)) {
    shortcutRecorderState.modifiers.add(key);
  } else if (key !== "Unidentified") {
    shortcutRecorderState.keys.add(key);
  }

  renderCurrentShortcut();
}

function handleShortcutKeyUp(e: KeyboardEvent): void {
  e.preventDefault();
  e.stopPropagation();

  const key = normalizeKey(e.key);
  if (isModifierKey(key)) {
    shortcutRecorderState.modifiers.delete(key);
  }

  // If all keys released and we captured something, stop recording
  if (e.key === "Escape") {
    stopRecordingShortcut();
    return;
  }

  // Auto-commit when a non-modifier key is pressed and released
  if (!isModifierKey(key) && shortcutRecorderState.keys.size > 0) {
    const shortcut = buildShortcutString();
    if (shortcut) {
      stopRecordingShortcut();
      renderShortcutRecorder(shortcut);
      // Auto-save the recorded shortcut
      void saveRecordedShortcut(shortcut);
    }
  }
}

function normalizeKey(key: string): string {
  const keyMap: Record<string, string> = {
    "Control": "Control",
    "Ctrl": "Control",
    "Alt": "Alt",
    "Option": "Alt",
    "Shift": "Shift",
    "Meta": "Super",
    "Command": "Super",
    "Cmd": "Super",
    "Super": "Super",
    "ArrowUp": "Up",
    "ArrowDown": "Down",
    "ArrowLeft": "Left",
    "ArrowRight": "Right",
  };
  return keyMap[key] || key;
}

function isModifierKey(key: string): boolean {
  return ["Control", "Alt", "Shift", "Super"].includes(key);
}

function buildShortcutString(): string {
  const modifiers = Array.from(shortcutRecorderState.modifiers);
  const keys = Array.from(shortcutRecorderState.keys);

  // Sort modifiers in consistent order
  const modifierOrder = ["Control", "Alt", "Shift", "Super"];
  const sortedModifiers = modifiers.sort(
    (a, b) => modifierOrder.indexOf(a) - modifierOrder.indexOf(b)
  );

  const parts = [...sortedModifiers, ...keys];
  return parts.join("+");
}

function renderCurrentShortcut(): void {
  const shortcut = buildShortcutString();
  renderShortcutRecorder(shortcut || "Press keys…");
}

function renderShortcutRecorder(shortcut: string): void {
  renderShortcutRecorderState(
    micShortcutRecorder,
    shortcut,
    getShortcutDisplayMode(platformRuntimeInfo),
  );
}

async function saveRecordedShortcut(shortcut: string): Promise<void> {
  setMicShortcutBusy(true);
  try {
    const runtimeShortcut = await window.voiceToText.updateMicToggleShortcut(shortcut);
    renderShortcutRecorder(runtimeShortcut);
    updateReadyCardShortcut(runtimeShortcut);

    const persisted = saveMicToggleShortcutPreference(runtimeShortcut);
    if (!persisted) {
      setShortcutStatus(
        "Shortcut updated, but local save failed. Storage may be unavailable.",
        true,
      );
      return;
    }

    setShortcutStatus("Global shortcut saved.", false);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setShortcutStatus(`Could not save shortcut: ${message}`, true);
  } finally {
    setMicShortcutBusy(false);
  }
}

async function handleMicShortcutReset(): Promise<void> {
  clearShortcutStatus();
  setMicShortcutBusy(true);
  try {
    const runtimeShortcut = await window.voiceToText.updateMicToggleShortcut(
      DEFAULT_MIC_TOGGLE_SHORTCUT,
    );
    renderShortcutRecorder(runtimeShortcut);
    updateReadyCardShortcut(runtimeShortcut);

    const cleared = resetMicToggleShortcutPreference();
    if (!cleared) {
      const fallbackSaved = saveMicToggleShortcutPreference(runtimeShortcut);
      if (!fallbackSaved) {
        setShortcutStatus(
          "Shortcut reset, but local storage is unavailable.",
          true,
        );
        return;
      }
    }

    setShortcutStatus("Global shortcut reset to default.", false);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setShortcutStatus(`Could not reset shortcut: ${message}`, true);
  } finally {
    setMicShortcutBusy(false);
  }
}

function setMicShortcutBusy(isBusy: boolean): void {
  micShortcutResetBtn.disabled = isBusy;
}

function scheduleStatusClear(element: HTMLElement, clearFn: () => void): void {
  cancelScheduledStatusClear(element);
  const timerId = setTimeout(() => {
    statusClearTimers.delete(element);
    clearFn();
  }, STATUS_AUTO_CLEAR_MS);
  statusClearTimers.set(element, timerId);
}

function cancelScheduledStatusClear(element: HTMLElement): void {
  const existing = statusClearTimers.get(element);
  if (existing !== undefined) {
    clearTimeout(existing);
    statusClearTimers.delete(element);
  }
}

function setShortcutStatus(message: string, isError: boolean): void {
  micShortcutStatus.textContent = message;
  micShortcutStatus.classList.toggle("is-error", isError);
  micShortcutStatus.classList.toggle("is-success", !isError);
  if (isError) {
    cancelScheduledStatusClear(micShortcutStatus);
  } else {
    scheduleStatusClear(micShortcutStatus, clearShortcutStatus);
  }
}

function clearShortcutStatus(): void {
  micShortcutStatus.textContent = "";
  micShortcutStatus.classList.remove("is-error", "is-success");
}

// ─── Stop word status ─────────────────────────────────────────────────────

function setStopWordStatus(message: string, isError: boolean): void {
  stopWordStatus.textContent = message;
  stopWordStatus.classList.toggle("is-error", isError);
  stopWordStatus.classList.toggle("is-success", !isError);
  if (isError) {
    cancelScheduledStatusClear(stopWordStatus);
  } else {
    scheduleStatusClear(stopWordStatus, clearStopWordStatus);
  }
}

function clearStopWordStatus(): void {
  stopWordStatus.textContent = "";
  stopWordStatus.classList.remove("is-error", "is-success");
}

// ─── AI status ────────────────────────────────────────────────────────────

function setAiStatus(message: string, isError: boolean): void {
  aiStatus.textContent = message;
  aiStatus.classList.toggle("is-error", isError);
  aiStatus.classList.toggle("is-success", !isError);
  if (isError) {
    cancelScheduledStatusClear(aiStatus);
  } else {
    scheduleStatusClear(aiStatus, clearAiStatus);
  }
}

function clearAiStatus(): void {
  aiStatus.textContent = "";
  aiStatus.classList.remove("is-error", "is-success");
}

// ─── Soniox key status ────────────────────────────────────────────────────

function setSonioxKeyStatus(message: string, isError: boolean): void {
  sonioxKeyStatus.textContent = message;
  sonioxKeyStatus.classList.toggle("is-error", isError);
  sonioxKeyStatus.classList.toggle("is-success", !isError);
  if (isError) {
    cancelScheduledStatusClear(sonioxKeyStatus);
  } else {
    scheduleStatusClear(sonioxKeyStatus, clearSonioxKeyStatus);
  }
}

function clearSonioxKeyStatus(): void {
  sonioxKeyStatus.textContent = "";
  sonioxKeyStatus.classList.remove("is-error", "is-success");
}

function setSonioxModelStatus(message: string, isError: boolean): void {
  sonioxModelStatus.textContent = message;
  sonioxModelStatus.classList.toggle("is-error", isError);
  sonioxModelStatus.classList.toggle("is-success", !isError);
  if (isError) {
    cancelScheduledStatusClear(sonioxModelStatus);
  } else {
    scheduleStatusClear(sonioxModelStatus, clearSonioxModelStatus);
  }
}

function clearSonioxModelStatus(): void {
  sonioxModelStatus.textContent = "";
  sonioxModelStatus.classList.remove("is-error", "is-success");
}

// ─── Model status ─────────────────────────────────────────────────────────

function setModelStatus(message: string, isError: boolean): void {
  llmModelStatus.textContent = message;
  llmModelStatus.classList.toggle("is-error", isError);
  llmModelStatus.classList.toggle("is-success", !isError);
  if (isError) {
    cancelScheduledStatusClear(llmModelStatus);
  } else {
    scheduleStatusClear(llmModelStatus, clearModelStatus);
  }
}

function clearModelStatus(): void {
  llmModelStatus.textContent = "";
  llmModelStatus.classList.remove("is-error", "is-success");
}

// ─── Provider key status ──────────────────────────────────────────────────

function setProviderKeyStatus(message: string, isError: boolean): void {
  providerKeyStatus.textContent = message;
  providerKeyStatus.classList.toggle("is-error", isError);
  providerKeyStatus.classList.toggle("is-success", !isError);
  if (isError) {
    cancelScheduledStatusClear(providerKeyStatus);
  } else {
    scheduleStatusClear(providerKeyStatus, clearProviderKeyStatus);
  }
}

function clearProviderKeyStatus(): void {
  providerKeyStatus.textContent = "";
  providerKeyStatus.classList.remove("is-error", "is-success");
}

// ─── AI fieldset disabled sync ────────────────────────────────────────────

function syncAiFieldsetDisabledState(correctionEnabled: boolean): void {
  aiSettingsFieldset.disabled = !correctionEnabled;
  aiDisabledNote.classList.toggle("is-hidden", correctionEnabled);
}

// ─── Vocabulary count ─────────────────────────────────────────────────────

function updateVocabCount(): void {
  const prefs = loadPreferences();
  const total = prefs.sonioxTerms.length;
  vocabCountBadge.textContent = total > 0 ? String(total) : "";
}

// ─── Permission banner (prefs screen) ─────────────────────────────────────

function showPermissionBanner(
  deniedResults: Array<{ permission: string; message?: string }>,
  runtimeInfo: PlatformRuntimeInfo,
): void {
  const deniedList = buildPermissionSummary(deniedResults);
  const detailMessage = buildPermissionDetailMessage(deniedResults);
  const settingsLabel = getPermissionSettingsLabel(runtimeInfo);
  permissionBannerText.textContent = [
    `Missing permissions: ${deniedList}.`,
    detailMessage,
    `Review them in ${settingsLabel}.`,
  ]
    .filter(Boolean)
    .join(" ");
  permissionBanner.classList.remove("is-hidden");
}

function hidePermissionBanner(): void {
  permissionBanner.classList.add("is-hidden");
}

async function checkForAppUpdate(): Promise<void> {
  try {
    const update = await window.voiceToText.checkForUpdate();
    if (!update) {
      return;
    }

    updateAvailable = update;
    showUpdateBanner(update.version);
  } catch {
    hideUpdateBanner();
  }
}

function showUpdateBanner(version: string): void {
  updateBannerText.textContent = `Update available: v${version}`;
  updateBannerAction.textContent = UPDATE_BUTTON_LABEL;
  updateBannerAction.disabled = false;
  updateBanner.classList.remove("is-hidden");
}

function hideUpdateBanner(): void {
  updateBanner.classList.add("is-hidden");
}

function bindUpdateBanner(): void {
  updateBannerAction.addEventListener("click", () => {
    void handleUpdateInstall();
  });
}

async function handleUpdateInstall(): Promise<void> {
  if (!updateAvailable || updateDownloading) {
    return;
  }

  updateDownloading = true;
  updateBannerAction.textContent = UPDATE_DOWNLOADING_LABEL;
  updateBannerAction.disabled = true;

  try {
    await updateAvailable.downloadAndInstall();
    updateBannerAction.textContent = UPDATE_RESTARTING_LABEL;
    await window.voiceToText.relaunchApp();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateBannerText.textContent = `Update failed: ${message}`;
    updateBannerAction.textContent = UPDATE_RETRY_LABEL;
    updateBannerAction.disabled = false;
    updateDownloading = false;
  }
}

// ─── Action buttons ───────────────────────────────────────────────────────

function bindActionButtons(): void {
  openSettingsBtn.addEventListener("click", () => {
    settingsOpenedBy = openSettingsBtn;
    openSettingsDialog();
  });
}

// ─── Settings dialog ──────────────────────────────────────────────────────

function bindDialog(): void {
  dialogCloseBtn.addEventListener("click", closeSettingsDialog);
  dialogCancelBtn.addEventListener("click", closeSettingsDialog);

  dialogSaveBtn.addEventListener("click", () => {
    commitStagedSettings();
    closeSettingsDialog();
  });

  dialogResetBtn.addEventListener("click", () => {
    loadStagedFromDefaults();
    renderDialogTerms();
  });

  termsAddBtn.addEventListener("click", addStagedTerm);
  termsAddInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addStagedTerm();
  });

  // Close on backdrop click
  dialogBackdrop.addEventListener("click", (e) => {
    if (e.target === dialogBackdrop) closeSettingsDialog();
  });

  // Escape closes dialog
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && dialogBackdrop.classList.contains("is-open")) {
      closeSettingsDialog();
    }
  });

  // Focus trap
  dialogEl.addEventListener("keydown", trapFocus);
}

function openSettingsDialog(): void {
  const prefs = loadPreferences();
  staged = {
    terms: [...prefs.sonioxTerms],
  };

  renderDialogTerms();

  dialogBackdrop.classList.add("is-open");
  dialogEl.setAttribute("aria-hidden", "false");

  // Focus first focusable element in dialog
  const first = firstFocusable(dialogEl);
  first?.focus();
}

function closeSettingsDialog(): void {
  dialogBackdrop.classList.remove("is-open");
  dialogEl.setAttribute("aria-hidden", "true");
  settingsOpenedBy?.focus();
  settingsOpenedBy = null;
}

function commitStagedSettings(): void {
  const termsOk = saveSonioxTerms(staged.terms);
  if (!termsOk) {
    applySetupError(
      "Could not save vocabulary settings. Storage may be full or unavailable.",
      setupError,
      sonioxInput,
    );
    return;
  }
  updateVocabCount();
}

function loadStagedFromDefaults(): void {
  const defaults = window.voiceToTextDefaults;
  staged = {
    terms: [...defaults.terms],
  };
}

// ─── Dialog: terms ────────────────────────────────────────────────────────

function renderDialogTerms(): void {
  termsTagList.innerHTML = "";

  if (staged.terms.length === 0) {
    const empty = document.createElement("span");
    empty.className = "tag-empty";
    empty.textContent = "No terms added";
    termsTagList.appendChild(empty);
    return;
  }

  for (const term of staged.terms) {
    termsTagList.appendChild(buildTermTag(term));
  }
}

function buildTermTag(term: string): HTMLElement {
  const tag = document.createElement("span");
  tag.className = "tag";

  const text = document.createElement("span");
  text.textContent = term;

  const removeBtn = document.createElement("button");
  removeBtn.className = "tag-remove";
  removeBtn.setAttribute("aria-label", `Remove term "${term}"`);
  removeBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>`;
  removeBtn.addEventListener("click", () => {
    staged.terms = staged.terms.filter((t) => t !== term);
    renderDialogTerms();
  });

  tag.appendChild(text);
  tag.appendChild(removeBtn);
  return tag;
}

function addStagedTerm(): void {
  const value = termsAddInput.value.trim();
  if (!value) return;
  if (staged.terms.includes(value)) {
    termsAddInput.value = "";
    return;
  }
  staged.terms = [...staged.terms, value];
  termsAddInput.value = "";
  renderDialogTerms();
}

// ─── Focus trap ───────────────────────────────────────────────────────────

function firstFocusable(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
}

function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

function trapFocus(e: KeyboardEvent): void {
  if (e.key !== "Tab") return;

  const focusable = getFocusableElements(dialogEl);
  if (focusable.length === 0) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (e.shiftKey) {
    if (document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
  } else if (document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  void init();
});
