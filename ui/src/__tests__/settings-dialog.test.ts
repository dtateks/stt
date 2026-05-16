import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSettingsDialog, type SettingsDialog } from "../settings-dialog.ts";

interface Harness {
  dialog: SettingsDialog;
  backdropEl: HTMLDivElement;
  dialogEl: HTMLDivElement;
  closeBtnEl: HTMLButtonElement;
  cancelBtnEl: HTMLButtonElement;
  saveBtnEl: HTMLButtonElement;
  resetBtnEl: HTMLButtonElement;
  termsTagListEl: HTMLDivElement;
  termsAddInputEl: HTMLInputElement;
  termsAddBtnEl: HTMLButtonElement;
  loadStagedTerms: ReturnType<typeof vi.fn<() => string[]>>;
  loadDefaultTerms: ReturnType<typeof vi.fn<() => string[]>>;
  saveTerms: ReturnType<typeof vi.fn<(terms: string[]) => boolean>>;
  onSaveError: ReturnType<typeof vi.fn<(message: string) => void>>;
  onTermsCommitted: ReturnType<typeof vi.fn<() => void>>;
}

function buildHarness(overrides: {
  staged?: string[];
  defaults?: string[];
  saveTerms?: (terms: string[]) => boolean;
} = {}): Harness {
  document.body.innerHTML = `
    <div id="backdrop">
      <div id="dialog" aria-hidden="true">
        <button id="close-btn" type="button">Close</button>
        <div id="terms-list"></div>
        <input id="terms-input" type="text" />
        <button id="terms-add" type="button">Add</button>
        <button id="reset" type="button">Reset</button>
        <button id="cancel" type="button">Cancel</button>
        <button id="save" type="button">Save</button>
      </div>
    </div>
  `;

  const backdropEl = document.getElementById("backdrop") as HTMLDivElement;
  const dialogEl = document.getElementById("dialog") as HTMLDivElement;
  const closeBtnEl = document.getElementById("close-btn") as HTMLButtonElement;
  const cancelBtnEl = document.getElementById("cancel") as HTMLButtonElement;
  const saveBtnEl = document.getElementById("save") as HTMLButtonElement;
  const resetBtnEl = document.getElementById("reset") as HTMLButtonElement;
  const termsTagListEl = document.getElementById("terms-list") as HTMLDivElement;
  const termsAddInputEl = document.getElementById("terms-input") as HTMLInputElement;
  const termsAddBtnEl = document.getElementById("terms-add") as HTMLButtonElement;

  const loadStagedTerms = vi.fn<() => string[]>(() => [...(overrides.staged ?? [])]);
  const loadDefaultTerms = vi.fn<() => string[]>(() => [...(overrides.defaults ?? [])]);
  const saveTerms = vi.fn<(terms: string[]) => boolean>(overrides.saveTerms ?? (() => true));
  const onSaveError = vi.fn<(message: string) => void>();
  const onTermsCommitted = vi.fn<() => void>();

  const dialog = createSettingsDialog({
    backdropEl,
    dialogEl,
    closeBtnEl,
    cancelBtnEl,
    saveBtnEl,
    resetBtnEl,
    termsTagListEl,
    termsAddInputEl,
    termsAddBtnEl,
    loadStagedTerms,
    loadDefaultTerms,
    saveTerms,
    onSaveError,
    onTermsCommitted,
  });

  return {
    dialog,
    backdropEl,
    dialogEl,
    closeBtnEl,
    cancelBtnEl,
    saveBtnEl,
    resetBtnEl,
    termsTagListEl,
    termsAddInputEl,
    termsAddBtnEl,
    loadStagedTerms,
    loadDefaultTerms,
    saveTerms,
    onSaveError,
    onTermsCommitted,
  };
}

function tagTexts(termsTagListEl: HTMLElement): string[] {
  return Array.from(termsTagListEl.querySelectorAll(".tag"))
    .map((tag) => (tag.firstElementChild as HTMLElement | null)?.textContent ?? "");
}

describe("createSettingsDialog", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  describe("open / close", () => {
    it("renders staged terms and toggles aria-hidden on open", () => {
      const harness = buildHarness({ staged: ["alpha", "beta"] });

      harness.dialog.open(null);

      expect(harness.backdropEl.classList.contains("is-open")).toBe(true);
      expect(harness.dialogEl.getAttribute("aria-hidden")).toBe("false");
      expect(tagTexts(harness.termsTagListEl)).toEqual(["alpha", "beta"]);
    });

    it("renders an empty-state pill when staged terms are empty", () => {
      const harness = buildHarness({ staged: [] });

      harness.dialog.open(null);

      expect(harness.termsTagListEl.querySelector(".tag")).toBeNull();
      expect(harness.termsTagListEl.querySelector(".tag-empty")?.textContent).toBe(
        "No terms added",
      );
    });

    it("restores focus to the opener on close", () => {
      const harness = buildHarness();
      const opener = document.createElement("button");
      document.body.appendChild(opener);

      harness.dialog.open(opener);
      harness.closeBtnEl.click();

      expect(document.activeElement).toBe(opener);
      expect(harness.backdropEl.classList.contains("is-open")).toBe(false);
    });

    it("dismisses on cancel without committing", () => {
      const harness = buildHarness({ staged: ["alpha"] });
      harness.dialog.open(null);

      harness.cancelBtnEl.click();

      expect(harness.backdropEl.classList.contains("is-open")).toBe(false);
      expect(harness.saveTerms).not.toHaveBeenCalled();
    });

    it("dismisses on backdrop click but not on inner-content click", () => {
      const harness = buildHarness();
      harness.dialog.open(null);

      // Inner-content click should not close.
      harness.dialogEl.click();
      expect(harness.backdropEl.classList.contains("is-open")).toBe(true);

      // Backdrop click closes.
      harness.backdropEl.click();
      expect(harness.backdropEl.classList.contains("is-open")).toBe(false);
    });

    it("dismisses on Escape", () => {
      const harness = buildHarness();
      harness.dialog.open(null);

      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

      expect(harness.backdropEl.classList.contains("is-open")).toBe(false);
    });

    it("Escape is a no-op while the dialog is closed", () => {
      const harness = buildHarness();

      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

      expect(harness.backdropEl.classList.contains("is-open")).toBe(false);
    });
  });

  describe("term editing", () => {
    it("adds a trimmed, deduped term and clears the input", () => {
      const harness = buildHarness({ staged: ["alpha"] });
      harness.dialog.open(null);

      harness.termsAddInputEl.value = "  beta  ";
      harness.termsAddBtnEl.click();

      expect(harness.termsAddInputEl.value).toBe("");
      expect(tagTexts(harness.termsTagListEl)).toEqual(["alpha", "beta"]);
    });

    it("ignores duplicate term additions but still clears the input", () => {
      const harness = buildHarness({ staged: ["alpha"] });
      harness.dialog.open(null);

      harness.termsAddInputEl.value = "alpha";
      harness.termsAddBtnEl.click();

      expect(harness.termsAddInputEl.value).toBe("");
      expect(tagTexts(harness.termsTagListEl)).toEqual(["alpha"]);
    });

    it("ignores empty/whitespace input", () => {
      const harness = buildHarness();
      harness.dialog.open(null);

      harness.termsAddInputEl.value = "   ";
      harness.termsAddBtnEl.click();

      expect(harness.termsTagListEl.querySelector(".tag")).toBeNull();
    });

    it("adds on Enter keydown", () => {
      const harness = buildHarness({ staged: [] });
      harness.dialog.open(null);

      harness.termsAddInputEl.value = "gamma";
      harness.termsAddInputEl.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter" }),
      );

      expect(tagTexts(harness.termsTagListEl)).toEqual(["gamma"]);
    });

    it("removes a term when its remove button is clicked", () => {
      const harness = buildHarness({ staged: ["alpha", "beta"] });
      harness.dialog.open(null);

      const tagButtons = harness.termsTagListEl.querySelectorAll<HTMLButtonElement>(
        ".tag-remove",
      );
      tagButtons[0].click();

      expect(tagTexts(harness.termsTagListEl)).toEqual(["beta"]);
    });

    it("renders the empty-state pill after the last term is removed", () => {
      const harness = buildHarness({ staged: ["alpha"] });
      harness.dialog.open(null);

      const removeBtn = harness.termsTagListEl.querySelector<HTMLButtonElement>(
        ".tag-remove",
      );
      removeBtn?.click();

      expect(harness.termsTagListEl.querySelector(".tag")).toBeNull();
      expect(harness.termsTagListEl.querySelector(".tag-empty")?.textContent).toBe(
        "No terms added",
      );
    });

    it("rewrites the staged list to the bundled defaults on reset", () => {
      const harness = buildHarness({
        staged: ["custom"],
        defaults: ["app", "claude"],
      });
      harness.dialog.open(null);

      harness.resetBtnEl.click();

      expect(tagTexts(harness.termsTagListEl)).toEqual(["app", "claude"]);
    });
  });

  describe("save", () => {
    it("commits staged terms and dismisses on save", () => {
      const harness = buildHarness({ staged: ["alpha"] });
      harness.dialog.open(null);
      harness.termsAddInputEl.value = "beta";
      harness.termsAddBtnEl.click();

      harness.saveBtnEl.click();

      expect(harness.saveTerms).toHaveBeenCalledWith(["alpha", "beta"]);
      expect(harness.onTermsCommitted).toHaveBeenCalledTimes(1);
      expect(harness.onSaveError).not.toHaveBeenCalled();
      expect(harness.backdropEl.classList.contains("is-open")).toBe(false);
    });

    it("surfaces a save failure and still closes the dialog", () => {
      const harness = buildHarness({
        staged: ["alpha"],
        saveTerms: () => false,
      });
      harness.dialog.open(null);

      harness.saveBtnEl.click();

      expect(harness.onSaveError).toHaveBeenCalledWith(
        "Could not save vocabulary settings. Storage may be full or unavailable.",
      );
      expect(harness.onTermsCommitted).not.toHaveBeenCalled();
      // The dialog still closes — the error is surfaced through the caller's
      // panel-level surface, not by holding the dialog open.
      expect(harness.backdropEl.classList.contains("is-open")).toBe(false);
    });
  });
});
