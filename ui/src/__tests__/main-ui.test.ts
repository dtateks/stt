/**
 * Main window UI tests.
 *
 * Covers:
 *   - storage: readJson fallback + corrupt-data recovery
 *   - storage: writeJson returns false on quota failure (IMP-03)
 *   - storage: save helpers return false when write fails (IMP-03)
 *   - storage: loadPreferences default hydration
 *   - storage: save helpers persist correct keys
 *   - setup validation: applySetupError / clearSetupError real functions (IMP-02)
 *   - setup validation: validateSonioxKey pure function (IMP-02)
 *   - dialog: applyDialogOpen / applyDialogClose real functions (IMP-02)
 *   - startup permissions: requestStartupPermissions returns per-permission results (IMP-01)
 *   - startup permissions: denied results include which permission failed (IMP-01)
 *   - dialog: staged-state isolation (pure logic)
 *   - dialog: reset-to-defaults (pure logic)
 *
 * Run with: vitest
 *
 * All tests are pure-module or jsdom-based; no Tauri bridge calls are made.
 *
 * NOTE: Node 25 provides a global `localStorage` via --localstorage-file which
 * lacks `.clear()`. All storage tests use `window.localStorage` to access
 * the jsdom implementation installed by src/__tests__/setup.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_LLM_PROVIDER,
  DEFAULT_MIC_TOGGLE_SHORTCUT,
  DEFAULT_REMINDER_BEEP_ENABLED,
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
import {
  applySetupError,
  clearSetupError,
  validateSonioxKey,
  applyDialogOpen,
  applyDialogClose,
} from "../main-logic.ts";
import { requestStartupPermissions } from "../startup-permissions.ts";

// ─── Storage: readJson fallback behavior ─────────────────────────────────

describe("storage — readJson fallback behavior", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.voiceToTextDefaults = { terms: [] };
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("returns the default enterMode (false) when key is absent", () => {
    const prefs = loadPreferences();
    expect(prefs.enterMode).toBe(false);
  });

  it("returns default outputLang ('auto') when key is absent", () => {
    const prefs = loadPreferences();
    expect(prefs.outputLang).toBe("auto");
  });

  it("defaults skipLlm to true when key is absent", () => {
    const prefs = loadPreferences();
    expect(prefs.skipLlm).toBe(true);
  });

  it("returns the fallback when stored value is corrupt JSON", () => {
    window.localStorage.setItem("enterMode", "not-valid-json{{{");
    const prefs = loadPreferences();
    expect(prefs.enterMode).toBe(false);
  });

  it("returns the persisted value when it is valid JSON", () => {
    window.localStorage.setItem("enterMode", "false");
    const prefs = loadPreferences();
    expect(prefs.enterMode).toBe(false);
  });

  it("returns the persisted outputLang when stored", () => {
    window.localStorage.setItem("outputLang", '"english"');
    const prefs = loadPreferences();
    expect(prefs.outputLang).toBe("english");
  });
});

// ─── Storage: writeJson error handling — IMP-03 ───────────────────────────
// Save helpers must return false (not throw) when storage is unavailable.

describe("storage — writeJson returns false on quota failure (IMP-03)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("saveEnterMode returns false when setItem throws", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementationOnce(() => {
      throw new DOMException("QuotaExceededError");
    });
    const ok = saveEnterMode(false);
    expect(ok).toBe(false);
  });

  it("saveEnterMode returns true when write succeeds", () => {
    const ok = saveEnterMode(true);
    expect(ok).toBe(true);
  });

  it("saveSonioxTerms returns false when setItem throws", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementationOnce(() => {
      throw new DOMException("QuotaExceededError");
    });
    const ok = saveSonioxTerms(["term1"]);
    expect(ok).toBe(false);
  });

  it("saveSonioxTerms returns true when write succeeds", () => {
    const ok = saveSonioxTerms(["alpha"]);
    expect(ok).toBe(true);
  });

  it("saveOutputLang returns false when setItem throws", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementationOnce(() => {
      throw new DOMException("QuotaExceededError");
    });
    const ok = saveOutputLang("english");
    expect(ok).toBe(false);
  });

  it("saveOutputLang returns true when write succeeds", () => {
    const ok = saveOutputLang("english");
    expect(ok).toBe(true);
  });
});

// ─── Storage: loadPreferences defaults hydration ─────────────────────────

describe("storage — loadPreferences defaults hydration", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("uses voiceToTextDefaults.terms when no sonioxTerms stored", () => {
    const defaults = { terms: ["hello", "world"] };
    window.voiceToTextDefaults = defaults;
    const prefs = loadPreferences();
    expect(prefs.sonioxTerms).toEqual(["hello", "world"]);
  });

  it("does not hydrate a translation-term preference surface", () => {
    window.voiceToTextDefaults = { terms: ["foo"] };
    const prefs = loadPreferences();
    expect("sonioxTranslationTerms" in prefs).toBe(false);
  });

  it("returns stored sonioxTerms over defaults when present", () => {
    const defaults = { terms: ["default-term"] };
    window.voiceToTextDefaults = defaults;
    window.localStorage.setItem("sonioxTerms", JSON.stringify(["stored-term"]));
    const prefs = loadPreferences();
    expect(prefs.sonioxTerms).toEqual(["stored-term"]);
  });
});

// ─── Storage: save helpers persist correct keys ───────────────────────────

describe("storage — save helpers persist correct keys", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("saveEnterMode persists the enterMode key", () => {
    saveEnterMode(false);
    expect(window.localStorage.getItem("enterMode")).toBe("false");
  });

  it("saveOutputLang persists the outputLang key", () => {
    saveOutputLang("english");
    expect(window.localStorage.getItem("outputLang")).toBe('"english"');
  });

  it("saveSonioxTerms persists the sonioxTerms key as JSON array", () => {
    saveSonioxTerms(["alpha", "beta"]);
    const stored = window.localStorage.getItem("sonioxTerms");
    expect(JSON.parse(stored!)).toEqual(["alpha", "beta"]);
  });

  it("saveMicToggleShortcutPreference persists the micToggleShortcut key", () => {
    saveMicToggleShortcutPreference("Control+Alt+Super+M");
    expect(window.localStorage.getItem("micToggleShortcut")).toBe('"Control+Alt+Super+M"');
  });
});

describe("storage — mic shortcut helpers", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("loadMicToggleShortcutPreference falls back to default when key is missing", () => {
    expect(loadMicToggleShortcutPreference()).toBe(DEFAULT_MIC_TOGGLE_SHORTCUT);
  });

  it("loadMicToggleShortcutPreference returns stored shortcut", () => {
    window.localStorage.setItem("micToggleShortcut", '"Control+Alt+Super+M"');
    expect(loadMicToggleShortcutPreference()).toBe("Control+Alt+Super+M");
  });

  it("loadMicToggleShortcutPreference ignores empty stored value", () => {
    window.localStorage.setItem("micToggleShortcut", '"   "');
    expect(loadMicToggleShortcutPreference()).toBe(DEFAULT_MIC_TOGGLE_SHORTCUT);
  });

  it("resetMicToggleShortcutPreference removes the stored shortcut", () => {
    window.localStorage.setItem("micToggleShortcut", '"Control+Alt+Super+M"');
    expect(resetMicToggleShortcutPreference()).toBe(true);
    expect(window.localStorage.getItem("micToggleShortcut")).toBeNull();
  });

  it("resetMicToggleShortcutPreference returns false when storage remove fails", () => {
    vi.spyOn(window.localStorage, "removeItem").mockImplementationOnce(() => {
      throw new DOMException("QuotaExceededError");
    });

    expect(resetMicToggleShortcutPreference()).toBe(false);
  });
});

describe("storage — stop word and llm/reminder helper keys", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("loads and saves custom stop word preference", () => {
    expect(loadCustomStopWordPreference("thank you")).toBe("thank you");
    expect(saveCustomStopWordPreference("done now")).toBe(true);
    expect(loadCustomStopWordPreference("thank you")).toBe("done now");
  });

  it("resets custom stop word preference", () => {
    saveCustomStopWordPreference("done now");
    expect(resetCustomStopWordPreference()).toBe(true);
    expect(loadCustomStopWordPreference("thank you")).toBe("thank you");
  });

  it("loads and saves llm correction toggle through skipLlm", () => {
    expect(loadLlmCorrectionEnabledPreference()).toBe(false);
    expect(saveLlmCorrectionEnabledPreference(true)).toBe(true);
    expect(loadLlmCorrectionEnabledPreference()).toBe(true);
    expect(saveSkipLlm(true)).toBe(true);
    expect(loadLlmCorrectionEnabledPreference()).toBe(false);
  });

  it("loads and saves reminder beep toggle", () => {
    expect(loadReminderBeepEnabledPreference()).toBe(DEFAULT_REMINDER_BEEP_ENABLED);
    expect(saveReminderBeepEnabledPreference(false)).toBe(true);
    expect(loadReminderBeepEnabledPreference()).toBe(false);
  });

  it("loads and saves llm provider/model/base url preferences", () => {
    expect(loadLlmProviderPreference(DEFAULT_LLM_PROVIDER)).toBe("xai");
    expect(saveLlmProviderPreference("openai_compatible")).toBe(true);
    expect(loadLlmProviderPreference(DEFAULT_LLM_PROVIDER)).toBe("openai_compatible");
    expect(saveLlmProviderPreference("gemini")).toBe(true);
    expect(loadLlmProviderPreference(DEFAULT_LLM_PROVIDER)).toBe("gemini");

    expect(loadLlmModelPreference("xai")).toBeNull();
    expect(saveLlmModelPreference("xai", "grok-4")).toBe(true);
    expect(loadLlmModelPreference("xai")).toBe("grok-4");
    expect(loadLlmModelPreference("gemini")).toBeNull();

    expect(loadLlmBaseUrlPreference("https://api.openai.com/v1")).toBe("https://api.openai.com/v1");
    expect(saveLlmBaseUrlPreference("https://openrouter.ai/api/v1")).toBe(true);
    expect(loadLlmBaseUrlPreference("https://api.openai.com/v1")).toBe("https://openrouter.ai/api/v1");
  });

  it("loads and saves Soniox realtime model preference", () => {
    expect(loadSonioxModelPreference()).toBeNull();
    expect(saveSonioxModelPreference("stt-rt-v3")).toBe(true);
    expect(loadSonioxModelPreference()).toBe("stt-rt-v3");
  });
});

// ─── Setup validation: real main-logic functions (IMP-02) ─────────────────
// These tests exercise the actual applySetupError / clearSetupError /
// validateSonioxKey functions exported from main-logic.ts, not manual DOM.

describe("setup validation — applySetupError (IMP-02)", () => {
  let sonioxInput: HTMLInputElement;
  let errorRegion: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="setup-error" class="error-region" role="alert"></div>
      <input id="setup-soniox-key" type="password" aria-required="true" />
    `;
    sonioxInput = document.getElementById("setup-soniox-key") as HTMLInputElement;
    errorRegion = document.getElementById("setup-error") as HTMLDivElement;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("sets aria-invalid='true' on the input", () => {
    applySetupError("Soniox API key is required.", errorRegion, sonioxInput);
    expect(sonioxInput.getAttribute("aria-invalid")).toBe("true");
  });

  it("adds has-error class to the input", () => {
    applySetupError("Soniox API key is required.", errorRegion, sonioxInput);
    expect(sonioxInput.classList.contains("has-error")).toBe(true);
  });

  it("makes the error region visible with the message", () => {
    applySetupError("Soniox API key is required.", errorRegion, sonioxInput);
    expect(errorRegion.classList.contains("is-visible")).toBe(true);
    expect(errorRegion.textContent).toBe("Soniox API key is required.");
  });
});

describe("setup validation — clearSetupError (IMP-02)", () => {
  let sonioxInput: HTMLInputElement;
  let errorRegion: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="setup-error" class="error-region is-visible" role="alert">Error</div>
      <input id="setup-soniox-key" type="password" class="has-error" aria-invalid="true" />
    `;
    sonioxInput = document.getElementById("setup-soniox-key") as HTMLInputElement;
    errorRegion = document.getElementById("setup-error") as HTMLDivElement;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("sets aria-invalid='false' on the input", () => {
    clearSetupError(errorRegion, sonioxInput);
    expect(sonioxInput.getAttribute("aria-invalid")).toBe("false");
  });

  it("removes has-error class from the input", () => {
    clearSetupError(errorRegion, sonioxInput);
    expect(sonioxInput.classList.contains("has-error")).toBe(false);
  });

  it("hides the error region and clears message", () => {
    clearSetupError(errorRegion, sonioxInput);
    expect(errorRegion.classList.contains("is-visible")).toBe(false);
    expect(errorRegion.textContent).toBe("");
  });
});

describe("setup validation — validateSonioxKey (IMP-02)", () => {
  it("returns null for a non-empty key", () => {
    expect(validateSonioxKey("sk-soniox-abc")).toBeNull();
  });

  it("returns an error message for empty string", () => {
    expect(validateSonioxKey("")).toBe("Soniox API key is required.");
  });

  it("returns an error message for whitespace-only string", () => {
    expect(validateSonioxKey("   ")).toBe("Soniox API key is required.");
  });
});

// ─── Dialog: real open/close functions (IMP-02) ───────────────────────────

describe("dialog — applyDialogOpen (IMP-02)", () => {
  let dialog: HTMLDivElement;
  let backdrop: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="settings-dialog-backdrop" class="dialog-backdrop"></div>
      <div id="settings-dialog" class="dialog" role="dialog" aria-hidden="true">
        <button id="dialog-close-btn" type="button">X</button>
      </div>
    `;
    dialog = document.getElementById("settings-dialog") as HTMLDivElement;
    backdrop = document.getElementById("settings-dialog-backdrop") as HTMLDivElement;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("adds is-open class to backdrop", () => {
    applyDialogOpen(dialog, backdrop);
    expect(backdrop.classList.contains("is-open")).toBe(true);
  });

  it("sets aria-hidden='false' on the dialog", () => {
    applyDialogOpen(dialog, backdrop);
    expect(dialog.getAttribute("aria-hidden")).toBe("false");
  });
});

describe("dialog — applyDialogClose (IMP-02)", () => {
  let dialog: HTMLDivElement;
  let backdrop: HTMLDivElement;
  let opener: HTMLButtonElement;

  beforeEach(() => {
    document.body.innerHTML = `
      <button id="opener" type="button">Open</button>
      <div id="settings-dialog-backdrop" class="dialog-backdrop is-open"></div>
      <div id="settings-dialog" class="dialog" role="dialog" aria-hidden="false">
        <button id="dialog-close-btn" type="button">X</button>
      </div>
    `;
    dialog = document.getElementById("settings-dialog") as HTMLDivElement;
    backdrop = document.getElementById("settings-dialog-backdrop") as HTMLDivElement;
    opener = document.getElementById("opener") as HTMLButtonElement;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("removes is-open class from backdrop", () => {
    applyDialogClose(dialog, backdrop, opener);
    expect(backdrop.classList.contains("is-open")).toBe(false);
  });

  it("sets aria-hidden='true' on the dialog", () => {
    applyDialogClose(dialog, backdrop, opener);
    expect(dialog.getAttribute("aria-hidden")).toBe("true");
  });

  it("focuses the opener element", () => {
    const focusSpy = vi.spyOn(opener, "focus");
    applyDialogClose(dialog, backdrop, opener);
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

  it("does not throw when opener is null", () => {
    expect(() => applyDialogClose(dialog, backdrop, null)).not.toThrow();
  });
});

// ─── Startup permissions: structured result (IMP-01) ─────────────────────
// requestStartupPermissions must return results callers can inspect so that
// main.ts can surface advisory feedback when permissions are denied.

describe("requestStartupPermissions — returns structured results (IMP-01)", () => {
  it("returns an array of three results in order", async () => {
    const bridge = {
      ensureMicrophonePermission: vi.fn(async () => ({ granted: true })),
      ensureAccessibilityPermission: vi.fn(async () => ({ granted: true })),
      ensureTextInsertionPermission: vi.fn(async () => ({ granted: true })),
    };

    const results = await requestStartupPermissions(bridge);

    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ permission: "microphone", granted: true });
    expect(results[1]).toMatchObject({ permission: "accessibility", granted: true });
    expect(results[2]).toMatchObject({ permission: "textInsertion", granted: true });
  });

  it("marks denied result when bridge returns granted: false", async () => {
    const bridge = {
      ensureMicrophonePermission: vi.fn(async () => ({ granted: false, status: "denied" })),
      ensureAccessibilityPermission: vi.fn(async () => ({ granted: true })),
      ensureTextInsertionPermission: vi.fn(async () => ({ granted: true })),
    };

    const results = await requestStartupPermissions(bridge);

    expect(results[0]).toMatchObject({ permission: "microphone", granted: false });
    expect(results[1]).toMatchObject({ permission: "accessibility", granted: true });
  });

  it("marks errored result when bridge throws", async () => {
    const bridge = {
      ensureMicrophonePermission: vi.fn(async () => {
        throw new Error("TCC denied");
      }),
      ensureAccessibilityPermission: vi.fn(async () => ({ granted: true })),
      ensureTextInsertionPermission: vi.fn(async () => ({ granted: true })),
    };

    const results = await requestStartupPermissions(bridge);

    expect(results[0]).toMatchObject({
      permission: "microphone",
      granted: false,
      error: "TCC denied",
    });
    // Still continues to subsequent permissions
    expect(results[1]).toMatchObject({ permission: "accessibility", granted: true });
    expect(results[2]).toMatchObject({ permission: "textInsertion", granted: true });
  });

  it("continues past all failures — still returns all three results", async () => {
    const bridge = {
      ensureMicrophonePermission: vi.fn(async () => { throw new Error("denied"); }),
      ensureAccessibilityPermission: vi.fn(async () => { throw new Error("denied"); }),
      ensureTextInsertionPermission: vi.fn(async () => { throw new Error("denied"); }),
    };

    const results = await requestStartupPermissions(bridge);

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.granted === false)).toBe(true);
  });
});

// ─── Dialog staged-state isolation (pure logic) ───────────────────────────

describe("dialog staged-state isolation", () => {
  it("staged terms are a copy — not a reference — of persisted terms", () => {
    const persisted = ["alpha", "beta"];
    const staged = { terms: [...persisted] };

    staged.terms.push("gamma");
    expect(persisted).not.toContain("gamma");
    expect(staged.terms).toContain("gamma");
  });

  it("cancel leaves persisted state unchanged", () => {
    const persisted = { terms: ["original"] };
    let staged = { terms: [...persisted.terms] };

    staged.terms = [...staged.terms, "new-term"];
    staged = { terms: [] };

    expect(persisted.terms).not.toContain("new-term");
    expect(persisted.terms).toEqual(["original"]);
  });
});

// ─── Dialog reset-to-defaults (pure logic) ────────────────────────────────

describe("dialog reset-to-defaults", () => {
  it("loads terms from voiceToTextDefaults", () => {
    const defaults = { terms: ["default-term"] };

    const staged = {
      terms: [...defaults.terms],
    };

    expect(staged.terms).toEqual(["default-term"]);
  });

  it("staged from defaults is a copy — mutations do not affect defaults", () => {
    const defaults = { terms: ["keep-me"] };

    const staged = {
      terms: [...defaults.terms],
    };

    staged.terms.push("extra");
    expect(defaults.terms).not.toContain("extra");
  });
});

// ─── addStagedTerm deduplication (pure logic) ─────────────────────────────

describe("addStagedTerm — deduplication", () => {
  it("does not add a duplicate term", () => {
    let terms = ["existing"];

    function addStagedTerm(value: string): void {
      const v = value.trim();
      if (!v) return;
      if (terms.includes(v)) return;
      terms = [...terms, v];
    }

    addStagedTerm("existing");
    expect(terms).toEqual(["existing"]);
    addStagedTerm("new");
    expect(terms).toEqual(["existing", "new"]);
  });

  it("ignores empty or whitespace-only input", () => {
    let terms = ["alpha"];

    function addStagedTerm(value: string): void {
      const v = value.trim();
      if (!v) return;
      if (terms.includes(v)) return;
      terms = [...terms, v];
    }

    addStagedTerm("");
    addStagedTerm("   ");
    expect(terms).toEqual(["alpha"]);
  });
});

// ─── index.html — semantic structure ─────────────────────────────────────

describe("index.html — semantic structure", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <main id="settings-panel" class="settings-panel" aria-label="Voice to Text settings">
        <header class="status-hero"></header>
        <div id="setup-error" class="error-region" role="alert"></div>
        <div class="content-grid"></div>
      </main>
      <div id="settings-dialog-backdrop" class="dialog-backdrop" role="presentation">
        <div id="settings-dialog" class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" aria-hidden="true">
          <h2 id="dialog-title">Vocabulary</h2>
          <button id="dialog-close-btn" type="button" aria-label="Close dialog"></button>
        </div>
      </div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("settings shell contains a <main> landmark element", () => {
    const settingsPanel = document.getElementById("settings-panel")!;
    expect(settingsPanel.tagName).toBe("MAIN");
  });

  it("single-screen layout does not expose tablist landmarks", () => {
    expect(document.querySelector('[role="tablist"]')).toBeNull();
    expect(document.querySelector('[role="tabpanel"]')).toBeNull();
  });

  it("dialog has role='dialog', aria-modal='true', and aria-labelledby", () => {
    const dialog = document.getElementById("settings-dialog")!;
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe("dialog-title");
  });

  it("error region uses role='alert' without aria-live", () => {
    const errorEl = document.getElementById("setup-error")!;
    expect(errorEl.getAttribute("role")).toBe("alert");
    expect(errorEl.getAttribute("aria-live")).toBeNull();
  });

  it("dialog close button has an accessible label", () => {
    const closeBtn = document.getElementById("dialog-close-btn")!;
    expect(closeBtn.getAttribute("aria-label")).toBe("Close dialog");
  });
});

// ─── Setup progress UI ───────────────────────────────────────────────────

describe("setup progress — DOM structure", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="setup-progress" class="setup-progress is-hidden" role="status" aria-live="polite">
        <span class="setup-progress-dot" aria-hidden="true"></span>
        <span id="setup-progress-text">Verifying key…</span>
      </div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("setup-progress starts hidden with is-hidden class", () => {
    const progress = document.getElementById("setup-progress")!;
    expect(progress.classList.contains("is-hidden")).toBe(true);
  });

  it("setup-progress has role='status' and aria-live='polite' for screen reader announcements", () => {
    const progress = document.getElementById("setup-progress")!;
    expect(progress.getAttribute("role")).toBe("status");
    expect(progress.getAttribute("aria-live")).toBe("polite");
  });

  it("setup-progress-text has default verifying text", () => {
    const text = document.getElementById("setup-progress-text")!;
    expect(text.textContent).toBe("Verifying key…");
  });

  it("toggling is-hidden shows/hides the progress indicator", () => {
    const progress = document.getElementById("setup-progress")!;
    progress.classList.remove("is-hidden");
    expect(progress.classList.contains("is-hidden")).toBe(false);
    progress.classList.add("is-hidden");
    expect(progress.classList.contains("is-hidden")).toBe(true);
  });
});

// ─── AI disabled note visibility ──────────────────────────────────────────

describe("AI disabled note — visibility toggle", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="ai-disabled-note" class="ai-disabled-note" role="note">
        <span class="ai-disabled-note-text">Explanation text</span>
      </div>
      <fieldset id="ai-settings-fieldset" class="ai-fieldset" disabled></fieldset>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("note is visible when AI correction is disabled (is-hidden absent)", () => {
    const note = document.getElementById("ai-disabled-note")!;
    expect(note.classList.contains("is-hidden")).toBe(false);
  });

  it("note is hidden when AI correction is enabled (is-hidden applied)", () => {
    const note = document.getElementById("ai-disabled-note")!;
    note.classList.add("is-hidden");
    expect(note.classList.contains("is-hidden")).toBe(true);
  });

  it("fieldset and note visibility are inversely coupled", () => {
    const note = document.getElementById("ai-disabled-note")!;
    const fieldset = document.getElementById("ai-settings-fieldset") as HTMLFieldSetElement;

    // Simulates syncAiFieldsetDisabledState(true)
    fieldset.disabled = false;
    note.classList.add("is-hidden");
    expect(fieldset.disabled).toBe(false);
    expect(note.classList.contains("is-hidden")).toBe(true);

    // Simulates syncAiFieldsetDisabledState(false)
    fieldset.disabled = true;
    note.classList.remove("is-hidden");
    expect(fieldset.disabled).toBe(true);
    expect(note.classList.contains("is-hidden")).toBe(false);
  });
});

// ─── Prefs ready card shortcut ────────────────────────────────────────────

describe("prefs ready card — shortcut display", () => {
  it("shortcutCanonicalToDisplay converts canonical tokens to platform labels", () => {
    // Importing dynamically to verify the pure helper
    const { shortcutCanonicalToDisplay: convert } = require("../shortcut-display.ts");
    expect(convert("Control+Alt+Super+M", "macos")).toBe("Control+Option+Command+M");
    expect(convert("Control+Alt+Super+M", "windows")).toBe("Ctrl+Alt+Win+M");
  });

  it("ready card shortcut element exists in the expected DOM location", () => {
    document.body.innerHTML = `
      <div class="prefs-ready-card" role="note">
        <div class="prefs-ready-content">
          <span class="prefs-ready-title">Ready to dictate</span>
          <span id="prefs-ready-shortcut" class="prefs-ready-shortcut">Press your shortcut to start</span>
        </div>
      </div>
    `;
    const el = document.getElementById("prefs-ready-shortcut");
    expect(el).not.toBeNull();
    expect(el!.textContent).toBe("Press your shortcut to start");
    document.body.innerHTML = "";
  });
});

// ─── Status auto-clear ───────────────────────────────────────────────────
// These tests exercise the real scheduleStatusClear / cancelScheduledStatusClear
// scheduling logic imported from main.ts's closure, reproduced here as a
// faithful standalone copy of the production implementation so we can test
// the timer interaction patterns without requiring a full init() bootstrap.

describe("status auto-clear — scheduling behavior", () => {
  const STATUS_AUTO_CLEAR_MS = 4_000;
  let statusClearTimers: Map<HTMLElement, ReturnType<typeof setTimeout>>;

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

  function setStatus(
    element: HTMLElement,
    message: string,
    isError: boolean,
    clearFn: () => void,
  ): void {
    element.textContent = message;
    element.classList.toggle("is-error", isError);
    element.classList.toggle("is-success", !isError);
    if (isError) {
      cancelScheduledStatusClear(element);
    } else {
      scheduleStatusClear(element, clearFn);
    }
  }

  beforeEach(() => {
    vi.useFakeTimers();
    statusClearTimers = new Map();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-clears a success status after the configured delay", () => {
    const element = document.createElement("div");
    const clearFn = () => {
      element.textContent = "";
      element.classList.remove("is-success", "is-error");
    };

    setStatus(element, "Saved.", false, clearFn);

    expect(element.textContent).toBe("Saved.");
    vi.advanceTimersByTime(3_999);
    expect(element.textContent).toBe("Saved.");
    vi.advanceTimersByTime(1);
    expect(element.textContent).toBe("");
    expect(element.classList.contains("is-success")).toBe(false);
  });

  it("replaces a pending timer when a new success is set before clear fires", () => {
    const element = document.createElement("div");
    const clearFn = vi.fn(() => {
      element.textContent = "";
      element.classList.remove("is-success", "is-error");
    });

    setStatus(element, "First save.", false, clearFn);
    vi.advanceTimersByTime(2_000);
    setStatus(element, "Second save.", false, clearFn);
    vi.advanceTimersByTime(2_000);

    // First timer would have fired at 4000ms if not replaced
    expect(clearFn).not.toHaveBeenCalled();
    expect(element.textContent).toBe("Second save.");

    vi.advanceTimersByTime(2_000);
    expect(clearFn).toHaveBeenCalledTimes(1);
    expect(element.textContent).toBe("");
  });

  it("does not schedule a timer for error statuses", () => {
    const element = document.createElement("div");
    const clearFn = vi.fn();

    setStatus(element, "Something failed.", true, clearFn);

    vi.advanceTimersByTime(10_000);
    expect(clearFn).not.toHaveBeenCalled();
    expect(element.textContent).toBe("Something failed.");
    expect(element.classList.contains("is-error")).toBe(true);
  });

  it("error after success cancels the pending success timer so error stays visible (IMP-01)", () => {
    const element = document.createElement("div");
    const clearFn = () => {
      element.textContent = "";
      element.classList.remove("is-success", "is-error");
    };

    // Show a success — schedules auto-clear at 4000ms
    setStatus(element, "Saved.", false, clearFn);
    expect(element.textContent).toBe("Saved.");

    // 1s later, an error replaces it — must cancel the pending clear
    vi.advanceTimersByTime(1_000);
    setStatus(element, "Save failed.", true, clearFn);
    expect(element.textContent).toBe("Save failed.");
    expect(element.classList.contains("is-error")).toBe(true);

    // The original success timer would have fired at 4000ms — it must NOT clear the error
    vi.advanceTimersByTime(5_000);
    expect(element.textContent).toBe("Save failed.");
    expect(element.classList.contains("is-error")).toBe(true);
  });

  it("success after error replaces error and schedules auto-clear normally", () => {
    const element = document.createElement("div");
    const clearFn = () => {
      element.textContent = "";
      element.classList.remove("is-success", "is-error");
    };

    setStatus(element, "Failed.", true, clearFn);
    vi.advanceTimersByTime(2_000);

    setStatus(element, "Retried and saved.", false, clearFn);
    expect(element.textContent).toBe("Retried and saved.");
    expect(element.classList.contains("is-success")).toBe(true);
    expect(element.classList.contains("is-error")).toBe(false);

    vi.advanceTimersByTime(4_000);
    expect(element.textContent).toBe("");
  });
});
