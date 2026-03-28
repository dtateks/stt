/**
 * Client-side persistence helpers.
 * All localStorage reads/writes are centralised here.
 */

import type { OutputLang, TranslationTerm, UserPreferences } from "./types.ts";

const KEYS = {
  enterMode: "enterMode",
  outputLang: "outputLang",
  sonioxTerms: "sonioxTerms",
  sonioxTranslationTerms: "sonioxTranslationTerms",
  skipLlm: "skipLlm",
} as const;

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
    sonioxTranslationTerms: readJson<TranslationTerm[]>(
      KEYS.sonioxTranslationTerms,
      defaults.translationTerms
    ),
    skipLlm: readJson<boolean>(KEYS.skipLlm, false),
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

export function saveSonioxTranslationTerms(terms: TranslationTerm[]): boolean {
  return writeJson(KEYS.sonioxTranslationTerms, terms);
}
