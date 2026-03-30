/// <reference types="node" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppConfig, PlatformRuntimeInfo, VoiceToTextBridge } from "../types.ts";

const waitForVoiceToTextBridge = vi.hoisted(() => vi.fn());

vi.mock("../bridge-ready.ts", () => ({
  waitForVoiceToTextBridge,
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
    max_endpoint_delay_ms: 500,
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

function createBridge(
  runtimeInfo: PlatformRuntimeInfo,
  permissionOverrides?: Partial<
    Pick<
      VoiceToTextBridge,
      | "ensureMicrophonePermission"
      | "ensureAccessibilityPermission"
      | "ensureTextInsertionPermission"
    >
  >,
): VoiceToTextBridge {
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
    ensureMicrophonePermission:
      permissionOverrides?.ensureMicrophonePermission ??
      vi.fn(async () => ({ granted: true })),
    ensureAccessibilityPermission:
      permissionOverrides?.ensureAccessibilityPermission ??
      vi.fn(async () => ({ granted: true })),
    ensureTextInsertionPermission:
      permissionOverrides?.ensureTextInsertionPermission ??
      vi.fn(async () => ({ granted: true })),
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
    getPlatformRuntimeInfo: vi.fn(async () => runtimeInfo),
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
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function bootMain(
  bridge: VoiceToTextBridge,
): Promise<void> {
  vi.resetModules();
  buildIndexDom();
  window.localStorage.clear();
  window.voiceToTextDefaults = { terms: [] };
  window.voiceToText = bridge;
  waitForVoiceToTextBridge.mockResolvedValue(bridge);

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

describe("platform runtime UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    window.localStorage.clear();
    window.onfocus = null;
    document.onvisibilitychange = null;
  });

  it("keeps macOS permission guidance and shortcut labels", async () => {
    const bridge = createBridge({
      os: "macos",
      shortcutDisplay: "macos",
      permissionFlow: "system-settings-privacy",
      backgroundRecovery: "dockless-reopen",
      supportsFullscreenHud: true,
      requiresPrivilegedInsertionHelper: false,
    }, {
      ensureMicrophonePermission: vi.fn(async () => ({
        granted: false,
        message: "Grant microphone permission in System Settings.",
      })),
    });

    await bootMain(bridge);

    expect(document.getElementById("prefs-permission-text")?.textContent).toContain(
      "System Settings",
    );
    expect(document.getElementById("runtime-background-recovery")?.textContent).toContain(
      "reopen the app",
    );

    const renderedKeys = Array.from(document.querySelectorAll("#pref-mic-shortcut .shortcut-key")).map(
      (el) => el.textContent,
    );
    expect(renderedKeys).toContain("Option");
    expect(renderedKeys).toContain("Command");
  });

  it("renders Windows-specific permission, tray, and shortcut guidance from runtime info", async () => {
    const bridge = createBridge({
      os: "windows",
      shortcutDisplay: "windows",
      permissionFlow: "windows-privacy-settings",
      backgroundRecovery: "tray-reopen",
      supportsFullscreenHud: false,
      requiresPrivilegedInsertionHelper: true,
    }, {
      ensureTextInsertionPermission: vi.fn(async () => ({
        granted: false,
        code: "windows-helper-required",
        message: "Admin apps require the privileged insertion helper.",
      })),
    });

    await bootMain(bridge);

    expect(document.getElementById("prefs-permission-text")?.textContent).toContain(
      "Windows Settings",
    );
    expect(document.getElementById("prefs-permission-text")?.textContent).toContain(
      "privileged insertion helper",
    );
    expect(document.getElementById("runtime-background-recovery")?.textContent).toContain(
      "notification area",
    );

    const renderedKeys = Array.from(document.querySelectorAll("#pref-mic-shortcut .shortcut-key")).map(
      (el) => el.textContent,
    );
    expect(renderedKeys).toContain("Ctrl");
    expect(renderedKeys).toContain("Win");
    expect(renderedKeys).not.toContain("Command");
  });
});
