import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
  DEFAULT_XAI_MODEL,
  GEMINI_PROVIDER,
  OPENAI_COMPATIBLE_PROVIDER,
  XAI_PROVIDER,
  defaultModelForProvider,
  hasProviderKey,
  providerLabel,
  updateProviderKey,
} from "../llm-provider.ts";
import type { VoiceToTextBridge } from "../types.ts";

function bridgeStub(): VoiceToTextBridge {
  return {
    hasXaiKey: vi.fn(async () => true),
    hasGeminiKey: vi.fn(async () => true),
    hasOpenaiCompatibleKey: vi.fn(async () => true),
    updateXaiKey: vi.fn(async () => {}),
    updateGeminiKey: vi.fn(async () => {}),
    updateOpenaiCompatibleKey: vi.fn(async () => {}),
  } as unknown as VoiceToTextBridge;
}

describe("llm-provider catalogue", () => {
  describe("provider id constants", () => {
    it("exports the wire-format ids", () => {
      expect(XAI_PROVIDER).toBe("xai");
      expect(GEMINI_PROVIDER).toBe("gemini");
      expect(OPENAI_COMPATIBLE_PROVIDER).toBe("openai_compatible");
    });
  });

  describe("defaultModelForProvider", () => {
    it("returns the bundled xAI default model", () => {
      expect(defaultModelForProvider(XAI_PROVIDER)).toBe(DEFAULT_XAI_MODEL);
    });

    it("returns the bundled Gemini default model", () => {
      expect(defaultModelForProvider(GEMINI_PROVIDER)).toBe(DEFAULT_GEMINI_MODEL);
    });

    it("returns null for OpenAI-compatible (no auto-pick convention)", () => {
      expect(defaultModelForProvider(OPENAI_COMPATIBLE_PROVIDER)).toBeNull();
    });
  });

  describe("providerLabel", () => {
    it("returns 'xAI' for xai", () => {
      expect(providerLabel(XAI_PROVIDER)).toBe("xAI");
    });

    it("returns 'Gemini' for gemini", () => {
      expect(providerLabel(GEMINI_PROVIDER)).toBe("Gemini");
    });

    it("returns 'OpenAI-compatible' for openai_compatible", () => {
      expect(providerLabel(OPENAI_COMPATIBLE_PROVIDER)).toBe("OpenAI-compatible");
    });
  });

  describe("hasProviderKey", () => {
    it("dispatches to bridge.hasXaiKey for xai", async () => {
      const bridge = bridgeStub();
      bridge.hasXaiKey = vi.fn(async () => true);

      await hasProviderKey(bridge, XAI_PROVIDER);

      expect(bridge.hasXaiKey).toHaveBeenCalled();
      expect(bridge.hasGeminiKey).not.toHaveBeenCalled();
      expect(bridge.hasOpenaiCompatibleKey).not.toHaveBeenCalled();
    });

    it("dispatches to bridge.hasGeminiKey for gemini", async () => {
      const bridge = bridgeStub();
      bridge.hasGeminiKey = vi.fn(async () => true);

      await hasProviderKey(bridge, GEMINI_PROVIDER);

      expect(bridge.hasGeminiKey).toHaveBeenCalled();
      expect(bridge.hasXaiKey).not.toHaveBeenCalled();
    });

    it("dispatches to bridge.hasOpenaiCompatibleKey for openai_compatible", async () => {
      const bridge = bridgeStub();
      bridge.hasOpenaiCompatibleKey = vi.fn(async () => true);

      await hasProviderKey(bridge, OPENAI_COMPATIBLE_PROVIDER);

      expect(bridge.hasOpenaiCompatibleKey).toHaveBeenCalled();
      expect(bridge.hasXaiKey).not.toHaveBeenCalled();
    });

    it("propagates the boolean returned by the bridge", async () => {
      const bridge = bridgeStub();
      bridge.hasXaiKey = vi.fn(async () => false);

      await expect(hasProviderKey(bridge, XAI_PROVIDER)).resolves.toBe(false);
    });
  });

  describe("updateProviderKey", () => {
    it("dispatches to bridge.updateXaiKey for xai with the given key", async () => {
      const bridge = bridgeStub();

      await updateProviderKey(bridge, XAI_PROVIDER, "xai-new-key");

      expect(bridge.updateXaiKey).toHaveBeenCalledWith("xai-new-key");
      expect(bridge.updateGeminiKey).not.toHaveBeenCalled();
      expect(bridge.updateOpenaiCompatibleKey).not.toHaveBeenCalled();
    });

    it("dispatches to bridge.updateGeminiKey for gemini", async () => {
      const bridge = bridgeStub();

      await updateProviderKey(bridge, GEMINI_PROVIDER, "gemini-new-key");

      expect(bridge.updateGeminiKey).toHaveBeenCalledWith("gemini-new-key");
    });

    it("dispatches to bridge.updateOpenaiCompatibleKey for openai_compatible", async () => {
      const bridge = bridgeStub();

      await updateProviderKey(bridge, OPENAI_COMPATIBLE_PROVIDER, "oc-new-key");

      expect(bridge.updateOpenaiCompatibleKey).toHaveBeenCalledWith("oc-new-key");
    });
  });

  describe("DEFAULT_OPENAI_COMPATIBLE_BASE_URL", () => {
    it("is the OpenAI v1 endpoint, used as the fallback base URL", () => {
      expect(DEFAULT_OPENAI_COMPATIBLE_BASE_URL).toBe("https://api.openai.com/v1");
    });
  });
});
