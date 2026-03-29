/**
 * Tauri bridge initializer — injected into every WebView by Rust before page scripts run.
 *
 * This is the ONLY file that touches window.__TAURI__. All app code must go through
 * window.voiceToText. Plain JS only — no imports, no bundler.
 */
(function initBridge() {
  "use strict";

  var TAURI_READY_POLL_MS = 10;
  var TAURI_READY_TIMEOUT_MS = 10000;

  function waitForTauriApi(selectApi) {
    return new Promise(function(resolve, reject) {
      var startedAt = Date.now();

      function check() {
        var tauri = window.__TAURI__;
        var api = tauri ? selectApi(tauri) : undefined;
        if (api) {
          resolve(api);
          return;
        }

        if (Date.now() - startedAt >= TAURI_READY_TIMEOUT_MS) {
          reject(new Error("Tauri IPC not available"));
          return;
        }

        window.setTimeout(check, TAURI_READY_POLL_MS);
      }

      check();
    });
  }

  /**
   * Thin wrapper around the Tauri invoke IPC. Surfaces a stable promise-based
   * API even when __TAURI__ becomes available asynchronously in some WebView
   * contexts.
   */
  function invoke(command, args) {
    return waitForTauriApi(function(tauri) {
      return tauri.core;
    }).then(function(tauriCore) {
      return tauriCore.invoke(command, args);
    });
  }

  function listen(event, callback) {
    return waitForTauriApi(function(tauri) {
      return tauri.event;
    }).then(function(tauriEvent) {
      return tauriEvent.listen(event, callback);
    });
  }

  /** @type {import('./src/types').VoiceToTextBridge} */
  window.voiceToText = {
    setMicState: (isActive) =>
      invoke("set_mic_state", { is_active: isActive }),

    insertText: (text, opts) =>
      invoke("insert_text", {
        text,
        enter_mode: opts?.enterMode ?? false,
      }),

    correctTranscript: (transcript, outputLang, llmOptions) =>
      invoke("correct_transcript", {
        transcript,
        output_lang: outputLang ?? "auto",
        llm_provider: llmOptions?.provider,
        llm_model: llmOptions?.model,
        llm_base_url: llmOptions?.baseUrl,
      }),

    getSonioxKey: () =>
      invoke("get_soniox_key"),

    hasXaiKey: () =>
      invoke("has_xai_key"),

    hasGeminiKey: () =>
      invoke("has_openai_compatible_key", { provider: "gemini" }),

    hasOpenaiCompatibleKey: () =>
      invoke("has_openai_compatible_key", { provider: "openai_compatible" }),

    getConfig: () =>
      invoke("get_config"),

    ensureMicrophonePermission: () =>
      invoke("ensure_microphone_permission"),

    ensureAccessibilityPermission: () =>
      invoke("ensure_accessibility_permission"),

    ensureTextInsertionPermission: () =>
      invoke("ensure_text_insertion_permission"),

    checkPermissionsStatus: () =>
      invoke("check_permissions_status"),

    saveCredentials: (xaiKey, sonioxKey) =>
      invoke("save_credentials", { xai_key: xaiKey, soniox_key: sonioxKey }),

    updateXaiKey: (xaiKey) =>
      invoke("update_xai_key", { xai_key: xaiKey }),

    updateOpenaiCompatibleKey: (openaiCompatibleKey) =>
      invoke("update_openai_compatible_key", {
        openai_compatible_key: openaiCompatibleKey,
        provider: "openai_compatible",
      }),

    updateGeminiKey: (geminiKey) =>
      invoke("update_openai_compatible_key", {
        openai_compatible_key: geminiKey,
        provider: "gemini",
      }),

    updateSonioxKey: (sonioxKey) =>
      invoke("update_soniox_key", { soniox_key: sonioxKey }),

    listModels: (provider, baseUrl) =>
      invoke("list_models", { provider: provider ?? null, base_url: baseUrl ?? null }),

    resetCredentials: () =>
      invoke("reset_credentials"),

    onToggleMic: (callback) => {
      const unlistenPromise = listen("toggle-mic", callback);
      return () => {
        unlistenPromise.then((unlisten) => unlisten());
      };
    },

    copyToClipboard: (text) =>
      invoke("copy_to_clipboard", { text }),

    quitApp: () =>
      invoke("quit_app"),

    relaunchApp: () =>
      invoke("relaunch_app"),

    showBar: () =>
      invoke("show_bar"),

    hideBar: () =>
      invoke("hide_bar"),

    setMouseEvents: (ignore) =>
      invoke("set_mouse_events", { ignore }),

    showSettings: () =>
      invoke("show_settings"),

    getMicToggleShortcut: () =>
      invoke("get_mic_toggle_shortcut"),

    updateMicToggleShortcut: (shortcut) =>
      invoke("update_mic_toggle_shortcut", { shortcut }),
  };

  /**
   * Shared vocabulary defaults — single source of truth per the contract.
   * These are the fallback values when localStorage has no stored terms.
   */
  window.voiceToTextDefaults = {
    terms: [
      "Soniox",
      "xAI",
      "Grok",
      "Tauri",
    ],
    translationTerms: [],
  };
})();
