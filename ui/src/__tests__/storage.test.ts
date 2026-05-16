import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_LLM_PROVIDER,
  DEFAULT_MIC_TOGGLE_SHORTCUT,
  DEFAULT_REMINDER_BEEP_ENABLED,
  loadCustomStopWordPreference,
  loadLlmBaseUrlPreference,
  loadLlmCorrectionEnabledPreference,
  loadLlmModelPreference,
  loadLlmProviderPreference,
  loadMicToggleShortcutPreference,
  loadPreferences,
  loadReminderBeepEnabledPreference,
  loadSonioxModelPreference,
  resetCustomStopWordPreference,
  resetMicToggleShortcutPreference,
  saveCustomStopWordPreference,
  saveEnterMode,
  saveLlmBaseUrlPreference,
  saveLlmCorrectionEnabledPreference,
  saveLlmModelPreference,
  saveLlmProviderPreference,
  saveMicToggleShortcutPreference,
  saveOutputLang,
  saveReminderBeepEnabledPreference,
  saveSkipLlm,
  saveSonioxModelPreference,
  saveSonioxTerms,
} from "../storage.ts";

function installDefaults(terms: string[] = ["alpha", "beta"]): void {
  (window as Window & { voiceToTextDefaults?: unknown }).voiceToTextDefaults = {
    terms,
  };
}

describe("storage helpers", () => {
  beforeEach(() => {
    window.localStorage.clear();
    installDefaults();
  });

  describe("loadPreferences", () => {
    it("returns the bundled defaults when nothing is stored", () => {
      const prefs = loadPreferences();

      expect(prefs.enterMode).toBe(false);
      expect(prefs.outputLang).toBe("auto");
      expect(prefs.sonioxTerms).toEqual(["alpha", "beta"]);
      expect(prefs.skipLlm).toBe(true);
    });

    it("reads sonioxTerms from window.voiceToTextDefaults.terms as the fallback", () => {
      installDefaults(["one", "two", "three"]);

      const prefs = loadPreferences();

      expect(prefs.sonioxTerms).toEqual(["one", "two", "three"]);
    });

    it("returns stored overrides when present", () => {
      window.localStorage.setItem("enterMode", JSON.stringify(true));
      window.localStorage.setItem("outputLang", JSON.stringify("english"));
      window.localStorage.setItem("sonioxTerms", JSON.stringify(["custom"]));
      window.localStorage.setItem("skipLlm", JSON.stringify(false));

      const prefs = loadPreferences();

      expect(prefs.enterMode).toBe(true);
      expect(prefs.outputLang).toBe("english");
      expect(prefs.sonioxTerms).toEqual(["custom"]);
      expect(prefs.skipLlm).toBe(false);
    });
  });

  describe("loadCustomStopWordPreference", () => {
    it("returns the bundled default when nothing is stored", () => {
      expect(loadCustomStopWordPreference("thank you")).toBe("thank you");
    });

    it("returns the stored value trimmed", () => {
      window.localStorage.setItem("stopWord", JSON.stringify("  done  "));

      expect(loadCustomStopWordPreference("thank you")).toBe("done");
    });

    it("falls back to default when the stored value is whitespace-only", () => {
      window.localStorage.setItem("stopWord", JSON.stringify("   "));

      expect(loadCustomStopWordPreference("thank you")).toBe("thank you");
    });

    it("falls back to default when the stored value is not a string", () => {
      window.localStorage.setItem("stopWord", JSON.stringify(123));

      expect(loadCustomStopWordPreference("thank you")).toBe("thank you");
    });
  });

  describe("resetCustomStopWordPreference", () => {
    it("removes the stored stop word", () => {
      window.localStorage.setItem("stopWord", JSON.stringify("done"));

      expect(resetCustomStopWordPreference()).toBe(true);
      expect(window.localStorage.getItem("stopWord")).toBeNull();
    });
  });

  describe("loadLlmCorrectionEnabledPreference", () => {
    it("returns the inverse of the stored skipLlm flag (default skipLlm=true → enabled=false)", () => {
      expect(loadLlmCorrectionEnabledPreference()).toBe(false);
    });

    it("returns true when skipLlm is false", () => {
      window.localStorage.setItem("skipLlm", JSON.stringify(false));

      expect(loadLlmCorrectionEnabledPreference()).toBe(true);
    });

    it("saveLlmCorrectionEnabledPreference inverts before persisting", () => {
      saveLlmCorrectionEnabledPreference(true);

      expect(window.localStorage.getItem("skipLlm")).toBe("false");
      expect(loadLlmCorrectionEnabledPreference()).toBe(true);
    });

    it("saveLlmCorrectionEnabledPreference(false) flips skipLlm back to true", () => {
      // skipLlm defaults to true, so a one-way bug that only writes when enabled=true
      // would still leave the stored flag at its default and silently pass. Drive the
      // round-trip from enabled=true → enabled=false to force the false branch to write.
      saveLlmCorrectionEnabledPreference(true);
      saveLlmCorrectionEnabledPreference(false);

      expect(window.localStorage.getItem("skipLlm")).toBe("true");
      expect(loadLlmCorrectionEnabledPreference()).toBe(false);
    });
  });

  describe("loadReminderBeepEnabledPreference", () => {
    it("returns the DEFAULT_REMINDER_BEEP_ENABLED constant when nothing is stored", () => {
      expect(loadReminderBeepEnabledPreference()).toBe(DEFAULT_REMINDER_BEEP_ENABLED);
    });

    it("round-trips through saveReminderBeepEnabledPreference", () => {
      saveReminderBeepEnabledPreference(true);

      expect(loadReminderBeepEnabledPreference()).toBe(true);
    });
  });

  describe("loadLlmProviderPreference", () => {
    it("returns the supplied default when nothing is stored", () => {
      expect(loadLlmProviderPreference(DEFAULT_LLM_PROVIDER)).toBe("xai");
    });

    it("returns gemini when stored", () => {
      window.localStorage.setItem("llmProvider", JSON.stringify("gemini"));

      expect(loadLlmProviderPreference("xai")).toBe("gemini");
    });

    it("returns openai_compatible when stored", () => {
      window.localStorage.setItem("llmProvider", JSON.stringify("openai_compatible"));

      expect(loadLlmProviderPreference("xai")).toBe("openai_compatible");
    });

    it("coerces an unknown stored value to 'xai'", () => {
      window.localStorage.setItem("llmProvider", JSON.stringify("perplexity"));

      expect(loadLlmProviderPreference("gemini")).toBe("xai");
    });

    it("saveLlmProviderPreference persists the wire-format id", () => {
      saveLlmProviderPreference("gemini");

      expect(window.localStorage.getItem("llmProvider")).toBe(JSON.stringify("gemini"));
    });
  });

  describe("loadLlmModelPreference (per-provider)", () => {
    it("returns null when nothing is stored", () => {
      expect(loadLlmModelPreference("xai")).toBeNull();
    });

    it("returns the stored model for the requested provider", () => {
      saveLlmModelPreference("xai", "grok-test");
      saveLlmModelPreference("gemini", "gemini-test");

      expect(loadLlmModelPreference("xai")).toBe("grok-test");
      expect(loadLlmModelPreference("gemini")).toBe("gemini-test");
    });

    it("merges into the existing provider map without clobbering other providers", () => {
      saveLlmModelPreference("xai", "grok-test");
      saveLlmModelPreference("gemini", "gemini-test");

      expect(loadLlmModelPreference("xai")).toBe("grok-test");
      expect(loadLlmModelPreference("gemini")).toBe("gemini-test");
    });

    it("returns null when the stored model is whitespace-only", () => {
      saveLlmModelPreference("xai", "   ");

      expect(loadLlmModelPreference("xai")).toBeNull();
    });
  });

  describe("loadLlmBaseUrlPreference", () => {
    it("returns the supplied default when nothing is stored", () => {
      expect(loadLlmBaseUrlPreference("https://api.openai.com/v1")).toBe(
        "https://api.openai.com/v1",
      );
    });

    it("returns the stored value trimmed", () => {
      saveLlmBaseUrlPreference("  https://custom/v1  ");

      expect(loadLlmBaseUrlPreference("https://api.openai.com/v1")).toBe(
        "https://custom/v1",
      );
    });

    it("falls back to default when the stored value is whitespace-only", () => {
      window.localStorage.setItem("llmBaseUrl", JSON.stringify("   "));

      expect(loadLlmBaseUrlPreference("https://api.openai.com/v1")).toBe(
        "https://api.openai.com/v1",
      );
    });
  });

  describe("loadSonioxModelPreference", () => {
    it("returns null when nothing is stored", () => {
      expect(loadSonioxModelPreference()).toBeNull();
    });

    it("returns the stored model trimmed", () => {
      saveSonioxModelPreference("  stt-rt-v4  ");

      expect(loadSonioxModelPreference()).toBe("stt-rt-v4");
    });

    it("returns null when the stored model is whitespace-only", () => {
      saveSonioxModelPreference("   ");

      expect(loadSonioxModelPreference()).toBeNull();
    });
  });

  describe("loadMicToggleShortcutPreference", () => {
    it("returns DEFAULT_MIC_TOGGLE_SHORTCUT when nothing is stored", () => {
      expect(loadMicToggleShortcutPreference()).toBe(DEFAULT_MIC_TOGGLE_SHORTCUT);
    });

    it("returns the stored shortcut trimmed", () => {
      saveMicToggleShortcutPreference("  Control+Alt+Shift+K  ");

      expect(loadMicToggleShortcutPreference()).toBe("Control+Alt+Shift+K");
    });

    it("falls back to the default when the stored value is whitespace-only", () => {
      window.localStorage.setItem("micToggleShortcut", JSON.stringify("   "));

      expect(loadMicToggleShortcutPreference()).toBe(DEFAULT_MIC_TOGGLE_SHORTCUT);
    });

    it("resetMicToggleShortcutPreference removes the stored value", () => {
      saveMicToggleShortcutPreference("Control+Alt+K");
      expect(loadMicToggleShortcutPreference()).toBe("Control+Alt+K");

      resetMicToggleShortcutPreference();
      expect(loadMicToggleShortcutPreference()).toBe(DEFAULT_MIC_TOGGLE_SHORTCUT);
    });
  });

  describe("save helpers — quota-exceeded resilience", () => {
    it("saveCustomStopWordPreference returns false when localStorage throws", () => {
      const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
      window.localStorage.setItem = () => {
        throw new Error("quota exceeded");
      };

      try {
        expect(saveCustomStopWordPreference("done")).toBe(false);
      } finally {
        window.localStorage.setItem = originalSetItem;
      }
    });

    it("saveLlmModelPreference returns false when localStorage throws", () => {
      // Distinct from the stop-word path because per-provider model save first reads
      // the existing object, merges, then writes — a separate code path through
      // readJson + writeJson. Pin that the read-merge-write helper still reports
      // failure when the write step throws.
      const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
      window.localStorage.setItem = () => {
        throw new Error("quota exceeded");
      };

      try {
        expect(saveLlmModelPreference("xai", "grok-test")).toBe(false);
      } finally {
        window.localStorage.setItem = originalSetItem;
      }
    });
  });

  describe("loadPreferences round-trip via individual save helpers", () => {
    it("saveEnterMode round-trips through loadPreferences", () => {
      saveEnterMode(true);
      expect(loadPreferences().enterMode).toBe(true);

      saveEnterMode(false);
      expect(loadPreferences().enterMode).toBe(false);
    });

    it("saveOutputLang round-trips through loadPreferences", () => {
      saveOutputLang("english");
      expect(loadPreferences().outputLang).toBe("english");

      saveOutputLang("vietnamese");
      expect(loadPreferences().outputLang).toBe("vietnamese");

      saveOutputLang("auto");
      expect(loadPreferences().outputLang).toBe("auto");
    });

    it("saveSonioxTerms round-trips through loadPreferences", () => {
      saveSonioxTerms(["claude", "tmux"]);
      expect(loadPreferences().sonioxTerms).toEqual(["claude", "tmux"]);

      saveSonioxTerms([]);
      // Empty array is a valid stored override — must NOT fall back to
      // bundled defaults when the user explicitly clears the list.
      expect(loadPreferences().sonioxTerms).toEqual([]);
    });

    it("saveSkipLlm round-trips through loadPreferences", () => {
      saveSkipLlm(false);
      expect(loadPreferences().skipLlm).toBe(false);

      saveSkipLlm(true);
      expect(loadPreferences().skipLlm).toBe(true);
    });
  });

  describe("readJson — corrupt-JSON resilience", () => {
    it("loadPreferences falls back to defaults when stored JSON is corrupt", () => {
      // Write malformed JSON directly, bypassing the writer.
      window.localStorage.setItem("enterMode", "not-json-{{{");
      window.localStorage.setItem("outputLang", "still-not-json}}}");
      window.localStorage.setItem("sonioxTerms", "}}{{");
      window.localStorage.setItem("skipLlm", "abc");

      const prefs = loadPreferences();

      // Each field falls back to its default rather than throwing.
      expect(prefs.enterMode).toBe(false);
      expect(prefs.outputLang).toBe("auto");
      expect(prefs.sonioxTerms).toEqual(["alpha", "beta"]);
      expect(prefs.skipLlm).toBe(true);
    });

    it("loadLlmModelPreference falls back to null when the stored map is corrupt", () => {
      window.localStorage.setItem("llmModelsByProvider", "not-a-real-object{}}}");

      expect(loadLlmModelPreference("xai")).toBeNull();
    });

    it("loadLlmModelPreference returns null when the stored map exists but has no entry for the provider", () => {
      // Store a map that ONLY has xai; querying for gemini should be null,
      // not the xai value, and not a JS error.
      saveLlmModelPreference("xai", "grok-test");

      expect(loadLlmModelPreference("gemini")).toBeNull();
      expect(loadLlmModelPreference("xai")).toBe("grok-test");
    });
  });
});
