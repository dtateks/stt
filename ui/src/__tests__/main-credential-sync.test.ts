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
    listModels: vi.fn(async () => ["grok-4-1-fast-non-reasoning"]),
    listSonioxModels: vi.fn(async () => ["stt-rt-v4"]),
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
      permissionFlow: "macos",
      backgroundRecovery: "dockless",
      supportsFullscreenHud: true,
      requiresPrivilegedInsertionHelper: false,
    })),
    getMicToggleShortcut: vi.fn(async () => "Control+Alt+Super+V"),
    updateMicToggleShortcut: vi.fn(async (shortcut: string) => shortcut),
  };
}

async function flushMainUi(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function bootMain(
  bridge: VoiceToTextBridge,
  options: { seedLocalStorage?: () => void } = {},
): Promise<void> {
  vi.resetModules();
  buildIndexDom();
  window.localStorage.clear();
  options.seedLocalStorage?.();
  window.voiceToTextDefaults = { terms: [] };
  window.voiceToText = bridge;
  waitForVoiceToTextBridge.mockResolvedValue(bridge);
  requestStartupPermissions.mockResolvedValue([
    { permission: "microphone", granted: true },
    { permission: "accessibility", granted: true },
    { permission: "automation", granted: true },
  ]);

  const domReadyCallbacks: EventListenerOrEventListenerObject[] = [];
  const addEventListener = document.addEventListener.bind(document);
  const addEventListenerSpy = vi
    .spyOn(document, "addEventListener")
    .mockImplementation((type, listener, options) => {
      if (type === "DOMContentLoaded") {
        domReadyCallbacks.push(listener);
        return;
      }

      addEventListener(type, listener, options);
    });

  await import("../main.ts");
  addEventListenerSpy.mockRestore();

  const domReadyHandler = domReadyCallbacks.at(-1);
  if (!domReadyHandler) {
    throw new Error("main.ts did not register a DOMContentLoaded handler");
  }

  const domReadyEvent = new Event("DOMContentLoaded");
  if (typeof domReadyHandler === "function") {
    domReadyHandler(domReadyEvent);
  } else {
    domReadyHandler.handleEvent(domReadyEvent);
  }

  await flushMainUi();
}

describe("main credential screen sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    window.localStorage.clear();
    window.onfocus = null;
    document.onvisibilitychange = null;
  });

  it("stays on setup when post-save key verification still fails", async () => {
    const bridge = createBridge();
    vi.mocked(bridge.hasSonioxKey)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);

    await bootMain(bridge);

    const settingsPanel = document.getElementById("settings-panel") as HTMLDivElement;
    const sonioxInput = document.getElementById("setup-soniox-key") as HTMLInputElement;
    const setupSubmitBtn = document.getElementById("setup-submit") as HTMLButtonElement;
    const setupError = document.getElementById("setup-error") as HTMLDivElement;
    const readyTitle = document.getElementById("prefs-ready-title") as HTMLSpanElement;

    sonioxInput.value = "soniox-live-key";
    setupSubmitBtn.click();
    await flushMainUi();

    expect(settingsPanel).not.toBeNull();
    expect(bridge.updateSonioxKey).toHaveBeenCalledWith("soniox-live-key");
    expect(vi.mocked(bridge.hasSonioxKey).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(readyTitle.textContent).toBe("Activation required");
    expect(setupSubmitBtn.textContent).toBe("Save key");
    expect(setupError.textContent).toContain("Saved credentials could not be verified");
  });

  it("does not advance to prefs when backend save verification fails", async () => {
    const bridge = createBridge();
    vi.mocked(bridge.hasSonioxKey).mockResolvedValue(false);
    vi.mocked(bridge.updateSonioxKey).mockRejectedValueOnce(
      new Error("Stored credentials could not be verified after save"),
    );

    await bootMain(bridge);

    const sonioxInput = document.getElementById("setup-soniox-key") as HTMLInputElement;
    const setupError = document.getElementById("setup-error") as HTMLDivElement;
    const readyTitle = document.getElementById("prefs-ready-title") as HTMLSpanElement;

    sonioxInput.value = "soniox-live-key";
    (document.getElementById("setup-submit") as HTMLButtonElement).click();
    await flushMainUi();

    expect(readyTitle.textContent).toBe("Activation required");
    expect(setupError.textContent).toContain("Stored credentials could not be verified after save");
  });

  it("rejects Soniox keys that fail temporary-key validation during setup save", async () => {
    const bridge = createBridge();
    vi.mocked(bridge.hasSonioxKey).mockResolvedValue(false);
    vi.mocked(bridge.updateSonioxKey).mockRejectedValueOnce(
      new Error("Soniox temporary key request failed (401): invalid key"),
    );

    await bootMain(bridge);

    const sonioxInput = document.getElementById("setup-soniox-key") as HTMLInputElement;
    const setupError = document.getElementById("setup-error") as HTMLDivElement;
    const readyTitle = document.getElementById("prefs-ready-title") as HTMLSpanElement;

    sonioxInput.value = "soniox-live-key";
    (document.getElementById("setup-submit") as HTMLButtonElement).click();
    await flushMainUi();

    expect(bridge.updateSonioxKey).toHaveBeenCalledWith("soniox-live-key");
    expect(vi.mocked(bridge.hasSonioxKey).mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(readyTitle.textContent).toBe("Activation required");
    expect(setupError.textContent).toContain(
      "Soniox temporary key request failed (401): invalid key",
    );
  });

  it("switches to prefs only after post-save verification succeeds", async () => {
    const bridge = createBridge();
    vi.mocked(bridge.hasSonioxKey)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(true);

    await bootMain(bridge);

    const sonioxInput = document.getElementById("setup-soniox-key") as HTMLInputElement;
    const setupSubmitBtn = document.getElementById("setup-submit") as HTMLButtonElement;
    const readyTitle = document.getElementById("prefs-ready-title") as HTMLSpanElement;

    sonioxInput.value = "soniox-live-key";
    setupSubmitBtn.click();
    await flushMainUi();
    await flushMainUi();

    expect(readyTitle.textContent).toBe("Ready to dictate");
    expect(setupSubmitBtn.textContent).toBe("Save key");
  });

  it("reverts prefs back to setup when focus revalidation sees no Soniox key", async () => {
    const bridge = createBridge();
    vi.mocked(bridge.hasSonioxKey)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(true);

    await bootMain(bridge);

    const sonioxInput = document.getElementById("setup-soniox-key") as HTMLInputElement;
    const setupError = document.getElementById("setup-error") as HTMLDivElement;
    const readyTitle = document.getElementById("prefs-ready-title") as HTMLSpanElement;

    sonioxInput.value = "soniox-live-key";
    (document.getElementById("setup-submit") as HTMLButtonElement).click();
    await flushMainUi();
    await flushMainUi();

    expect(readyTitle.textContent).toBe("Ready to dictate");

    vi.mocked(bridge.hasSonioxKey).mockResolvedValue(false);
    window.onfocus?.(new FocusEvent("focus"));
    await flushMainUi();

    expect(readyTitle.textContent).toBe("Activation required");
    expect(setupError.textContent).toContain("Soniox API key is missing");
  });

});
