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
  if (!match) {
    throw new Error("index.html: <body> not found");
  }
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
    listSonioxModels: vi.fn(async () => ["stt-rt-v4", "stt-rt-v3"]),
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

async function flushMainUi(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function bootMain(bridge: VoiceToTextBridge): Promise<void> {
  vi.resetModules();
  buildIndexDom();
  window.localStorage.clear();
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

function resetStatusElement(element: HTMLDivElement): void {
  element.textContent = "";
  element.className = "pref-status-line";
}

describe("main status feedback integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    window.localStorage.clear();
    window.onfocus = null;
    document.onvisibilitychange = null;
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("auto-clears stop-word success after the configured delay", async () => {
    const bridge = createBridge();
    await bootMain(bridge);

    vi.clearAllTimers();

    const stopWordInput = document.getElementById("pref-stop-word") as HTMLInputElement;
    const stopWordStatus = document.getElementById("pref-stop-word-status") as HTMLDivElement;
    resetStatusElement(stopWordStatus);

    stopWordInput.value = "done now";
    stopWordInput.focus();
    stopWordInput.blur();

    expect(stopWordStatus.textContent).toBe("Stop word saved.");
    expect(stopWordStatus.classList.contains("is-success")).toBe(true);

    vi.advanceTimersByTime(3_999);
    expect(stopWordStatus.textContent).toBe("Stop word saved.");

    vi.advanceTimersByTime(1);
    expect(stopWordStatus.textContent).toBe("");
    expect(stopWordStatus.classList.contains("is-success")).toBe(false);
  });

  it("keeps a later stop-word error visible after an earlier success timer would have fired", async () => {
    const bridge = createBridge();
    await bootMain(bridge);

    vi.clearAllTimers();

    const stopWordInput = document.getElementById("pref-stop-word") as HTMLInputElement;
    const stopWordStatus = document.getElementById("pref-stop-word-status") as HTMLDivElement;
    resetStatusElement(stopWordStatus);

    stopWordInput.value = "done now";
    stopWordInput.focus();
    stopWordInput.blur();

    expect(stopWordStatus.textContent).toBe("Stop word saved.");
    expect(stopWordStatus.classList.contains("is-success")).toBe(true);

    vi.advanceTimersByTime(1_000);
    stopWordInput.value = "   ";
    stopWordInput.focus();
    stopWordInput.blur();

    expect(stopWordStatus.textContent).toBe("Stop word cannot be empty.");
    expect(stopWordStatus.classList.contains("is-error")).toBe(true);

    vi.advanceTimersByTime(5_000);
    expect(stopWordStatus.textContent).toBe("Stop word cannot be empty.");
    expect(stopWordStatus.classList.contains("is-error")).toBe(true);
  });

  it("renders one combined settings panel without tablist navigation", async () => {
    const bridge = createBridge();
    await bootMain(bridge);

    expect(document.querySelector('[role="tablist"]')).toBeNull();
    expect(document.querySelector('[role="tabpanel"]')).toBeNull();
    expect(document.getElementById("settings-panel")).not.toBeNull();
  });

  it("shows shortcut, engine, and AI sections together on first paint", async () => {
    const bridge = createBridge();
    await bootMain(bridge);

    expect(document.getElementById("panel-quick-title")?.textContent).toBe("Daily use");
    expect(document.getElementById("panel-engine-title")?.textContent).toBe("Speech engine");
    expect(document.getElementById("panel-ai-title")?.textContent).toBe("AI Enhance");
  });
});
