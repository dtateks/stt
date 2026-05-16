import { beforeEach, describe, expect, it, vi } from "vitest";

import { createUpdateBanner } from "../update-banner.ts";
import type { AppUpdate } from "../types.ts";

interface Harness {
  bannerEl: HTMLDivElement;
  textEl: HTMLSpanElement;
  actionBtnEl: HTMLButtonElement;
  checkForUpdate: ReturnType<typeof vi.fn<() => Promise<AppUpdate | null>>>;
  relaunch: ReturnType<typeof vi.fn<() => Promise<void>>>;
  check: () => Promise<void>;
}

function makeAppUpdate(overrides: Partial<AppUpdate> = {}): AppUpdate & {
  downloadAndInstall: ReturnType<typeof vi.fn<() => Promise<void>>>;
} {
  return {
    version: "1.2.3",
    downloadAndInstall: vi.fn(async () => {}),
    ...overrides,
  } as AppUpdate & { downloadAndInstall: ReturnType<typeof vi.fn<() => Promise<void>>> };
}

function buildHarness(overrides: {
  checkForUpdate?: () => Promise<AppUpdate | null>;
  relaunch?: () => Promise<void>;
} = {}): Harness {
  const bannerEl = document.createElement("div");
  bannerEl.classList.add("is-hidden");
  const textEl = document.createElement("span");
  const actionBtnEl = document.createElement("button");
  const checkForUpdate = vi.fn<() => Promise<AppUpdate | null>>(
    overrides.checkForUpdate ?? (async () => null),
  );
  const relaunch = vi.fn<() => Promise<void>>(
    overrides.relaunch ?? (async () => {}),
  );

  const banner = createUpdateBanner({
    bannerEl,
    textEl,
    actionBtnEl,
    checkForUpdate,
    relaunch,
  });

  return {
    bannerEl,
    textEl,
    actionBtnEl,
    checkForUpdate,
    relaunch,
    check: () => banner.check(),
  };
}

describe("createUpdateBanner", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  describe("check", () => {
    it("stays hidden when checkForUpdate returns null", async () => {
      const harness = buildHarness({ checkForUpdate: async () => null });

      await harness.check();

      expect(harness.bannerEl.classList.contains("is-hidden")).toBe(true);
      expect(harness.textEl.textContent).toBe("");
    });

    it("shows the banner with the version when an update is available", async () => {
      const update = makeAppUpdate({ version: "2.0.0" });
      const harness = buildHarness({ checkForUpdate: async () => update });

      await harness.check();

      expect(harness.bannerEl.classList.contains("is-hidden")).toBe(false);
      expect(harness.textEl.textContent).toBe("Update available: v2.0.0");
      expect(harness.actionBtnEl.textContent).toBe("Update");
      expect(harness.actionBtnEl.disabled).toBe(false);
    });

    it("hides the banner quietly when the probe rejects (offline path)", async () => {
      const harness = buildHarness({
        checkForUpdate: async () => {
          throw new Error("network unreachable");
        },
      });

      await harness.check();

      expect(harness.bannerEl.classList.contains("is-hidden")).toBe(true);
      // No error surface — probe failures are normal offline.
      expect(harness.textEl.textContent).toBe("");
    });
  });

  describe("action click — download + relaunch", () => {
    it("downloads, transitions to Restarting…, then relaunches on success", async () => {
      const update = makeAppUpdate();
      const harness = buildHarness({ checkForUpdate: async () => update });

      await harness.check();

      const clickPromise = (async () => {
        harness.actionBtnEl.click();
        // Allow the click handler's microtasks to schedule.
        await Promise.resolve();
        await Promise.resolve();
      })();

      // After the click handler kicks off, the banner reflects downloading state.
      await clickPromise;
      await Promise.resolve();
      await Promise.resolve();

      expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
      expect(harness.relaunch).toHaveBeenCalledTimes(1);
      // After relaunch, button label settled to "Restarting…" (never reset because the
      // process restarts).
      expect(harness.actionBtnEl.textContent).toBe("Restarting…");
    });

    it("disables the action button while downloading", async () => {
      let releaseDownload: () => void = () => {};
      const update = makeAppUpdate({
        downloadAndInstall: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              releaseDownload = resolve;
            }),
        ),
      });
      const harness = buildHarness({ checkForUpdate: async () => update });

      await harness.check();
      harness.actionBtnEl.click();
      // Let the click handler enter the download branch.
      await Promise.resolve();
      await Promise.resolve();

      expect(harness.actionBtnEl.disabled).toBe(true);
      expect(harness.actionBtnEl.textContent).toBe("Downloading…");

      releaseDownload();
      // Let the post-await branch run.
      await Promise.resolve();
      await Promise.resolve();
    });

    it("surfaces a download failure and offers Retry while keeping the banner visible", async () => {
      const update = makeAppUpdate({
        downloadAndInstall: vi.fn(async () => {
          throw new Error("bundle corrupt");
        }),
      });
      const harness = buildHarness({ checkForUpdate: async () => update });

      await harness.check();
      harness.actionBtnEl.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(harness.bannerEl.classList.contains("is-hidden")).toBe(false);
      expect(harness.textEl.textContent).toBe("Update failed: bundle corrupt");
      expect(harness.actionBtnEl.textContent).toBe("Retry");
      expect(harness.actionBtnEl.disabled).toBe(false);
      expect(harness.relaunch).not.toHaveBeenCalled();
    });

    it("ignores concurrent clicks while a download is in flight", async () => {
      let releaseDownload: () => void = () => {};
      const downloadAndInstall = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            releaseDownload = resolve;
          }),
      );
      const update = makeAppUpdate({ downloadAndInstall });
      const harness = buildHarness({ checkForUpdate: async () => update });

      await harness.check();
      harness.actionBtnEl.click();
      await Promise.resolve();
      harness.actionBtnEl.click();
      harness.actionBtnEl.click();
      await Promise.resolve();

      expect(downloadAndInstall).toHaveBeenCalledTimes(1);

      releaseDownload();
      await Promise.resolve();
      await Promise.resolve();
    });

    it("does nothing when clicked with no cached update", async () => {
      const harness = buildHarness({ checkForUpdate: async () => null });

      await harness.check();
      harness.actionBtnEl.click();
      await Promise.resolve();

      expect(harness.relaunch).not.toHaveBeenCalled();
    });
  });

  describe("retry after failure", () => {
    it("allows a second click to re-attempt download after a failure", async () => {
      let attempt = 0;
      const downloadAndInstall = vi.fn(async () => {
        attempt += 1;
        if (attempt === 1) {
          throw new Error("first attempt failed");
        }
      });
      const update = makeAppUpdate({ downloadAndInstall });
      const harness = buildHarness({ checkForUpdate: async () => update });

      await harness.check();

      harness.actionBtnEl.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(harness.actionBtnEl.textContent).toBe("Retry");

      harness.actionBtnEl.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(downloadAndInstall).toHaveBeenCalledTimes(2);
      expect(harness.relaunch).toHaveBeenCalledTimes(1);
    });
  });
});
