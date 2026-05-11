/**
 * Pure session-preferences resolution.
 *
 * Three pure functions assemble the live session config from current
 * `localStorage` values + bundled `AppConfig`:
 *
 *   - `resolveLlmRequestOptions(config)` — provider + model + base URL
 *     for the correction call. Throws if no model is configured.
 *   - `resolveSonioxConfigForSession(config)` — the Soniox WS config
 *     with the user-selected model (or the bundled default) overlaid.
 *     Throws if `config` is null.
 *   - `createActiveSessionPreferences(prefs, config)` — the full set
 *     of session-time preferences: enter mode, output language, skip-
 *     LLM, stop word + normalized form, vocabulary terms, and the LLM
 *     options (or null when LLM is skipped).
 *
 * No side effects, no controller state — `bar-session-controller.ts`
 * still owns the `this.activeSessionPreferences` mutation, the
 * `pendingActiveSessionPreferencesRefresh` flag, and the storage-event
 * refresh decision; this module only produces the values.
 *
 * Living invariants preserved verbatim:
 *   - Empty / missing provider id resolves to `xai`.
 *   - Empty / missing Soniox model resolves to `stt-rt-v4`
 *     (`DEFAULT_SONIOX_MODEL`).
 *   - Empty / missing LLM base URL resolves to the bundled default,
 *     falling back to `https://api.openai.com/v1`.
 *   - `stopWord` falls back to `config.voice.stop_word ?? ""` so a
 *     missing/null config produces an empty stop word (legacy
 *     behavior).
 */
import type { AppConfig, LlmProvider, LlmRequestOptions, UserPreferences } from "./types.ts";
import {
  loadCustomStopWordPreference,
  loadLlmBaseUrlPreference,
  loadLlmModelPreference,
  loadLlmProviderPreference,
  loadSonioxModelPreference,
} from "./storage.ts";
import { normalizeStopWord } from "./stop-word.ts";
import {
  DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
  XAI_PROVIDER,
  defaultModelForProvider,
  providerLabel,
} from "./llm-provider.ts";

export const DEFAULT_SONIOX_MODEL = "stt-rt-v4";

export interface ActiveSessionPreferences {
  enterMode: boolean;
  outputLang: "auto" | "english" | "vietnamese";
  skipLlm: boolean;
  stopWord: string;
  normalizedStopWord: string;
  sonioxTerms: string[];
  llmOptions: LlmRequestOptions | null;
}

export function resolveLlmRequestOptions(config: AppConfig | null): LlmRequestOptions {
  const provider: LlmProvider = loadLlmProviderPreference(
    (config?.llm.provider as LlmProvider) ?? XAI_PROVIDER,
  );
  const model = loadLlmModelPreference(provider) ?? defaultModelForProvider(provider);
  if (!model) {
    throw new Error(
      `No ${providerLabel(provider)} model selected. Open Settings, refresh models, and choose one.`,
    );
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

export function resolveSonioxConfigForSession(config: AppConfig | null): AppConfig["soniox"] {
  if (!config) {
    throw new Error("App config is not loaded");
  }

  const selectedModel = loadSonioxModelPreference() ?? DEFAULT_SONIOX_MODEL;

  return {
    ...config.soniox,
    model: selectedModel,
  };
}

export function createActiveSessionPreferences(
  prefs: UserPreferences,
  config: AppConfig | null,
): ActiveSessionPreferences {
  const stopWord = loadCustomStopWordPreference(config?.voice.stop_word ?? "");
  return {
    enterMode: prefs.enterMode,
    outputLang: prefs.outputLang,
    skipLlm: prefs.skipLlm,
    stopWord,
    normalizedStopWord: normalizeStopWord(stopWord),
    sonioxTerms: prefs.sonioxTerms,
    llmOptions: prefs.skipLlm ? null : resolveLlmRequestOptions(config),
  };
}
