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
}));

vi.mock("../soniox-client.ts", () => ({
  SonioxClient: soniox.ctor,
}));

vi.mock("../storage.ts", () => ({
  loadPreferences: storage.loadPreferences,
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
    getConfig: ReturnType<typeof vi.fn<VoiceToTextBridge["getConfig"]>>;
    ensureMicrophonePermission: ReturnType<typeof vi.fn<VoiceToTextBridge["ensureMicrophonePermission"]>>;
    ensureAccessibilityPermission: ReturnType<typeof vi.fn<VoiceToTextBridge["ensureAccessibilityPermission"]>>;
    ensureTextInsertionPermission: ReturnType<typeof vi.fn<VoiceToTextBridge["ensureTextInsertionPermission"]>>;
    saveCredentials: ReturnType<typeof vi.fn<VoiceToTextBridge["saveCredentials"]>>;
    updateXaiKey: ReturnType<typeof vi.fn<VoiceToTextBridge["updateXaiKey"]>>;
    resetCredentials: ReturnType<typeof vi.fn<VoiceToTextBridge["resetCredentials"]>>;
    onToggleMic: ReturnType<typeof vi.fn<VoiceToTextBridge["onToggleMic"]>>;
    copyToClipboard: ReturnType<typeof vi.fn<VoiceToTextBridge["copyToClipboard"]>>;
    quitApp: ReturnType<typeof vi.fn<VoiceToTextBridge["quitApp"]>>;
    showBar: ReturnType<typeof vi.fn<VoiceToTextBridge["showBar"]>>;
    hideBar: ReturnType<typeof vi.fn<VoiceToTextBridge["hideBar"]>>;
    setMouseEvents: ReturnType<typeof vi.fn<VoiceToTextBridge["setMouseEvents"]>>;
    showSettings: ReturnType<typeof vi.fn<VoiceToTextBridge["showSettings"]>>;
  };
} {
  const mocks = {
    setMicState: vi.fn(async (_isActive: boolean) => {}),
    insertText: vi.fn(async () => ({ success: true })),
    correctTranscript: vi.fn(async (transcript: string) => transcript),
    getSonioxKey: vi.fn(async () => "soniox-key"),
    hasXaiKey: vi.fn(async () => false),
    getConfig: vi.fn(async () => DEFAULT_CONFIG),
    ensureMicrophonePermission: vi.fn(async () => createPermissionResult(true)),
    ensureAccessibilityPermission: vi.fn(async () => createPermissionResult(true)),
    ensureTextInsertionPermission: vi.fn(async () => createPermissionResult(true)),
    saveCredentials: vi.fn(async () => {}),
    updateXaiKey: vi.fn(async () => {}),
    resetCredentials: vi.fn(async () => {}),
    onToggleMic: vi.fn((_callback: () => void) => () => {}),
    copyToClipboard: vi.fn(async (_text: string) => {}),
    quitApp: vi.fn(async () => {}),
    showBar: vi.fn(async () => {}),
    hideBar: vi.fn(async () => {}),
    setMouseEvents: vi.fn(async (_ignore: boolean) => {}),
    showSettings: vi.fn(async () => {}),
  };

  const bridge: VoiceToTextBridge = {
    setMicState: mocks.setMicState,
    insertText: mocks.insertText,
    correctTranscript: mocks.correctTranscript,
    getSonioxKey: mocks.getSonioxKey,
    hasXaiKey: mocks.hasXaiKey,
    getConfig: mocks.getConfig,
    ensureMicrophonePermission: mocks.ensureMicrophonePermission,
    ensureAccessibilityPermission: mocks.ensureAccessibilityPermission,
    ensureTextInsertionPermission: mocks.ensureTextInsertionPermission,
    saveCredentials: mocks.saveCredentials,
    updateXaiKey: mocks.updateXaiKey,
    resetCredentials: mocks.resetCredentials,
    onToggleMic: mocks.onToggleMic,
    copyToClipboard: mocks.copyToClipboard,
    quitApp: mocks.quitApp,
    showBar: mocks.showBar,
    hideBar: mocks.hideBar,
    setMouseEvents: mocks.setMouseEvents,
    showSettings: mocks.showSettings,
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
});
