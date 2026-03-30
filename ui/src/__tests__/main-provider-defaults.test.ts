/// <reference types="node" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppConfig, VoiceToTextBridge } from "../types.ts";

const waitForVoiceToTextBridge = vi.hoisted(() => vi.fn());
const requestStartupPermissions = vi.hoisted(() => vi.fn());

vi.mock("../bridge-ready.ts", () => ({
  waitForVoiceToTextBridge,
}));

vi.mock("../startup-permissions.ts", () => ({
  requestStartupPermissions,
}));

const DEFAULT_CONFIG: AppConfig = {
  soniox: {
    ws_url: "wss://example.test/stt",
    model: "stt-rt-v4",
    sample_rate: 16_000,
    num_channels: 1,
    audio_format: "pcm_s16le",
    chunk_size: 4_096,
    enable_endpoint_detection: true,
    max_endpoint_delay_ms: 1800,
    max_non_final_tokens_duration_ms: 1800,
  },
  llm: {
    provider: "xai",
    model: "grok-4-1-fast-non-reasoning",
    temperature: 0.1,
    base_url: "https://api.openai.com/v1",
  },
  voice: {
    stop_word: "thank you",
  },
};

function loadProductionIndexHtml(): string {
  const htmlPath = resolve(__dirname, "../../index.html");
  const source = readFileSync(htmlPath, "utf-8");
  const match = source.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!match) throw new Error("index.html: <body> not found");
  return match[1];
}

const PRODUCTION_INDEX_HTML = loadProductionIndexHtml();

function buildIndexDom(): void {
  document.body.innerHTML = PRODUCTION_INDEX_HTML;
}

function createBridge(): VoiceToTextBridge {
  return {
    setMicState: vi.fn(async () => {}),
    insertText: vi.fn(async () => ({ success: true })),
    correctTranscript: vi.fn(async () => ""),
    hasSonioxKey: vi.fn(async () => true),
    createSonioxTemporaryKey: vi.fn(async () => ({ apiKey: "temporary-key" })),
    hasXaiKey: vi.fn(async () => true),
    hasGeminiKey: vi.fn(async () => true),
    hasOpenaiCompatibleKey: vi.fn(async () => true),
    getConfig: vi.fn(async () => DEFAULT_CONFIG),
    checkForUpdate: vi.fn(async () => null),
    ensureMicrophonePermission: vi.fn(async () => ({ granted: true })),
    ensureAccessibilityPermission: vi.fn(async () => ({ granted: true })),
    ensureTextInsertionPermission: vi.fn(async () => ({ granted: true })),
    checkPermissionsStatus: vi.fn(async () => ({
      microphone: true,
      accessibility: true,
      automation: true,
    })),
    saveCredentials: vi.fn(async () => {}),
    updateXaiKey: vi.fn(async () => {}),
    updateGeminiKey: vi.fn(async () => {}),
    updateOpenaiCompatibleKey: vi.fn(async () => {}),
    updateSonioxKey: vi.fn(async () => {}),
    listModels: vi.fn(async (provider: string) => {
      if (provider === "gemini") {
        return ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-1.5-pro"];
      }
      if (provider === "openai_compatible") {
        return ["gpt-4.1-mini", "gpt-4o-mini"];
      }

      return ["grok-4-1-fast-non-reasoning", "grok-4-fast-reasoning"];
    }),
    listSonioxModels: vi.fn(async () => ["stt-rt-v4", "stt-rt-v3", "stt-rt"]),
    onToggleMic: vi.fn(() => () => {}),
    copyToClipboard: vi.fn(async () => {}),
    quitApp: vi.fn(async () => {}),
    relaunchApp: vi.fn(async () => {}),
    showBar: vi.fn(async () => {}),
    hideBar: vi.fn(async () => {}),
    setMouseEvents: vi.fn(async () => {}),
    showSettings: vi.fn(async () => {}),
    getPlatformRuntimeInfo: vi.fn(async () => ({
      os: "macos",
      shortcutDisplay: "macos",
      permissionFlow: "system-settings-privacy",
      backgroundRecovery: "dockless-reopen",
      supportsFullscreenHud: true,
      requiresPrivilegedInsertionHelper: false,
    })),
    getMicToggleShortcut: vi.fn(async () => "Control+Alt+Super+V"),
    updateMicToggleShortcut: vi.fn(async (shortcut: string) => shortcut),
  };
}

async function bootMain(): Promise<void> {
  vi.resetModules();
  buildIndexDom();
  window.localStorage.clear();
  window.voiceToTextDefaults = { terms: [] };

  const bridge = createBridge();
  window.voiceToText = bridge;
  waitForVoiceToTextBridge.mockResolvedValue(bridge);
  requestStartupPermissions.mockResolvedValue([
    { permission: "microphone", granted: true },
    { permission: "accessibility", granted: true },
    { permission: "automation", granted: true },
  ]);

  await import("../main.ts");
  document.dispatchEvent(new Event("DOMContentLoaded"));
  await Promise.resolve();
  await Promise.resolve();
}

describe("main provider defaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    window.localStorage.clear();
  });

  it("switching to Gemini prefers the configured default model from the fetched list", async () => {
    await bootMain();

    const providerSelect = document.getElementById("pref-llm-provider") as HTMLSelectElement;
    const modelSelect = document.getElementById("pref-llm-model") as HTMLSelectElement;

    providerSelect.value = "gemini";
    providerSelect.dispatchEvent(new Event("change"));

    // Wait for async fetchModels() to complete
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Provider should be saved
    expect(window.localStorage.getItem("llmProvider")).toBe('"gemini"');
    
    // Model select should prefer the configured default when it exists in fetched models
    expect(modelSelect.value).toBe("gemini-2.5-flash-lite");
    
    // Model should be auto-saved from fetched list when no prior selection exists
    expect(window.localStorage.getItem("llmModelsByProvider")).toBe(
      '{"gemini":"gemini-2.5-flash-lite"}',
    );

    // Model should update when user explicitly selects it
    modelSelect.value = "gemini-1.5-pro";
    modelSelect.dispatchEvent(new Event("change"));
    await Promise.resolve();
    expect(window.localStorage.getItem("llmModelsByProvider")).toBe(
      '{"gemini":"gemini-1.5-pro"}',
    );
  });

  it("fetching xAI models prefers the configured default from the fetched list", async () => {
    await bootMain();

    const providerSelect = document.getElementById("pref-llm-provider") as HTMLSelectElement;
    const bridge = window.voiceToText;

    providerSelect.value = "gemini";
    providerSelect.dispatchEvent(new Event("change"));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    providerSelect.value = "xai";
    providerSelect.dispatchEvent(new Event("change"));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const storedModels = JSON.parse(window.localStorage.getItem("llmModelsByProvider") ?? "{}");

    expect(bridge.listModels).toHaveBeenCalledWith("xai", undefined);
    expect(storedModels).toMatchObject({
      xai: "grok-4-1-fast-non-reasoning",
    });
  });

  it("loads Soniox realtime models and persists selected Soniox model", async () => {
    await bootMain();

    const sonioxModelSelect = document.getElementById("pref-soniox-model") as HTMLSelectElement;
    const sonioxModelFetchBtn = document.getElementById("pref-soniox-model-fetch") as HTMLButtonElement;

    sonioxModelFetchBtn.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const sonioxOptionValues = Array.from(sonioxModelSelect.options).map((option) => option.value);
    expect(sonioxOptionValues).toContain("stt-rt-v4");

    sonioxModelSelect.value = "stt-rt-v3";
    sonioxModelSelect.dispatchEvent(new Event("change"));
    await Promise.resolve();

    expect(window.localStorage.getItem("sonioxModel")).toBe('"stt-rt-v3"');
  });

  it("reuses persisted fetched model selections when still available", async () => {
    await bootMain();

    window.localStorage.setItem("llmModelsByProvider", '{"gemini":"gemini-1.5-pro"}');
    window.localStorage.setItem("sonioxModel", '"stt-rt-v3"');

    const providerSelect = document.getElementById("pref-llm-provider") as HTMLSelectElement;
    const llmModelSelect = document.getElementById("pref-llm-model") as HTMLSelectElement;
    const sonioxModelSelect = document.getElementById("pref-soniox-model") as HTMLSelectElement;
    const sonioxModelFetchBtn = document.getElementById("pref-soniox-model-fetch") as HTMLButtonElement;

    providerSelect.value = "gemini";
    providerSelect.dispatchEvent(new Event("change"));
    sonioxModelFetchBtn.click();

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(llmModelSelect.value).toBe("gemini-1.5-pro");
    expect(sonioxModelSelect.value).toBe("stt-rt-v3");
  });

  it("does not auto-select an OpenAI-compatible model", async () => {
    await bootMain();

    const providerSelect = document.getElementById("pref-llm-provider") as HTMLSelectElement;
    const modelSelect = document.getElementById("pref-llm-model") as HTMLSelectElement;

    providerSelect.value = "openai_compatible";
    providerSelect.dispatchEvent(new Event("change"));

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(modelSelect.value).toBe("");
    expect(modelSelect.options[0]?.textContent).toBe("Choose a model");
    expect(window.localStorage.getItem("llmModelsByProvider")).toBeNull();
  });
});
