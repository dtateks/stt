import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createShortcutRecorder } from "../shortcut-recorder.ts";
import type { StatusField } from "../status-field.ts";

interface Harness {
  buttonEl: HTMLButtonElement;
  resetBtnEl: HTMLButtonElement;
  statusField: StatusField & {
    clear: ReturnType<typeof vi.fn>;
    setSuccess: ReturnType<typeof vi.fn>;
    setError: ReturnType<typeof vi.fn>;
  };
  saveShortcut: ReturnType<typeof vi.fn<(canonical: string) => boolean>>;
  resetSavedShortcut: ReturnType<typeof vi.fn<() => boolean>>;
  applyShortcutAtRuntime: ReturnType<
    typeof vi.fn<(canonical: string) => Promise<string>>
  >;
  onShortcutApplied: ReturnType<typeof vi.fn<(canonical: string) => void>>;
  applyRuntimeShortcut: (canonical: string) => void;
}

function buildHarness(overrides: {
  loadSavedShortcut?: () => string;
  applyShortcutAtRuntime?: (canonical: string) => Promise<string>;
  saveShortcut?: (canonical: string) => boolean;
  resetSavedShortcut?: () => boolean;
} = {}): Harness {
  document.body.innerHTML = "";
  const buttonEl = document.createElement("button");
  const resetBtnEl = document.createElement("button");
  document.body.appendChild(buttonEl);
  document.body.appendChild(resetBtnEl);

  const statusField = {
    clear: vi.fn(),
    setSuccess: vi.fn(),
    setError: vi.fn(),
  };
  const saveShortcut = vi.fn<(canonical: string) => boolean>(
    overrides.saveShortcut ?? (() => true),
  );
  const resetSavedShortcut = vi.fn<() => boolean>(
    overrides.resetSavedShortcut ?? (() => true),
  );
  const applyShortcutAtRuntime = vi.fn<(canonical: string) => Promise<string>>(
    overrides.applyShortcutAtRuntime ?? (async (canonical) => canonical),
  );
  const onShortcutApplied = vi.fn<(canonical: string) => void>();

  const recorder = createShortcutRecorder({
    buttonEl,
    resetBtnEl,
    statusField,
    displayMode: () => "macos",
    loadSavedShortcut: overrides.loadSavedShortcut ?? (() => "Control+Alt+V"),
    saveShortcut,
    resetSavedShortcut,
    applyShortcutAtRuntime,
    onShortcutApplied,
    defaultShortcut: "Control+Alt+V",
  });

  return {
    buttonEl,
    resetBtnEl,
    statusField,
    saveShortcut,
    resetSavedShortcut,
    applyShortcutAtRuntime,
    onShortcutApplied,
    applyRuntimeShortcut: recorder.applyRuntimeShortcut,
  };
}

function fireKey(
  type: "keydown" | "keyup",
  key: string,
): boolean {
  const event = new KeyboardEvent(type, { key, cancelable: true, bubbles: true });
  return document.dispatchEvent(event);
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("createShortcutRecorder", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  describe("idle state", () => {
    it("renders the persisted shortcut on construction", () => {
      const harness = buildHarness({
        loadSavedShortcut: () => "Control+Shift+M",
      });

      expect(harness.buttonEl.dataset.shortcut).toBe("Control+Shift+M");
    });

    it("ignores keydown / keyup while not recording", async () => {
      const harness = buildHarness();
      fireKey("keydown", "K");
      fireKey("keyup", "K");
      await flushMicrotasks();

      expect(harness.applyShortcutAtRuntime).not.toHaveBeenCalled();
    });
  });

  describe("recording lifecycle", () => {
    it("enters recording mode on the first click", () => {
      const harness = buildHarness();

      harness.buttonEl.click();

      expect(harness.buttonEl.classList.contains("is-recording")).toBe(true);
      expect(harness.buttonEl.getAttribute("aria-label")).toBe(
        "Recording shortcut — press key combination",
      );
    });

    it("cancels recording on a second click without persisting", () => {
      const harness = buildHarness({
        loadSavedShortcut: () => "Control+Alt+V",
      });

      harness.buttonEl.click();
      harness.buttonEl.click();

      expect(harness.buttonEl.classList.contains("is-recording")).toBe(false);
      expect(harness.applyShortcutAtRuntime).not.toHaveBeenCalled();
      // Idle render falls back to the persisted shortcut.
      expect(harness.buttonEl.dataset.shortcut).toBe("Control+Alt+V");
    });

    it("captures modifiers + a letter and persists the combo on key release", async () => {
      const harness = buildHarness();
      harness.buttonEl.click(); // enter recording

      fireKey("keydown", "Control");
      fireKey("keydown", "Alt");
      fireKey("keydown", "K");
      fireKey("keyup", "K");
      await flushMicrotasks();

      expect(harness.applyShortcutAtRuntime).toHaveBeenCalledWith("Control+Alt+K");
      expect(harness.saveShortcut).toHaveBeenCalledWith("Control+Alt+K");
      expect(harness.statusField.setSuccess).toHaveBeenCalledWith("Global shortcut saved.");
      // Recording mode exits after the persist starts.
      expect(harness.buttonEl.classList.contains("is-recording")).toBe(false);
    });

    it("aborts recording on Escape without persisting", async () => {
      const harness = buildHarness();
      harness.buttonEl.click();

      fireKey("keydown", "Escape");
      fireKey("keyup", "Escape");
      await flushMicrotasks();

      expect(harness.applyShortcutAtRuntime).not.toHaveBeenCalled();
      expect(harness.buttonEl.classList.contains("is-recording")).toBe(false);
    });

    it("normalizes alias keys to canonical tokens (Option → Alt, Meta → Super)", async () => {
      const harness = buildHarness();
      harness.buttonEl.click();

      fireKey("keydown", "Option");
      fireKey("keydown", "Meta");
      fireKey("keydown", "K");
      fireKey("keyup", "K");
      await flushMicrotasks();

      expect(harness.applyShortcutAtRuntime).toHaveBeenCalledWith("Alt+Super+K");
    });

    it("does not persist when only modifiers are released without a non-modifier", async () => {
      const harness = buildHarness();
      harness.buttonEl.click();

      fireKey("keydown", "Control");
      fireKey("keyup", "Control");
      await flushMicrotasks();

      expect(harness.applyShortcutAtRuntime).not.toHaveBeenCalled();
      // Still in recording mode because nothing completed.
      expect(harness.buttonEl.classList.contains("is-recording")).toBe(true);
    });
  });

  describe("persist failure", () => {
    it("surfaces a runtime apply failure and clears the busy state", async () => {
      const harness = buildHarness({
        applyShortcutAtRuntime: async () => {
          throw new Error("conflict with another app");
        },
      });
      harness.buttonEl.click();

      fireKey("keydown", "Control");
      fireKey("keydown", "K");
      fireKey("keyup", "K");
      await flushMicrotasks();

      expect(harness.statusField.setError).toHaveBeenCalledWith(
        "Could not save shortcut: conflict with another app",
      );
      expect(harness.resetBtnEl.disabled).toBe(false);
    });

    it("warns when local save fails after a successful runtime apply", async () => {
      const harness = buildHarness({
        saveShortcut: () => false,
      });
      harness.buttonEl.click();

      fireKey("keydown", "Control");
      fireKey("keydown", "K");
      fireKey("keyup", "K");
      await flushMicrotasks();

      expect(harness.applyShortcutAtRuntime).toHaveBeenCalled();
      expect(harness.statusField.setError).toHaveBeenCalledWith(
        "Shortcut updated, but local save failed. Storage may be unavailable.",
      );
    });
  });

  describe("reset", () => {
    it("applies the default shortcut at runtime and clears storage", async () => {
      const harness = buildHarness();

      harness.resetBtnEl.click();
      await flushMicrotasks();

      expect(harness.applyShortcutAtRuntime).toHaveBeenCalledWith("Control+Alt+V");
      expect(harness.resetSavedShortcut).toHaveBeenCalled();
      expect(harness.statusField.setSuccess).toHaveBeenCalledWith(
        "Global shortcut reset to default.",
      );
    });

    it("falls back to saving the default when localStorage.removeItem fails", async () => {
      const harness = buildHarness({
        resetSavedShortcut: () => false,
      });

      harness.resetBtnEl.click();
      await flushMicrotasks();

      expect(harness.saveShortcut).toHaveBeenCalledWith("Control+Alt+V");
      expect(harness.statusField.setSuccess).toHaveBeenCalledWith(
        "Global shortcut reset to default.",
      );
    });

    it("reports unavailable storage when both removeItem and save fail", async () => {
      const harness = buildHarness({
        resetSavedShortcut: () => false,
        saveShortcut: () => false,
      });

      harness.resetBtnEl.click();
      await flushMicrotasks();

      expect(harness.statusField.setError).toHaveBeenCalledWith(
        "Shortcut reset, but local storage is unavailable.",
      );
    });

    it("surfaces a runtime apply failure on reset", async () => {
      const harness = buildHarness({
        applyShortcutAtRuntime: async () => {
          throw new Error("permission denied");
        },
      });

      harness.resetBtnEl.click();
      await flushMicrotasks();

      expect(harness.statusField.setError).toHaveBeenCalledWith(
        "Could not reset shortcut: permission denied",
      );
    });
  });

  describe("applyRuntimeShortcut", () => {
    it("renders and broadcasts a runtime-sourced shortcut without touching storage", () => {
      const harness = buildHarness();

      harness.applyRuntimeShortcut("Control+Shift+M");

      expect(harness.buttonEl.dataset.shortcut).toBe("Control+Shift+M");
      expect(harness.onShortcutApplied).toHaveBeenCalledWith("Control+Shift+M");
      expect(harness.saveShortcut).not.toHaveBeenCalled();
      expect(harness.applyShortcutAtRuntime).not.toHaveBeenCalled();
    });
  });
});
