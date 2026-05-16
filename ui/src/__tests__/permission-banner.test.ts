import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPermissionBanner, type DeniedPermission } from "../permission-banner.ts";
import type { PermissionsStatus, PlatformRuntimeInfo } from "../types.ts";

const MACOS_RUNTIME: PlatformRuntimeInfo = {
  os: "macos",
  shortcutDisplay: "macos",
  permissionFlow: "system-settings-privacy",
  backgroundRecovery: "dockless-reopen",
  supportsFullscreenHud: true,
  requiresPrivilegedInsertionHelper: false,
};

const WINDOWS_RUNTIME: PlatformRuntimeInfo = {
  os: "windows",
  shortcutDisplay: "windows",
  permissionFlow: "system-settings-privacy",
  backgroundRecovery: "tray-reopen",
  supportsFullscreenHud: true,
  requiresPrivilegedInsertionHelper: true,
};

interface Harness {
  bannerEl: HTMLDivElement;
  textEl: HTMLSpanElement;
  checkPermissionsStatus: ReturnType<typeof vi.fn<() => Promise<PermissionsStatus>>>;
  show: (denied: ReadonlyArray<DeniedPermission>, runtimeInfo: PlatformRuntimeInfo) => void;
  hide: () => void;
}

function buildHarness(
  checkPermissionsStatus?: () => Promise<PermissionsStatus>,
): Harness {
  const bannerEl = document.createElement("div");
  bannerEl.classList.add("is-hidden");
  const textEl = document.createElement("span");
  const probe = vi.fn<() => Promise<PermissionsStatus>>(
    checkPermissionsStatus ??
      (async () => ({ microphone: true, accessibility: true, automation: true })),
  );

  const banner = createPermissionBanner({
    bannerEl,
    textEl,
    checkPermissionsStatus: probe,
  });

  return {
    bannerEl,
    textEl,
    checkPermissionsStatus: probe,
    show: banner.show,
    hide: banner.hide,
  };
}

describe("createPermissionBanner", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("show — copy", () => {
    it("renders denied names, detail messages, and the macOS settings pointer", () => {
      const harness = buildHarness();

      harness.show(
        [
          { permission: "microphone", message: "Enable mic." },
          { permission: "accessibility", message: "Enable AX." },
        ],
        MACOS_RUNTIME,
      );

      expect(harness.bannerEl.classList.contains("is-hidden")).toBe(false);
      expect(harness.textEl.textContent).toBe(
        "Missing permissions: microphone, accessibility. Enable mic. Enable AX. Review them in System Settings → Privacy & Security.",
      );
    });

    it("renames textInsertion to 'text insertion' in the summary", () => {
      const harness = buildHarness();

      harness.show(
        [{ permission: "textInsertion" }],
        MACOS_RUNTIME,
      );

      expect(harness.textEl.textContent).toContain("Missing permissions: text insertion.");
    });

    it("omits the detail line when no denied result has a message", () => {
      const harness = buildHarness();

      harness.show(
        [{ permission: "microphone" }, { permission: "accessibility" }],
        MACOS_RUNTIME,
      );

      expect(harness.textEl.textContent).toBe(
        "Missing permissions: microphone, accessibility. Review them in System Settings → Privacy & Security.",
      );
    });

    it("uses the Windows settings pointer when runtimeInfo.os is windows", () => {
      const harness = buildHarness();

      harness.show([{ permission: "microphone" }], WINDOWS_RUNTIME);

      expect(harness.textEl.textContent).toContain(
        "Review them in Windows Settings → Privacy & security.",
      );
    });
  });

  describe("auto-clear poll", () => {
    it("hides + stops polling once all three permissions flip to granted", async () => {
      let granted = false;
      const harness = buildHarness(async () => ({
        microphone: granted,
        accessibility: granted,
        automation: granted,
      }));

      harness.show([{ permission: "microphone" }], MACOS_RUNTIME);
      expect(harness.bannerEl.classList.contains("is-hidden")).toBe(false);

      await vi.advanceTimersByTimeAsync(2_000);
      expect(harness.bannerEl.classList.contains("is-hidden")).toBe(false);

      granted = true;
      await vi.advanceTimersByTimeAsync(2_000);
      expect(harness.bannerEl.classList.contains("is-hidden")).toBe(true);

      // Further ticks should not re-poll once the banner has cleared itself.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(harness.checkPermissionsStatus).toHaveBeenCalledTimes(2);
    });

    it("keeps the banner up when only some permissions are granted", async () => {
      const harness = buildHarness(async () => ({
        microphone: true,
        accessibility: true,
        automation: false,
      }));

      harness.show([{ permission: "automation" }], MACOS_RUNTIME);

      await vi.advanceTimersByTimeAsync(4_000);
      expect(harness.bannerEl.classList.contains("is-hidden")).toBe(false);
    });

    it("survives a probe rejection and keeps polling", async () => {
      let shouldReject = true;
      const harness = buildHarness(async () => {
        if (shouldReject) {
          throw new Error("probe failed");
        }
        return { microphone: true, accessibility: true, automation: true };
      });

      harness.show([{ permission: "microphone" }], MACOS_RUNTIME);

      await vi.advanceTimersByTimeAsync(2_000);
      expect(harness.bannerEl.classList.contains("is-hidden")).toBe(false);

      shouldReject = false;
      await vi.advanceTimersByTimeAsync(2_000);
      expect(harness.bannerEl.classList.contains("is-hidden")).toBe(true);
    });

    it("does not start a second interval on a duplicate show() while polling", async () => {
      const harness = buildHarness(async () => ({
        microphone: false,
        accessibility: false,
        automation: false,
      }));

      harness.show([{ permission: "microphone" }], MACOS_RUNTIME);
      harness.show([{ permission: "accessibility" }], MACOS_RUNTIME);

      await vi.advanceTimersByTimeAsync(2_000);
      expect(harness.checkPermissionsStatus).toHaveBeenCalledTimes(1);
    });
  });

  describe("hide", () => {
    it("hides the banner and stops the poll", async () => {
      const harness = buildHarness();
      harness.show([{ permission: "microphone" }], MACOS_RUNTIME);

      harness.hide();
      await vi.advanceTimersByTimeAsync(10_000);

      expect(harness.bannerEl.classList.contains("is-hidden")).toBe(true);
      expect(harness.checkPermissionsStatus).not.toHaveBeenCalled();
    });

    it("is a no-op when nothing is shown", () => {
      const harness = buildHarness();
      harness.bannerEl.classList.add("is-hidden");

      expect(() => harness.hide()).not.toThrow();
      expect(harness.bannerEl.classList.contains("is-hidden")).toBe(true);
    });
  });
});
