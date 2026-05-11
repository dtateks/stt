/**
 * Soniox temporary API key cache with background refresh.
 *
 * Concentrates the prewarm + reuse + refresh-before-expiry behavior so the
 * session controller does not have to interleave timer state, in-flight
 * promise dedup, and the near-expiry mint retry with its own lifecycle.
 *
 * Contract (matches bar-session-controller behavior preserved across the
 * refactor):
 *   - `prewarm` mints once on init so the first toggle reuses a warm key.
 *   - `getKey` returns the cached key while the remaining lifetime is at
 *     least `refreshLeadMs`; otherwise it mints fresh.
 *   - Concurrent callers share a single in-flight mint promise.
 *   - When the minted key itself expires inside the lead window, the cache
 *     retries the mint up to `mintRetryCount` times before returning "".
 *   - `""` is the sentinel for "no long-lived Soniox key configured" or
 *     "temporary key has no usable expiry" — the caller surfaces the
 *     missing-key error.
 */
import type { SonioxTemporaryApiKeyResult } from "./types.ts";

export interface TemporaryApiKeyMintBridge {
  hasSonioxKey(): Promise<boolean>;
  createSonioxTemporaryKey(): Promise<SonioxTemporaryApiKeyResult>;
}

export interface TemporaryApiKeyCacheOptions {
  refreshLeadMs?: number;
  mintRetryCount?: number;
}

const DEFAULT_REFRESH_LEAD_MS = 60_000;
const DEFAULT_MINT_RETRY_COUNT = 1;

interface CachedKey {
  apiKey: string;
  expiresAtMs: number;
}

export class TemporaryApiKeyCache {
  private cached: CachedKey | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshPromise: Promise<string> | null = null;
  private readonly refreshLeadMs: number;
  private readonly mintRetryCount: number;

  constructor(
    private readonly bridge: TemporaryApiKeyMintBridge,
    options: TemporaryApiKeyCacheOptions = {},
  ) {
    this.refreshLeadMs = options.refreshLeadMs ?? DEFAULT_REFRESH_LEAD_MS;
    this.mintRetryCount = options.mintRetryCount ?? DEFAULT_MINT_RETRY_COUNT;
  }

  prewarm(): Promise<void> {
    return this.refresh().then(() => undefined);
  }

  getKey(): Promise<string> {
    const reusable = this.takeReusableKey();
    if (reusable) {
      return Promise.resolve(reusable.apiKey);
    }
    return this.refresh();
  }

  dispose(): void {
    this.invalidate();
    this.refreshPromise = null;
  }

  private takeReusableKey(): CachedKey | null {
    if (!this.cached) {
      return null;
    }

    if (this.cached.expiresAtMs - Date.now() <= this.refreshLeadMs) {
      this.cached = null;
      return null;
    }

    return this.cached;
  }

  private refresh(): Promise<string> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    const refreshPromise = this.mint(this.mintRetryCount);
    this.refreshPromise = refreshPromise;

    return refreshPromise.finally(() => {
      if (this.refreshPromise === refreshPromise) {
        this.refreshPromise = null;
      }
    });
  }

  private async mint(remainingRetryCount: number): Promise<string> {
    const hasSonioxKey = await this.bridge.hasSonioxKey();
    if (!hasSonioxKey) {
      this.invalidate();
      return "";
    }

    const result = await this.bridge.createSonioxTemporaryKey();
    const apiKey = result.apiKey.trim();
    if (!apiKey) {
      this.invalidate();
      return "";
    }

    const expiresAtMs = resolveExpiryMs(result);
    if (expiresAtMs === null) {
      this.invalidate();
      return apiKey;
    }

    if (expiresAtMs - Date.now() <= this.refreshLeadMs) {
      this.invalidate();
      if (remainingRetryCount > 0) {
        return this.mint(remainingRetryCount - 1);
      }
      return "";
    }

    this.cached = { apiKey, expiresAtMs };
    this.scheduleRefresh(expiresAtMs);
    return apiKey;
  }

  private scheduleRefresh(expiresAtMs: number): void {
    this.clearTimer();
    const refreshDelayMs = Math.max(
      0,
      expiresAtMs - Date.now() - this.refreshLeadMs,
    );
    this.refreshTimer = setTimeout(() => {
      void this.refresh().catch((error: unknown) => {
        console.error("[temporary-api-key-cache] background refresh failed", error);
      });
    }, refreshDelayMs);
  }

  private clearTimer(): void {
    if (this.refreshTimer === null) {
      return;
    }

    clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  private invalidate(): void {
    this.cached = null;
    this.clearTimer();
  }
}

function resolveExpiryMs(result: SonioxTemporaryApiKeyResult): number | null {
  if (result.expiresAt) {
    const expiresAtMs = Date.parse(result.expiresAt);
    if (Number.isFinite(expiresAtMs)) {
      return expiresAtMs;
    }
  }

  if (typeof result.expiresInSeconds === "number" && result.expiresInSeconds > 0) {
    return Date.now() + result.expiresInSeconds * 1_000;
  }

  return null;
}
