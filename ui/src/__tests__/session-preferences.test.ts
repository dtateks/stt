import { beforeEach, describe, expect, it } from "vitest";

import {
  createActiveSessionPreferences,
  DEFAULT_SONIOX_MODEL,
  resolveLlmRequestOptions,
  resolveSonioxConfigForSession,
} from "../session-preferences.ts";
import type { AppConfig, UserPreferences } from "../types.ts";

const BASE_CONFIG: AppConfig = {
  soniox: {
    ws_url: "wss://stt-rt.soniox.com/transcribe-websocket",
    model: "stt-rt-v4",
    sample_rate: 16_000,
    num_channels: 1,
    audio_format: "pcm_s16le",
    chunk_size: 4_096,
  },
  llm: {
    provider: "xai",
    model: "grok-4-1-fast-non-reasoning",
    temperature: 0.1,
    base_url: "https://api.x.ai/v1",
  },
  voice: {
    stop_word: "thank you",
  },
};

const BASE_PREFS: UserPreferences = {
  enterMode: false,
  outputLang: "auto",
  sonioxTerms: ["claude", "gbrain"],
  skipLlm: false,
};

describe("resolveLlmRequestOptions", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("uses the bundled provider + default model when nothing is stored", () => {
    const result = resolveLlmRequestOptions(BASE_CONFIG);

    expect(result.provider).toBe("xai");
    expect(result.model).toBe("grok-4-1-fast-non-reasoning");
    expect(result.baseUrl).toBe("https://api.x.ai/v1");
  });

  it("honors the saved provider override", () => {
    window.localStorage.setItem("llmProvider", JSON.stringify("gemini"));

    const result = resolveLlmRequestOptions(BASE_CONFIG);

    expect(result.provider).toBe("gemini");
    expect(result.model).toBe("gemini-2.5-flash-lite");
  });

  it("honors the saved per-provider model override", () => {
    window.localStorage.setItem("llmProvider", JSON.stringify("gemini"));
    window.localStorage.setItem(
      "llmModelsByProvider",
      JSON.stringify({ gemini: "gemini-2.5-pro" }),
    );

    const result = resolveLlmRequestOptions(BASE_CONFIG);

    expect(result.provider).toBe("gemini");
    expect(result.model).toBe("gemini-2.5-pro");
  });

  it("falls back to the openai_compatible base URL when llm.base_url is missing", () => {
    const config: AppConfig = {
      ...BASE_CONFIG,
      llm: { ...BASE_CONFIG.llm, base_url: undefined },
    };

    const result = resolveLlmRequestOptions(config);

    expect(result.baseUrl).toBe("https://api.openai.com/v1");
  });

  it("throws when the selected provider has no model and no default (OpenAI-compatible)", () => {
    window.localStorage.setItem("llmProvider", JSON.stringify("openai_compatible"));

    expect(() => resolveLlmRequestOptions(BASE_CONFIG)).toThrow(
      /No OpenAI-compatible model selected/,
    );
  });

  it("falls back to xai when config.llm.provider is empty/missing", () => {
    const config: AppConfig = {
      ...BASE_CONFIG,
      llm: { ...BASE_CONFIG.llm },
    };
    delete (config.llm as Partial<AppConfig["llm"]>).provider;

    const result = resolveLlmRequestOptions(config);

    expect(result.provider).toBe("xai");
  });
});

describe("resolveSonioxConfigForSession", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns the bundled Soniox config when no model override is stored", () => {
    const result = resolveSonioxConfigForSession(BASE_CONFIG);

    expect(result.model).toBe("stt-rt-v4");
    expect(result.ws_url).toBe("wss://stt-rt.soniox.com/transcribe-websocket");
    expect(result.sample_rate).toBe(16_000);
  });

  it("overlays a stored Soniox model selection without changing the rest", () => {
    window.localStorage.setItem("sonioxModel", JSON.stringify("stt-rt-v3"));

    const result = resolveSonioxConfigForSession(BASE_CONFIG);

    expect(result.model).toBe("stt-rt-v3");
    expect(result.ws_url).toBe(BASE_CONFIG.soniox.ws_url);
  });

  it("throws when the bundled config is not loaded", () => {
    expect(() => resolveSonioxConfigForSession(null)).toThrow(/App config is not loaded/);
  });

  it("uses DEFAULT_SONIOX_MODEL as the fallback constant", () => {
    expect(DEFAULT_SONIOX_MODEL).toBe("stt-rt-v4");
  });
});

describe("createActiveSessionPreferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("assembles enter mode, output language, skipLlm, terms, and the bundled stop word", () => {
    const result = createActiveSessionPreferences(BASE_PREFS, BASE_CONFIG);

    expect(result.enterMode).toBe(false);
    expect(result.outputLang).toBe("auto");
    expect(result.skipLlm).toBe(false);
    expect(result.sonioxTerms).toEqual(["claude", "gbrain"]);
    expect(result.stopWord).toBe("thank you");
    expect(result.normalizedStopWord).toBe("thank you");
  });

  it("uses a stored custom stop word when one is set", () => {
    window.localStorage.setItem("stopWord", JSON.stringify("done please"));

    const result = createActiveSessionPreferences(BASE_PREFS, BASE_CONFIG);

    expect(result.stopWord).toBe("done please");
    expect(result.normalizedStopWord).toBe("done please");
  });

  it("falls back to an empty stop word when config is null", () => {
    const result = createActiveSessionPreferences(BASE_PREFS, null);

    expect(result.stopWord).toBe("");
    expect(result.normalizedStopWord).toBe("");
  });

  it("populates llmOptions when skipLlm is false", () => {
    const result = createActiveSessionPreferences(BASE_PREFS, BASE_CONFIG);

    expect(result.llmOptions).toEqual({
      provider: "xai",
      model: "grok-4-1-fast-non-reasoning",
      baseUrl: "https://api.x.ai/v1",
    });
  });

  it("leaves llmOptions null when skipLlm is true (no resolver call)", () => {
    // Stage a provider that would have thrown if the resolver ran.
    window.localStorage.setItem("llmProvider", JSON.stringify("openai_compatible"));

    const result = createActiveSessionPreferences(
      { ...BASE_PREFS, skipLlm: true },
      BASE_CONFIG,
    );

    expect(result.llmOptions).toBeNull();
  });

  it("propagates resolveLlmRequestOptions throws when LLM is enabled but misconfigured", () => {
    window.localStorage.setItem("llmProvider", JSON.stringify("openai_compatible"));

    expect(() =>
      createActiveSessionPreferences({ ...BASE_PREFS, skipLlm: false }, BASE_CONFIG),
    ).toThrow(/No OpenAI-compatible model selected/);
  });

  it("normalises the stop word (strips punctuation, lowercases) for matching", () => {
    window.localStorage.setItem("stopWord", JSON.stringify(" THANK!  You. "));

    const result = createActiveSessionPreferences(BASE_PREFS, BASE_CONFIG);

    // loadCustomStopWordPreference trims the stored value before returning it.
    expect(result.stopWord).toBe("THANK!  You.");
    // normalizeStopWord then strips punctuation, lowercases, and collapses whitespace.
    expect(result.normalizedStopWord).toBe("thank you");
  });
});
