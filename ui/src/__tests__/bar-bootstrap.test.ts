import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  waitForVoiceToTextBridge: vi.fn<() => Promise<unknown>>(),
}));

const controllerMocks = vi.hoisted(() => ({
  init: vi.fn(async () => {}),
  handleClose: vi.fn(async () => {}),
  handleClear: vi.fn(async () => {}),
  instance: null as {
    onStateChange: ((state: string) => void) | null;
  } | null,
}));

vi.mock("../bridge-ready.ts", () => ({
  waitForVoiceToTextBridge: bridge.waitForVoiceToTextBridge,
}));

vi.mock("../bar-session-controller.ts", () => ({
  BarSessionController: class {
    onStateChange: ((state: string) => void) | null = null;
    onTranscriptChange: ((result: unknown) => void) | null = null;
    onOverlayModeChange: ((mode: string) => void) | null = null;
    onErrorMessageChange: ((message: string | null) => void) | null = null;

    constructor() {
      controllerMocks.instance = this;
    }

    async init(): Promise<void> {
      await controllerMocks.init();
    }

    async handleClose(): Promise<void> {
      await controllerMocks.handleClose();
    }

    async handleClear(): Promise<void> {
      await controllerMocks.handleClear();
    }

    getAnalyserNode(): AnalyserNode | null {
      return null;
    }
  },
}));

function renderHudFixture(): void {
  document.body.innerHTML = `
    <div id="hud" data-state="HIDDEN">
      <canvas id="waveform"></canvas>
      <span id="transcript-final"></span>
      <span id="transcript-interim"></span>
      <span id="transcript-prompt" hidden></span>
      <span id="hud-state-label"></span>
      <button id="hud-clear-btn" type="button"></button>
      <button id="hud-close-btn" type="button"></button>
    </div>
  `;
}

async function bootstrapBarModule(): Promise<void> {
  await import("../bar.ts");
  document.dispatchEvent(new Event("DOMContentLoaded"));
  await Promise.resolve();
  await Promise.resolve();
}

describe("bar bootstrap fallback close behavior", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    controllerMocks.instance = null;
    renderHudFixture();
    Object.defineProperty(window, "voiceToText", {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("binds close control before bridge timeout without destroying the window", async () => {
    bridge.waitForVoiceToTextBridge.mockRejectedValueOnce(new Error("bridge unavailable"));
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => {});

    await bootstrapBarModule();

    const hud = document.getElementById("hud") as HTMLDivElement;
    const final = document.getElementById("transcript-final") as HTMLSpanElement;
    const closeBtn = document.getElementById("hud-close-btn") as HTMLButtonElement;

    expect(hud.dataset.state).toBe("ERROR");
    expect(final.textContent).toContain("Startup bridge failed: bridge unavailable");

    closeBtn.click();

    expect(closeSpy).not.toHaveBeenCalled();
    expect(controllerMocks.handleClose).not.toHaveBeenCalled();
  });

  it("does not clear when bridge bootstraps unsuccessfully", async () => {
    bridge.waitForVoiceToTextBridge.mockRejectedValueOnce(new Error("bridge unavailable"));

    await bootstrapBarModule();

    const clearBtn = document.getElementById("hud-clear-btn") as HTMLButtonElement;
    clearBtn.click();

    expect(controllerMocks.handleClear).not.toHaveBeenCalled();
  });

  it("uses controller close path when bridge bootstraps successfully", async () => {
    window.voiceToText = {} as never;
    bridge.waitForVoiceToTextBridge.mockResolvedValueOnce(window.voiceToText);
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => {});

    await bootstrapBarModule();

    const closeBtn = document.getElementById("hud-close-btn") as HTMLButtonElement;
    closeBtn.click();
    await Promise.resolve();

    expect(controllerMocks.handleClose).toHaveBeenCalledTimes(1);
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it("uses controller clear path when bridge bootstraps successfully", async () => {
    window.voiceToText = {} as never;
    bridge.waitForVoiceToTextBridge.mockResolvedValueOnce(window.voiceToText);

    await bootstrapBarModule();

    const clearBtn = document.getElementById("hud-clear-btn") as HTMLButtonElement;
    clearBtn.click();
    await Promise.resolve();

    expect(controllerMocks.handleClear).toHaveBeenCalledTimes(1);
  });

  it("clears close-button hover suppression when the HUD hides", async () => {
    window.voiceToText = {} as never;
    bridge.waitForVoiceToTextBridge.mockResolvedValueOnce(window.voiceToText);

    await bootstrapBarModule();

    const closeBtn = document.getElementById("hud-close-btn") as HTMLButtonElement;
    closeBtn.click();
    await Promise.resolve();

    expect(closeBtn.dataset.hoverSuppressed).toBe("true");

    controllerMocks.instance?.onStateChange?.("HIDDEN");
    expect(closeBtn.dataset.hoverSuppressed).toBeUndefined();
  });
});
