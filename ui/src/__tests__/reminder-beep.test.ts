import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createReminderBeepPlayer } from "../reminder-beep.ts";

type AudioContextState = "running" | "suspended" | "closed" | "interrupted";

interface MockOscillator {
  type: string;
  frequency: { value: number };
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
}

interface MockGain {
  gain: {
    setValueAtTime: ReturnType<typeof vi.fn>;
    exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
  };
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

interface MockAudioContext {
  state: AudioContextState;
  currentTime: number;
  destination: object;
  resume: ReturnType<typeof vi.fn>;
  createOscillator: ReturnType<typeof vi.fn<() => MockOscillator>>;
  createGain: ReturnType<typeof vi.fn<() => MockGain>>;
}

function buildMockContext(state: AudioContextState = "running"): MockAudioContext {
  return {
    state,
    currentTime: 0,
    destination: {},
    resume: vi.fn(async () => {
      ctx.state = "running";
    }),
    createOscillator: vi.fn<() => MockOscillator>(() => ({
      type: "",
      frequency: { value: 0 },
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
    })),
    createGain: vi.fn<() => MockGain>(() => ({
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),
  } as MockAudioContext;
  // (declared below by reference for resume() to mutate)
}

let ctx: MockAudioContext;
let ctorMock: ReturnType<typeof vi.fn>;
const realAudioContext = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;

function installAudioContextMock(initialState: AudioContextState = "running"): void {
  ctx = buildMockContext(initialState);
  ctorMock = vi.fn(() => ctx as unknown as AudioContext);
  (globalThis as { AudioContext?: unknown }).AudioContext = ctorMock;
}

function uninstallAudioContextMock(): void {
  if (realAudioContext) {
    (globalThis as { AudioContext?: typeof AudioContext }).AudioContext = realAudioContext;
  } else {
    delete (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  }
}

describe("createReminderBeepPlayer", () => {
  beforeEach(() => {
    installAudioContextMock("running");
  });

  afterEach(() => {
    uninstallAudioContextMock();
  });

  it("does not throw when AudioContext construction itself throws", () => {
    ctorMock.mockImplementationOnce(() => {
      throw new Error("audio unavailable");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const player = createReminderBeepPlayer();
    expect(() => player.play()).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("constructs a single AudioContext and reuses it across plays", () => {
    const player = createReminderBeepPlayer();
    player.play();
    player.play();
    player.play();

    expect(ctorMock).toHaveBeenCalledTimes(1);
  });

  it("rebuilds the AudioContext when the cached one is in the closed state", () => {
    const player = createReminderBeepPlayer();
    player.play();

    ctx.state = "closed";
    player.play();

    expect(ctorMock).toHaveBeenCalledTimes(2);
  });

  it("calls resume() on a suspended context", () => {
    installAudioContextMock("suspended");
    const player = createReminderBeepPlayer();

    player.play();

    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });

  it("wires oscillator + gain to the destination and schedules start/stop", () => {
    const player = createReminderBeepPlayer();
    player.play();

    expect(ctx.createOscillator).toHaveBeenCalledTimes(1);
    expect(ctx.createGain).toHaveBeenCalledTimes(1);

    const oscillator = ctx.createOscillator.mock.results[0]?.value as MockOscillator;
    const gain = ctx.createGain.mock.results[0]?.value as MockGain;

    expect(oscillator.type).toBe("sine");
    expect(oscillator.frequency.value).toBe(880);
    expect(oscillator.connect).toHaveBeenCalledWith(gain);
    expect(gain.connect).toHaveBeenCalledWith(ctx.destination);
    expect(oscillator.start).toHaveBeenCalled();
    expect(oscillator.stop).toHaveBeenCalled();
  });

  it("disconnects the oscillator and gain on onended so nodes do not leak", () => {
    const player = createReminderBeepPlayer();
    player.play();

    const oscillator = ctx.createOscillator.mock.results[0]?.value as MockOscillator;
    const gain = ctx.createGain.mock.results[0]?.value as MockGain;

    oscillator.onended?.();

    expect(oscillator.disconnect).toHaveBeenCalledTimes(1);
    expect(gain.disconnect).toHaveBeenCalledTimes(1);
  });

  it("does not throw when a single play() call errors mid-stream", () => {
    const player = createReminderBeepPlayer();
    ctx.createOscillator.mockImplementationOnce(() => {
      throw new Error("oscillator failed");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => player.play()).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
