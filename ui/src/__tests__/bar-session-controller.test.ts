import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AppConfig,
  PermissionResult,
  SonioxContext,
  TranscriptResult,
  VoiceToTextBridge,
} from "../types.ts";

const DEFAULT_CONFIG: AppConfig = {
  soniox: {
    ws_url: "wss://example.test/stt",
    model: "stt-rt-preview",
    sample_rate: 16_000,
    num_channels: 1,
    audio_format: "pcm_s16le",
    chunk_size: 4_096,
  },
  llm: {
    provider: "xai",
    model: "grok",
    temperature: 0,
  },
  voice: {
    stop_word: "thank you",
  },
};

type SonioxMock = {
  onTranscript: ((result: TranscriptResult) => void) | null;
  onError: ((error: Error) => void) | null;
  setConfig: ReturnType<typeof vi.fn<(config: AppConfig["soniox"]) => void>>;
  start: ReturnType<typeof vi.fn<(apiKey: string, context: SonioxContext) => Promise<void>>>;
  stop: ReturnType<typeof vi.fn<() => void>>;
  resetTranscript: ReturnType<typeof vi.fn<() => void>>;
  getAnalyser: ReturnType<typeof vi.fn<() => AnalyserNode | null>>;
};

const soniox = vi.hoisted(() => {
  const instance: SonioxMock = {
    onTranscript: null,
    onError: null,
    setConfig: vi.fn(),
    start: vi.fn(async () => {}),
    stop: vi.fn(),
    resetTranscript: vi.fn(),
    getAnalyser: vi.fn(() => null),
  };

  return {
    instance,
    ctor: vi.fn(() => instance),
  };
});

const storage = vi.hoisted(() => ({
  loadPreferences: vi.fn(() => ({
    enterMode: true,
    outputLang: "auto" as const,
    sonioxTerms: ["alpha"],
    sonioxTranslationTerms: [{ source: "one", target: "1" }],
    skipLlm: false,
  })),
  loadCustomStopWordPreference: vi.fn((defaultStopWord: string) => defaultStopWord),
  loadLlmBaseUrlPreference: vi.fn((defaultBaseUrl: string) => defaultBaseUrl),
  loadLlmModelPreference: vi.fn((defaultModel: string) => defaultModel),
  loadLlmProviderPreference: vi.fn((defaultProvider: "xai" | "openai_compatible" | "gemini") => defaultProvider),
  loadReminderBeepEnabledPreference: vi.fn(() => true),
}));

vi.mock("../soniox-client.ts", () => ({
  SonioxClient: soniox.ctor,
}));

vi.mock("../storage.ts", () => ({
  loadPreferences: storage.loadPreferences,
  loadCustomStopWordPreference: storage.loadCustomStopWordPreference,
  loadLlmBaseUrlPreference: storage.loadLlmBaseUrlPreference,
  loadLlmModelPreference: storage.loadLlmModelPreference,
  loadLlmProviderPreference: storage.loadLlmProviderPreference,
  loadReminderBeepEnabledPreference: storage.loadReminderBeepEnabledPreference,
}));

import { BarSessionController } from "../bar-session-controller.ts";

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createPermissionResult(granted: boolean): PermissionResult {
  return { granted };
}

function createBridge(): {
  bridge: VoiceToTextBridge;
  mocks: {
    setMicState: ReturnType<typeof vi.fn<(isActive: boolean) => Promise<void>>>;
    insertText: ReturnType<typeof vi.fn<VoiceToTextBridge["insertText"]>>;
     correctTranscript: ReturnType<typeof vi.fn<VoiceToTextBridge["correctTranscript"]>>;
     getSonioxKey: ReturnType<typeof vi.fn<VoiceToTextBridge["getSonioxKey"]>>;
      hasXaiKey: ReturnType<typeof vi.fn<VoiceToTextBridge["hasXaiKey"]>>;
      hasGeminiKey: ReturnType<typeof vi.fn<VoiceToTextBridge["hasGeminiKey"]>>;
      hasOpenaiCompatibleKey: ReturnType<typeof vi.fn<VoiceToTextBridge["hasOpenaiCompatibleKey"]>>;
     getConfig: ReturnType<typeof vi.fn<VoiceToTextBridge["getConfig"]>>;
    ensureMicrophonePermission: ReturnType<typeof vi.fn<VoiceToTextBridge["ensureMicrophonePermission"]>>;
    ensureAccessibilityPermission: ReturnType<typeof vi.fn<VoiceToTextBridge["ensureAccessibilityPermission"]>>;
    ensureTextInsertionPermission: ReturnType<typeof vi.fn<VoiceToTextBridge["ensureTextInsertionPermission"]>>;
    checkPermissionsStatus: ReturnType<typeof vi.fn<VoiceToTextBridge["checkPermissionsStatus"]>>;
     saveCredentials: ReturnType<typeof vi.fn<VoiceToTextBridge["saveCredentials"]>>;
      updateXaiKey: ReturnType<typeof vi.fn<VoiceToTextBridge["updateXaiKey"]>>;
      updateGeminiKey: ReturnType<typeof vi.fn<VoiceToTextBridge["updateGeminiKey"]>>;
      updateOpenaiCompatibleKey: ReturnType<typeof vi.fn<VoiceToTextBridge["updateOpenaiCompatibleKey"]>>;
     resetCredentials: ReturnType<typeof vi.fn<VoiceToTextBridge["resetCredentials"]>>;
    onToggleMic: ReturnType<typeof vi.fn<VoiceToTextBridge["onToggleMic"]>>;
    copyToClipboard: ReturnType<typeof vi.fn<VoiceToTextBridge["copyToClipboard"]>>;
    quitApp: ReturnType<typeof vi.fn<VoiceToTextBridge["quitApp"]>>;
    relaunchApp: ReturnType<typeof vi.fn<VoiceToTextBridge["relaunchApp"]>>;
    showBar: ReturnType<typeof vi.fn<VoiceToTextBridge["showBar"]>>;
    hideBar: ReturnType<typeof vi.fn<VoiceToTextBridge["hideBar"]>>;
    setMouseEvents: ReturnType<typeof vi.fn<VoiceToTextBridge["setMouseEvents"]>>;
    showSettings: ReturnType<typeof vi.fn<VoiceToTextBridge["showSettings"]>>;
    getMicToggleShortcut: ReturnType<typeof vi.fn<VoiceToTextBridge["getMicToggleShortcut"]>>;
    updateMicToggleShortcut: ReturnType<typeof vi.fn<VoiceToTextBridge["updateMicToggleShortcut"]>>;
  };
} {
  const mocks = {
    setMicState: vi.fn(async (_isActive: boolean) => {}),
    insertText: vi.fn(async () => ({ success: true })),
    correctTranscript: vi.fn(async (transcript: string) => transcript),
    getSonioxKey: vi.fn(async () => "soniox-key"),
    hasXaiKey: vi.fn(async () => false),
    hasGeminiKey: vi.fn(async () => false),
    hasOpenaiCompatibleKey: vi.fn(async () => false),
    getConfig: vi.fn(async () => DEFAULT_CONFIG),
    ensureMicrophonePermission: vi.fn(async () => createPermissionResult(true)),
    ensureAccessibilityPermission: vi.fn(async () => createPermissionResult(true)),
    ensureTextInsertionPermission: vi.fn(async () => createPermissionResult(true)),
    checkPermissionsStatus: vi.fn(async () => ({ microphone: true, accessibility: true, automation: true })),
    saveCredentials: vi.fn(async () => {}),
    updateXaiKey: vi.fn(async () => {}),
    updateGeminiKey: vi.fn(async () => {}),
    updateOpenaiCompatibleKey: vi.fn(async () => {}),
    updateSonioxKey: vi.fn(async () => {}),
    listModels: vi.fn(async () => []),
    resetCredentials: vi.fn(async () => {}),
    onToggleMic: vi.fn((_callback: () => void) => () => {}),
    copyToClipboard: vi.fn(async (_text: string) => {}),
    quitApp: vi.fn(async () => {}),
    relaunchApp: vi.fn(async () => {}),
    showBar: vi.fn(async () => {}),
    hideBar: vi.fn(async () => {}),
    setMouseEvents: vi.fn(async (_ignore: boolean) => {}),
    showSettings: vi.fn(async () => {}),
    getMicToggleShortcut: vi.fn(async () => "Control+Alt+Super+V"),
    updateMicToggleShortcut: vi.fn(async (shortcut: string) => shortcut),
  };

  const bridge: VoiceToTextBridge = {
    setMicState: mocks.setMicState,
    insertText: mocks.insertText,
    correctTranscript: mocks.correctTranscript,
    getSonioxKey: mocks.getSonioxKey,
    hasXaiKey: mocks.hasXaiKey,
    hasGeminiKey: mocks.hasGeminiKey,
    hasOpenaiCompatibleKey: mocks.hasOpenaiCompatibleKey,
    getConfig: mocks.getConfig,
    ensureMicrophonePermission: mocks.ensureMicrophonePermission,
    ensureAccessibilityPermission: mocks.ensureAccessibilityPermission,
    ensureTextInsertionPermission: mocks.ensureTextInsertionPermission,
    checkPermissionsStatus: mocks.checkPermissionsStatus,
    saveCredentials: mocks.saveCredentials,
    updateXaiKey: mocks.updateXaiKey,
    updateGeminiKey: mocks.updateGeminiKey,
    updateOpenaiCompatibleKey: mocks.updateOpenaiCompatibleKey,
    updateSonioxKey: mocks.updateSonioxKey,
    listModels: mocks.listModels,
    resetCredentials: mocks.resetCredentials,
    onToggleMic: mocks.onToggleMic,
    copyToClipboard: mocks.copyToClipboard,
    quitApp: mocks.quitApp,
    relaunchApp: mocks.relaunchApp,
    showBar: mocks.showBar,
    hideBar: mocks.hideBar,
    setMouseEvents: mocks.setMouseEvents,
    showSettings: mocks.showSettings,
    getMicToggleShortcut: mocks.getMicToggleShortcut,
    updateMicToggleShortcut: mocks.updateMicToggleShortcut,
  };

  return { bridge, mocks };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("BarSessionController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    storage.loadCustomStopWordPreference.mockImplementation((defaultStopWord: string) => defaultStopWord);
    storage.loadLlmBaseUrlPreference.mockImplementation((defaultBaseUrl: string) => defaultBaseUrl);
    storage.loadLlmModelPreference.mockImplementation((defaultModel: string) => defaultModel);
    storage.loadLlmProviderPreference.mockImplementation((defaultProvider: "xai" | "openai_compatible" | "gemini") => defaultProvider);
    storage.loadPreferences.mockReturnValue({
      enterMode: true,
      outputLang: "auto",
      sonioxTerms: ["alpha"],
      sonioxTranslationTerms: [{ source: "one", target: "1" }],
      skipLlm: false,
    });
    storage.loadReminderBeepEnabledPreference.mockReturnValue(true);
    soniox.instance.onTranscript = null;
    soniox.instance.onError = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("init wires Soniox config and global toggle listener", async () => {
    const { bridge, mocks } = createBridge();
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    await controller.init();

    expect(mocks.getConfig).toHaveBeenCalledTimes(1);
    expect(soniox.instance.setConfig).toHaveBeenCalledWith(DEFAULT_CONFIG.soniox);
    expect(mocks.onToggleMic).toHaveBeenCalledTimes(1);
  });

  it("keeps the session stopped when user toggles off during startup", async () => {
    const micDeferred = createDeferred<PermissionResult>();
    const { bridge, mocks } = createBridge();

    mocks.ensureMicrophonePermission.mockImplementationOnce(async () => micDeferred.promise);
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    await controller.init();

    const startPromise = controller.handleToggle();
    await flushMicrotasks();

    await controller.handleToggle();

    micDeferred.resolve(createPermissionResult(true));
    await startPromise;
    await flushMicrotasks();

    expect(soniox.instance.start).not.toHaveBeenCalled();
    expect(mocks.setMicState).toHaveBeenCalledWith(false);
    expect(mocks.setMicState).not.toHaveBeenCalledWith(true);
    expect(controller.getCurrentState()).toBe("HIDDEN");
  });

  it("hides the HUD immediately when startup accessibility permission is denied", async () => {
    const { bridge, mocks } = createBridge();
    mocks.ensureAccessibilityPermission.mockResolvedValueOnce(
      createPermissionResult(false),
    );
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    await controller.init();
    await controller.handleToggle();

    expect(controller.getCurrentState()).toBe("HIDDEN");
    expect(controller.getOverlayMode()).toBe("PASSIVE");
    expect(mocks.hideBar).toHaveBeenCalledTimes(1);
    expect(mocks.setMouseEvents).toHaveBeenNthCalledWith(1, false);
    expect(mocks.setMouseEvents).toHaveBeenLastCalledWith(true);
  });

  it("retries enabling passive mouse events after first toggle failure", async () => {
    const { bridge, mocks } = createBridge();
    mocks.ensureAccessibilityPermission.mockResolvedValueOnce(
      createPermissionResult(false),
    );
    mocks.setMouseEvents
      .mockRejectedValueOnce(new Error("cursor toggle failed"))
      .mockResolvedValue(undefined);
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    await controller.init();
    await controller.handleToggle();

    expect(controller.getCurrentState()).toBe("HIDDEN");
    expect(mocks.setMouseEvents).toHaveBeenNthCalledWith(1, false);
    expect(mocks.setMouseEvents).toHaveBeenLastCalledWith(true);
  });

  it("still hides the HUD when close cleanup hits a stop-audio error", async () => {
    const { bridge, mocks } = createBridge();
    mocks.ensureAccessibilityPermission.mockResolvedValueOnce(
      createPermissionResult(false),
    );
    mocks.setMicState
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("mic state update failed"));
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    await controller.init();
    await controller.handleToggle();

    expect(controller.getCurrentState()).toBe("HIDDEN");

    await controller.handleClose();

    expect(controller.getCurrentState()).toBe("HIDDEN");
    expect(mocks.hideBar).toHaveBeenCalledTimes(2);
  });

  it("starts listening on the first retry after microphone permission is granted", async () => {
    const { bridge, mocks } = createBridge();
    mocks.ensureMicrophonePermission
      .mockResolvedValueOnce(createPermissionResult(false))
      .mockResolvedValueOnce(createPermissionResult(true));
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    await controller.init();

    await controller.handleToggle();

    expect(controller.getCurrentState()).toBe("HIDDEN");
    expect(controller.getOverlayMode()).toBe("PASSIVE");
    expect(soniox.instance.start).not.toHaveBeenCalled();

    await controller.handleToggle();

    expect(controller.getCurrentState()).toBe("LISTENING");
    expect(controller.getOverlayMode()).toBe("INTERACTIVE");
    expect(soniox.instance.start).toHaveBeenCalledTimes(1);
    expect(mocks.setMicState).toHaveBeenCalledWith(true);
  });

  it("starts listening on the first retry after accessibility permission is granted", async () => {
    const { bridge, mocks } = createBridge();
    mocks.ensureAccessibilityPermission
      .mockResolvedValueOnce(createPermissionResult(false))
      .mockResolvedValueOnce(createPermissionResult(true));
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    await controller.init();

    await controller.handleToggle();

    expect(controller.getCurrentState()).toBe("HIDDEN");
    expect(controller.getOverlayMode()).toBe("PASSIVE");
    expect(soniox.instance.start).not.toHaveBeenCalled();

    await controller.handleToggle();

    expect(controller.getCurrentState()).toBe("LISTENING");
    expect(controller.getOverlayMode()).toBe("INTERACTIVE");
    expect(soniox.instance.start).toHaveBeenCalledTimes(1);
    expect(mocks.setMicState).toHaveBeenCalledWith(true);
  });

  it("keeps startup missing-key failures visible in ERROR", async () => {
    const { bridge, mocks } = createBridge();
    mocks.getSonioxKey.mockResolvedValueOnce("");
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    const errorMessages: Array<string | null> = [];
    controller.onErrorMessageChange = (message) => errorMessages.push(message);

    await controller.init();
    await controller.handleToggle();

    expect(controller.getCurrentState()).toBe("ERROR");
    expect(controller.getOverlayMode()).toBe("INTERACTIVE");
    expect(mocks.hideBar).not.toHaveBeenCalled();
    expect(errorMessages[errorMessages.length - 1]).toBe(
      "Soniox API key is missing. Open Settings and add your key."
    );
  });

  it("stops immediately when transcript only contains the stop word", async () => {
    const { bridge, mocks } = createBridge();
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    await controller.init();
    await controller.handleToggle();

    const transcriptHandler = soniox.instance.onTranscript;
    expect(transcriptHandler).not.toBeNull();

    transcriptHandler?.({ finalText: "thank you", interimText: "" });
    await flushMicrotasks();

    expect(mocks.insertText).not.toHaveBeenCalled();
    expect(soniox.instance.resetTranscript).toHaveBeenCalled();
    expect(controller.getCurrentState()).toBe("HIDDEN");
  });

  it("keeps HUD interactive while visible and reverts passive only on hide", async () => {
    const { bridge, mocks } = createBridge();
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    await controller.init();
    await controller.handleToggle();

    expect(controller.getCurrentState()).toBe("LISTENING");
    expect(controller.getOverlayMode()).toBe("INTERACTIVE");

    await vi.advanceTimersByTimeAsync(30_000);
    await flushMicrotasks();

    expect(controller.getOverlayMode()).toBe("INTERACTIVE");

    await controller.handleClose();

    expect(controller.getCurrentState()).toBe("HIDDEN");
    expect(controller.getOverlayMode()).toBe("PASSIVE");
    expect(mocks.setMouseEvents).toHaveBeenLastCalledWith(true);
  });

  it("uses customized stop word from dedicated storage helper", async () => {
    const { bridge, mocks } = createBridge();
    storage.loadCustomStopWordPreference.mockReturnValue("done now");
    storage.loadPreferences.mockReturnValue({
      enterMode: true,
      outputLang: "auto",
      sonioxTerms: ["alpha"],
      sonioxTranslationTerms: [{ source: "one", target: "1" }],
      skipLlm: true,
    });
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    await controller.init();
    await controller.handleToggle();

    soniox.instance.onTranscript?.({
      finalText: "send update",
      interimText: "done now",
    });
    await flushMicrotasks();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(mocks.insertText).toHaveBeenCalledWith("send update", { enterMode: true });
  });

  it("keeps frozen command transcript while stop-word finalization is running", async () => {
    const { bridge, mocks } = createBridge();
    storage.loadPreferences.mockReturnValue({
      enterMode: true,
      outputLang: "auto",
      sonioxTerms: ["alpha"],
      sonioxTranslationTerms: [{ source: "one", target: "1" }],
      skipLlm: true,
    });
    const insertDeferred = createDeferred<{ success: boolean }>();
    mocks.insertText.mockImplementationOnce(async () => insertDeferred.promise);
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    const transcriptChanges: TranscriptResult[] = [];
    controller.onTranscriptChange = (result) => transcriptChanges.push(result);

    await controller.init();
    await controller.handleToggle();

    soniox.instance.onTranscript?.({
      finalText: "send update",
      interimText: "thank you",
    });
    await flushMicrotasks();

    soniox.instance.onTranscript?.({
      finalText: "OVERWRITE",
      interimText: "incoming",
    });
    await flushMicrotasks();

    expect(controller.getCurrentState()).toBe("INSERTING");
    expect(transcriptChanges).toEqual([{ finalText: "send update", interimText: "" }]);

    insertDeferred.resolve({ success: true });
    await flushMicrotasks();
  });

  it("skips hasXaiKey lookup when skipLlm preference is enabled", async () => {
    const { bridge, mocks } = createBridge();
    storage.loadPreferences.mockReturnValue({
      enterMode: true,
      outputLang: "auto",
      sonioxTerms: ["alpha"],
      sonioxTranslationTerms: [{ source: "one", target: "1" }],
      skipLlm: true,
    });
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    await controller.init();
    await controller.handleToggle();

    soniox.instance.onTranscript?.({
      finalText: "send report",
      interimText: "thank you",
    });
    await flushMicrotasks();

    expect(mocks.hasXaiKey).not.toHaveBeenCalled();
    expect(mocks.correctTranscript).not.toHaveBeenCalled();
  });

  it("uses OpenAI-compatible provider settings for correction", async () => {
    const { bridge, mocks } = createBridge();
    storage.loadPreferences.mockReturnValue({
      enterMode: true,
      outputLang: "auto",
      sonioxTerms: ["alpha"],
      sonioxTranslationTerms: [{ source: "one", target: "1" }],
      skipLlm: false,
    });
    storage.loadLlmProviderPreference.mockReturnValue("openai_compatible");
    storage.loadLlmModelPreference.mockReturnValue("gpt-4o-mini");
    storage.loadLlmBaseUrlPreference.mockReturnValue("https://openrouter.example/v1");
    mocks.hasOpenaiCompatibleKey.mockResolvedValueOnce(true);
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    await controller.init();
    await controller.handleToggle();

    soniox.instance.onTranscript?.({
      finalText: "ship update",
      interimText: "thank you",
    });
    await flushMicrotasks();
    await flushMicrotasks();

    expect(mocks.hasOpenaiCompatibleKey).toHaveBeenCalledTimes(1);
    expect(mocks.hasXaiKey).not.toHaveBeenCalled();
    expect(mocks.correctTranscript).toHaveBeenCalledWith("ship update", "auto", {
      provider: "openai_compatible",
      model: "gpt-4o-mini",
      baseUrl: "https://openrouter.example/v1",
    });
  });

  it("uses Gemini provider settings for correction", async () => {
    const { bridge, mocks } = createBridge();
    storage.loadPreferences.mockReturnValue({
      enterMode: true,
      outputLang: "auto",
      sonioxTerms: ["alpha"],
      sonioxTranslationTerms: [{ source: "one", target: "1" }],
      skipLlm: false,
    });
    storage.loadLlmProviderPreference.mockReturnValue("gemini");
    storage.loadLlmModelPreference.mockReturnValue("gemini-2.5-flash");
    mocks.hasGeminiKey.mockResolvedValueOnce(true);
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    await controller.init();
    await controller.handleToggle();

    soniox.instance.onTranscript?.({
      finalText: "ship update",
      interimText: "thank you",
    });
    await flushMicrotasks();
    await flushMicrotasks();

    expect(mocks.hasGeminiKey).toHaveBeenCalledTimes(1);
    expect(mocks.hasXaiKey).not.toHaveBeenCalled();
    expect(mocks.hasOpenaiCompatibleKey).not.toHaveBeenCalled();
    expect(mocks.correctTranscript).toHaveBeenCalledWith("ship update", "auto", {
      provider: "gemini",
      model: "gemini-2.5-flash",
      baseUrl: "https://api.openai.com/v1",
    });
  });

  it("falls back to the Gemini default model when no model is stored", async () => {
    const { bridge, mocks } = createBridge();
    storage.loadPreferences.mockReturnValue({
      enterMode: true,
      outputLang: "auto",
      sonioxTerms: ["alpha"],
      sonioxTranslationTerms: [{ source: "one", target: "1" }],
      skipLlm: false,
    });
    storage.loadLlmProviderPreference.mockReturnValue("gemini");
    storage.loadLlmModelPreference.mockImplementation((defaultModel: string) => defaultModel);
    mocks.hasGeminiKey.mockResolvedValueOnce(true);
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    await controller.init();
    await controller.handleToggle();

    soniox.instance.onTranscript?.({
      finalText: "ship update",
      interimText: "thank you",
    });
    await flushMicrotasks();
    await flushMicrotasks();

    expect(mocks.correctTranscript).toHaveBeenCalledWith("ship update", "auto", {
      provider: "gemini",
      model: "gemini-2.5-flash",
      baseUrl: "https://api.openai.com/v1",
    });
  });

  it("recovers from mid-session stream interruption and returns to LISTENING", async () => {
    const { bridge, mocks } = createBridge();
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    const stateChanges: string[] = [];
    const errorMessages: Array<string | null> = [];
    controller.onStateChange = (state) => stateChanges.push(state);
    controller.onErrorMessageChange = (message) => errorMessages.push(message);

    await controller.init();
    await controller.handleToggle();

    expect(controller.getCurrentState()).toBe("LISTENING");
    expect(soniox.instance.start).toHaveBeenCalledTimes(1);

    soniox.instance.onError?.(new Error("stream dropped"));
    await flushMicrotasks();

    expect(controller.getCurrentState()).toBe("ERROR");

    await vi.advanceTimersByTimeAsync(2_000);
    await flushMicrotasks();

    expect(soniox.instance.start).toHaveBeenCalledTimes(2);
    expect(controller.getCurrentState()).toBe("LISTENING");
    expect(stateChanges).toContain("ERROR");
    expect(stateChanges).toContain("LISTENING");
    expect(errorMessages.some((message) => message !== null)).toBe(true);
    expect(mocks.setMicState).toHaveBeenCalledWith(false);
    expect(mocks.setMicState).toHaveBeenCalledWith(true);
  });

  it("stays in ERROR and reports actionable message when stream restart fails", async () => {
    const { bridge } = createBridge();
    window.voiceToText = bridge;

    soniox.instance.start
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(async () => {
        throw new Error("network down");
      });

    const controller = new BarSessionController();
    const errorMessages: Array<string | null> = [];
    controller.onErrorMessageChange = (message) => errorMessages.push(message);

    await controller.init();
    await controller.handleToggle();

    soniox.instance.onError?.(new Error("stream dropped"));
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(2_000);
    await flushMicrotasks();

    expect(soniox.instance.start).toHaveBeenCalledTimes(2);
    expect(controller.getCurrentState()).toBe("ERROR");
    expect(errorMessages[errorMessages.length - 1]).toContain(
      "Could not reconnect to Soniox. Check your key/network, then retry. network down"
    );
  });

  it("logs reminder beep errors instead of swallowing them", async () => {
    const { bridge } = createBridge();
    window.voiceToText = bridge;

    const originalAudioContext = globalThis.AudioContext;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    (globalThis as typeof globalThis & { AudioContext: typeof AudioContext }).AudioContext =
      vi.fn(() => {
        throw new Error("audio blocked");
      }) as unknown as typeof AudioContext;

    try {
      const controller = new BarSessionController();
      await controller.init();
      await controller.handleToggle();

      await vi.advanceTimersByTimeAsync(60_000);
      await flushMicrotasks();

      expect(controller.getCurrentState()).toBe("LISTENING");
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      (globalThis as typeof globalThis & { AudioContext: typeof AudioContext }).AudioContext = originalAudioContext;
    }
  });

  it("does not schedule reminder beep when preference is disabled", async () => {
    const { bridge } = createBridge();
    storage.loadReminderBeepEnabledPreference.mockReturnValue(false);
    window.voiceToText = bridge;

    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    const controller = new BarSessionController();
    await controller.init();
    await controller.handleToggle();

    expect(controller.getCurrentState()).toBe("LISTENING");
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });
});
