/**
 * Auto-update notification banner.
 *
 * Owns the full update lifecycle:
 *   - probe for a new version via the caller-provided `checkForUpdate`
 *     (which wraps `tauri-plugin-updater`)
 *   - show / hide the banner element + label/button state
 *   - download + install on action-button click
 *   - relaunch the app on success
 *   - surface failures with a "Retry" affordance, keeping the banner
 *     visible so the user can re-click
 *
 * The factory owns `cachedAvailableUpdate` and the `isDownloading` flag;
 * `main.ts` only triggers checks (after key verification, after a
 * credential save, on revalidation). Three call sites become three
 * `void updateBanner.check()` fire-and-forget calls.
 *
 * Preserved invariants:
 *   - `isDownloading` is set false only on the error path. Success path's
 *     `relaunch` terminates the process before any further state update
 *     would matter.
 *   - On failure, the banner stays visible with a "Retry" button; never
 *     auto-hidden because the user needs the affordance.
 *   - `check()` swallows probe failures by hiding the banner — failed
 *     probes are a normal offline condition, not a user-facing error.
 */
import type { AppUpdate } from "./types.ts";

export interface UpdateBannerOptions {
  bannerEl: HTMLElement;
  textEl: HTMLElement;
  actionBtnEl: HTMLButtonElement;
  /** Returns the available update or null if up-to-date. Errors surface as null. */
  checkForUpdate: () => Promise<AppUpdate | null>;
  /** Restart the app after a successful download+install. */
  relaunch: () => Promise<void>;
}

export interface UpdateBanner {
  /** Probe the updater; on hit, display the banner. Failures hide the banner. */
  check(): Promise<void>;
}

const UPDATE_BUTTON_LABEL = "Update";
const UPDATE_DOWNLOADING_LABEL = "Downloading…";
const UPDATE_RETRY_LABEL = "Retry";
const UPDATE_RESTARTING_LABEL = "Restarting…";

export function createUpdateBanner(options: UpdateBannerOptions): UpdateBanner {
  const { bannerEl, textEl, actionBtnEl, checkForUpdate, relaunch } = options;

  let cachedAvailableUpdate: AppUpdate | null = null;
  let isDownloading = false;

  function showFor(version: string): void {
    textEl.textContent = `Update available: v${version}`;
    actionBtnEl.textContent = UPDATE_BUTTON_LABEL;
    actionBtnEl.disabled = false;
    bannerEl.classList.remove("is-hidden");
  }

  function hide(): void {
    bannerEl.classList.add("is-hidden");
  }

  async function installAndRelaunch(): Promise<void> {
    if (!cachedAvailableUpdate || isDownloading) {
      return;
    }

    isDownloading = true;
    actionBtnEl.textContent = UPDATE_DOWNLOADING_LABEL;
    actionBtnEl.disabled = true;

    try {
      await cachedAvailableUpdate.downloadAndInstall();
      actionBtnEl.textContent = UPDATE_RESTARTING_LABEL;
      await relaunch();
    } catch (error) {
      // Keep the banner visible with a retry affordance; the user needs
      // a way to re-attempt without re-triggering the probe.
      const message = error instanceof Error ? error.message : String(error);
      textEl.textContent = `Update failed: ${message}`;
      actionBtnEl.textContent = UPDATE_RETRY_LABEL;
      actionBtnEl.disabled = false;
      isDownloading = false;
    }
  }

  actionBtnEl.addEventListener("click", () => {
    void installAndRelaunch();
  });

  return {
    async check() {
      try {
        const update = await checkForUpdate();
        if (!update) {
          return;
        }

        cachedAvailableUpdate = update;
        showFor(update.version);
      } catch {
        // Probe failure is a normal offline condition — hide quietly.
        hide();
      }
    },
  };
}
