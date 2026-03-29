/**
 * Main window entry point.
 *
 * Surfaces: setup screen + preferences screen + advanced settings dialog.
 * All bridge calls are funnelled through the window.voiceToText surface only.
 */

import "./main.css";
import type { LlmProvider, OutputLang, TranslationTerm } from "./types.ts";
import {
  readShortcutRecorderShortcut,
  renderShortcutRecorderState,
} from "./shortcut-recorder-logic.ts";
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
  saveSonioxTranslationTerms,
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
  translationTerms: TranslationTerm[];
}

let staged: StagedSettings = { terms: [], translationTerms: [] };
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

// Screens
const setupScreen = q<HTMLDivElement>("#screen-setup");
const prefsScreen = q<HTMLDivElement>("#screen-prefs");

// Setup form
const sonioxInput = q<HTMLInputElement>("#setup-soniox-key");
const xaiInput = q<HTMLInputElement>("#setup-xai-key");
const setupSubmitBtn = q<HTMLButtonElement>("#setup-submit");
const setupError = q<HTMLDivElement>("#setup-error");

// Prefs
const enterModeToggle = q<HTMLInputElement>("#pref-enter-mode");
const outputLangSelect = q<HTMLSelectElement>("#pref-output-lang");
const llmCorrectionToggle = q<HTMLInputElement>("#pref-llm-correction");
const reminderBeepToggle = q<HTMLInputElement>("#pref-reminder-beep");
const stopWordInput = q<HTMLInputElement>("#pref-stop-word");
const stopWordSaveBtn = q<HTMLButtonElement>("#pref-stop-word-save");
const stopWordResetBtn = q<HTMLButtonElement>("#pref-stop-word-reset");
const micShortcutRecorder = q<HTMLButtonElement>("#pref-mic-shortcut");
const micShortcutSaveBtn = q<HTMLButtonElement>("#pref-mic-shortcut-save");
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
const sonioxKeyInput = q<HTMLInputElement>("#pref-soniox-key");
const sonioxKeySaveBtn = q<HTMLButtonElement>("#pref-soniox-key-save");
const sonioxKeyStatus = q<HTMLDivElement>("#pref-soniox-key-status");
const sonioxModelSelect = q<HTMLSelectElement>("#pref-soniox-model");
const sonioxModelFetchBtn = q<HTMLButtonElement>("#pref-soniox-model-fetch");
const sonioxModelStatus = q<HTMLDivElement>("#pref-soniox-model-status");

// Stop word status (General tab — separate from shortcut status)
const stopWordStatus = q<HTMLDivElement>("#pref-stop-word-status");

// AI status (AI tab)
const aiStatus = q<HTMLDivElement>("#ai-status");
const aiSettingsFieldset = q<HTMLFieldSetElement>("#ai-settings-fieldset");

// Permission banner (prefs screen)
const permissionBanner = q<HTMLDivElement>("#prefs-permission-banner");
const permissionBannerText = q<HTMLSpanElement>("#prefs-permission-text");

// Vocabulary count badge
const vocabCountBadge = q<HTMLSpanElement>("#vocab-count");

// Dialog
const dialogBackdrop = q<HTMLDivElement>("#settings-dialog-backdrop");
const dialogEl = q<HTMLDivElement>("#settings-dialog");

// Dialog: terms
const termsTagList = q<HTMLDivElement>("#terms-tag-list");
const termsAddInput = q<HTMLInputElement>("#terms-add-input");
const termsAddBtn = q<HTMLButtonElement>("#terms-add-btn");

// Dialog: translation terms
const translationList = q<HTMLDivElement>("#translation-list");
const translationSrcInput = q<HTMLInputElement>("#translation-src-input");
const translationTgtInput = q<HTMLInputElement>("#translation-tgt-input");
const translationAddBtn = q<HTMLButtonElement>("#translation-add-btn");

// Dialog footer
const dialogResetBtn = q<HTMLButtonElement>("#dialog-reset");
const dialogCancelBtn = q<HTMLButtonElement>("#dialog-cancel");
const dialogSaveBtn = q<HTMLButtonElement>("#dialog-save");
const dialogCloseBtn = q<HTMLButtonElement>("#dialog-close-btn");

// Action buttons
const resetKeysBtn = q<HTMLButtonElement>("#action-reset-keys");
const openSettingsBtn = q<HTMLButtonElement>("#action-open-settings");

// Tab navigation
const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".tab-btn"));
const tabPanels = Array.from(document.querySelectorAll<HTMLDivElement>(".tab-panel"));

const SHORTCUT_STATUS_CLEAR_DELAY_MS = 4_000;
let shortcutStatusTimer: ReturnType<typeof setTimeout> | null = null;

const AI_STATUS_CLEAR_DELAY_MS = 4_000;
const STOP_WORD_STATUS_CLEAR_DELAY_MS = 4_000;
const SONIOX_KEY_STATUS_CLEAR_DELAY_MS = 4_000;
const SONIOX_MODEL_STATUS_CLEAR_DELAY_MS = 4_000;
const MODEL_STATUS_CLEAR_DELAY_MS = 4_000;
const PROVIDER_KEY_STATUS_CLEAR_DELAY_MS = 4_000;

const OPENAI_COMPATIBLE_PROVIDER: LlmProvider = "openai_compatible";
const XAI_PROVIDER: LlmProvider = "xai";
const GEMINI_PROVIDER: LlmProvider = "gemini";
const DEFAULT_XAI_MODEL = "grok-4-1-fast-non-reasoning";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";
const DEFAULT_SONIOX_MODEL = "stt-rt-v4";
const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = "https://api.openai.com/v1";
const SETUP_BUTTON_LABEL = "Get Started";
const SETUP_BUTTON_SAVING_LABEL = "Saving…";

let aiStatusTimer: ReturnType<typeof setTimeout> | null = null;
let stopWordStatusTimer: ReturnType<typeof setTimeout> | null = null;
let sonioxKeyStatusTimer: ReturnType<typeof setTimeout> | null = null;
let sonioxModelStatusTimer: ReturnType<typeof setTimeout> | null = null;
let modelStatusTimer: ReturnType<typeof setTimeout> | null = null;
let providerKeyStatusTimer: ReturnType<typeof setTimeout> | null = null;
let defaultStopWord = "thank you";
let defaultLlmProvider: LlmProvider = XAI_PROVIDER;
let defaultLlmBaseUrl = DEFAULT_OPENAI_COMPATIBLE_BASE_URL;

// ─── Initialization ───────────────────────────────────────────────────────

async function init(): Promise<void> {
  bindSetupForm();
  bindPrefs();
  bindActionButtons();
  bindDialog();
  bindTabs();
  bindShortcutRecorder();

  let bridge: Awaited<ReturnType<typeof waitForVoiceToTextBridge>>;
  try {
    bridge = await waitForVoiceToTextBridge();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showSetupScreen();
    applySetupError(`Startup bridge failed: ${message}`, setupError, sonioxInput);
    return;
  }

  const shortcutSyncError = await syncStoredMicToggleShortcut(bridge);
  await hydrateRuntimeDefaults(bridge);

  const keyCheck = await checkHasSonioxKey(bridge);
  const hasKey = keyCheck.hasKey;
  let startupErrorMessage = keyCheck.error
    ? `Startup credential check failed: ${keyCheck.error}`
    : null;

  if (shortcutSyncError) {
    startupErrorMessage = startupErrorMessage
      ? `${startupErrorMessage} — ${shortcutSyncError}`
      : shortcutSyncError;
  }

  if (hasKey) {
    showPrefsScreen();
  } else {
    showSetupScreen();
  }

  if (startupErrorMessage) {
    applySetupError(startupErrorMessage, setupError, sonioxInput);
  }

  // Trigger permission dialogs on first launch so the OS prompts upfront.
  // Surface an advisory on the setup screen if any permission was not granted.
  const permResults = await requestStartupPermissions(bridge);
  const anyDenied = permResults.some((r) => !r.granted);
  if (anyDenied) {
    const deniedNames = permResults
      .filter((r) => !r.granted)
      .map((r) => r.permission);
    const deniedList = deniedNames.join(", ");
    const permissionMessage = `Some permissions were not granted (${deniedList}). Voice to Text may not function correctly. Enable them in System Settings → Privacy & Security.`;
    startupErrorMessage = startupErrorMessage
      ? `${startupErrorMessage} — ${permissionMessage}`
      : permissionMessage;
    applySetupError(
      startupErrorMessage,
      setupError,
      sonioxInput,
    );
    showPermissionBanner(deniedNames);
    startPermissionPolling();
  }
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
      clearSetupError(setupError, sonioxInput);
      hidePermissionBanner();
    }
  } catch {
    // Polling failure is not actionable — keep polling.
  }
}

// ─── Screen routing ───────────────────────────────────────────────────────

function showSetupScreen(): void {
  setupScreen.classList.add("is-active");
  prefsScreen.classList.remove("is-active");
  sonioxInput.focus();
}

function showPrefsScreen(): void {
  prefsScreen.classList.add("is-active");
  setupScreen.classList.remove("is-active");
  loadPrefsUI();
  void loadRuntimeMicToggleShortcut();
  void loadKeyStates(); // Load key presence indicators
  void fetchModels(); // Fetch real models from endpoint
  void fetchSonioxModels(); // Fetch Soniox realtime models from backend
}

// ─── Setup form ───────────────────────────────────────────────────────────

function bindSetupForm(): void {
  setupSubmitBtn.addEventListener("click", () => {
    void handleSetupSubmit();
  });

  // Allow Enter on inputs to submit
  [sonioxInput, xaiInput].forEach((input) => {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void handleSetupSubmit();
    });
  });
}

async function handleSetupSubmit(): Promise<void> {
  clearSetupError(setupError, sonioxInput);

  const sonioxKey = sonioxInput.value.trim();
  const xaiKey = xaiInput.value.trim();

  const validationError = validateSonioxKey(sonioxKey);
  if (validationError) {
    applySetupError(validationError, setupError, sonioxInput);
    sonioxInput.focus();
    return;
  }

  setSetupSaving(true);

  try {
    await window.voiceToText.saveCredentials(xaiKey, sonioxKey);
    showPrefsScreen();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    applySetupError(`Failed to save credentials: ${msg}`, setupError, sonioxInput);
    setSetupSaving(false);
  }
}

function setSetupSaving(saving: boolean): void {
  setupSubmitBtn.disabled = saving;
  setupSubmitBtn.textContent = saving ? SETUP_BUTTON_SAVING_LABEL : SETUP_BUTTON_LABEL;
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

  stopWordSaveBtn.addEventListener("click", () => {
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

  micShortcutSaveBtn.addEventListener("click", () => {
    void handleMicShortcutSave();
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

  sonioxKeySaveBtn.addEventListener("click", () => {
    void handleSonioxKeySave();
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
  const resetOk = resetCustomStopWordPreference();
  if (!resetOk) {
    setStopWordStatus("Could not reset stop word. Storage may be unavailable.", true);
    return;
  }

  stopWordInput.value = defaultStopWord;
  setStopWordStatus("Stop word reset to default.", false);
}

async function handleProviderKeySave(): Promise<void> {
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

async function handleSonioxKeySave(): Promise<void> {
  const key = sonioxKeyInput.value.trim();
  if (!key) {
    setSonioxKeyStatus("Soniox key cannot be empty.", true);
    return;
  }

  try {
    await window.voiceToText.updateSonioxKey(key);
    sonioxKeyInput.value = "";
    setSonioxKeyStatus("Soniox API key saved.", false);
    await fetchSonioxModels();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setSonioxKeyStatus(`Could not save Soniox API key: ${message}`, true);
  }
}

async function fetchSonioxModels(): Promise<void> {
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
  const provider = llmProviderSelect.value as LlmProvider;
  const baseUrl = llmBaseUrlInput.value.trim() || undefined;

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
  // Check Soniox key
  try {
    const hasSonioxKey = await window.voiceToText.hasSonioxKey();
    if (hasSonioxKey) {
      // Show masked placeholder to indicate key is present
      sonioxKeyInput.placeholder = "••••••••••••••••";
      sonioxKeyInput.classList.add("has-key");
      setSonioxKeyStatus("Key loaded.", false);
    }
  } catch {
    // Key check failed, leave empty
  }

  // Check provider key based on current selection
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setShortcutStatus(`Could not load current shortcut: ${message}`, true);
  }
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
  renderShortcutRecorderState(micShortcutRecorder, shortcut);
}

async function saveRecordedShortcut(shortcut: string): Promise<void> {
  setMicShortcutBusy(true);
  try {
    const runtimeShortcut = await window.voiceToText.updateMicToggleShortcut(shortcut);
    renderShortcutRecorder(runtimeShortcut);

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

async function handleMicShortcutSave(): Promise<void> {
  // The shortcut is already saved when recording completes
  // This button is now just for explicit save if user typed something
  const currentShortcut = buildShortcutFromRecorder();
  if (!currentShortcut) {
    setShortcutStatus("No shortcut recorded. Click the recorder and press a key combination.", true);
    return;
  }

  await saveRecordedShortcut(currentShortcut);
}

async function handleMicShortcutReset(): Promise<void> {
  setMicShortcutBusy(true);
  try {
    const runtimeShortcut = await window.voiceToText.updateMicToggleShortcut(
      DEFAULT_MIC_TOGGLE_SHORTCUT,
    );
    renderShortcutRecorder(runtimeShortcut);

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

function buildShortcutFromRecorder(): string | null {
  return readShortcutRecorderShortcut(micShortcutRecorder);
}

function setMicShortcutBusy(isBusy: boolean): void {
  micShortcutSaveBtn.disabled = isBusy;
  micShortcutResetBtn.disabled = isBusy;
}

function setShortcutStatus(message: string, isError: boolean): void {
  micShortcutStatus.textContent = message;
  micShortcutStatus.classList.toggle("is-error", isError);
  micShortcutStatus.classList.toggle("is-success", !isError);

  if (shortcutStatusTimer !== null) {
    clearTimeout(shortcutStatusTimer);
  }
  shortcutStatusTimer = setTimeout(() => {
    clearShortcutStatus();
  }, SHORTCUT_STATUS_CLEAR_DELAY_MS);
}

function clearShortcutStatus(): void {
  micShortcutStatus.textContent = "";
  micShortcutStatus.classList.remove("is-error", "is-success");
  if (shortcutStatusTimer !== null) {
    clearTimeout(shortcutStatusTimer);
    shortcutStatusTimer = null;
  }
}

// ─── Stop word status ─────────────────────────────────────────────────────

function setStopWordStatus(message: string, isError: boolean): void {
  stopWordStatus.textContent = message;
  stopWordStatus.classList.toggle("is-error", isError);
  stopWordStatus.classList.toggle("is-success", !isError);

  if (stopWordStatusTimer !== null) {
    clearTimeout(stopWordStatusTimer);
  }

  stopWordStatusTimer = setTimeout(() => {
    clearStopWordStatus();
  }, STOP_WORD_STATUS_CLEAR_DELAY_MS);
}

function clearStopWordStatus(): void {
  stopWordStatus.textContent = "";
  stopWordStatus.classList.remove("is-error", "is-success");
  if (stopWordStatusTimer !== null) {
    clearTimeout(stopWordStatusTimer);
    stopWordStatusTimer = null;
  }
}

// ─── AI status ────────────────────────────────────────────────────────────

function setAiStatus(message: string, isError: boolean): void {
  aiStatus.textContent = message;
  aiStatus.classList.toggle("is-error", isError);
  aiStatus.classList.toggle("is-success", !isError);

  if (aiStatusTimer !== null) {
    clearTimeout(aiStatusTimer);
  }

  aiStatusTimer = setTimeout(() => {
    clearAiStatus();
  }, AI_STATUS_CLEAR_DELAY_MS);
}

function clearAiStatus(): void {
  aiStatus.textContent = "";
  aiStatus.classList.remove("is-error", "is-success");
  if (aiStatusTimer !== null) {
    clearTimeout(aiStatusTimer);
    aiStatusTimer = null;
  }
}

// ─── Soniox key status ────────────────────────────────────────────────────

function setSonioxKeyStatus(message: string, isError: boolean): void {
  sonioxKeyStatus.textContent = message;
  sonioxKeyStatus.classList.toggle("is-error", isError);
  sonioxKeyStatus.classList.toggle("is-success", !isError);

  if (sonioxKeyStatusTimer !== null) {
    clearTimeout(sonioxKeyStatusTimer);
  }

  sonioxKeyStatusTimer = setTimeout(() => {
    clearSonioxKeyStatus();
  }, SONIOX_KEY_STATUS_CLEAR_DELAY_MS);
}

function clearSonioxKeyStatus(): void {
  sonioxKeyStatus.textContent = "";
  sonioxKeyStatus.classList.remove("is-error", "is-success");
  if (sonioxKeyStatusTimer !== null) {
    clearTimeout(sonioxKeyStatusTimer);
    sonioxKeyStatusTimer = null;
  }
}

function setSonioxModelStatus(message: string, isError: boolean): void {
  sonioxModelStatus.textContent = message;
  sonioxModelStatus.classList.toggle("is-error", isError);
  sonioxModelStatus.classList.toggle("is-success", !isError);

  if (sonioxModelStatusTimer !== null) {
    clearTimeout(sonioxModelStatusTimer);
  }

  sonioxModelStatusTimer = setTimeout(() => {
    clearSonioxModelStatus();
  }, SONIOX_MODEL_STATUS_CLEAR_DELAY_MS);
}

function clearSonioxModelStatus(): void {
  sonioxModelStatus.textContent = "";
  sonioxModelStatus.classList.remove("is-error", "is-success");
  if (sonioxModelStatusTimer !== null) {
    clearTimeout(sonioxModelStatusTimer);
    sonioxModelStatusTimer = null;
  }
}

// ─── Model status ─────────────────────────────────────────────────────────

function setModelStatus(message: string, isError: boolean): void {
  llmModelStatus.textContent = message;
  llmModelStatus.classList.toggle("is-error", isError);
  llmModelStatus.classList.toggle("is-success", !isError);

  if (modelStatusTimer !== null) {
    clearTimeout(modelStatusTimer);
  }

  modelStatusTimer = setTimeout(() => {
    clearModelStatus();
  }, MODEL_STATUS_CLEAR_DELAY_MS);
}

function clearModelStatus(): void {
  llmModelStatus.textContent = "";
  llmModelStatus.classList.remove("is-error", "is-success");
  if (modelStatusTimer !== null) {
    clearTimeout(modelStatusTimer);
    modelStatusTimer = null;
  }
}

// ─── Provider key status ──────────────────────────────────────────────────

function setProviderKeyStatus(message: string, isError: boolean): void {
  providerKeyStatus.textContent = message;
  providerKeyStatus.classList.toggle("is-error", isError);
  providerKeyStatus.classList.toggle("is-success", !isError);

  if (providerKeyStatusTimer !== null) {
    clearTimeout(providerKeyStatusTimer);
  }

  providerKeyStatusTimer = setTimeout(() => {
    clearProviderKeyStatus();
  }, PROVIDER_KEY_STATUS_CLEAR_DELAY_MS);
}

function clearProviderKeyStatus(): void {
  providerKeyStatus.textContent = "";
  providerKeyStatus.classList.remove("is-error", "is-success");
  if (providerKeyStatusTimer !== null) {
    clearTimeout(providerKeyStatusTimer);
    providerKeyStatusTimer = null;
  }
}

// ─── AI fieldset disabled sync ────────────────────────────────────────────

function syncAiFieldsetDisabledState(correctionEnabled: boolean): void {
  aiSettingsFieldset.disabled = !correctionEnabled;
}

// ─── Vocabulary count ─────────────────────────────────────────────────────

function updateVocabCount(): void {
  const prefs = loadPreferences();
  const total = prefs.sonioxTerms.length + prefs.sonioxTranslationTerms.length;
  vocabCountBadge.textContent = total > 0 ? String(total) : "";
}

// ─── Permission banner (prefs screen) ─────────────────────────────────────

function showPermissionBanner(deniedNames: string[]): void {
  const deniedList = deniedNames.join(", ");
  permissionBannerText.textContent = `Missing permissions: ${deniedList}. Enable in System Settings → Privacy & Security.`;
  permissionBanner.classList.remove("is-hidden");
}

function hidePermissionBanner(): void {
  permissionBanner.classList.add("is-hidden");
}

// ─── Action buttons ───────────────────────────────────────────────────────

function bindActionButtons(): void {
  openSettingsBtn.addEventListener("click", () => {
    settingsOpenedBy = openSettingsBtn;
    openSettingsDialog();
  });

  resetKeysBtn.addEventListener("click", () => {
    void handleResetKeys();
  });
}

async function handleResetKeys(): Promise<void> {
  try {
    await window.voiceToText.resetCredentials();
    showSetupScreen();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    showSetupScreen();
    applySetupError(`Failed to reset credentials: ${msg}`, setupError, sonioxInput);
  }
}

// ─── Tab navigation ───────────────────────────────────────────────────────

function bindTabs(): void {
  for (const btn of tabButtons) {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.tab;
      if (!targetId) return;
      switchTab(targetId);
    });
  }
}

function switchTab(targetId: string): void {
  for (const btn of tabButtons) {
    const isActive = btn.dataset.tab === targetId;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
  }

  for (const panel of tabPanels) {
    panel.classList.toggle("is-active", panel.id === targetId);
  }
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
    renderDialogTranslations();
  });

  termsAddBtn.addEventListener("click", addStagedTerm);
  termsAddInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addStagedTerm();
  });

  translationAddBtn.addEventListener("click", addStagedTranslation);
  translationTgtInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addStagedTranslation();
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
    translationTerms: prefs.sonioxTranslationTerms.map((t) => ({ ...t })),
  };

  renderDialogTerms();
  renderDialogTranslations();

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
  const translationOk = saveSonioxTranslationTerms(staged.translationTerms);
  if (!termsOk || !translationOk) {
    applySetupError(
      "Could not save vocabulary settings. Storage may be full or unavailable.",
      setupError,
      sonioxInput,
    );
    showSetupScreen();
    return;
  }
  updateVocabCount();
}

function loadStagedFromDefaults(): void {
  const defaults = window.voiceToTextDefaults;
  staged = {
    terms: [...defaults.terms],
    translationTerms: defaults.translationTerms.map((t) => ({ ...t })),
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

// ─── Dialog: translation terms ────────────────────────────────────────────

function renderDialogTranslations(): void {
  translationList.innerHTML = "";

  if (staged.translationTerms.length === 0) {
    const empty = document.createElement("span");
    empty.className = "tag-empty";
    empty.textContent = "No translation pairs added";
    translationList.appendChild(empty);
    return;
  }

  for (const pair of staged.translationTerms) {
    translationList.appendChild(buildTranslationItem(pair));
  }
}

function buildTranslationItem(pair: TranslationTerm): HTMLElement {
  const item = document.createElement("div");
  item.className = "translation-item";

  const src = document.createElement("span");
  src.className = "source";
  src.textContent = pair.source;

  const arrow = document.createElement("span");
  arrow.className = "arrow";
  arrow.textContent = "→";
  arrow.setAttribute("aria-hidden", "true");

  const tgt = document.createElement("span");
  tgt.className = "target";
  tgt.textContent = pair.target;

  const removeBtn = document.createElement("button");
  removeBtn.className = "tag-remove";
  removeBtn.setAttribute("aria-label", `Remove translation "${pair.source}" → "${pair.target}"`);
  removeBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>`;
  removeBtn.addEventListener("click", () => {
    staged.translationTerms = staged.translationTerms.filter(
      (t) => !(t.source === pair.source && t.target === pair.target),
    );
    renderDialogTranslations();
  });

  item.append(src, arrow, tgt, removeBtn);
  return item;
}

function addStagedTranslation(): void {
  const source = translationSrcInput.value.trim();
  const target = translationTgtInput.value.trim();

  if (!source || !target) return;

  const isDuplicate = staged.translationTerms.some(
    (t) => t.source === source && t.target === target,
  );
  if (isDuplicate) {
    translationSrcInput.value = "";
    translationTgtInput.value = "";
    return;
  }

  staged.translationTerms = [...staged.translationTerms, { source, target }];
  translationSrcInput.value = "";
  translationTgtInput.value = "";
  renderDialogTranslations();
  translationSrcInput.focus();
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
