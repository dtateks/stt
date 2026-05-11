/**
 * Model picker bound to a `<select>` + refresh button + status line.
 *
 * Concentrates the fetch/select/populate/loading/placeholder dance shared
 * by the Soniox realtime model row and the LLM model row in the main
 * settings panel. Each row just describes its bridge call, persistence,
 * default, and copy; the picker owns the rest.
 *
 * Selection rules (preserved from the previous inline implementation):
 *   1. Saved model wins if still in the fetched list.
 *   2. Else the configured default model wins if still in the list.
 *   3. Else fall back to `models[0]` UNLESS the configured default is
 *      `null` — that is the "no auto-pick" convention used by the
 *      OpenAI-compatible provider. In that case we leave the selection
 *      empty and render the `chooseModelPlaceholder`.
 *   4. Empty fetch results raise `"No models returned from provider."`
 *      so the status field surfaces it and the initial placeholder
 *      replaces the dropdown.
 */
import type { StatusField } from "./status-field.ts";

export interface ModelPickerCopy {
  /** Status line shown while the fetch is in flight. */
  fetching: string;
  /** Status line shown after a successful fetch with `count` models. */
  loaded: (count: number) => string;
  /** Disabled placeholder shown before any fetch attempt or after a fetch error. */
  initialPlaceholder: string;
  /** Disabled placeholder shown above the option list when no model can be auto-picked. */
  chooseModelPlaceholder: string;
}

export interface ModelPickerOptions {
  selectEl: HTMLSelectElement;
  fetchBtn: HTMLButtonElement;
  statusField: StatusField;
  fetchModels: () => Promise<string[]>;
  loadSavedModel: () => string | null;
  saveModel: (model: string) => void;
  /** Returns the configured default model; `null` disables auto-pick. */
  defaultModel: () => string | null;
  copy: ModelPickerCopy;
}

export interface ModelPicker {
  fetch(): Promise<void>;
  showInitialPlaceholder(): void;
}

export function createModelPicker(opts: ModelPickerOptions): ModelPicker {
  const {
    selectEl,
    fetchBtn,
    statusField,
    fetchModels,
    loadSavedModel,
    saveModel,
    defaultModel,
    copy,
  } = opts;

  function setLoading(loading: boolean): void {
    fetchBtn.disabled = loading;
    fetchBtn.classList.toggle("is-loading", loading);
  }

  function showInitialPlaceholder(): void {
    selectEl.innerHTML = "";
    const option = document.createElement("option");
    option.value = "";
    option.textContent = copy.initialPlaceholder;
    option.disabled = true;
    option.selected = true;
    selectEl.appendChild(option);
  }

  function pickSelectedModel(
    models: string[],
    saved: string | null,
    fallbackDefault: string | null,
  ): string | null {
    if (saved && models.includes(saved)) {
      return saved;
    }
    if (fallbackDefault && models.includes(fallbackDefault)) {
      return fallbackDefault;
    }
    if (fallbackDefault === null) {
      return null;
    }
    return models[0];
  }

  function populateSelect(models: string[], selected: string | null): void {
    selectEl.innerHTML = "";

    if (selected === null) {
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = copy.chooseModelPlaceholder;
      placeholder.disabled = true;
      placeholder.selected = true;
      selectEl.appendChild(placeholder);
    }

    for (const model of models) {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      if (model === selected) {
        option.selected = true;
      }
      selectEl.appendChild(option);
    }
  }

  async function fetch(): Promise<void> {
    statusField.clear();
    setLoading(true);
    statusField.setSuccess(copy.fetching);

    try {
      const models = await fetchModels();
      if (models.length === 0) {
        throw new Error("No models returned from provider.");
      }

      const saved = loadSavedModel();
      const selected = pickSelectedModel(models, saved, defaultModel());
      populateSelect(models, selected);
      if (selected !== null) {
        saveModel(selected);
      }
      statusField.setSuccess(copy.loaded(models.length));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      statusField.setError(message);
      showInitialPlaceholder();
    } finally {
      setLoading(false);
    }
  }

  return { fetch, showInitialPlaceholder };
}
