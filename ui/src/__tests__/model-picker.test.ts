import { beforeEach, describe, expect, it, vi } from "vitest";

import { createModelPicker, type ModelPicker, type ModelPickerCopy } from "../model-picker.ts";
import type { StatusField } from "../status-field.ts";

const COPY: ModelPickerCopy = {
  fetching: "Fetching…",
  loaded: (count) => `Loaded ${count} models.`,
  initialPlaceholder: "Click refresh to load models",
  chooseModelPlaceholder: "Choose a model",
};

interface Harness {
  picker: ModelPicker;
  selectEl: HTMLSelectElement;
  fetchBtn: HTMLButtonElement;
  statusField: StatusField & {
    clear: ReturnType<typeof vi.fn>;
    setSuccess: ReturnType<typeof vi.fn>;
    setError: ReturnType<typeof vi.fn>;
  };
  fetchModels: ReturnType<typeof vi.fn<() => Promise<string[]>>>;
  loadSavedModel: ReturnType<typeof vi.fn<() => string | null>>;
  saveModel: ReturnType<typeof vi.fn<(model: string) => void>>;
  defaultModel: ReturnType<typeof vi.fn<() => string | null>>;
}

function buildHarness(overrides: {
  fetchModels?: () => Promise<string[]>;
  loadSavedModel?: () => string | null;
  defaultModel?: () => string | null;
} = {}): Harness {
  const selectEl = document.createElement("select");
  const fetchBtn = document.createElement("button");
  const statusField = {
    clear: vi.fn(),
    setSuccess: vi.fn(),
    setError: vi.fn(),
  };
  const fetchModels = vi.fn(overrides.fetchModels ?? (async () => ["alpha", "beta"]));
  const loadSavedModel = vi.fn(overrides.loadSavedModel ?? (() => null));
  const saveModel = vi.fn<(model: string) => void>();
  const defaultModel = vi.fn(overrides.defaultModel ?? (() => null));

  const picker = createModelPicker({
    selectEl,
    fetchBtn,
    statusField,
    fetchModels,
    loadSavedModel,
    saveModel,
    defaultModel,
    copy: COPY,
  });

  return {
    picker,
    selectEl,
    fetchBtn,
    statusField,
    fetchModels,
    loadSavedModel,
    saveModel,
    defaultModel,
  };
}

function optionValues(selectEl: HTMLSelectElement): string[] {
  return Array.from(selectEl.options).map((option) => option.value);
}

describe("createModelPicker", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  describe("showInitialPlaceholder", () => {
    it("renders one disabled placeholder option with the initial copy", () => {
      const { picker, selectEl } = buildHarness();

      picker.showInitialPlaceholder();

      expect(selectEl.options).toHaveLength(1);
      expect(selectEl.options[0].textContent).toBe(COPY.initialPlaceholder);
      expect(selectEl.options[0].disabled).toBe(true);
      expect(selectEl.options[0].selected).toBe(true);
    });

    it("replaces any existing options on subsequent calls", () => {
      const { picker, selectEl } = buildHarness();

      const stray = document.createElement("option");
      stray.value = "stale";
      selectEl.appendChild(stray);
      expect(selectEl.options).toHaveLength(1);

      picker.showInitialPlaceholder();

      expect(selectEl.options).toHaveLength(1);
      expect(selectEl.options[0].value).toBe("");
    });
  });

  describe("fetch — selection rules", () => {
    it("selects the saved model when it appears in the fetched list", async () => {
      const { picker, selectEl, saveModel } = buildHarness({
        loadSavedModel: () => "beta",
        defaultModel: () => "alpha",
      });

      await picker.fetch();

      expect(selectEl.value).toBe("beta");
      expect(saveModel).toHaveBeenCalledWith("beta");
    });

    it("falls back to the configured default when no saved model is present", async () => {
      const { picker, selectEl, saveModel } = buildHarness({
        loadSavedModel: () => null,
        defaultModel: () => "beta",
      });

      await picker.fetch();

      expect(selectEl.value).toBe("beta");
      expect(saveModel).toHaveBeenCalledWith("beta");
    });

    it("falls back to the configured default when the saved model is no longer offered", async () => {
      const { picker, selectEl, saveModel } = buildHarness({
        loadSavedModel: () => "obsolete",
        defaultModel: () => "alpha",
      });

      await picker.fetch();

      expect(selectEl.value).toBe("alpha");
      expect(saveModel).toHaveBeenCalledWith("alpha");
    });

    it("falls back to the first model when neither saved nor default match the list", async () => {
      const { picker, selectEl, saveModel } = buildHarness({
        loadSavedModel: () => "obsolete",
        defaultModel: () => "also-obsolete",
      });

      await picker.fetch();

      expect(selectEl.value).toBe("alpha");
      expect(saveModel).toHaveBeenCalledWith("alpha");
    });

    it("leaves selection empty with a choose-a-model placeholder when defaultModel is null", async () => {
      const { picker, selectEl, saveModel } = buildHarness({
        loadSavedModel: () => null,
        defaultModel: () => null, // "no auto-pick" convention (OpenAI-compatible)
      });

      await picker.fetch();

      expect(selectEl.value).toBe("");
      expect(selectEl.options[0].textContent).toBe(COPY.chooseModelPlaceholder);
      expect(selectEl.options[0].disabled).toBe(true);
      expect(optionValues(selectEl)).toEqual(["", "alpha", "beta"]);
      expect(saveModel).not.toHaveBeenCalled();
    });
  });

  describe("fetch — loading + status feedback", () => {
    it("disables the refresh button while the fetch is in flight", async () => {
      let resolve: (models: string[]) => void = () => {};
      const harness = buildHarness({
        fetchModels: () =>
          new Promise<string[]>((r) => {
            resolve = r;
          }),
      });

      const inFlight = harness.picker.fetch();
      expect(harness.fetchBtn.disabled).toBe(true);
      expect(harness.fetchBtn.classList.contains("is-loading")).toBe(true);

      resolve(["alpha"]);
      await inFlight;

      expect(harness.fetchBtn.disabled).toBe(false);
      expect(harness.fetchBtn.classList.contains("is-loading")).toBe(false);
    });

    it("emits fetching → loaded status on success", async () => {
      const { picker, statusField } = buildHarness();

      await picker.fetch();

      expect(statusField.clear).toHaveBeenCalled();
      expect(statusField.setSuccess).toHaveBeenCalledWith(COPY.fetching);
      expect(statusField.setSuccess).toHaveBeenLastCalledWith("Loaded 2 models.");
      expect(statusField.setError).not.toHaveBeenCalled();
    });
  });

  describe("fetch — error handling", () => {
    it("renders the initial placeholder and surfaces the error when the bridge rejects", async () => {
      const { picker, selectEl, statusField, saveModel } = buildHarness({
        fetchModels: async () => {
          throw new Error("upstream is down");
        },
      });

      await picker.fetch();

      expect(statusField.setError).toHaveBeenCalledWith("upstream is down");
      expect(selectEl.options).toHaveLength(1);
      expect(selectEl.options[0].textContent).toBe(COPY.initialPlaceholder);
      expect(saveModel).not.toHaveBeenCalled();
    });

    it("renders the initial placeholder when the bridge returns an empty list", async () => {
      const { picker, selectEl, statusField, saveModel } = buildHarness({
        fetchModels: async () => [],
      });

      await picker.fetch();

      expect(statusField.setError).toHaveBeenCalledWith("No models returned from provider.");
      expect(selectEl.options[0].textContent).toBe(COPY.initialPlaceholder);
      expect(saveModel).not.toHaveBeenCalled();
    });

    it("restores the refresh button even when fetch throws", async () => {
      const { picker, fetchBtn } = buildHarness({
        fetchModels: async () => {
          throw new Error("boom");
        },
      });

      await picker.fetch();

      expect(fetchBtn.disabled).toBe(false);
      expect(fetchBtn.classList.contains("is-loading")).toBe(false);
    });
  });
});
