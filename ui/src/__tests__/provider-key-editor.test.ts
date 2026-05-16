import { beforeEach, describe, expect, it, vi } from "vitest";

import { createProviderKeyEditor } from "../provider-key-editor.ts";
import type { LlmProvider } from "../types.ts";
import type { StatusField } from "../status-field.ts";

interface Harness {
  inputEl: HTMLInputElement;
  saveBtnEl: HTMLButtonElement;
  labelEl: HTMLElement;
  statusField: StatusField & {
    clear: ReturnType<typeof vi.fn>;
    setSuccess: ReturnType<typeof vi.fn>;
    setError: ReturnType<typeof vi.fn>;
  };
  currentProvider: ReturnType<typeof vi.fn<() => LlmProvider>>;
  hasKey: ReturnType<typeof vi.fn<(provider: LlmProvider) => Promise<boolean>>>;
  saveKey: ReturnType<typeof vi.fn<(provider: LlmProvider, key: string) => Promise<void>>>;
  onSaved: ReturnType<typeof vi.fn<() => void | Promise<void>>>;
  refresh: () => Promise<void>;
}

function buildHarness(overrides: {
  currentProvider?: () => LlmProvider;
  hasKey?: (provider: LlmProvider) => Promise<boolean>;
  saveKey?: (provider: LlmProvider, key: string) => Promise<void>;
} = {}): Harness {
  const inputEl = document.createElement("input");
  const saveBtnEl = document.createElement("button");
  const labelEl = document.createElement("label");
  const statusField = {
    clear: vi.fn(),
    setSuccess: vi.fn(),
    setError: vi.fn(),
  };
  const currentProvider = vi.fn<() => LlmProvider>(
    overrides.currentProvider ?? (() => "xai"),
  );
  const hasKey = vi.fn<(provider: LlmProvider) => Promise<boolean>>(
    overrides.hasKey ?? (async () => false),
  );
  const saveKey = vi.fn<(provider: LlmProvider, key: string) => Promise<void>>(
    overrides.saveKey ?? (async () => {}),
  );
  const onSaved = vi.fn<() => void | Promise<void>>();

  const editor = createProviderKeyEditor({
    inputEl,
    saveBtnEl,
    labelEl,
    statusField,
    currentProvider,
    hasKey,
    saveKey,
    onSaved,
  });

  return {
    inputEl,
    saveBtnEl,
    labelEl,
    statusField,
    currentProvider,
    hasKey,
    saveKey,
    onSaved,
    refresh: () => editor.refresh(),
  };
}

describe("createProviderKeyEditor", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  describe("refresh", () => {
    it("renders the provider-aware label", async () => {
      const harness = buildHarness({ currentProvider: () => "gemini" });

      await harness.refresh();

      expect(harness.labelEl.textContent).toBe("Gemini API key");
    });

    it("re-reads currentProvider each refresh so label tracks live selection", async () => {
      let provider: LlmProvider = "xai";
      const harness = buildHarness({ currentProvider: () => provider });

      await harness.refresh();
      expect(harness.labelEl.textContent).toBe("xAI API key");

      provider = "openai_compatible";
      await harness.refresh();
      expect(harness.labelEl.textContent).toBe("OpenAI-compatible API key");
    });

    it("renders masked placeholder + has-key class when a key is stored", async () => {
      const harness = buildHarness({ hasKey: async () => true });

      await harness.refresh();

      expect(harness.inputEl.placeholder).toBe("••••••••••••••••");
      expect(harness.inputEl.classList.contains("has-key")).toBe(true);
      expect(harness.statusField.setSuccess).toHaveBeenCalledWith("Key loaded.");
    });

    it("renders an empty placeholder + clears has-key class when no key is stored", async () => {
      const harness = buildHarness({ hasKey: async () => false });
      harness.inputEl.classList.add("has-key");

      await harness.refresh();

      expect(harness.inputEl.placeholder).toBe("");
      expect(harness.inputEl.classList.contains("has-key")).toBe(false);
      expect(harness.statusField.setSuccess).not.toHaveBeenCalled();
    });

    it("preserves the placeholder/class state when the hasKey probe rejects", async () => {
      const harness = buildHarness({
        hasKey: async () => {
          throw new Error("network");
        },
      });
      harness.inputEl.placeholder = "preserved";
      harness.inputEl.classList.add("has-key");

      await harness.refresh();

      expect(harness.inputEl.placeholder).toBe("preserved");
      expect(harness.inputEl.classList.contains("has-key")).toBe(true);
    });
  });

  describe("save click", () => {
    it("trims the input, persists via saveKey for the current provider, and clears the field", async () => {
      const harness = buildHarness({ currentProvider: () => "gemini" });
      harness.inputEl.value = "  fresh-gemini-key  ";

      harness.saveBtnEl.click();
      await Promise.resolve();
      await Promise.resolve();

      expect(harness.saveKey).toHaveBeenCalledWith("gemini", "fresh-gemini-key");
      expect(harness.inputEl.value).toBe("");
      expect(harness.inputEl.placeholder).toBe("••••••••••••••••");
      expect(harness.inputEl.classList.contains("has-key")).toBe(true);
      expect(harness.statusField.setSuccess).toHaveBeenCalledWith("API key saved.");
    });

    it("invokes onSaved after a successful persist", async () => {
      const harness = buildHarness();
      harness.inputEl.value = "ok";

      harness.saveBtnEl.click();
      await Promise.resolve();
      await Promise.resolve();

      expect(harness.onSaved).toHaveBeenCalledTimes(1);
    });

    it("surfaces a save failure without flipping has-key state", async () => {
      const harness = buildHarness({
        saveKey: async () => {
          throw new Error("upstream rejected the key");
        },
      });
      harness.inputEl.value = "bad";

      harness.saveBtnEl.click();
      await Promise.resolve();
      await Promise.resolve();

      expect(harness.statusField.setError).toHaveBeenCalledWith(
        "Could not save API key: upstream rejected the key",
      );
      expect(harness.inputEl.classList.contains("has-key")).toBe(false);
      expect(harness.onSaved).not.toHaveBeenCalled();
    });

    it("clears prior status before reporting the save outcome", async () => {
      const harness = buildHarness();
      harness.inputEl.value = "fresh";

      harness.saveBtnEl.click();
      await Promise.resolve();
      await Promise.resolve();

      expect(harness.statusField.clear).toHaveBeenCalled();
    });
  });
});
