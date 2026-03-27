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
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
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

export function saveEnterMode(value: boolean): void {
  writeJson(KEYS.enterMode, value);
}

export function saveOutputLang(value: OutputLang): void {
  writeJson(KEYS.outputLang, value);
}

export function saveSonioxTerms(terms: string[]): void {
  writeJson(KEYS.sonioxTerms, terms);
}

export function saveSonioxTranslationTerms(terms: TranslationTerm[]): void {
  writeJson(KEYS.sonioxTranslationTerms, terms);
}
