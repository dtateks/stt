/**
 * Provider API key editor (xAI / Gemini / OpenAI-compatible).
 *
 * Owns the per-provider key-input lifecycle:
 *   - label sync ("xAI API key" / "Gemini API key" / …) tied to the
 *     currently selected provider, sourced from `providerLabel` in
 *     `llm-provider.ts` so the catalogue stays the single source of
 *     truth
 *   - has-key placeholder + class state (mask vs empty)
 *   - save click → bridge `saveKey` → status feedback → `onSaved`
 *     callback (model-picker fetch lives at the call site)
 *
 * `refresh()` is the only public seam: callers invoke it after the
 * selected provider changes and after a session-wide key-state refresh.
 * The factory binds the save click listener once at construction.
 *
 * Bridge access flows through `hasKey` / `saveKey` callbacks rather than
 * direct catalogue calls so the factory stays bridge-agnostic and is
 * trivial to fake in tests — same pattern as createUpdateBanner /
 * createPermissionBanner / createSettingsDialog.
 */
import type { LlmProvider } from "./types.ts";
import { providerLabel } from "./llm-provider.ts";
import type { StatusField } from "./status-field.ts";

const MASKED_KEY_PLACEHOLDER = "••••••••••••••••";
const KEY_LOADED_STATUS = "Key loaded.";
const KEY_SAVED_STATUS = "API key saved.";

export interface ProviderKeyEditorOptions {
  inputEl: HTMLInputElement;
  saveBtnEl: HTMLButtonElement;
  labelEl: HTMLElement;
  statusField: StatusField;
  /** Returns the currently selected provider — re-read every render. */
  currentProvider: () => LlmProvider;
  /** Bridge call: does this provider have a stored API key? */
  hasKey: (provider: LlmProvider) => Promise<boolean>;
  /** Bridge call: persist a new key for this provider. */
  saveKey: (provider: LlmProvider, key: string) => Promise<void>;
  /** Fired after a successful save (e.g. trigger model-picker fetch). */
  onSaved: () => void | Promise<void>;
}

export interface ProviderKeyEditor {
  /**
   * Re-render the label and re-read the bridge's has-key state.
   * Call after a provider change or a wider key-state refresh.
   */
  refresh(): Promise<void>;
}

export function createProviderKeyEditor(options: ProviderKeyEditorOptions): ProviderKeyEditor {
  const { inputEl, saveBtnEl, labelEl, statusField, currentProvider, hasKey, saveKey, onSaved } =
    options;

  function applyHasKeyState(present: boolean): void {
    if (present) {
      inputEl.placeholder = MASKED_KEY_PLACEHOLDER;
      inputEl.classList.add("has-key");
    } else {
      inputEl.placeholder = "";
      inputEl.classList.remove("has-key");
    }
  }

  function syncLabel(): void {
    labelEl.textContent = `${providerLabel(currentProvider())} API key`;
  }

  async function handleSave(): Promise<void> {
    statusField.clear();
    const provider = currentProvider();
    const key = inputEl.value.trim();

    try {
      await saveKey(provider, key);
      inputEl.value = "";
      applyHasKeyState(true);
      statusField.setSuccess(KEY_SAVED_STATUS);
      await Promise.resolve(onSaved());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      statusField.setError(`Could not save API key: ${message}`);
    }
  }

  async function refresh(): Promise<void> {
    syncLabel();
    try {
      const present = await hasKey(currentProvider());
      applyHasKeyState(present);
      if (present) {
        statusField.setSuccess(KEY_LOADED_STATUS);
      }
    } catch {
      // Key check failed — leave the placeholder/class state as-is.
    }
  }

  saveBtnEl.addEventListener("click", () => {
    void handleSave();
  });

  return { refresh };
}
