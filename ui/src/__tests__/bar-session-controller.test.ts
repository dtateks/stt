import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AppConfig,
  PermissionResult,
  PlatformRuntimeInfo,
  SonioxContext,
  TranscriptResult,
  VoiceToTextBridge,
} from "../types.ts";

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
    temperature: 0,
  },
  voice: {
    stop_word: "thank you",
  },
};

const MICROTASK_FLUSH_ITERATIONS = 8;
const STOP_WORD_FINALIZE_TIMEOUT_MS = 1_000;
const DEFAULT_PLATFORM_RUNTIME_INFO: PlatformRuntimeInfo = {
  os: "macos",
  shortcutDisplay: "macos",
  permissionFlow: "system-settings-privacy",
  backgroundRecovery: "dockless-reopen",
  supportsFullscreenHud: true,
  requiresPrivilegedInsertionHelper: false,
};

type SonioxMock = {
  onTranscript: ((result: TranscriptResult) => void) | null;
  onError: ((error: Error) => void) | null;
  setConfig: ReturnType<typeof vi.fn<(config: AppConfig["soniox"]) => void>>;
  start: ReturnType<typeof vi.fn<(apiKey: string, context: SonioxContext) => Promise<void>>>;
  finalizeCurrentUtterance: ReturnType<typeof vi.fn<(fallbackTranscript: string) => Promise<string>>>;
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
    finalizeCurrentUtterance: vi.fn(async (fallbackTranscript: string) => fallbackTranscript),
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
    skipLlm: false,
  })),
  loadCustomStopWordPreference: vi.fn((defaultStopWord: string) => defaultStopWord),
  loadLlmBaseUrlPreference: vi.fn((defaultBaseUrl: string) => defaultBaseUrl),
  loadLlmModelPreference: vi.fn<
    (provider: "xai" | "openai_compatible" | "gemini") => string | null
  >((provider: "xai" | "openai_compatible" | "gemini") => {
    if (provider === "openai_compatible") {
      return null;
    }
    if (provider === "gemini") {
      return "gemini-2.5-flash-lite";
    }

    return "grok-4-1-fast-non-reasoning";
  }),
  loadLlmProviderPreference: vi.fn((defaultProvider: "xai" | "openai_compatible" | "gemini") => defaultProvider),
  loadReminderBeepEnabledPreference: vi.fn(() => true),
  loadSonioxModelPreference: vi.fn<() => string | null>(() => "stt-rt-v4"),
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
  loadSonioxModelPreference: storage.loadSonioxModelPreference,
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
     hasSonioxKey: ReturnType<typeof vi.fn<VoiceToTextBridge["hasSonioxKey"]>>;
     createSonioxTemporaryKey: ReturnType<typeof vi.fn<VoiceToTextBridge["createSonioxTemporaryKey"]>>;
      hasXaiKey: ReturnType<typeof vi.fn<VoiceToTextBridge["hasXaiKey"]>>;
    hasGeminiKey: ReturnType<typeof vi.fn<VoiceToTextBridge["hasGeminiKey"]>>;
    hasOpenaiCompatibleKey: ReturnType<typeof vi.fn<VoiceToTextBridge["hasOpenaiCompatibleKey"]>>;
    getConfig: ReturnType<typeof vi.fn<VoiceToTextBridge["getConfig"]>>;
    checkForUpdate: ReturnType<typeof vi.fn<VoiceToTextBridge["checkForUpdate"]>>;
    ensureMicrophonePermission: ReturnType<typeof vi.fn<VoiceToTextBridge["ensureMicrophonePermission"]>>;
    ensureAccessibilityPermission: ReturnType<typeof vi.fn<VoiceToTextBridge["ensureAccessibilityPermission"]>>;
    ensureTextInsertionPermission: ReturnType<typeof vi.fn<VoiceToTextBridge["ensureTextInsertionPermission"]>>;
    checkPermissionsStatus: ReturnType<typeof vi.fn<VoiceToTextBridge["checkPermissionsStatus"]>>;
      saveCredentials: ReturnType<typeof vi.fn<VoiceToTextBridge["saveCredentials"]>>;
      updateXaiKey: ReturnType<typeof vi.fn<VoiceToTextBridge["updateXaiKey"]>>;
      updateGeminiKey: ReturnType<typeof vi.fn<VoiceToTextBridge["updateGeminiKey"]>>;
      updateOpenaiCompatibleKey: ReturnType<typeof vi.fn<VoiceToTextBridge["updateOpenaiCompatibleKey"]>>;
     updateSonioxKey: ReturnType<typeof vi.fn<VoiceToTextBridge["updateSonioxKey"]>>;
     listModels: ReturnType<typeof vi.fn<VoiceToTextBridge["listModels"]>>;
     listSonioxModels: ReturnType<typeof vi.fn<VoiceToTextBridge["listSonioxModels"]>>;
    onToggleMic: ReturnType<typeof vi.fn<VoiceToTextBridge["onToggleMic"]>>;
    copyToClipboard: ReturnType<typeof vi.fn<VoiceToTextBridge["copyToClipboard"]>>;
    quitApp: ReturnType<typeof vi.fn<VoiceToTextBridge["quitApp"]>>;
    relaunchApp: ReturnType<typeof vi.fn<VoiceToTextBridge["relaunchApp"]>>;
    showBar: ReturnType<typeof vi.fn<VoiceToTextBridge["showBar"]>>;
    hideBar: ReturnType<typeof vi.fn<VoiceToTextBridge["hideBar"]>>;
    setMouseEvents: ReturnType<typeof vi.fn<VoiceToTextBridge["setMouseEvents"]>>;
    showSettings: ReturnType<typeof vi.fn<VoiceToTextBridge["showSettings"]>>;
    getPlatformRuntimeInfo: ReturnType<typeof vi.fn<VoiceToTextBridge["getPlatformRuntimeInfo"]>>;
    getMicToggleShortcut: ReturnType<typeof vi.fn<VoiceToTextBridge["getMicToggleShortcut"]>>;
    updateMicToggleShortcut: ReturnType<typeof vi.fn<VoiceToTextBridge["updateMicToggleShortcut"]>>;
  };
} {
  const mocks = {
    setMicState: vi.fn(async (_isActive: boolean) => {}),
    insertText: vi.fn(async () => ({ success: true })),
    correctTranscript: vi.fn(async (transcript: string) => transcript),
    hasSonioxKey: vi.fn(async () => true),
    createSonioxTemporaryKey: vi.fn(async () => ({ apiKey: "soniox-key", expiresInSeconds: 3_600 })),
    hasXaiKey: vi.fn(async () => false),
    hasGeminiKey: vi.fn(async () => false),
    hasOpenaiCompatibleKey: vi.fn(async () => false),
    getConfig: vi.fn(async () => DEFAULT_CONFIG),
    checkForUpdate: vi.fn(async () => null),
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
    listSonioxModels: vi.fn(async () => []),
    onToggleMic: vi.fn((_callback: () => void) => () => {}),
    copyToClipboard: vi.fn(async (_text: string) => {}),
    quitApp: vi.fn(async () => {}),
    relaunchApp: vi.fn(async () => {}),
    showBar: vi.fn(async () => {}),
    hideBar: vi.fn(async () => {}),
    setMouseEvents: vi.fn(async (_ignore: boolean) => {}),
    showSettings: vi.fn(async () => {}),
    getPlatformRuntimeInfo: vi.fn(async () => DEFAULT_PLATFORM_RUNTIME_INFO),
    getMicToggleShortcut: vi.fn(async () => "Control+Alt+Super+V"),
    updateMicToggleShortcut: vi.fn(async (shortcut: string) => shortcut),
  };

  const bridge: VoiceToTextBridge = {
    setMicState: mocks.setMicState,
    insertText: mocks.insertText,
    correctTranscript: mocks.correctTranscript,
    hasSonioxKey: mocks.hasSonioxKey,
    createSonioxTemporaryKey: mocks.createSonioxTemporaryKey,
    hasXaiKey: mocks.hasXaiKey,
    hasGeminiKey: mocks.hasGeminiKey,
    hasOpenaiCompatibleKey: mocks.hasOpenaiCompatibleKey,
    getConfig: mocks.getConfig,
    checkForUpdate: mocks.checkForUpdate,
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
    listSonioxModels: mocks.listSonioxModels,
    onToggleMic: mocks.onToggleMic,
    copyToClipboard: mocks.copyToClipboard,
    quitApp: mocks.quitApp,
    relaunchApp: mocks.relaunchApp,
    showBar: mocks.showBar,
    hideBar: mocks.hideBar,
    setMouseEvents: mocks.setMouseEvents,
    showSettings: mocks.showSettings,
    getPlatformRuntimeInfo: mocks.getPlatformRuntimeInfo,
    getMicToggleShortcut: mocks.getMicToggleShortcut,
    updateMicToggleShortcut: mocks.updateMicToggleShortcut,
  };

  return { bridge, mocks };
}

async function flushMicrotasks(): Promise<void> {
  for (let iteration = 0; iteration < MICROTASK_FLUSH_ITERATIONS; iteration += 1) {
    await Promise.resolve();
  }
}

async function settleStopWordFinalization(
  ms = 0,
): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await flushMicrotasks();
}

function dispatchStorageEvent(key: string): void {
  window.dispatchEvent(new StorageEvent("storage", {
    key,
  }));
}

describe("BarSessionController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    storage.loadCustomStopWordPreference.mockImplementation((defaultStopWord: string) => defaultStopWord);
    storage.loadLlmBaseUrlPreference.mockImplementation((defaultBaseUrl: string) => defaultBaseUrl);
    storage.loadLlmModelPreference.mockImplementation((provider: "xai" | "openai_compatible" | "gemini") => {
      if (provider === "openai_compatible") {
        return "gpt-4o-mini";
      }
      if (provider === "gemini") {
        return "gemini-2.5-flash";
      }

      return "grok";
    });
    storage.loadLlmProviderPreference.mockImplementation((defaultProvider: "xai" | "openai_compatible" | "gemini") => defaultProvider);
    storage.loadPreferences.mockReturnValue({
    enterMode: true,
    outputLang: "auto",
      sonioxTerms: ["alpha"],
      skipLlm: false,
    });
    storage.loadReminderBeepEnabledPreference.mockReturnValue(true);
    storage.loadSonioxModelPreference.mockImplementation(() => "stt-rt-v4");
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

  it("init prewarms the Soniox temporary key cache", async () => {
    const { bridge, mocks } = createBridge();
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    await controller.init();
    await flushMicrotasks();

    expect(mocks.hasSonioxKey).toHaveBeenCalledTimes(1);
    expect(mocks.createSonioxTemporaryKey).toHaveBeenCalledTimes(1);
  });

  it("uses stored Soniox model when starting realtime session", async () => {
    const { bridge } = createBridge();
    storage.loadSonioxModelPreference.mockReturnValue("stt-rt-v3");
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    await controller.init();
    await controller.handleToggle();

    expect(soniox.instance.setConfig).toHaveBeenCalledWith({
      ...DEFAULT_CONFIG.soniox,
      model: "stt-rt-v3",
    });
    expect(soniox.instance.start).toHaveBeenCalled();
  });

  it("uses the default Soniox model when no custom selection is stored", async () => {
    const { bridge, mocks } = createBridge();
    storage.loadSonioxModelPreference.mockReturnValue(null);
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    await controller.init();
    await controller.handleToggle();

    expect(soniox.instance.start).toHaveBeenCalled();
    expect(mocks.setMicState).toHaveBeenCalledWith(true);
    expect(soniox.instance.setConfig).toHaveBeenCalledWith({
      ...DEFAULT_CONFIG.soniox,
      model: "stt-rt-v4",
    });
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
    mocks.hasSonioxKey.mockResolvedValue(false);
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
    await settleStopWordFinalization();

    expect(mocks.insertText).not.toHaveBeenCalled();
    expect(soniox.instance.resetTranscript).toHaveBeenCalled();
    expect(controller.getCurrentState()).toBe("HIDDEN");
  });

  it("reuses the cached temporary Soniox key for startup and restart paths", async () => {
    const { bridge, mocks } = createBridge();
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    await controller.init();
    await flushMicrotasks();
    await controller.handleToggle();

    expect(mocks.hasSonioxKey).toHaveBeenCalledTimes(1);
    expect(mocks.createSonioxTemporaryKey).toHaveBeenCalledTimes(1);

    soniox.instance.onError?.(new Error("stream dropped"));
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(2_000);
    await flushMicrotasks();

    expect(mocks.hasSonioxKey).toHaveBeenCalledTimes(1);
    expect(mocks.createSonioxTemporaryKey).toHaveBeenCalledTimes(1);
  });

  it("refreshes the temporary Soniox key when the cached key is near expiry", async () => {
    const { bridge, mocks } = createBridge();
    mocks.createSonioxTemporaryKey
      .mockResolvedValueOnce({ apiKey: "near-expiry-key", expiresInSeconds: 30 })
      .mockResolvedValueOnce({ apiKey: "fresh-key", expiresInSeconds: 3_600 });
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    await controller.init();
    await flushMicrotasks();
    await controller.handleToggle();

    expect(mocks.hasSonioxKey).toHaveBeenCalledTimes(2);
    expect(mocks.createSonioxTemporaryKey).toHaveBeenCalledTimes(2);
    expect(soniox.instance.start).toHaveBeenCalledWith("fresh-key", { terms: ["alpha"] });
  });

  it("retries a near-expiry prewarm key during startup before surfacing missing-key error", async () => {
    const { bridge, mocks } = createBridge();
    mocks.createSonioxTemporaryKey
      .mockResolvedValueOnce({ apiKey: "near-expiry-prewarm-key", expiresInSeconds: 30 })
      .mockResolvedValueOnce({ apiKey: "fresh-prewarm-key", expiresInSeconds: 3_600 });
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    const errorMessages: Array<string | null> = [];
    controller.onErrorMessageChange = (message) => errorMessages.push(message);

    await controller.init();
    await flushMicrotasks();
    await controller.handleToggle();

    expect(controller.getCurrentState()).toBe("LISTENING");
    expect(mocks.hasSonioxKey).toHaveBeenCalledTimes(2);
    expect(mocks.createSonioxTemporaryKey).toHaveBeenCalledTimes(2);
    expect(soniox.instance.start).toHaveBeenCalledWith("fresh-prewarm-key", { terms: ["alpha"] });
    expect(errorMessages).toEqual([]);
  });

  it("finalizes the stop-word transcript before insert", async () => {
    const { bridge, mocks } = createBridge();
    const finalizedTranscript = createDeferred<string>();
    soniox.instance.finalizeCurrentUtterance.mockImplementationOnce(
      async (_fallbackTranscript: string) => finalizedTranscript.promise,
    );
    storage.loadPreferences.mockReturnValue({
      enterMode: true,
      outputLang: "auto",
      sonioxTerms: ["alpha"],
      skipLlm: true,
    });
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    await controller.init();
    await controller.handleToggle();

    soniox.instance.onTranscript?.({
      finalText: "send update",
      interimText: "thank you",
    });
    await flushMicrotasks();

    expect(controller.getCurrentState()).toBe("PROCESSING");
    expect(soniox.instance.stop).not.toHaveBeenCalled();

    await settleStopWordFinalization();

    expect(soniox.instance.finalizeCurrentUtterance).toHaveBeenCalledWith("send update thank you");
    expect(mocks.insertText).not.toHaveBeenCalled();
    expect(soniox.instance.stop).not.toHaveBeenCalled();

    finalizedTranscript.resolve("send update from final thank you");
    await flushMicrotasks();
    await flushMicrotasks();

    expect(mocks.insertText).toHaveBeenCalledWith("send update from final", { enterMode: true });
  });

  it("falls back to the detected transcript when stop-word finalization fails", async () => {
    const { bridge, mocks } = createBridge();
    soniox.instance.finalizeCurrentUtterance.mockRejectedValueOnce(new Error("finalize failed"));
    storage.loadPreferences.mockReturnValue({
      enterMode: true,
      outputLang: "auto",
      sonioxTerms: ["alpha"],
      skipLlm: true,
    });
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    await controller.init();
    await controller.handleToggle();

    soniox.instance.onTranscript?.({
      finalText: "send update",
      interimText: "thank you",
    });
    await flushMicrotasks();
    await settleStopWordFinalization();

    expect(mocks.insertText).toHaveBeenCalledWith("send update", { enterMode: true });
  });

  it("falls back to the detected transcript when stop-word finalization times out", async () => {
    const { bridge, mocks } = createBridge();
    const neverResolves = new Promise<string>(() => {});
    soniox.instance.finalizeCurrentUtterance.mockImplementationOnce(
      async () => neverResolves,
    );
    storage.loadPreferences.mockReturnValue({
      enterMode: true,
      outputLang: "auto",
      sonioxTerms: ["alpha"],
      skipLlm: true,
    });
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    await controller.init();
    await controller.handleToggle();

    soniox.instance.onTranscript?.({
      finalText: "send update",
      interimText: "thank you",
    });
    await flushMicrotasks();
    await settleStopWordFinalization(STOP_WORD_FINALIZE_TIMEOUT_MS);

    expect(mocks.insertText).toHaveBeenCalledWith("send update", { enterMode: true });
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
    await settleStopWordFinalization();

    expect(mocks.insertText).toHaveBeenCalledWith("send update", { enterMode: true });
  });

  it("loads stop-word preference once per active session", async () => {
    const { bridge } = createBridge();
    storage.loadCustomStopWordPreference.mockReturnValue("done now");
    storage.loadPreferences.mockReturnValue({
      enterMode: true,
      outputLang: "auto",
      sonioxTerms: ["alpha"],
      skipLlm: true,
    });
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    await controller.init();
    await controller.handleToggle();

    soniox.instance.onTranscript?.({
      finalText: "send update",
      interimText: "please",
    });
    soniox.instance.onTranscript?.({
      finalText: "send update",
      interimText: "done now",
    });
    await flushMicrotasks();
    await settleStopWordFinalization();

    expect(storage.loadCustomStopWordPreference).toHaveBeenCalledTimes(1);
  });

  it("applies updated stop word and toggles without restarting the HUD", async () => {
    const { bridge, mocks } = createBridge();
    storage.loadPreferences.mockReturnValue({
      enterMode: true,
      outputLang: "auto",
      sonioxTerms: ["alpha"],
      skipLlm: false,
    });
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    await controller.init();
    await controller.handleToggle();

    storage.loadPreferences.mockReturnValue({
      enterMode: false,
      outputLang: "auto",
      sonioxTerms: ["alpha"],
      skipLlm: true,
    });
    storage.loadCustomStopWordPreference.mockReturnValue("done now");

    dispatchStorageEvent("skipLlm");

    soniox.instance.onTranscript?.({
      finalText: "send update",
      interimText: "done now",
    });
    await flushMicrotasks();
    await settleStopWordFinalization();

    expect(mocks.correctTranscript).not.toHaveBeenCalled();
    expect(mocks.insertText).toHaveBeenCalledWith("send update", { enterMode: false });
  });

  it("keeps frozen command transcript while stop-word finalization is running", async () => {
    const { bridge, mocks } = createBridge();
    const finalizedTranscript = createDeferred<string>();
    soniox.instance.finalizeCurrentUtterance.mockImplementationOnce(
      async () => finalizedTranscript.promise,
    );
    storage.loadPreferences.mockReturnValue({
      enterMode: true,
      outputLang: "auto",
      sonioxTerms: ["alpha"],
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

    expect(controller.getCurrentState()).toBe("PROCESSING");
    expect(transcriptChanges).toEqual([{ finalText: "send update", interimText: "" }]);

    finalizedTranscript.resolve("send update thank you");
    await flushMicrotasks();
    insertDeferred.resolve({ success: true });
    await flushMicrotasks();
  });

  it("handleClear restarts a listening session without hiding the HUD", async () => {
    const { bridge, mocks } = createBridge();
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    await controller.init();
    await controller.handleToggle();

    soniox.instance.onTranscript?.({
      finalText: "draft",
      interimText: "incoming",
    });
    await flushMicrotasks();

    await controller.handleClear();
    await flushMicrotasks();

    expect(controller.getCurrentState()).toBe("LISTENING");
    expect(controller.getOverlayMode()).toBe("INTERACTIVE");
    expect(soniox.instance.stop).toHaveBeenCalledTimes(1);
    expect(soniox.instance.start).toHaveBeenCalledTimes(2);
    expect(mocks.hideBar).not.toHaveBeenCalled();
    expect(mocks.setMicState).toHaveBeenNthCalledWith(2, false);
    expect(mocks.setMicState).toHaveBeenNthCalledWith(3, true);
  });

  it("handleClear cancels stale stop-word finalization before insert", async () => {
    const { bridge, mocks } = createBridge();
    storage.loadPreferences.mockReturnValue({
      enterMode: true,
      outputLang: "auto",
      sonioxTerms: ["alpha"],
      skipLlm: false,
    });
    const correctionDeferred = createDeferred<string>();
    mocks.correctTranscript.mockImplementationOnce(async () => correctionDeferred.promise);
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    await controller.init();
    await controller.handleToggle();

    soniox.instance.onTranscript?.({
      finalText: "ship update",
      interimText: "thank you",
    });
    await flushMicrotasks();

    expect(controller.getCurrentState()).toBe("PROCESSING");

    await controller.handleClear();
    await flushMicrotasks();

    correctionDeferred.resolve("stale correction");
    await flushMicrotasks();

    expect(controller.getCurrentState()).toBe("LISTENING");
    expect(mocks.insertText).not.toHaveBeenCalled();
    expect(soniox.instance.start).toHaveBeenCalledTimes(2);
  });

  it("restarts listening after insert and ignores stale transcript callbacks", async () => {
    const { bridge, mocks } = createBridge();
    storage.loadPreferences.mockReturnValue({
      enterMode: true,
      outputLang: "auto",
      sonioxTerms: ["alpha"],
      skipLlm: true,
    });
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    const transcriptChanges: TranscriptResult[] = [];
    controller.onTranscriptChange = (result) => transcriptChanges.push(result);
    await controller.init();
    await controller.handleToggle();

    const staleTranscriptHandler = soniox.instance.onTranscript;
    expect(staleTranscriptHandler).not.toBeNull();

    staleTranscriptHandler?.({
      finalText: "hello hello 1234",
      interimText: "thank you",
    });
    await flushMicrotasks();
    await settleStopWordFinalization();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(mocks.insertText).toHaveBeenCalledTimes(1);
    expect(soniox.instance.stop).toHaveBeenCalledTimes(1);
    expect(soniox.instance.start).toHaveBeenCalledTimes(2);
    expect(controller.getCurrentState()).toBe("LISTENING");
    expect(controller.getOverlayMode()).toBe("INTERACTIVE");
    expect(mocks.hideBar).not.toHaveBeenCalled();
    expect(transcriptChanges[transcriptChanges.length - 1]).toEqual({
      finalText: "",
      interimText: "",
    });

    staleTranscriptHandler?.({
      finalText: "hello hello 1234",
      interimText: "thank you",
    });
    await flushMicrotasks();

    expect(controller.getCurrentState()).toBe("LISTENING");
    expect(mocks.insertText).toHaveBeenCalledTimes(1);
  });

  it("applies pending settings changes after the current finalization completes", async () => {
    const { bridge, mocks } = createBridge();
    storage.loadPreferences.mockReturnValue({
      enterMode: true,
      outputLang: "auto",
      sonioxTerms: ["alpha"],
      skipLlm: true,
    });
    const insertDeferred = createDeferred<{ success: boolean }>();
    mocks.insertText
      .mockImplementationOnce(async () => insertDeferred.promise)
      .mockResolvedValueOnce({ success: true });
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    await controller.init();
    await controller.handleToggle();

    soniox.instance.onTranscript?.({
      finalText: "first command",
      interimText: "thank you",
    });
    await flushMicrotasks();
    await settleStopWordFinalization();

    storage.loadPreferences.mockReturnValue({
      enterMode: false,
      outputLang: "auto",
      sonioxTerms: ["alpha"],
      skipLlm: true,
    });
    storage.loadCustomStopWordPreference.mockReturnValue("done now");
    dispatchStorageEvent("stopWord");

    insertDeferred.resolve({ success: true });
    await flushMicrotasks();
    await flushMicrotasks();

    expect(controller.getCurrentState()).toBe("LISTENING");

    soniox.instance.onTranscript?.({
      finalText: "second command",
      interimText: "done now",
    });
    await flushMicrotasks();
    await settleStopWordFinalization();

    expect(mocks.insertText).toHaveBeenNthCalledWith(2, "second command", { enterMode: false });
  });

  it("stays in ERROR when listening restart fails after insert succeeds", async () => {
    const { bridge, mocks } = createBridge();
    storage.loadPreferences.mockReturnValue({
      enterMode: true,
      outputLang: "auto",
      sonioxTerms: ["alpha"],
      skipLlm: true,
    });
    soniox.instance.start
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(async () => {
        throw new Error("network down");
      });
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    const errorMessages: Array<string | null> = [];
    controller.onErrorMessageChange = (message) => errorMessages.push(message);

    await controller.init();
    await controller.handleToggle();

    soniox.instance.onTranscript?.({
      finalText: "ship update",
      interimText: "thank you",
    });
    await flushMicrotasks();
    await settleStopWordFinalization();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(mocks.insertText).toHaveBeenCalledTimes(1);
    expect(controller.getCurrentState()).toBe("ERROR");
    expect(errorMessages[errorMessages.length - 1]).toContain(
      "Could not reconnect to Soniox. Check your key/network, then retry. network down",
    );
  });

  it("skips hasXaiKey lookup when skipLlm preference is enabled", async () => {
    const { bridge, mocks } = createBridge();
    storage.loadPreferences.mockReturnValue({
      enterMode: true,
      outputLang: "auto",
      sonioxTerms: ["alpha"],
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
    await settleStopWordFinalization();

    expect(mocks.hasXaiKey).not.toHaveBeenCalled();
    expect(mocks.correctTranscript).not.toHaveBeenCalled();
  });

  it("uses OpenAI-compatible provider settings for correction", async () => {
    const { bridge, mocks } = createBridge();
    storage.loadPreferences.mockReturnValue({
      enterMode: true,
      outputLang: "auto",
      sonioxTerms: ["alpha"],
      skipLlm: false,
    });
    storage.loadLlmProviderPreference.mockReturnValue("openai_compatible");
    storage.loadLlmModelPreference.mockReturnValue("gpt-4o-mini");
    storage.loadLlmBaseUrlPreference.mockReturnValue("https://openrouter.example/v1");
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    await controller.init();
    await controller.handleToggle();

    soniox.instance.onTranscript?.({
      finalText: "ship update",
      interimText: "thank you",
    });
    await flushMicrotasks();
    await settleStopWordFinalization();
    await flushMicrotasks();

    expect(mocks.hasOpenaiCompatibleKey).not.toHaveBeenCalled();
    expect(mocks.hasGeminiKey).not.toHaveBeenCalled();
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
      skipLlm: false,
    });
    storage.loadLlmProviderPreference.mockReturnValue("gemini");
    storage.loadLlmModelPreference.mockReturnValue("gemini-2.5-flash-lite");
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    await controller.init();
    await controller.handleToggle();

    soniox.instance.onTranscript?.({
      finalText: "ship update",
      interimText: "thank you",
    });
    await flushMicrotasks();
    await settleStopWordFinalization();
    await flushMicrotasks();

    expect(mocks.hasGeminiKey).not.toHaveBeenCalled();
    expect(mocks.hasXaiKey).not.toHaveBeenCalled();
    expect(mocks.hasOpenaiCompatibleKey).not.toHaveBeenCalled();
    expect(mocks.correctTranscript).toHaveBeenCalledWith("ship update", "auto", {
      provider: "gemini",
      model: "gemini-2.5-flash-lite",
      baseUrl: "https://api.openai.com/v1",
    });
  });

  it("falls back to the configured Gemini default when no model is stored", async () => {
    const { bridge, mocks } = createBridge();
    storage.loadPreferences.mockReturnValue({
      enterMode: true,
      outputLang: "auto",
      sonioxTerms: ["alpha"],
      skipLlm: false,
    });
    storage.loadLlmProviderPreference.mockReturnValue("gemini");
    storage.loadLlmModelPreference.mockReturnValue(null);
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    await controller.init();
    await controller.handleToggle();

    soniox.instance.onTranscript?.({
      finalText: "ship update",
      interimText: "thank you",
    });
    await flushMicrotasks();
    await settleStopWordFinalization();
    await flushMicrotasks();

    expect(mocks.correctTranscript).toHaveBeenCalledWith("ship update", "auto", {
      provider: "gemini",
      model: "gemini-2.5-flash-lite",
      baseUrl: "https://api.openai.com/v1",
    });
  });

  it("falls back to the configured xAI default when no model is stored", async () => {
    const { bridge, mocks } = createBridge();
    storage.loadPreferences.mockReturnValue({
      enterMode: true,
      outputLang: "auto",
      sonioxTerms: ["alpha"],
      skipLlm: false,
    });
    storage.loadLlmProviderPreference.mockReturnValue("xai");
    storage.loadLlmModelPreference.mockReturnValue(null);
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    await controller.init();
    await controller.handleToggle();

    soniox.instance.onTranscript?.({
      finalText: "ship update",
      interimText: "thank you",
    });
    await flushMicrotasks();
    await settleStopWordFinalization();
    await flushMicrotasks();

    expect(mocks.correctTranscript).toHaveBeenCalledWith("ship update", "auto", {
      provider: "xai",
      model: "grok-4-1-fast-non-reasoning",
      baseUrl: "https://api.openai.com/v1",
    });
  });

  it("reports actionable error when no OpenAI-compatible model is stored", async () => {
    const { bridge, mocks } = createBridge();
    storage.loadPreferences.mockReturnValue({
      enterMode: true,
      outputLang: "auto",
      sonioxTerms: ["alpha"],
      skipLlm: false,
    });
    storage.loadLlmProviderPreference.mockReturnValue("openai_compatible");
    storage.loadLlmModelPreference.mockReturnValue(null);
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    const errorMessages: Array<string | null> = [];
    controller.onErrorMessageChange = (message) => {
      errorMessages.push(message);
    };
    await controller.init();
    await controller.handleToggle();

    expect(mocks.correctTranscript).not.toHaveBeenCalled();
    expect(errorMessages.at(-1)).toContain(
      "No OpenAI-compatible model selected. Open Settings, refresh models, and choose one.",
    );
  });

  it("falls back to raw transcript after a non-retryable correction failure and resumes listening", async () => {
    const { bridge, mocks } = createBridge();
    storage.loadPreferences.mockReturnValue({
      enterMode: true,
      outputLang: "auto",
      sonioxTerms: ["alpha"],
      skipLlm: false,
    });
    mocks.correctTranscript
      .mockRejectedValueOnce(new Error("xAI API key is not configured"))
      .mockRejectedValueOnce(new Error("xAI API key is not configured"))
      .mockRejectedValueOnce(new Error("xAI API key is not configured"));
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    const errorMessages: Array<string | null> = [];
    controller.onErrorMessageChange = (message) => errorMessages.push(message);
    await controller.init();
    await controller.handleToggle();

    soniox.instance.onTranscript?.({
      finalText: "ship update",
      interimText: "thank you",
    });
    await flushMicrotasks();
    await settleStopWordFinalization();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(mocks.hasXaiKey).not.toHaveBeenCalled();
    expect(mocks.hasGeminiKey).not.toHaveBeenCalled();
    expect(mocks.hasOpenaiCompatibleKey).not.toHaveBeenCalled();
    expect(mocks.correctTranscript).toHaveBeenCalledTimes(1);
    const [rawTranscript] = mocks.correctTranscript.mock.calls[0] ?? [];
    expect(mocks.insertText).toHaveBeenCalledWith(rawTranscript, { enterMode: true });
    expect(controller.getCurrentState()).toBe("LISTENING");
    expect(errorMessages.some((message) => message !== null)).toBe(false);
    expect(errorMessages).toEqual([]);
  });

  it("retries transient correction failures before falling back to raw transcript", async () => {
    const { bridge, mocks } = createBridge();
    storage.loadPreferences.mockReturnValue({
      enterMode: true,
      outputLang: "auto",
      sonioxTerms: ["alpha"],
      skipLlm: false,
    });
    mocks.correctTranscript
      .mockRejectedValueOnce(new Error("xAI request timed out after 15 seconds"))
      .mockRejectedValueOnce(new Error("xAI request timed out after 15 seconds"))
      .mockRejectedValueOnce(new Error("xAI request timed out after 15 seconds"));
    window.voiceToText = bridge;

    const controller = new BarSessionController();
    await controller.init();
    await controller.handleToggle();

    soniox.instance.onTranscript?.({
      finalText: "ship update",
      interimText: "thank you",
    });
    await flushMicrotasks();
    await settleStopWordFinalization();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(mocks.correctTranscript).toHaveBeenCalledTimes(3);
    expect(mocks.insertText).toHaveBeenCalledWith("ship update", { enterMode: true });
    expect(controller.getCurrentState()).toBe("LISTENING");
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
