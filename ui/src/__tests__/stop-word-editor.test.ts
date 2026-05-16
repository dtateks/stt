import { beforeEach, describe, expect, it, vi } from "vitest";

import { createStopWordEditor } from "../stop-word-editor.ts";
import type { StatusField } from "../status-field.ts";

interface Harness {
  inputEl: HTMLInputElement;
  resetBtnEl: HTMLButtonElement;
  statusField: StatusField & {
    clear: ReturnType<typeof vi.fn>;
    setSuccess: ReturnType<typeof vi.fn>;
    setError: ReturnType<typeof vi.fn>;
  };
  getDefault: ReturnType<typeof vi.fn<() => string>>;
  load: ReturnType<typeof vi.fn<() => string>>;
  save: ReturnType<typeof vi.fn<(word: string) => boolean>>;
  reset: ReturnType<typeof vi.fn<() => boolean>>;
}

function buildHarness(overrides: Partial<Pick<Harness, "load" | "save" | "reset" | "getDefault">> = {}): Harness {
  const inputEl = document.createElement("input");
  const resetBtnEl = document.createElement("button");
  const statusField = {
    clear: vi.fn(),
    setSuccess: vi.fn(),
    setError: vi.fn(),
  };
  const getDefault = vi.fn<() => string>(overrides.getDefault ?? (() => "thank you"));
  const load = vi.fn<() => string>(overrides.load ?? (() => "stop now"));
  const save = vi.fn<(word: string) => boolean>(overrides.save ?? (() => true));
  const reset = vi.fn<() => boolean>(overrides.reset ?? (() => true));

  createStopWordEditor({
    inputEl,
    resetBtnEl,
    statusField,
    getDefault,
    load,
    save,
    reset,
  });

  return { inputEl, resetBtnEl, statusField, getDefault, load, save, reset };
}

function dispatchEnter(inputEl: HTMLInputElement): boolean {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    cancelable: true,
  });
  inputEl.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("createStopWordEditor", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  describe("applyLoaded", () => {
    it("pushes the persisted value into the input", () => {
      const editorInputEl = document.createElement("input");
      const editorResetBtnEl = document.createElement("button");
      const statusField = {
        clear: vi.fn(),
        setSuccess: vi.fn(),
        setError: vi.fn(),
      };
      const editor = createStopWordEditor({
        inputEl: editorInputEl,
        resetBtnEl: editorResetBtnEl,
        statusField,
        getDefault: () => "thank you",
        load: () => "all done",
        save: () => true,
        reset: () => true,
      });

      editor.applyLoaded();

      expect(editorInputEl.value).toBe("all done");
    });
  });

  describe("save on blur", () => {
    it("trims the input and persists on blur", () => {
      const { inputEl, save, statusField } = buildHarness();
      inputEl.value = "  finish up  ";

      inputEl.dispatchEvent(new FocusEvent("blur"));

      expect(save).toHaveBeenCalledWith("finish up");
      expect(inputEl.value).toBe("finish up");
      expect(statusField.setSuccess).toHaveBeenCalledWith("Stop word saved.");
    });

    it("rejects an empty/whitespace-only value", () => {
      const { inputEl, save, statusField } = buildHarness();
      inputEl.value = "    ";

      inputEl.dispatchEvent(new FocusEvent("blur"));

      expect(save).not.toHaveBeenCalled();
      expect(statusField.setError).toHaveBeenCalledWith("Stop word cannot be empty.");
    });

    it("surfaces a storage failure without clobbering the input", () => {
      const { inputEl, statusField } = buildHarness({
        save: () => false,
      });
      inputEl.value = "ok";

      inputEl.dispatchEvent(new FocusEvent("blur"));

      expect(statusField.setError).toHaveBeenCalledWith(
        "Could not save stop word. Storage may be unavailable.",
      );
      expect(statusField.setSuccess).not.toHaveBeenCalled();
    });

    it("clears prior status before reporting a new outcome", () => {
      const { inputEl, statusField } = buildHarness();
      inputEl.value = "finish";

      inputEl.dispatchEvent(new FocusEvent("blur"));

      expect(statusField.clear).toHaveBeenCalled();
      expect(statusField.clear.mock.invocationCallOrder[0]).toBeLessThan(
        statusField.setSuccess.mock.invocationCallOrder[0],
      );
    });
  });

  describe("save on Enter keydown", () => {
    it("persists on Enter and prevents the default form submission", () => {
      const { inputEl, save } = buildHarness();
      inputEl.value = "halt";

      const prevented = dispatchEnter(inputEl);

      expect(prevented).toBe(true);
      expect(save).toHaveBeenCalledWith("halt");
    });

    it("ignores non-Enter keys", () => {
      const { inputEl, save } = buildHarness();
      inputEl.value = "halt";

      inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "a", cancelable: true }));

      expect(save).not.toHaveBeenCalled();
    });
  });

  describe("reset click", () => {
    it("clears storage and rewrites the input with the current default", () => {
      const { inputEl, resetBtnEl, reset, statusField, getDefault } = buildHarness({
        getDefault: () => "thank you",
      });
      inputEl.value = "custom";

      resetBtnEl.dispatchEvent(new MouseEvent("click"));

      expect(reset).toHaveBeenCalled();
      expect(getDefault).toHaveBeenCalled();
      expect(inputEl.value).toBe("thank you");
      expect(statusField.setSuccess).toHaveBeenCalledWith("Stop word reset to default.");
    });

    it("surfaces a storage failure on reset", () => {
      const { resetBtnEl, statusField } = buildHarness({
        reset: () => false,
      });

      resetBtnEl.dispatchEvent(new MouseEvent("click"));

      expect(statusField.setError).toHaveBeenCalledWith(
        "Could not reset stop word. Storage may be unavailable.",
      );
      expect(statusField.setSuccess).not.toHaveBeenCalled();
    });

    it("re-reads getDefault on every reset so runtime hydration is honored", () => {
      let bundled = "thank you";
      const { inputEl, resetBtnEl } = buildHarness({
        getDefault: () => bundled,
      });
      inputEl.value = "first";

      resetBtnEl.dispatchEvent(new MouseEvent("click"));
      expect(inputEl.value).toBe("thank you");

      bundled = "all set"; // simulate hydrateRuntimeDefaults landing late
      inputEl.value = "second";
      resetBtnEl.dispatchEvent(new MouseEvent("click"));
      expect(inputEl.value).toBe("all set");
    });
  });
});
