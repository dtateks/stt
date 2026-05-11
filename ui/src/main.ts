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
import type { ShortcutDisplayMode } from "./shortcut-display.ts";
import { shortcutCanonicalToDisplay } from "./shortcut-display.ts";
import { createShortcutRecorder, type ShortcutRecorder } from "./shortcut-recorder.ts";
import { createSettingsDialog, type SettingsDialog } from "./settings-dialog.ts";
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
import { statusField } from "./status-field.ts";
import { createModelPicker, type ModelPicker } from "./model-picker.ts";
import {
  DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
  OPENAI_COMPATIBLE_PROVIDER,
  XAI_PROVIDER,
  defaultModelForProvider,
  hasProviderKey,
  providerLabel,
  updateProviderKey,
} from "./llm-provider.ts";

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

const DEFAULT_SONIOX_MODEL = "stt-rt-v4";
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

const shortcutStatusField = statusField(micShortcutStatus);
const stopWordStatusField = statusField(stopWordStatus);
const aiStatusField = statusField(aiStatus);
const sonioxKeyStatusField = statusField(sonioxKeyStatus);
const sonioxModelStatusField = statusField(sonioxModelStatus);
const modelStatusField = statusField(llmModelStatus);
const providerKeyStatusField = statusField(providerKeyStatus);

const sonioxModelPicker: ModelPicker = createModelPicker({
  selectEl: sonioxModelSelect,
  fetchBtn: sonioxModelFetchBtn,
  statusField: sonioxModelStatusField,
  fetchModels: () => window.voiceToText.listSonioxModels(),
  loadSavedModel: () => loadSonioxModelPreference(),
  saveModel: (model) => {
    saveSonioxModelPreference(model);
  },
  defaultModel: () => DEFAULT_SONIOX_MODEL,
  copy: {
    fetching: "Fetching Soniox realtime models…",
    loaded: (count) => `Loaded ${count} Soniox models.`,
    initialPlaceholder: "Click refresh to load Soniox realtime models",
    chooseModelPlaceholder: "Choose a Soniox model",
  },
});

const llmModelPicker: ModelPicker = createModelPicker({
  selectEl: llmModelSelect,
  fetchBtn: llmModelFetchBtn,
  statusField: modelStatusField,
  fetchModels: () => {
    const provider = llmProviderSelect.value as LlmProvider;
    const baseUrl = provider === OPENAI_COMPATIBLE_PROVIDER
      ? llmBaseUrlInput.value.trim() || undefined
      : undefined;
    return window.voiceToText.listModels(provider, baseUrl);
  },
  loadSavedModel: () => loadLlmModelPreference(llmProviderSelect.value as LlmProvider),
  saveModel: (model) => {
    saveLlmModelPreference(llmProviderSelect.value as LlmProvider, model);
  },
  defaultModel: () => defaultModelForProvider(llmProviderSelect.value as LlmProvider),
  copy: {
    fetching: "Fetching models…",
    loaded: (count) => `Loaded ${count} models.`,
    initialPlaceholder: "Click refresh to load models",
    chooseModelPlaceholder: "Choose a model",
  },
});
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

const shortcutRecorder: ShortcutRecorder = createShortcutRecorder({
  buttonEl: micShortcutRecorder,
  resetBtnEl: micShortcutResetBtn,
  statusField: shortcutStatusField,
  displayMode: () => getShortcutDisplayMode(platformRuntimeInfo),
  loadSavedShortcut: () => loadMicToggleShortcutPreference(),
  saveShortcut: (canonical) => saveMicToggleShortcutPreference(canonical),
  resetSavedShortcut: () => resetMicToggleShortcutPreference(),
  applyShortcutAtRuntime: (canonical) =>
    window.voiceToText.updateMicToggleShortcut(canonical),
  onShortcutApplied: (canonical) => updateReadyCardShortcut(canonical),
  defaultShortcut: DEFAULT_MIC_TOGGLE_SHORTCUT,
});

const settingsDialog: SettingsDialog = createSettingsDialog({
  backdropEl: dialogBackdrop,
  dialogEl,
  closeBtnEl: dialogCloseBtn,
  cancelBtnEl: dialogCancelBtn,
  saveBtnEl: dialogSaveBtn,
  resetBtnEl: dialogResetBtn,
  termsTagListEl: termsTagList,
  termsAddInputEl: termsAddInput,
  termsAddBtnEl: termsAddBtn,
  loadStagedTerms: () => [...loadPreferences().sonioxTerms],
  loadDefaultTerms: () => [...window.voiceToTextDefaults.terms],
  saveTerms: (terms) => saveSonioxTerms(terms),
  onSaveError: (message) => applySetupError(message, setupError, sonioxInput),
  onTermsCommitted: () => updateVocabCount(),
});

// ─── Initialization ───────────────────────────────────────────────────────

async function init(): Promise<void> {
  bindSetupForm();
  bindPrefs();
  bindActionButtons();
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
  void llmModelPicker.fetch();

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
    void sonioxModelPicker.fetch();
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
  sonioxKeyStatusField.clear();

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
    sonioxKeyStatusField.setSuccess("Soniox API key saved.");
    await sonioxModelPicker.fetch();
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
  shortcutStatusField.clear();
  stopWordStatusField.clear();
  aiStatusField.clear();
  sonioxKeyStatusField.clear();
  sonioxModelStatusField.clear();
  modelStatusField.clear();
  providerKeyStatusField.clear();

  // Re-apply the saved shortcut so the recorder picks up any platform
  // display-mode change that happened since module load.
  shortcutRecorder.applyRuntimeShortcut(loadMicToggleShortcutPreference());

  // Show placeholder in each model select until the picker fetches real models.
  llmModelPicker.showInitialPlaceholder();
  sonioxModelPicker.showInitialPlaceholder();
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
      void sonioxModelPicker.fetch();
      void checkForAppUpdate();
    }
    return;
  }

  sonioxInput.classList.remove("has-key");
  sonioxInput.placeholder = SONIOX_KEY_PLACEHOLDER;
  sonioxModelPicker.showInitialPlaceholder();
  sonioxModelStatusField.clear();
  applySetupError(MISSING_SONIOX_KEY_SETUP_MESSAGE, setupError, sonioxInput);
}

function bindPrefs(): void {
  enterModeToggle.addEventListener("change", () => {
    saveEnterMode(enterModeToggle.checked);
  });

  outputLangSelect.addEventListener("change", () => {
    saveOutputLang(outputLangSelect.value as OutputLang);
    aiStatusField.setSuccess("Output language saved.");
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

  llmProviderSelect.addEventListener("change", () => {
    const provider = llmProviderSelect.value as LlmProvider;
    saveLlmProviderPreference(provider);
    syncLlmBaseUrlVisibility();
    syncProviderKeyLabel();
    aiStatusField.setSuccess("Provider saved.");
    // Clear model selection until we fetch real models
    llmModelPicker.showInitialPlaceholder();
    modelStatusField.clear();
    // Load key state for the new provider
    void loadProviderKeyState(provider);
    // Fetch real models from endpoint
    void llmModelPicker.fetch();
  });

  llmBaseUrlInput.addEventListener("change", () => {
    const baseUrl = llmBaseUrlInput.value.trim();
    if (baseUrl) {
      saveLlmBaseUrlPreference(baseUrl);
      aiStatusField.setSuccess("Base URL saved.");
    }
  });

  llmModelSelect.addEventListener("change", () => {
    const provider = llmProviderSelect.value as LlmProvider;
    const model = llmModelSelect.value;
    if (model) {
      saveLlmModelPreference(provider, model);
      aiStatusField.setSuccess("Model saved.");
    }
  });

  llmModelFetchBtn.addEventListener("click", () => {
    void llmModelPicker.fetch();
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
    sonioxModelStatusField.setSuccess("Soniox model saved.");
  });

  sonioxModelFetchBtn.addEventListener("click", () => {
    void sonioxModelPicker.fetch();
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
  providerKeyLabel.textContent = `${providerLabel(provider)} API key`;
}

function handleStopWordSave(): void {
  stopWordStatusField.clear();
  const stopWord = stopWordInput.value.trim();
  if (!stopWord) {
    stopWordStatusField.setError("Stop word cannot be empty.");
    return;
  }

  const saved = saveCustomStopWordPreference(stopWord);
  if (!saved) {
    stopWordStatusField.setError("Could not save stop word. Storage may be unavailable.");
    return;
  }

  stopWordInput.value = stopWord;
  stopWordStatusField.setSuccess("Stop word saved.");
}

function handleStopWordReset(): void {
  stopWordStatusField.clear();
  const resetOk = resetCustomStopWordPreference();
  if (!resetOk) {
    stopWordStatusField.setError("Could not reset stop word. Storage may be unavailable.");
    return;
  }

  stopWordInput.value = defaultStopWord;
  stopWordStatusField.setSuccess("Stop word reset to default.");
}

async function handleProviderKeySave(): Promise<void> {
  providerKeyStatusField.clear();
  const provider = llmProviderSelect.value as LlmProvider;
  const key = providerKeyInput.value.trim();

  try {
    await updateProviderKey(window.voiceToText, provider, key);
    providerKeyInput.value = "";
    // Update key state indicator
    providerKeyInput.placeholder = "••••••••••••••••";
    providerKeyInput.classList.add("has-key");
    providerKeyStatusField.setSuccess("API key saved.");
    // Auto-fetch models now that we have a key
    await llmModelPicker.fetch();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    providerKeyStatusField.setError(`Could not save API key: ${message}`);
  }
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
    const hasKey = await hasProviderKey(window.voiceToText, provider);

    if (hasKey) {
      // Show masked placeholder to indicate key is present
      providerKeyInput.placeholder = "••••••••••••••••";
      providerKeyInput.classList.add("has-key");
      providerKeyStatusField.setSuccess("Key loaded.");
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
    shortcutRecorder.applyRuntimeShortcut(runtimeShortcut);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    shortcutStatusField.setError(`Could not load current shortcut: ${message}`);
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
    settingsDialog.open(openSettingsBtn);
  });
}

// ─── Boot ─────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  void init();
});
