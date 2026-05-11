/**
 * Global mic-toggle shortcut recorder.
 *
 * Owns the full record-then-save lifecycle for the settings panel button:
 *   - press-and-hold key capture (modifiers + non-modifier completes the
 *     combo, Escape cancels)
 *   - canonical-string assembly + render via the pure
 *     `shortcut-recorder-logic` helper
 *   - bridge round-trip (`updateMicToggleShortcut`) + local persistence
 *     (`saveMicToggleShortcutPreference` / `resetMicToggleShortcutPreference`)
 *   - status-line feedback through the bound `statusField`
 *   - downstream notification (`onShortcutApplied`) so callers can keep the
 *     ready-card label in sync without reaching into recorder state
 *
 * Pure render + escape-mapping helpers stay in `shortcut-recorder-logic.ts`
 * so the orchestration here is the only place that touches the bridge,
 * storage, or document listeners. Match `createModelPicker` /
 * `TemporaryApiKeyCache` / `statusField`: callers describe their wiring,
 * the factory owns the rest.
 *
 * Document-level keydown/keyup listeners are registered once at creation
 * and never removed — single-page-app lifetime, mirroring the legacy
 * `bindShortcutRecorder` semantics.
 */
import type { ShortcutDisplayMode } from "./shortcut-display.ts";
import { renderShortcutRecorderState } from "./shortcut-recorder-logic.ts";
import type { StatusField } from "./status-field.ts";

export interface ShortcutRecorderOptions {
  buttonEl: HTMLButtonElement;
  resetBtnEl: HTMLButtonElement;
  statusField: StatusField;
  /** Returns the current display mode each time the recorder renders. */
  displayMode: () => ShortcutDisplayMode;
  loadSavedShortcut: () => string;
  saveShortcut: (canonical: string) => boolean;
  resetSavedShortcut: () => boolean;
  /** Bridge call that registers the shortcut globally; returns the runtime value. */
  applyShortcutAtRuntime: (canonical: string) => Promise<string>;
  /** Notified after a runtime apply succeeds (e.g. ready-card label sync). */
  onShortcutApplied: (canonical: string) => void;
  /** Canonical default — used by the reset path. */
  defaultShortcut: string;
}

export interface ShortcutRecorder {
  /**
   * Render and broadcast a shortcut sourced from the runtime (post-bridge
   * sync, post-load) — the single seam callers use after a successful
   * `getMicToggleShortcut` lookup.
   */
  applyRuntimeShortcut(canonical: string): void;
}

const MODIFIER_KEYS: ReadonlyArray<string> = ["Control", "Alt", "Shift", "Super"];
const MODIFIER_KEY_SET: ReadonlySet<string> = new Set(MODIFIER_KEYS);
const KEY_NORMALIZATION: Readonly<Record<string, string>> = {
  Control: "Control",
  Ctrl: "Control",
  Alt: "Alt",
  Option: "Alt",
  Shift: "Shift",
  Meta: "Super",
  Command: "Super",
  Cmd: "Super",
  Super: "Super",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
};
const PLACEHOLDER_PROMPT = "Press keys…";
const RECORDING_ARIA_LABEL = "Recording shortcut — press key combination";
const IDLE_ARIA_LABEL = "Global mic toggle shortcut — click to record";
const SHORTCUT_UPDATED_LOCAL_SAVE_FAILED =
  "Shortcut updated, but local save failed. Storage may be unavailable.";
const SHORTCUT_RESET_LOCAL_STORAGE_UNAVAILABLE =
  "Shortcut reset, but local storage is unavailable.";
const SHORTCUT_SAVED = "Global shortcut saved.";
const SHORTCUT_RESET_TO_DEFAULT = "Global shortcut reset to default.";

export function createShortcutRecorder(options: ShortcutRecorderOptions): ShortcutRecorder {
  const {
    buttonEl,
    resetBtnEl,
    statusField,
    displayMode,
    loadSavedShortcut,
    saveShortcut,
    resetSavedShortcut,
    applyShortcutAtRuntime,
    onShortcutApplied,
    defaultShortcut,
  } = options;

  let isRecording = false;
  const modifiers = new Set<string>();
  const keys = new Set<string>();

  function renderShortcut(canonical: string): void {
    renderShortcutRecorderState(buttonEl, canonical, displayMode());
  }

  function setBusy(busy: boolean): void {
    resetBtnEl.disabled = busy;
  }

  function clearRecordedKeys(): void {
    modifiers.clear();
    keys.clear();
  }

  function startRecording(): void {
    isRecording = true;
    clearRecordedKeys();
    buttonEl.classList.add("is-recording");
    buttonEl.setAttribute("aria-label", RECORDING_ARIA_LABEL);
    renderShortcut("");
  }

  function stopRecording(): void {
    isRecording = false;
    buttonEl.classList.remove("is-recording");
    buttonEl.setAttribute("aria-label", IDLE_ARIA_LABEL);
    renderShortcut(loadSavedShortcut());
  }

  function buildShortcutString(): string {
    const sortedModifiers = MODIFIER_KEYS.filter((modifier) => modifiers.has(modifier));
    return [...sortedModifiers, ...keys].join("+");
  }

  function renderInProgressShortcut(): void {
    const shortcut = buildShortcutString();
    renderShortcut(shortcut || PLACEHOLDER_PROMPT);
  }

  async function persistRecordedShortcut(shortcut: string): Promise<void> {
    setBusy(true);
    try {
      const runtimeShortcut = await applyShortcutAtRuntime(shortcut);
      renderShortcut(runtimeShortcut);
      onShortcutApplied(runtimeShortcut);

      if (!saveShortcut(runtimeShortcut)) {
        statusField.setError(SHORTCUT_UPDATED_LOCAL_SAVE_FAILED);
        return;
      }

      statusField.setSuccess(SHORTCUT_SAVED);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      statusField.setError(`Could not save shortcut: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  async function resetShortcutToDefault(): Promise<void> {
    statusField.clear();
    setBusy(true);
    try {
      const runtimeShortcut = await applyShortcutAtRuntime(defaultShortcut);
      renderShortcut(runtimeShortcut);
      onShortcutApplied(runtimeShortcut);

      if (!resetSavedShortcut()) {
        if (!saveShortcut(runtimeShortcut)) {
          statusField.setError(SHORTCUT_RESET_LOCAL_STORAGE_UNAVAILABLE);
          return;
        }
      }

      statusField.setSuccess(SHORTCUT_RESET_TO_DEFAULT);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      statusField.setError(`Could not reset shortcut: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();

    const key = normalizeKey(event.key);
    if (MODIFIER_KEY_SET.has(key)) {
      modifiers.add(key);
    } else if (key !== "Unidentified") {
      keys.add(key);
    }

    renderInProgressShortcut();
  }

  function handleKeyUp(event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();

    const key = normalizeKey(event.key);
    if (MODIFIER_KEY_SET.has(key)) {
      modifiers.delete(key);
    }

    if (event.key === "Escape") {
      stopRecording();
      return;
    }

    if (!MODIFIER_KEY_SET.has(key) && keys.size > 0) {
      const shortcut = buildShortcutString();
      if (shortcut) {
        stopRecording();
        renderShortcut(shortcut);
        void persistRecordedShortcut(shortcut);
      }
    }
  }

  buttonEl.addEventListener("click", () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  });

  resetBtnEl.addEventListener("click", () => {
    void resetShortcutToDefault();
  });

  document.addEventListener(
    "keydown",
    (event) => {
      if (!isRecording) return;
      handleKeyDown(event);
    },
    { capture: true },
  );

  document.addEventListener(
    "keyup",
    (event) => {
      if (!isRecording) return;
      handleKeyUp(event);
    },
    { capture: true },
  );

  // Initial render reflects the persisted value so the button is never
  // blank on first paint, before any runtime sync resolves.
  renderShortcut(loadSavedShortcut());

  return {
    applyRuntimeShortcut(canonical) {
      renderShortcut(canonical);
      onShortcutApplied(canonical);
    },
  };
}

function normalizeKey(key: string): string {
  return KEY_NORMALIZATION[key] ?? key;
}
