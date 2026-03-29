import { beforeEach, describe, expect, it, vi } from "vitest";
import "../../tauri-bridge.js";
import type { InsertTextResult, PermissionResult, PermissionsStatus } from "../types.ts";

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
    await window.voiceToText.correctTranscript("draft", "auto", {
      provider: "openai_compatible",
      model: "gpt-4o-mini",
      baseUrl: "https://example.test/v1",
    });
    await window.voiceToText.saveCredentials("xai", "soniox");
    await window.voiceToText.updateXaiKey("xai-new");
    await window.voiceToText.updateGeminiKey("gemini-new");
    await window.voiceToText.hasSonioxKey();
    await window.voiceToText.createSonioxTemporaryKey();
    await window.voiceToText.updateSonioxKey("soniox-new");
    await window.voiceToText.hasGeminiKey();
    await window.voiceToText.hasOpenaiCompatibleKey();
    await window.voiceToText.updateMicToggleShortcut("Control+Alt+Super+M");

    expect(invoke).toHaveBeenCalledWith("set_mic_state", { is_active: true });
    expect(invoke).toHaveBeenCalledWith("insert_text", {
      text: "hello",
      enter_mode: false,
    });
    expect(invoke).toHaveBeenCalledWith("correct_transcript", {
      transcript: "draft",
      output_lang: "auto",
      llm_provider: "openai_compatible",
      llm_model: "gpt-4o-mini",
      llm_base_url: "https://example.test/v1",
    });
    expect(invoke).toHaveBeenCalledWith("save_credentials", {
      xai_key: "xai",
      soniox_key: "soniox",
    });
    expect(invoke).toHaveBeenCalledWith("update_xai_key", {
      xai_key: "xai-new",
    });
    expect(invoke).toHaveBeenCalledWith("has_soniox_key", undefined);
    expect(invoke).toHaveBeenCalledWith("create_soniox_temporary_key", undefined);
    expect(invoke).toHaveBeenCalledWith("update_soniox_key", {
      soniox_key: "soniox-new",
    });
    expect(invoke).toHaveBeenCalledWith("update_openai_compatible_key", {
      openai_compatible_key: "gemini-new",
      provider: "gemini",
    });
    expect(invoke).toHaveBeenCalledWith("has_openai_compatible_key", {
      provider: "gemini",
    });
    expect(invoke).toHaveBeenCalledWith("has_openai_compatible_key", {
      provider: "openai_compatible",
    });
    expect(invoke).toHaveBeenCalledWith("update_mic_toggle_shortcut", {
      shortcut: "Control+Alt+Super+M",
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

    const invoke = vi.fn(async () => true);
    const listen = vi.fn(async () => () => {});
    const pendingHasKey = window.voiceToText.hasSonioxKey();

    setTimeout(() => {
      installTauriRuntime(invoke, listen);
    }, 25);

    await vi.advanceTimersByTimeAsync(30);

    await expect(pendingHasKey).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith("has_soniox_key", undefined);

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

    const pendingHasKey = window.voiceToText.hasSonioxKey();
    const rejection = expect(pendingHasKey).rejects.toThrow("Tauri IPC not available");

    await vi.advanceTimersByTimeAsync(10_000);

    await rejection;

    vi.useRealTimers();
  });

  it("wires listModels with provider and base_url through invoke", async () => {
    const models = ["grok-4-1-fast-non-reasoning", "grok-3"];
    const invoke = vi.fn(async () => models);
    const listen = vi.fn(async () => () => {});
    installTauriRuntime(invoke, listen);

    await expect(window.voiceToText.listModels("xai")).resolves.toEqual(models);
    expect(invoke).toHaveBeenCalledWith("list_models", {
      provider: "xai",
      base_url: null,
    });

    await window.voiceToText.listModels("openai_compatible", "https://api.openai.com/v1");
    expect(invoke).toHaveBeenCalledWith("list_models", {
      provider: "openai_compatible",
      base_url: "https://api.openai.com/v1",
    });

    await window.voiceToText.listModels("gemini");
    expect(invoke).toHaveBeenCalledWith("list_models", {
      provider: "gemini",
      base_url: null,
    });
  });

  it("wires checkPermissionsStatus and relaunchApp through invoke", async () => {
    const permissionsStatus: PermissionsStatus = {
      microphone: true,
      accessibility: false,
      automation: true,
    };
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(permissionsStatus)
      .mockResolvedValueOnce(undefined);
    const listen = vi.fn(async () => () => {});
    installTauriRuntime(invoke, listen);

    await expect(window.voiceToText.checkPermissionsStatus()).resolves.toEqual(
      permissionsStatus,
    );
    expect(invoke).toHaveBeenCalledWith("check_permissions_status", undefined);

    await window.voiceToText.relaunchApp();
    expect(invoke).toHaveBeenCalledWith("relaunch_app", undefined);
  });
});
