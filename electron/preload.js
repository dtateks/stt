const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("voiceEverywhere", {
  // Mic state (tray icon)
  setMicState: (isActive) => ipcRenderer.send("mic-state", isActive),

  // Text insertion (clipboard paste + AppleScript)
  insertText: (text, options) => ipcRenderer.invoke("insert-text", { text, ...options }),

  // LLM correction
  correctTranscript: (transcript) =>
    ipcRenderer.invoke("correct-transcript", { transcript }),

  // Soniox API key (for direct WebSocket from renderer)
  getSonioxKey: () => ipcRenderer.invoke("get-soniox-key"),

  // Check if xAI key is configured
  hasXaiKey: () => ipcRenderer.invoke("has-xai-key"),

  // Config
  getConfig: () => ipcRenderer.invoke("get-config"),

  // Setup: save credentials (Keychain)
  saveCredentials: (xaiKey, sonioxKey) =>
    ipcRenderer.invoke("save-credentials", { xaiKey, sonioxKey }),

  // Update just the xAI key (preserves Soniox key)
  updateXaiKey: (xaiKey) => ipcRenderer.invoke("update-xai-key", { xaiKey }),

  // Reset API keys (back to setup)
  resetCredentials: () => ipcRenderer.invoke("reset-credentials"),

  // Listen for toggle-mic from global shortcut
  onToggleMic: (callback) => ipcRenderer.on("toggle-mic", callback),

  // Copy to clipboard (navigator.clipboard fails in Electron)
  copyToClipboard: (text) => ipcRenderer.invoke("copy-to-clipboard", text),

  // Quit the app
  quitApp: () => ipcRenderer.send("quit-app"),
});
