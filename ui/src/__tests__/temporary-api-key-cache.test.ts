import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TemporaryApiKeyCache } from "../temporary-api-key-cache.ts";
import type { SonioxTemporaryApiKeyResult } from "../types.ts";

interface BridgeMocks {
  hasSonioxKey: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
  createSonioxTemporaryKey: ReturnType<
    typeof vi.fn<() => Promise<SonioxTemporaryApiKeyResult>>
  >;
}

function createBridge(): BridgeMocks {
  return {
    hasSonioxKey: vi.fn(async () => true),
    createSonioxTemporaryKey: vi.fn(async () => ({
      apiKey: "tk-fresh",
      expiresInSeconds: 3_600,
    })),
  };
}

describe("TemporaryApiKeyCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("mints fresh when no cached key is present", async () => {
    const bridge = createBridge();
    const cache = new TemporaryApiKeyCache(bridge);

    await expect(cache.getKey()).resolves.toBe("tk-fresh");
    expect(bridge.createSonioxTemporaryKey).toHaveBeenCalledTimes(1);
  });

  it("returns the cached key while its remaining lifetime exceeds the refresh lead", async () => {
    const bridge = createBridge();
    const cache = new TemporaryApiKeyCache(bridge);

    await cache.getKey();
    await cache.getKey();

    expect(bridge.createSonioxTemporaryKey).toHaveBeenCalledTimes(1);
  });

  it("trims whitespace from the bridge's apiKey before caching", async () => {
    const bridge = createBridge();
    bridge.createSonioxTemporaryKey.mockResolvedValueOnce({
      apiKey: "   tk-padded   ",
      expiresInSeconds: 3_600,
    });
    const cache = new TemporaryApiKeyCache(bridge);

    await expect(cache.getKey()).resolves.toBe("tk-padded");
  });

  it("returns empty when no long-lived Soniox key is configured", async () => {
    const bridge = createBridge();
    bridge.hasSonioxKey.mockResolvedValueOnce(false);
    const cache = new TemporaryApiKeyCache(bridge);

    await expect(cache.getKey()).resolves.toBe("");
    expect(bridge.createSonioxTemporaryKey).not.toHaveBeenCalled();
  });

  it("returns empty when the bridge returns a blank apiKey", async () => {
    const bridge = createBridge();
    bridge.createSonioxTemporaryKey.mockResolvedValueOnce({
      apiKey: "   ",
      expiresInSeconds: 3_600,
    });
    const cache = new TemporaryApiKeyCache(bridge);

    await expect(cache.getKey()).resolves.toBe("");
  });

  it("returns the apiKey without caching when no expiry is provided", async () => {
    const bridge = createBridge();
    bridge.createSonioxTemporaryKey.mockResolvedValueOnce({
      apiKey: "tk-no-expiry",
    });
    const cache = new TemporaryApiKeyCache(bridge);

    await expect(cache.getKey()).resolves.toBe("tk-no-expiry");
    // Second call should re-mint because nothing was cached.
    await cache.getKey();
    expect(bridge.createSonioxTemporaryKey).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent mint requests", async () => {
    const bridge = createBridge();
    const cache = new TemporaryApiKeyCache(bridge);

    const [first, second] = await Promise.all([cache.getKey(), cache.getKey()]);

    expect(first).toBe("tk-fresh");
    expect(second).toBe("tk-fresh");
    expect(bridge.createSonioxTemporaryKey).toHaveBeenCalledTimes(1);
  });

  it("re-mints when the cached key falls inside the refresh-lead window", async () => {
    const bridge = createBridge();
    bridge.createSonioxTemporaryKey
      .mockResolvedValueOnce({ apiKey: "tk-near-expiry", expiresInSeconds: 90 })
      .mockResolvedValueOnce({ apiKey: "tk-refreshed", expiresInSeconds: 3_600 });
    const cache = new TemporaryApiKeyCache(bridge, { refreshLeadMs: 60_000 });

    await expect(cache.getKey()).resolves.toBe("tk-near-expiry");

    vi.advanceTimersByTime(45_000); // remaining lifetime = 45s, under the 60s lead.
    await expect(cache.getKey()).resolves.toBe("tk-refreshed");
    expect(bridge.createSonioxTemporaryKey).toHaveBeenCalledTimes(2);
  });

  it("retries the mint when the minted key is already inside the refresh-lead window", async () => {
    const bridge = createBridge();
    bridge.createSonioxTemporaryKey
      .mockResolvedValueOnce({ apiKey: "tk-doa", expiresInSeconds: 5 })
      .mockResolvedValueOnce({ apiKey: "tk-good", expiresInSeconds: 3_600 });
    const cache = new TemporaryApiKeyCache(bridge, {
      refreshLeadMs: 60_000,
      mintRetryCount: 1,
    });

    await expect(cache.getKey()).resolves.toBe("tk-good");
    expect(bridge.createSonioxTemporaryKey).toHaveBeenCalledTimes(2);
  });

  it("returns empty after the mint-retry budget is exhausted", async () => {
    const bridge = createBridge();
    bridge.createSonioxTemporaryKey.mockResolvedValue({
      apiKey: "tk-always-doa",
      expiresInSeconds: 5,
    });
    const cache = new TemporaryApiKeyCache(bridge, {
      refreshLeadMs: 60_000,
      mintRetryCount: 2,
    });

    await expect(cache.getKey()).resolves.toBe("");
    expect(bridge.createSonioxTemporaryKey).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("prefers the absolute expiresAt timestamp over expiresInSeconds", async () => {
    const bridge = createBridge();
    bridge.createSonioxTemporaryKey.mockResolvedValueOnce({
      apiKey: "tk-absolute",
      expiresAt: "2026-01-01T01:00:00Z", // one hour after fake now
      expiresInSeconds: 1, // would be invalid; expiresAt wins
    });
    const cache = new TemporaryApiKeyCache(bridge);

    await expect(cache.getKey()).resolves.toBe("tk-absolute");
    // Re-issue immediately; cache lifetime is ~1 hour minus the 60s lead.
    await cache.getKey();
    expect(bridge.createSonioxTemporaryKey).toHaveBeenCalledTimes(1);
  });

  it("falls back to expiresInSeconds when expiresAt is unparseable", async () => {
    const bridge = createBridge();
    bridge.createSonioxTemporaryKey.mockResolvedValueOnce({
      apiKey: "tk-fallback",
      expiresAt: "not-a-real-date",
      expiresInSeconds: 3_600,
    });
    const cache = new TemporaryApiKeyCache(bridge);

    await expect(cache.getKey()).resolves.toBe("tk-fallback");
    await cache.getKey();
    expect(bridge.createSonioxTemporaryKey).toHaveBeenCalledTimes(1);
  });

  it("prewarm mints once so the first getKey reuses the warm key", async () => {
    const bridge = createBridge();
    const cache = new TemporaryApiKeyCache(bridge);

    await cache.prewarm();
    await cache.getKey();

    expect(bridge.createSonioxTemporaryKey).toHaveBeenCalledTimes(1);
  });

  it("dispose clears the cached key so the next getKey re-mints", async () => {
    const bridge = createBridge();
    const cache = new TemporaryApiKeyCache(bridge);

    await cache.getKey();
    cache.dispose();
    await cache.getKey();

    expect(bridge.createSonioxTemporaryKey).toHaveBeenCalledTimes(2);
  });

  it("schedules a background refresh that fires before expiry", async () => {
    const bridge = createBridge();
    bridge.createSonioxTemporaryKey
      .mockResolvedValueOnce({ apiKey: "tk-first", expiresInSeconds: 3_600 })
      .mockResolvedValueOnce({ apiKey: "tk-refreshed", expiresInSeconds: 3_600 });
    const cache = new TemporaryApiKeyCache(bridge, { refreshLeadMs: 60_000 });

    await cache.getKey();
    expect(bridge.createSonioxTemporaryKey).toHaveBeenCalledTimes(1);

    // Advance to one millisecond after the scheduled refresh (3_600_000 - 60_000 = 3_540_000ms).
    await vi.advanceTimersByTimeAsync(3_540_001);

    expect(bridge.createSonioxTemporaryKey).toHaveBeenCalledTimes(2);
    await expect(cache.getKey()).resolves.toBe("tk-refreshed");
  });
});
