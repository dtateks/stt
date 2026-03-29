/**
 * Client-side persistence helpers.
 * All localStorage reads/writes are centralised here.
 */

import type { LlmProvider, OutputLang, UserPreferences } from "./types.ts";

export const DEFAULT_MIC_TOGGLE_SHORTCUT = "Control+Alt+Super+V";
export const DEFAULT_REMINDER_BEEP_ENABLED = true;
export const DEFAULT_LLM_PROVIDER: LlmProvider = "xai";

const KEYS = {
  enterMode: "enterMode",
  outputLang: "outputLang",
  sonioxTerms: "sonioxTerms",
  skipLlm: "skipLlm",
  micToggleShortcut: "micToggleShortcut",
  stopWord: "stopWord",
  reminderBeepEnabled: "reminderBeepEnabled",
  llmProvider: "llmProvider",
  llmModelsByProvider: "llmModelsByProvider",
  llmBaseUrl: "llmBaseUrl",
  sonioxModel: "sonioxModel",
} as const;

type LlmModelsByProvider = Partial<Record<LlmProvider, string>>;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// Returns true if the write succeeded, false if storage was unavailable
// (quota exceeded, private mode, etc.). Callers decide whether to surface feedback.
function writeJson(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadPreferences(): UserPreferences {
  const defaults = window.voiceToTextDefaults;

  return {
    enterMode: readJson<boolean>(KEYS.enterMode, true),
    outputLang: readJson<OutputLang>(KEYS.outputLang, "auto"),
    sonioxTerms: readJson<string[]>(KEYS.sonioxTerms, defaults.terms),
    skipLlm: readJson<boolean>(KEYS.skipLlm, true),
  };
}

export function saveEnterMode(value: boolean): boolean {
  return writeJson(KEYS.enterMode, value);
}

export function saveOutputLang(value: OutputLang): boolean {
  return writeJson(KEYS.outputLang, value);
}

export function saveSonioxTerms(terms: string[]): boolean {
  return writeJson(KEYS.sonioxTerms, terms);
}

export function saveSkipLlm(value: boolean): boolean {
  return writeJson(KEYS.skipLlm, value);
}

export function loadMicToggleShortcutPreference(): string {
  const storedShortcut = readJson<string>(
    KEYS.micToggleShortcut,
    DEFAULT_MIC_TOGGLE_SHORTCUT,
  );
  if (typeof storedShortcut !== "string") {
    return DEFAULT_MIC_TOGGLE_SHORTCUT;
  }
  const trimmedShortcut = storedShortcut.trim();
  return trimmedShortcut || DEFAULT_MIC_TOGGLE_SHORTCUT;
}

export function saveMicToggleShortcutPreference(shortcut: string): boolean {
  return writeJson(KEYS.micToggleShortcut, shortcut);
}

export function resetMicToggleShortcutPreference(): boolean {
  try {
    window.localStorage.removeItem(KEYS.micToggleShortcut);
    return true;
  } catch {
    return false;
  }
}

export function loadCustomStopWordPreference(defaultStopWord: string): string {
  const storedStopWord = readJson<string>(KEYS.stopWord, defaultStopWord);
  if (typeof storedStopWord !== "string") {
    return defaultStopWord;
  }

  const trimmedStopWord = storedStopWord.trim();
  return trimmedStopWord || defaultStopWord;
}

export function saveCustomStopWordPreference(stopWord: string): boolean {
  return writeJson(KEYS.stopWord, stopWord);
}

export function resetCustomStopWordPreference(): boolean {
  try {
    window.localStorage.removeItem(KEYS.stopWord);
    return true;
  } catch {
    return false;
  }
}

export function loadLlmCorrectionEnabledPreference(): boolean {
  const skipLlm = readJson<boolean>(KEYS.skipLlm, true);
  return !skipLlm;
}

export function saveLlmCorrectionEnabledPreference(enabled: boolean): boolean {
  return saveSkipLlm(!enabled);
}

export function loadReminderBeepEnabledPreference(): boolean {
  return readJson<boolean>(KEYS.reminderBeepEnabled, DEFAULT_REMINDER_BEEP_ENABLED);
}

export function saveReminderBeepEnabledPreference(enabled: boolean): boolean {
  return writeJson(KEYS.reminderBeepEnabled, enabled);
}

export function loadLlmProviderPreference(defaultProvider: LlmProvider): LlmProvider {
  const storedProvider = readJson<string>(KEYS.llmProvider, defaultProvider);
  if (storedProvider === "gemini") {
    return "gemini";
  }
  if (storedProvider === "openai_compatible") {
    return "openai_compatible";
  }

  return "xai";
}

export function saveLlmProviderPreference(provider: LlmProvider): boolean {
  return writeJson(KEYS.llmProvider, provider);
}

export function loadLlmModelPreference(provider: LlmProvider): string | null {
  const storedModels = readJson<LlmModelsByProvider>(KEYS.llmModelsByProvider, {});
  if (storedModels === null || typeof storedModels !== "object") {
    return null;
  }

  const storedModel = storedModels[provider];
  if (typeof storedModel !== "string") {
    return null;
  }

  const trimmedModel = storedModel.trim();
  return trimmedModel.length > 0 ? trimmedModel : null;
}

export function saveLlmModelPreference(provider: LlmProvider, model: string): boolean {
  const currentModels = readJson<LlmModelsByProvider>(KEYS.llmModelsByProvider, {});
  const nextModels: LlmModelsByProvider =
    currentModels !== null && typeof currentModels === "object" ? { ...currentModels } : {};
  nextModels[provider] = model;
  return writeJson(KEYS.llmModelsByProvider, nextModels);
}

export function loadLlmBaseUrlPreference(defaultBaseUrl: string): string {
  const storedBaseUrl = readJson<string>(KEYS.llmBaseUrl, defaultBaseUrl);
  if (typeof storedBaseUrl !== "string") {
    return defaultBaseUrl;
  }

  const trimmedBaseUrl = storedBaseUrl.trim();
  return trimmedBaseUrl || defaultBaseUrl;
}

export function saveLlmBaseUrlPreference(baseUrl: string): boolean {
  return writeJson(KEYS.llmBaseUrl, baseUrl);
}

export function loadSonioxModelPreference(): string | null {
  const storedModel = readJson<string | null>(KEYS.sonioxModel, null);
  if (typeof storedModel !== "string") {
    return null;
  }

  const trimmedModel = storedModel.trim();
  return trimmedModel.length > 0 ? trimmedModel : null;
}

export function saveSonioxModelPreference(model: string): boolean {
  return writeJson(KEYS.sonioxModel, model);
}
