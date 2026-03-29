import { describe, expect, it, vi, beforeEach } from "vitest";

import type { VoiceToTextBridge } from "../types.ts";
import { waitForVoiceToTextBridge } from "../bridge-ready.ts";

function createBridge(): VoiceToTextBridge {
  return {
    setMicState: vi.fn(async () => {}),
    insertText: vi.fn(async () => ({ success: true })),
    correctTranscript: vi.fn(async () => ""),
    hasSonioxKey: vi.fn(async () => false),
    createSonioxTemporaryKey: vi.fn(async () => ({ apiKey: "temporary-key" })),
    hasXaiKey: vi.fn(async () => false),
    hasGeminiKey: vi.fn(async () => false),
    hasOpenaiCompatibleKey: vi.fn(async () => false),
    getConfig: vi.fn(async () => ({
      soniox: {
        ws_url: "",
        model: "",
        sample_rate: 16000,
        num_channels: 1,
        audio_format: "pcm_s16le",
        chunk_size: 4096,
      },
      llm: {
        provider: "xai" as const,
        model: "grok",
        temperature: 0,
      },
      voice: {
        stop_word: "thank you",
      },
    })),
    ensureMicrophonePermission: vi.fn(async () => ({ granted: true })),
    ensureAccessibilityPermission: vi.fn(async () => ({ granted: true })),
    ensureTextInsertionPermission: vi.fn(async () => ({ granted: true })),
    saveCredentials: vi.fn(async () => {}),
    updateXaiKey: vi.fn(async () => {}),
    updateGeminiKey: vi.fn(async () => {}),
    updateOpenaiCompatibleKey: vi.fn(async () => {}),
    updateSonioxKey: vi.fn(async () => {}),
    listModels: vi.fn(async () => []),
    resetCredentials: vi.fn(async () => {}),
    onToggleMic: vi.fn(() => () => {}),
    copyToClipboard: vi.fn(async () => {}),
    quitApp: vi.fn(async () => {}),
    showBar: vi.fn(async () => {}),
    hideBar: vi.fn(async () => {}),
    setMouseEvents: vi.fn(async () => {}),
    showSettings: vi.fn(async () => {}),
    checkPermissionsStatus: vi.fn(async () => ({ microphone: true, accessibility: true, automation: true })),
    relaunchApp: vi.fn(async () => {}),
    getMicToggleShortcut: vi.fn(async () => "Control+Alt+Super+V"),
    updateMicToggleShortcut: vi.fn(async (shortcut: string) => shortcut),
  };
}

describe("waitForVoiceToTextBridge", () => {
  beforeEach(() => {
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, "voiceToText");
  });

  it("resolves immediately when bridge already exists", async () => {
    const bridge = createBridge();
    (window as Window & { voiceToText?: VoiceToTextBridge }).voiceToText = bridge;

    await expect(waitForVoiceToTextBridge()).resolves.toBe(bridge);
  });

  it("waits until the injected bridge becomes available", async () => {
    vi.useFakeTimers();

    const bridge = createBridge();
    const pendingBridge = waitForVoiceToTextBridge();

    setTimeout(() => {
      (window as Window & { voiceToText?: VoiceToTextBridge }).voiceToText = bridge;
    }, 25);

    await vi.advanceTimersByTimeAsync(30);

    await expect(pendingBridge).resolves.toBe(bridge);

    vi.useRealTimers();
  });

  it("rejects when the bridge never appears", async () => {
    vi.useFakeTimers();

    const pendingBridge = waitForVoiceToTextBridge();
    const rejection = expect(pendingBridge).rejects.toThrow(
      "Voice to Text bridge was not injected",
    );

    await vi.advanceTimersByTimeAsync(10_000);

    await rejection;

    vi.useRealTimers();
  });
});
