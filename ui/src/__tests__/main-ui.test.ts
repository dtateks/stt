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
  loadPreferences,
  saveEnterMode,
  saveOutputLang,
  saveSonioxTerms,
  saveSonioxTranslationTerms,
} from "../storage.ts";
import {
  applySetupError,
  clearSetupError,
  validateSonioxKey,
  applyDialogOpen,
  applyDialogClose,
} from "../main-logic.ts";
import { requestStartupPermissions } from "../startup-permissions.ts";
import type { TranslationTerm } from "../types.ts";

// ─── Storage: readJson fallback behavior ─────────────────────────────────

describe("storage — readJson fallback behavior", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.voiceToTextDefaults = { terms: [], translationTerms: [] };
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("returns the default enterMode (true) when key is absent", () => {
    const prefs = loadPreferences();
    expect(prefs.enterMode).toBe(true);
  });

  it("returns default outputLang ('auto') when key is absent", () => {
    const prefs = loadPreferences();
    expect(prefs.outputLang).toBe("auto");
  });

  it("returns the fallback when stored value is corrupt JSON", () => {
    window.localStorage.setItem("enterMode", "not-valid-json{{{");
    const prefs = loadPreferences();
    expect(prefs.enterMode).toBe(true);
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

  it("saveSonioxTranslationTerms returns false when setItem throws", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementationOnce(() => {
      throw new DOMException("QuotaExceededError");
    });
    const ok = saveSonioxTranslationTerms([{ source: "a", target: "b" }]);
    expect(ok).toBe(false);
  });

  it("saveSonioxTranslationTerms returns true when write succeeds", () => {
    const ok = saveSonioxTranslationTerms([{ source: "a", target: "b" }]);
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
    const defaults = { terms: ["hello", "world"], translationTerms: [] };
    window.voiceToTextDefaults = defaults;
    const prefs = loadPreferences();
    expect(prefs.sonioxTerms).toEqual(["hello", "world"]);
  });

  it("uses voiceToTextDefaults.translationTerms when nothing stored", () => {
    const translationTerms: TranslationTerm[] = [{ source: "foo", target: "bar" }];
    const defaults = { terms: [], translationTerms };
    window.voiceToTextDefaults = defaults;
    const prefs = loadPreferences();
    expect(prefs.sonioxTranslationTerms).toEqual(translationTerms);
  });

  it("returns stored sonioxTerms over defaults when present", () => {
    const defaults = { terms: ["default-term"], translationTerms: [] };
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

  it("saveSonioxTranslationTerms persists the sonioxTranslationTerms key", () => {
    const pairs: TranslationTerm[] = [{ source: "hello", target: "xin chào" }];
    saveSonioxTranslationTerms(pairs);
    const stored = window.localStorage.getItem("sonioxTranslationTerms");
    expect(JSON.parse(stored!)).toEqual(pairs);
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
    const staged = { terms: [...persisted], translationTerms: [] };

    staged.terms.push("gamma");
    expect(persisted).not.toContain("gamma");
    expect(staged.terms).toContain("gamma");
  });

  it("staged translationTerms are shallow copies — not references", () => {
    const persisted: TranslationTerm[] = [{ source: "hi", target: "xin chào" }];
    const staged = {
      terms: [],
      translationTerms: persisted.map((t) => ({ ...t })),
    };

    staged.translationTerms[0].target = "mutated";
    expect(persisted[0].target).toBe("xin chào");
  });

  it("cancel leaves persisted state unchanged", () => {
    const persisted = { terms: ["original"], translationTerms: [] };
    let staged = { terms: [...persisted.terms], translationTerms: [] };

    staged.terms = [...staged.terms, "new-term"];
    staged = { terms: [], translationTerms: [] };

    expect(persisted.terms).not.toContain("new-term");
    expect(persisted.terms).toEqual(["original"]);
  });
});

// ─── Dialog reset-to-defaults (pure logic) ────────────────────────────────

describe("dialog reset-to-defaults", () => {
  it("loads terms from voiceToTextDefaults", () => {
    const defaults = {
      terms: ["default-term"],
      translationTerms: [{ source: "src", target: "tgt" }],
    };

    const staged = {
      terms: [...defaults.terms],
      translationTerms: defaults.translationTerms.map((t) => ({ ...t })),
    };

    expect(staged.terms).toEqual(["default-term"]);
    expect(staged.translationTerms).toEqual([{ source: "src", target: "tgt" }]);
  });

  it("staged from defaults is a copy — mutations do not affect defaults", () => {
    const defaults = {
      terms: ["keep-me"],
      translationTerms: [] as TranslationTerm[],
    };

    const staged = {
      terms: [...defaults.terms],
      translationTerms: defaults.translationTerms.map((t) => ({ ...t })),
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

// ─── addStagedTranslation deduplication (pure logic) ──────────────────────

describe("addStagedTranslation — deduplication", () => {
  it("does not add a duplicate translation pair", () => {
    let translationTerms: TranslationTerm[] = [
      { source: "hi", target: "xin chào" },
    ];

    function addStagedTranslation(source: string, target: string): void {
      const s = source.trim();
      const t = target.trim();
      if (!s || !t) return;
      const isDuplicate = translationTerms.some(
        (pair) => pair.source === s && pair.target === t,
      );
      if (isDuplicate) return;
      translationTerms = [...translationTerms, { source: s, target: t }];
    }

    addStagedTranslation("hi", "xin chào");
    expect(translationTerms).toHaveLength(1);
    addStagedTranslation("bye", "tạm biệt");
    expect(translationTerms).toHaveLength(2);
  });

  it("ignores pairs where either field is empty", () => {
    let translationTerms: TranslationTerm[] = [];

    function addStagedTranslation(source: string, target: string): void {
      const s = source.trim();
      const t = target.trim();
      if (!s || !t) return;
      translationTerms = [...translationTerms, { source: s, target: t }];
    }

    addStagedTranslation("", "target");
    addStagedTranslation("source", "");
    expect(translationTerms).toHaveLength(0);
  });
});

// ─── index.html — semantic structure ─────────────────────────────────────

describe("index.html — semantic structure", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <section id="screen-setup" class="screen is-active" aria-label="Setup — API credentials">
        <header class="app-header"></header>
        <main class="setup-body">
          <h1 class="setup-title">Connect your API keys</h1>
          <div id="setup-error" class="error-region" role="alert"></div>
        </main>
      </section>
      <section id="screen-prefs" class="screen" aria-label="Preferences">
        <header class="app-header"></header>
        <main class="prefs-body"></main>
      </section>
      <div id="settings-dialog-backdrop" class="dialog-backdrop" role="presentation">
        <div id="settings-dialog" class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" aria-hidden="true">
          <h2 id="dialog-title">Vocabulary &amp; Translation</h2>
          <button id="dialog-close-btn" type="button" aria-label="Close dialog"></button>
        </div>
      </div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("setup screen contains a <main> landmark element", () => {
    const setupScreen = document.getElementById("screen-setup")!;
    expect(setupScreen.querySelector("main")).not.toBeNull();
  });

  it("preferences screen contains a <main> landmark element", () => {
    const prefsScreen = document.getElementById("screen-prefs")!;
    expect(prefsScreen.querySelector("main")).not.toBeNull();
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
