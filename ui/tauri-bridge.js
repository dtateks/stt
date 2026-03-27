/**
 * Tauri bridge initializer — injected into every WebView by Rust before page scripts run.
 *
 * This is the ONLY file that touches window.__TAURI__. All app code must go through
 * window.voiceToText. Plain JS only — no imports, no bundler.
 */
(function initBridge() {
  "use strict";

  /**
   * Thin wrapper around the Tauri invoke IPC. Surfaces a stable promise-based
   * API even when __TAURI__ becomes available asynchronously in some WebView
   * contexts.
   */
  function invoke(command, args) {
    if (window.__TAURI__?.core?.invoke) {
      return window.__TAURI__.core.invoke(command, args);
    }
    return Promise.reject(new Error("Tauri IPC not available"));
  }

  function listen(event, callback) {
    if (window.__TAURI__?.event?.listen) {
      return window.__TAURI__.event.listen(event, callback);
    }
    return Promise.resolve(() => {});
  }

  /** @type {import('./src/types').VoiceToTextBridge} */
  window.voiceToText = {
    setMicState: (isActive) =>
      invoke("set_mic_state", { isActive }),

    insertText: (text, opts) =>
      invoke("insert_text", {
        text,
        enterMode: opts?.enterMode ?? true,
      }),

    correctTranscript: (transcript, outputLang) =>
      invoke("correct_transcript", {
        transcript,
        outputLang: outputLang ?? "auto",
      }),

    getSonioxKey: () =>
      invoke("get_soniox_key"),

    hasXaiKey: () =>
      invoke("has_xai_key"),

    getConfig: () =>
      invoke("get_config"),

    ensureMicrophonePermission: () =>
      invoke("ensure_microphone_permission"),

    saveCredentials: (xaiKey, sonioxKey) =>
      invoke("save_credentials", { xaiKey, sonioxKey }),

    updateXaiKey: (xaiKey) =>
      invoke("update_xai_key", { xaiKey }),

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

    showBar: () =>
      invoke("show_bar"),

    hideBar: () =>
      invoke("hide_bar"),

    setMouseEvents: (ignore) =>
      invoke("set_mouse_events", { ignore }),

    showSettings: () =>
      invoke("show_settings"),
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
