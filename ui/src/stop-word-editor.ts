/**
 * Stop word editor.
 *
 * Owns the small "edit the wake-stop phrase" form on the settings panel:
 *   - blur-save (input loses focus → trim + persist)
 *   - Enter key (preventDefault + same trim+persist path)
 *   - reset-click (clear storage → reload bundled default → status)
 *   - status-field surface for save / reset feedback (success copy
 *     auto-clears via the bound `statusField`)
 *
 * Storage I/O flows through caller-supplied callbacks (`load` / `save` /
 * `reset`) so the factory stays bridge-agnostic — same pattern as
 * `createProviderKeyEditor` / `createSettingsDialog`. Bridge surface is
 * zero (everything is `localStorage` via `ui/src/storage.ts`).
 *
 * `getDefault` is a getter rather than a constant because the runtime
 * default (`config.voice.stop_word`) hydrates from
 * `hydrateRuntimeDefaults` AFTER the factory is constructed in
 * `main.ts`. Pass-by-closure resolves the timing.
 *
 * `applyLoaded()` re-reads the persisted value with the current
 * `getDefault` fallback and pushes it into the input — `loadPrefsUI`
 * calls it on every prefs reload to honor any default change since the
 * last render.
 */
import type { StatusField } from "./status-field.ts";

const SAVED_MESSAGE = "Stop word saved.";
const RESET_MESSAGE = "Stop word reset to default.";
const EMPTY_ERROR_MESSAGE = "Stop word cannot be empty.";
const SAVE_STORAGE_ERROR_MESSAGE = "Could not save stop word. Storage may be unavailable.";
const RESET_STORAGE_ERROR_MESSAGE = "Could not reset stop word. Storage may be unavailable.";

export interface StopWordEditorOptions {
  inputEl: HTMLInputElement;
  resetBtnEl: HTMLButtonElement;
  statusField: StatusField;
  /** Returns the current bundled-config default — re-read at every load. */
  getDefault: () => string;
  /** Returns the persisted value, falling back to `getDefault()`. */
  load: () => string;
  /** Persist trimmed value; return false on storage failure. */
  save: (word: string) => boolean;
  /** Clear persisted value; return false on storage failure. */
  reset: () => boolean;
}

export interface StopWordEditor {
  /** Push the persisted (or default-fallback) value into the input. */
  applyLoaded(): void;
}

export function createStopWordEditor(options: StopWordEditorOptions): StopWordEditor {
  const { inputEl, resetBtnEl, statusField, getDefault, load, save, reset } = options;

  function handleSave(): void {
    statusField.clear();
    const stopWord = inputEl.value.trim();
    if (!stopWord) {
      statusField.setError(EMPTY_ERROR_MESSAGE);
      return;
    }

    if (!save(stopWord)) {
      statusField.setError(SAVE_STORAGE_ERROR_MESSAGE);
      return;
    }

    inputEl.value = stopWord;
    statusField.setSuccess(SAVED_MESSAGE);
  }

  function handleReset(): void {
    statusField.clear();
    if (!reset()) {
      statusField.setError(RESET_STORAGE_ERROR_MESSAGE);
      return;
    }

    inputEl.value = getDefault();
    statusField.setSuccess(RESET_MESSAGE);
  }

  inputEl.addEventListener("blur", handleSave);
  inputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSave();
    }
  });
  resetBtnEl.addEventListener("click", handleReset);

  return {
    applyLoaded(): void {
      inputEl.value = load();
    },
  };
}
