import { beforeEach, describe, expect, it, vi } from "vitest";
import "../../tauri-bridge.js";
import type { InsertTextResult, PermissionResult } from "../types.ts";

function installTauriRuntime(
  invoke: ReturnType<typeof vi.fn>,
  listen: ReturnType<typeof vi.fn>,
): void {
  (window as Window & { __TAURI__?: unknown }).__TAURI__ = {
    core: { invoke },
    event: { listen },
  };
}

describe("tauri bridge command contract", () => {
  beforeEach(() => {
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = undefined;
  });

  it("sends snake_case payload keys and aligned defaults", async () => {
    const invoke = vi.fn(async () => undefined);
    const listen = vi.fn(async () => () => {});
    installTauriRuntime(invoke, listen);

    await window.voiceToText.setMicState(true);
    await window.voiceToText.insertText("hello");
    await window.voiceToText.correctTranscript("draft", "auto");
    await window.voiceToText.saveCredentials("xai", "soniox");
    await window.voiceToText.updateXaiKey("xai-new");

    expect(invoke).toHaveBeenCalledWith("set_mic_state", { is_active: true });
    expect(invoke).toHaveBeenCalledWith("insert_text", {
      text: "hello",
      enter_mode: false,
    });
    expect(invoke).toHaveBeenCalledWith("correct_transcript", {
      transcript: "draft",
      output_lang: "auto",
    });
    expect(invoke).toHaveBeenCalledWith("save_credentials", {
      xai_key: "xai",
      soniox_key: "soniox",
    });
    expect(invoke).toHaveBeenCalledWith("update_xai_key", {
      xai_key: "xai-new",
    });
  });

  it("wires toggle listener and cleanup through Tauri events", async () => {
    const invoke = vi.fn(async () => undefined);
    const unlisten = vi.fn();
    const listen = vi.fn(async () => unlisten);
    const callback = vi.fn();
    installTauriRuntime(invoke, listen);

    const cleanup = window.voiceToText.onToggleMic(callback);
    await Promise.resolve();
    await Promise.resolve();
    expect(listen).toHaveBeenCalledWith("toggle-mic", callback);

    cleanup();
    await Promise.resolve();
    await Promise.resolve();

    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("preserves serialized permission and insertion result shapes", async () => {
    const deniedPermission: PermissionResult = {
      granted: false,
      status: "denied",
      code: "microphone-permission-required",
      openedSettings: false,
      message: "Grant microphone permission in System Settings.",
    };
    const grantedPermission: PermissionResult = { granted: true };
    const insertionFailure: InsertTextResult = {
      success: false,
      error: "Clipboard restore failed",
      code: "clipboard-restore-failed",
      openedSettings: false,
    };
    const insertionSuccess: InsertTextResult = { success: true };

    const invoke = vi
      .fn()
      .mockResolvedValueOnce(deniedPermission)
      .mockResolvedValueOnce(grantedPermission)
      .mockResolvedValueOnce(grantedPermission)
      .mockResolvedValueOnce(insertionFailure)
      .mockResolvedValueOnce(insertionSuccess);
    const listen = vi.fn(async () => () => {});
    installTauriRuntime(invoke, listen);

    await expect(window.voiceToText.ensureMicrophonePermission()).resolves.toEqual(
      deniedPermission,
    );
    await expect(window.voiceToText.ensureAccessibilityPermission()).resolves.toEqual(
      grantedPermission,
    );
    await expect(window.voiceToText.ensureTextInsertionPermission()).resolves.toEqual(
      grantedPermission,
    );
    await expect(window.voiceToText.insertText("hello", { enterMode: true })).resolves.toEqual(
      insertionFailure,
    );
    await expect(window.voiceToText.insertText("hello")).resolves.toEqual(insertionSuccess);
  });

  it("waits for Tauri invoke to become available during startup", async () => {
    vi.useFakeTimers();

    const invoke = vi.fn(async () => "soniox-key");
    const listen = vi.fn(async () => () => {});
    const pendingKey = window.voiceToText.getSonioxKey();

    setTimeout(() => {
      installTauriRuntime(invoke, listen);
    }, 25);

    await vi.advanceTimersByTimeAsync(30);

    await expect(pendingKey).resolves.toBe("soniox-key");
    expect(invoke).toHaveBeenCalledWith("get_soniox_key", undefined);

    vi.useRealTimers();
  });

  it("waits for Tauri event bridge before registering listeners", async () => {
    vi.useFakeTimers();

    const invoke = vi.fn(async () => undefined);
    const unlisten = vi.fn();
    const listen = vi.fn(async () => unlisten);
    const callback = vi.fn();
    const cleanup = window.voiceToText.onToggleMic(callback);

    setTimeout(() => {
      installTauriRuntime(invoke, listen);
    }, 25);

    await vi.advanceTimersByTimeAsync(30);
    await Promise.resolve();

    expect(listen).toHaveBeenCalledWith("toggle-mic", callback);

    cleanup();
    await Promise.resolve();

    expect(unlisten).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("rejects when the Tauri IPC bridge never becomes available", async () => {
    vi.useFakeTimers();

    const pendingKey = window.voiceToText.getSonioxKey();
    const rejection = expect(pendingKey).rejects.toThrow("Tauri IPC not available");

    await vi.advanceTimersByTimeAsync(10_000);

    await rejection;

    vi.useRealTimers();
  });
});
