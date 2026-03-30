import { beforeEach, describe, expect, it, vi } from "vitest";
import "../../tauri-bridge.js";

function installTauriRuntime(invoke: ReturnType<typeof vi.fn>): void {
  (window as Window & { __TAURI__?: unknown }).__TAURI__ = {
    core: { invoke },
    event: { listen: vi.fn(async () => () => {}) },
  };
}

describe("platform runtime bridge contract", () => {
  beforeEach(() => {
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = undefined;
  });

  it("exposes getPlatformRuntimeInfo through snake_case command", async () => {
    const runtimeInfo = {
      os: "macos",
      shortcutDisplay: "macos",
      permissionFlow: "system-settings-privacy",
      backgroundRecovery: "dockless-reopen",
      supportsFullscreenHud: true,
      requiresPrivilegedInsertionHelper: false,
    };
    const invoke = vi.fn(async () => runtimeInfo);
    installTauriRuntime(invoke);

    await expect(window.voiceToText.getPlatformRuntimeInfo()).resolves.toEqual(runtimeInfo);
    expect(invoke).toHaveBeenCalledWith("get_platform_runtime_info", undefined);
  });
});
