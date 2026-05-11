/**
 * Missing-permissions banner with auto-clearing poll.
 *
 * Owns the full lifecycle:
 *   - render the denied list + per-result detail strings + a
 *     platform-specific "Review them in {Settings}" pointer
 *   - start a 2-second poll that re-checks the permission status; once
 *     all three (mic / accessibility / automation) flip to granted, the
 *     banner clears and the poll stops
 *   - safe to call `show()` while already showing — the poll guard
 *     prevents duplicate intervals
 *   - `hide()` is a no-op when nothing is shown, so init's "all-granted"
 *     branch can call it unconditionally
 *
 * The factory takes the `runtimeInfo` argument on every `show()` (not at
 * construction) because platform-runtime info loads asynchronously in
 * `main.ts` and can change after the factory is built.
 *
 * String-builder helpers (denied-name formatting, summary join, detail
 * concatenation, platform-aware settings-label) are private — moved out
 * of `main.ts` because the only other caller (`buildStartupPermissionMessage`)
 * was dead code and has been deleted.
 */
import type { PermissionsStatus, PlatformRuntimeInfo } from "./types.ts";

const POLL_INTERVAL_MS = 2_000;

export interface DeniedPermission {
  permission: string;
  message?: string;
}

export interface PermissionBannerOptions {
  bannerEl: HTMLElement;
  textEl: HTMLElement;
  checkPermissionsStatus: () => Promise<PermissionsStatus>;
}

export interface PermissionBanner {
  /** Render the banner copy and start the auto-clear poll. */
  show(denied: ReadonlyArray<DeniedPermission>, runtimeInfo: PlatformRuntimeInfo): void;
  /** Stop the poll and hide the banner. No-op if nothing is shown. */
  hide(): void;
}

export function createPermissionBanner(options: PermissionBannerOptions): PermissionBanner {
  const { bannerEl, textEl, checkPermissionsStatus } = options;

  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function stopPolling(): void {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function hide(): void {
    stopPolling();
    bannerEl.classList.add("is-hidden");
  }

  async function pollOnce(): Promise<void> {
    try {
      const status = await checkPermissionsStatus();
      if (status.microphone && status.accessibility && status.automation) {
        hide();
      }
    } catch {
      // Polling failure is not actionable — keep polling.
    }
  }

  function startPollingIfNeeded(): void {
    if (pollTimer !== null) return;
    pollTimer = setInterval(() => {
      void pollOnce();
    }, POLL_INTERVAL_MS);
  }

  function show(
    denied: ReadonlyArray<DeniedPermission>,
    runtimeInfo: PlatformRuntimeInfo,
  ): void {
    textEl.textContent = buildBannerCopy(denied, runtimeInfo);
    bannerEl.classList.remove("is-hidden");
    startPollingIfNeeded();
  }

  return { show, hide };
}

function buildBannerCopy(
  denied: ReadonlyArray<DeniedPermission>,
  runtimeInfo: PlatformRuntimeInfo,
): string {
  const summary = buildSummary(denied);
  const detail = buildDetailMessage(denied);
  const settingsLabel = getSettingsLabel(runtimeInfo);

  return [`Missing permissions: ${summary}.`, detail, `Review them in ${settingsLabel}.`]
    .filter(Boolean)
    .join(" ");
}

function buildSummary(denied: ReadonlyArray<DeniedPermission>): string {
  return denied.map((result) => formatPermissionName(result.permission)).join(", ");
}

function buildDetailMessage(denied: ReadonlyArray<DeniedPermission>): string | null {
  const details = denied
    .map((result) => result.message?.trim())
    .filter((message): message is string => Boolean(message));

  if (details.length === 0) {
    return null;
  }

  return details.join(" ");
}

function formatPermissionName(permission: string): string {
  return permission === "textInsertion" ? "text insertion" : permission;
}

function getSettingsLabel(runtimeInfo: PlatformRuntimeInfo): string {
  return runtimeInfo.os === "windows"
    ? "Windows Settings → Privacy & security"
    : "System Settings → Privacy & Security";
}
