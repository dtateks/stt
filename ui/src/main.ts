/**
 * Main window entry point.
 *
 * Surfaces: setup screen + preferences screen + advanced settings dialog.
 * All bridge calls are funnelled through the window.voiceToText surface only.
 */

import "./main.css";
import type { OutputLang, TranslationTerm } from "./types.ts";
import {
  loadPreferences,
  saveEnterMode,
  saveOutputLang,
  saveSonioxTerms,
  saveSonioxTranslationTerms,
} from "./storage.ts";

// ─── Staged settings state ────────────────────────────────────────────────

interface StagedSettings {
  terms: string[];
  translationTerms: TranslationTerm[];
}

let staged: StagedSettings = { terms: [], translationTerms: [] };
let settingsOpenedBy: HTMLElement | null = null;

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
const quitBtn = q<HTMLButtonElement>("#action-quit");

// ─── Initialization ───────────────────────────────────────────────────────

async function init(): Promise<void> {
  const hasKey = await checkHasSonioxKey();

  if (hasKey) {
    showPrefsScreen();
  } else {
    showSetupScreen();
  }

  bindSetupForm();
  bindPrefs();
  bindActionButtons();
  bindDialog();
}

async function checkHasSonioxKey(): Promise<boolean> {
  try {
    const key = await window.voiceToText.getSonioxKey();
    return Boolean(key && key.trim());
  } catch {
    return false;
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
  const sonioxKey = sonioxInput.value.trim();
  const xaiKey = xaiInput.value.trim();

  clearSetupError();

  if (!sonioxKey) {
    showSetupError("Soniox API key is required.");
    sonioxInput.classList.add("has-error");
    sonioxInput.focus();
    return;
  }

  setSetupSaving(true);

  try {
    await window.voiceToText.saveCredentials(xaiKey, sonioxKey);
    showPrefsScreen();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    showSetupError(`Failed to save credentials: ${msg}`);
    setSetupSaving(false);
  }
}

function setSetupSaving(saving: boolean): void {
  setupSubmitBtn.disabled = saving;
  setupSubmitBtn.textContent = saving ? "Saving…" : "Continue";
}

function showSetupError(message: string): void {
  setupError.textContent = message;
  setupError.classList.add("is-visible");
}

function clearSetupError(): void {
  setupError.textContent = "";
  setupError.classList.remove("is-visible");
  sonioxInput.classList.remove("has-error");
}

// ─── Prefs UI ─────────────────────────────────────────────────────────────

function loadPrefsUI(): void {
  const prefs = loadPreferences();
  enterModeToggle.checked = prefs.enterMode;
  outputLangSelect.value = prefs.outputLang;
}

function bindPrefs(): void {
  enterModeToggle.addEventListener("change", () => {
    saveEnterMode(enterModeToggle.checked);
  });

  outputLangSelect.addEventListener("change", () => {
    saveOutputLang(outputLangSelect.value as OutputLang);
  });
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

  quitBtn.addEventListener("click", () => {
    void window.voiceToText.quitApp();
  });
}

async function handleResetKeys(): Promise<void> {
  try {
    await window.voiceToText.resetCredentials();
    showSetupScreen();
  } catch (error) {
    console.error("[reset-keys]", error);
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
  saveSonioxTerms(staged.terms);
  saveSonioxTranslationTerms(staged.translationTerms);
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
      (t) => !(t.source === pair.source && t.target === pair.target)
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
    (t) => t.source === source && t.target === target
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
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
}

function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
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
  } else {
    if (document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  void init();
});
