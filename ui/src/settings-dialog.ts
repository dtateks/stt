/**
 * Vocabulary settings dialog.
 *
 * Owns the full editor lifecycle:
 *   - open from a triggering element + restore focus to it on close
 *   - staged terms editing (add / remove with deduplication)
 *   - tag rendering (empty state + per-tag remove button)
 *   - save / cancel / reset orchestration through caller-provided
 *     persistence and notification callbacks
 *   - dismissal paths: explicit close button, cancel button, backdrop
 *     click, Escape key
 *   - focus trap that only redirects Tab at the first/last focusable
 *     element so middle-of-dialog tabbing remains native
 *
 * Storage / preference loading lives at the call site (the factory only
 * sees `loadStagedTerms` / `loadDefaultTerms` / `saveTerms`); the factory
 * never reaches into the wider settings panel state. `onTermsCommitted`
 * lets `main.ts` refresh derived UI (vocab count badge) without the
 * factory knowing about it.
 *
 * Document-level Escape listener follows the same single-page-app
 * lifetime as `shortcut-recorder.ts`: registered once at creation, never
 * removed. Aria toggling on the dialog element is part of the open/close
 * contract and stays inside the factory.
 */

export interface SettingsDialogOptions {
  backdropEl: HTMLElement;
  dialogEl: HTMLElement;
  closeBtnEl: HTMLButtonElement;
  cancelBtnEl: HTMLButtonElement;
  saveBtnEl: HTMLButtonElement;
  resetBtnEl: HTMLButtonElement;
  termsTagListEl: HTMLElement;
  termsAddInputEl: HTMLInputElement;
  termsAddBtnEl: HTMLButtonElement;
  /** Returns a fresh array — caller owns mutation discipline at the boundary. */
  loadStagedTerms: () => string[];
  /** Returns a fresh array of the bundled defaults (Reset action). */
  loadDefaultTerms: () => string[];
  /** Persist terms; return false on storage failure. */
  saveTerms: (terms: string[]) => boolean;
  /** Surfaced when `saveTerms` returns false. */
  onSaveError: (message: string) => void;
  /** Notified after a successful save commits (e.g. refresh vocab badge). */
  onTermsCommitted: () => void;
}

export interface SettingsDialog {
  /** Open the dialog; focus returns to `opener` on close. */
  open(opener: HTMLElement | null): void;
}

const SAVE_ERROR_MESSAGE =
  "Could not save vocabulary settings. Storage may be full or unavailable.";
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const REMOVE_BUTTON_SVG =
  '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>';

export function createSettingsDialog(options: SettingsDialogOptions): SettingsDialog {
  const {
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
  } = options;

  let stagedTerms: string[] = [];
  let lastOpener: HTMLElement | null = null;

  function isOpen(): boolean {
    return backdropEl.classList.contains("is-open");
  }

  function open(opener: HTMLElement | null): void {
    lastOpener = opener;
    stagedTerms = loadStagedTerms();
    renderTerms();

    backdropEl.classList.add("is-open");
    dialogEl.setAttribute("aria-hidden", "false");

    firstFocusable(dialogEl)?.focus();
  }

  function close(): void {
    backdropEl.classList.remove("is-open");
    dialogEl.setAttribute("aria-hidden", "true");
    lastOpener?.focus();
    lastOpener = null;
  }

  function commit(): void {
    if (!saveTerms(stagedTerms)) {
      onSaveError(SAVE_ERROR_MESSAGE);
      return;
    }
    onTermsCommitted();
  }

  function resetToDefaults(): void {
    stagedTerms = loadDefaultTerms();
    renderTerms();
  }

  function addTerm(): void {
    const value = termsAddInputEl.value.trim();
    if (!value) return;
    if (stagedTerms.includes(value)) {
      termsAddInputEl.value = "";
      return;
    }
    stagedTerms = [...stagedTerms, value];
    termsAddInputEl.value = "";
    renderTerms();
  }

  function removeTerm(term: string): void {
    stagedTerms = stagedTerms.filter((t) => t !== term);
    renderTerms();
  }

  function renderTerms(): void {
    termsTagListEl.innerHTML = "";

    if (stagedTerms.length === 0) {
      const empty = document.createElement("span");
      empty.className = "tag-empty";
      empty.textContent = "No terms added";
      termsTagListEl.appendChild(empty);
      return;
    }

    for (const term of stagedTerms) {
      termsTagListEl.appendChild(buildTermTag(term));
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
    removeBtn.innerHTML = REMOVE_BUTTON_SVG;
    removeBtn.addEventListener("click", () => {
      removeTerm(term);
    });

    tag.appendChild(text);
    tag.appendChild(removeBtn);
    return tag;
  }

  function trapFocus(event: KeyboardEvent): void {
    if (event.key !== "Tab") return;

    const focusable = focusableElements(dialogEl);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey) {
      if (document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    } else if (document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  closeBtnEl.addEventListener("click", close);
  cancelBtnEl.addEventListener("click", close);

  saveBtnEl.addEventListener("click", () => {
    commit();
    close();
  });

  resetBtnEl.addEventListener("click", resetToDefaults);

  termsAddBtnEl.addEventListener("click", addTerm);
  termsAddInputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") addTerm();
  });

  backdropEl.addEventListener("click", (event) => {
    if (event.target === backdropEl) close();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) {
      close();
    }
  });

  dialogEl.addEventListener("keydown", trapFocus);

  return { open };
}

function firstFocusable(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}
