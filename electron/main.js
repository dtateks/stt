const {
  app,
  BrowserWindow,
  Tray,
  ipcMain,
  session,
  globalShortcut,
  screen,
  shell,
  systemPreferences,
} = require("electron");

// Disable ScreenCaptureKit — Chromium enables it by default on macOS,
// causing GPU process to burn CPU even though we only need the mic.
app.commandLine.appendSwitch("disable-features", "ScreenCaptureKitPickerScreen,ScreenCaptureKitStreamPickerSonoma,TimeoutHangingVideoCaptureStarts");

// Keep app running when all windows are closed (lives in tray)
app.on("window-all-closed", () => {
  // Don't quit on macOS — app stays in tray
  if (process.platform !== "darwin") app.quit();
});
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");

const textInserter = require("./text-inserter");
const llmService = require("./llm-service");
const credentials = require("./credentials");
const { createMacosPermissionCoordinator } = require("./macos-permissions");

// --- PATH fix for packaged app (Finder doesn't inherit shell PATH) ---
if (app.isPackaged) {
  const extraPaths = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  process.env.PATH = `${process.env.PATH}:${extraPaths.join(":")}`;
}

// --- Config path: extraResources when packaged, project root in dev ---
const configPath = app.isPackaged
  ? path.join(process.resourcesPath, "config.json")
  : path.join(__dirname, "..", "config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

let currentCredentials = credentials.getCredentials();
const macosPermissions = createMacosPermissionCoordinator({
  systemPreferences,
  shell,
});

function setCurrentCredentials(nextCredentials) {
  currentCredentials = {
    xaiKey: nextCredentials.xaiKey || "",
    sonioxKey: nextCredentials.sonioxKey || "",
  };
}

// --- Determine which page to show for settings ---
function getSettingsStartUrl() {
  const needsSetup = !credentials.hasCredentials();
  const page = needsSetup ? "setup.html" : "index.html";
  return `file://${path.join(__dirname, "..", "ui", page)}`;
}

const iconPath = path.join(__dirname, "..", "assets", "circleTemplate.png");
const activeIconPath = path.join(__dirname, "..", "assets", "circle-active.png");

let tray = null;
let settingsWin = null;
let barWin = null;

const UI_PAGE_URLS = Object.freeze({
  setup: pathToFileURL(path.join(__dirname, "..", "ui", "setup.html")).toString(),
  index: pathToFileURL(path.join(__dirname, "..", "ui", "index.html")).toString(),
  bar: pathToFileURL(path.join(__dirname, "..", "ui", "bar.html")).toString(),
});

const IPC_ALLOWED_URLS = Object.freeze({
  anyPage: new Set(Object.values(UI_PAGE_URLS)),
  setupOnly: new Set([UI_PAGE_URLS.setup]),
  indexOnly: new Set([UI_PAGE_URLS.index]),
  settingsPages: new Set([UI_PAGE_URLS.setup, UI_PAGE_URLS.index]),
  barOnly: new Set([UI_PAGE_URLS.bar]),
});

// --- Sender validation helper ---
// Validates that IPC sender is from an expected local UI page.
// Returns the sender URL on success, null on failure.
// Must be called synchronously at the start of every handle/on handler.
function validateSender(event, allowedUrls) {
  const frame = event.senderFrame;
  if (!frame) {
    console.warn("[security] IPC from null frame — rejected");
    return null;
  }
  const url = frame.url;
  if (!url || !allowedUrls.has(url)) {
    console.warn(`[security] IPC from untrusted URL: ${url}`);
    return null;
  }
  return url;
}

app.on("ready", () => {
  console.log("Voice to Text ready");

  // Auto-grant microphone permission
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      if (permission === "media") {
        callback(true);
      } else {
        callback(false);
      }
    }
  );

  // --- Tray icon ---
  tray = new Tray(iconPath);
  tray.setToolTip("Voice to Text");
  tray.on("click", () => {
    if (settingsWin) {
      if (settingsWin.isVisible()) {
        settingsWin.focus();
      } else {
        settingsWin.show();
      }
    }
  });

  // --- Settings window (focusable, for API keys / settings) ---
  settingsWin = new BrowserWindow({
    width: 360,
    height: 560,
    show: false,
    resizable: true,
    title: "Voice to Text",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  settingsWin.loadURL(getSettingsStartUrl());

  // Hide instead of close (keep running in tray)
  settingsWin.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      settingsWin.hide();
    }
  });

  // --- Bar window (floating, non-focusable) ---
  const display = screen.getPrimaryDisplay();
  const { width: screenW } = display.workAreaSize;
  const screenBottom = display.bounds.y + display.bounds.height; // absolute bottom of screen
  const barWidth = 600;
  const barHeight = 56;
  const barX = Math.round((screenW - barWidth) / 2);
  const barY = screenBottom - barHeight;

  barWin = new BrowserWindow({
    width: barWidth,
    height: barHeight,
    x: barX,
    y: barY,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    visibleOnAllWorkspaces: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  barWin.loadURL(`file://${path.join(__dirname, "..", "ui", "bar.html")}`);
  barWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  barWin.setIgnoreMouseEvents(true, { forward: true });

  // Start shown but visually hidden (CSS handles opacity) —
  // keeping the window "shown" is required for setVisibleOnAllWorkspaces to persist across spaces.
  barWin.showInactive();

  // Global shortcut: Ctrl+Option+Cmd+V to toggle mic
  const shortcutRegistered = globalShortcut.register("Control+Option+Command+V", () => {
    if (barWin) {
      barWin.webContents.send("toggle-mic");
    }
  });
  if (!shortcutRegistered) {
    console.error("[security] Global shortcut registration failed — shortcut will not work");
  }
});

// Quit properly when app.quit() is called
app.on("before-quit", () => {
  app.isQuitting = true;
  globalShortcut.unregisterAll();
});

// macOS: re-show settings window when dock icon clicked
app.on("activate", () => {
  if (settingsWin) settingsWin.show();
});

// --- IPC: Bar window control ---
ipcMain.on("show-bar", (event) => {
  if (!validateSender(event, IPC_ALLOWED_URLS.barOnly)) return;
  // Window is always shown — CSS handles visibility (opacity/pointer-events).
  // No-op; kept for IPC compatibility.
});

ipcMain.on("hide-bar", (event) => {
  if (!validateSender(event, IPC_ALLOWED_URLS.barOnly)) return;
  // Don't actually hide — the bar CSS handles visibility (opacity 0, pointer-events none).
  // Keeping the window shown avoids breaking setVisibleOnAllWorkspaces across spaces.
});

ipcMain.on("set-ignore-mouse", (event, ignore) => {
  if (!validateSender(event, IPC_ALLOWED_URLS.barOnly)) return;
  if (barWin) {
    if (ignore) {
      barWin.setIgnoreMouseEvents(true, { forward: true });
    } else {
      barWin.setIgnoreMouseEvents(false);
    }
  }
});

ipcMain.on("show-settings", (event) => {
  if (!validateSender(event, IPC_ALLOWED_URLS.barOnly)) return;
  if (settingsWin) {
    if (settingsWin.isVisible()) {
      settingsWin.focus();
    } else {
      settingsWin.show();
    }
  }
});

// --- IPC: Save credentials from setup page, then reload to main UI ---
ipcMain.handle("save-credentials", async (event, { xaiKey, sonioxKey }) => {
  if (!validateSender(event, IPC_ALLOWED_URLS.setupOnly)) return;
  credentials.saveCredentials(xaiKey, sonioxKey);
  setCurrentCredentials({ xaiKey, sonioxKey });
  settingsWin.loadURL(
    `file://${path.join(__dirname, "..", "ui", "index.html")}`
  );
});

// --- IPC: Update just the xAI key (without touching Soniox) ---
ipcMain.handle("update-xai-key", async (event, { xaiKey }) => {
  if (!validateSender(event, IPC_ALLOWED_URLS.indexOnly)) return;
  credentials.saveXaiKey(xaiKey);
  setCurrentCredentials({
    xaiKey,
    sonioxKey: currentCredentials.sonioxKey,
  });
});

// --- IPC: Reset credentials, go back to setup ---
ipcMain.handle("reset-credentials", async (event) => {
  if (!validateSender(event, IPC_ALLOWED_URLS.indexOnly)) return;
  credentials.clearCredentials();
  setCurrentCredentials({ xaiKey: "", sonioxKey: "" });
  settingsWin.loadURL(
    `file://${path.join(__dirname, "..", "ui", "setup.html")}`
  );
});

// --- IPC: Copy to clipboard ---
ipcMain.handle("copy-to-clipboard", async (event, text) => {
  if (!validateSender(event, IPC_ALLOWED_URLS.anyPage)) return;
  const { clipboard } = require("electron");
  clipboard.writeText(text);
});

// --- IPC: Quit app ---
ipcMain.on("quit-app", (event) => {
  if (!validateSender(event, IPC_ALLOWED_URLS.anyPage)) return;
  app.quit();
});

// Toggle tray icon when mic state changes
ipcMain.on("mic-state", (event, isActive) => {
  if (!validateSender(event, IPC_ALLOWED_URLS.barOnly)) return;
  const icon = isActive ? activeIconPath : iconPath;
  if (tray) tray.setImage(icon);
});

// Provide config to renderer
ipcMain.handle("get-config", async (event) => {
  if (!validateSender(event, IPC_ALLOWED_URLS.barOnly)) return;
  return config;
});

// Check/request microphone permission before renderer capture starts
ipcMain.handle("ensure-microphone-permission", async (event) => {
  if (!validateSender(event, IPC_ALLOWED_URLS.barOnly)) return;
  return macosPermissions.ensureMicrophonePermission();
});

// Insert text at cursor in frontmost app
ipcMain.handle("insert-text", async (event, { text, enterMode }) => {
  if (!validateSender(event, IPC_ALLOWED_URLS.barOnly)) return;

  const accessibilityPermission = await macosPermissions.ensureAccessibilityPermission();
  if (!accessibilityPermission.granted) {
    return {
      success: false,
      code: accessibilityPermission.code,
      error: accessibilityPermission.message,
      openedSettings: accessibilityPermission.openedSettings,
    };
  }

  try {
    await textInserter.insertText(text, { enterMode });
    return { success: true };
  } catch (err) {
    console.error("Failed to insert text:", err.message);
    return { success: false, error: err.message };
  }
});

// Correct transcript via LLM
ipcMain.handle(
  "correct-transcript",
  async (event, { transcript, outputLang }) => {
    if (!validateSender(event, IPC_ALLOWED_URLS.barOnly)) return;
    if (!currentCredentials.xaiKey) {
      throw new Error("xAI key not configured — run setup");
    }
    return await llmService.correctTranscript(
      transcript,
      currentCredentials.xaiKey,
      config.llm,
      outputLang
    );
  }
);

// Provide Soniox API key to renderer
ipcMain.handle("get-soniox-key", async (event) => {
  if (!validateSender(event, IPC_ALLOWED_URLS.barOnly)) return;
  return currentCredentials.sonioxKey;
});

// Check if xAI key is configured
ipcMain.handle("has-xai-key", async (event) => {
  if (!validateSender(event, IPC_ALLOWED_URLS.barOnly)) return;
  return !!currentCredentials.xaiKey;
});
