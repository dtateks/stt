import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMainWindowAutoFit } from "../main-window-auto-fit.ts";

const DEBOUNCE_MS = 80;

function attachTarget(scrollHeight: number): HTMLElement {
  const el = document.createElement("section");
  Object.defineProperty(el, "scrollHeight", {
    value: scrollHeight,
    configurable: true,
  });
  document.body.appendChild(el);
  return el;
}

describe("createMainWindowAutoFit", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires an initial fit with ceil(scrollHeight) after the debounce window", async () => {
    const target = attachTarget(612.4);
    const fit = vi.fn(async () => {});

    createMainWindowAutoFit({ targetEl: target, fit });

    expect(fit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(fit).toHaveBeenCalledTimes(1);
    expect(fit).toHaveBeenCalledWith(613);
  });

  it("does not crash when no fit callback is provided (legacy bridge)", async () => {
    const target = attachTarget(300);

    expect(() =>
      createMainWindowAutoFit({ targetEl: target }),
    ).not.toThrow();

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
  });

  it("swallows fit() rejections so sizing never blocks setup", async () => {
    const target = attachTarget(400);
    const fit = vi.fn(async () => {
      throw new Error("bridge unavailable");
    });

    createMainWindowAutoFit({ targetEl: target, fit });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    // Allow the swallowed catch to settle.
    await Promise.resolve();
    await Promise.resolve();

    expect(fit).toHaveBeenCalled();
  });

  it("skips the deferred fit if the target detached before the timer fired", async () => {
    const target = attachTarget(500);
    const fit = vi.fn(async () => {});

    createMainWindowAutoFit({ targetEl: target, fit });
    target.remove();

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(fit).not.toHaveBeenCalled();
  });

  it("dispose cancels the pending timer", async () => {
    const target = attachTarget(500);
    const fit = vi.fn(async () => {});

    const handle = createMainWindowAutoFit({ targetEl: target, fit });
    handle.dispose();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 3);

    expect(fit).not.toHaveBeenCalled();
  });

  it("dispose is idempotent", () => {
    const target = attachTarget(500);
    const fit = vi.fn(async () => {});

    const handle = createMainWindowAutoFit({ targetEl: target, fit });
    expect(() => {
      handle.dispose();
      handle.dispose();
    }).not.toThrow();
  });

  describe("ResizeObserver integration (when available)", () => {
    const realResizeObserver = globalThis.ResizeObserver;
    let observerCallback: ResizeObserverCallback | null = null;
    const disconnect = vi.fn();
    const observe = vi.fn();

    beforeEach(() => {
      observerCallback = null;
      disconnect.mockClear();
      observe.mockClear();
      globalThis.ResizeObserver = vi.fn((callback: ResizeObserverCallback) => {
        observerCallback = callback;
        return {
          observe,
          unobserve: vi.fn(),
          disconnect,
        } as unknown as ResizeObserver;
      }) as unknown as typeof ResizeObserver;
    });

    afterEach(() => {
      if (realResizeObserver) {
        globalThis.ResizeObserver = realResizeObserver;
      } else {
        delete (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
      }
    });

    it("observes the target element on construction", () => {
      const target = attachTarget(500);
      createMainWindowAutoFit({ targetEl: target, fit: vi.fn(async () => {}) });

      expect(observe).toHaveBeenCalledWith(target);
    });

    it("schedules a fit when the observer fires", async () => {
      const target = attachTarget(500);
      const fit = vi.fn(async () => {});

      createMainWindowAutoFit({ targetEl: target, fit });
      // Burn the initial scheduled fit.
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
      fit.mockClear();

      // Simulate a resize.
      observerCallback?.([] as ResizeObserverEntry[], {} as ResizeObserver);
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

      expect(fit).toHaveBeenCalledTimes(1);
    });

    it("collapses rapid resize bursts into a single fit call (debounce)", async () => {
      const target = attachTarget(500);
      const fit = vi.fn(async () => {});

      createMainWindowAutoFit({ targetEl: target, fit });
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
      fit.mockClear();

      observerCallback?.([] as ResizeObserverEntry[], {} as ResizeObserver);
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS / 2);
      observerCallback?.([] as ResizeObserverEntry[], {} as ResizeObserver);
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS / 2);
      observerCallback?.([] as ResizeObserverEntry[], {} as ResizeObserver);
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

      expect(fit).toHaveBeenCalledTimes(1);
    });

    it("self-disposes when the observer fires after detach", async () => {
      const target = attachTarget(500);
      const fit = vi.fn(async () => {});

      createMainWindowAutoFit({ targetEl: target, fit });
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

      target.remove();
      observerCallback?.([] as ResizeObserverEntry[], {} as ResizeObserver);

      expect(disconnect).toHaveBeenCalledTimes(1);

      // No further fit after burning more time.
      fit.mockClear();
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 3);
      expect(fit).not.toHaveBeenCalled();
    });
  });
});
