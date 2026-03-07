const { app, BrowserWindow, Tray, ipcMain, session, globalShortcut, screen } = require("electron");

// Disable ScreenCaptureKit — Chromium enables it by default on macOS,
// causing GPU process to burn CPU even though we only need the mic.
app.commandLine.appendSwitch("disable-features", "ScreenCaptureKitPickerScreen,ScreenCaptureKitStreamPickerSonoma,TimeoutHangingVideoCaptureStarts");
app.commandLine.appendSwitch("disable-gpu");

// Keep app running when all windows are closed (lives in tray)
app.on("window-all-closed", () => {
  // Don't quit on macOS — app stays in tray
  if (process.platform !== "darwin") app.quit();
});
const path = require("path");
const fs = require("fs");

const textInserter = require("./text-inserter");
const llmService = require("./llm-service");
const credentials = require("./credentials");

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

// --- Load credentials: Keychain → shell env vars → .env fallback ---
function loadApiKeys() {
  // Only source: stored credentials (user-entered via setup page)
  // No shell env, no .env fallback — avoids stale/expired key confusion
  const creds = credentials.getCredentials();
  if (creds.xaiKey) process.env.XAI_API_KEY = creds.xaiKey;
  if (creds.sonioxKey) process.env.SONIOX_API_KEY = creds.sonioxKey;
}

loadApiKeys();

// Log which keys are loaded (redacted) for debugging
const xaiK = process.env.XAI_API_KEY || "";
const sonK = process.env.SONIOX_API_KEY || "";
console.log(`[keys] XAI: ${xaiK.slice(0, 10)}...${xaiK.slice(-4)} | Soniox: ${sonK ? sonK.slice(0, 8) + "..." + sonK.slice(-4) : "NOT SET"}`);

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

app.on("ready", () => {
  console.log("Voice Everywhere ready");

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
  tray.setToolTip("Voice Everywhere");
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
    title: "Voice Everywhere",
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

  // Start hidden
  barWin.showInactive();

  // Global shortcut: Ctrl+Option+Cmd+V to toggle mic
  globalShortcut.register("Control+Option+Command+V", () => {
    if (barWin) {
      barWin.webContents.send("toggle-mic");
    }
  });
});

// Quit properly when app.quit() is called
app.on("before-quit", () => {
  app.isQuitting = true;
});

// macOS: re-show settings window when dock icon clicked
app.on("activate", () => {
  if (settingsWin) settingsWin.show();
});

// --- IPC: Bar window control ---
ipcMain.on("show-bar", () => {
  if (barWin) barWin.showInactive();
});

ipcMain.on("hide-bar", () => {
  // Don't actually hide — the bar CSS handles visibility (opacity 0, pointer-events none)
  // Keeping the window shown avoids mic permission issues on re-show
});

ipcMain.on("set-ignore-mouse", (_event, ignore) => {
  if (barWin) {
    if (ignore) {
      barWin.setIgnoreMouseEvents(true, { forward: true });
    } else {
      barWin.setIgnoreMouseEvents(false);
    }
  }
});

ipcMain.on("show-settings", () => {
  if (settingsWin) {
    if (settingsWin.isVisible()) {
      settingsWin.focus();
    } else {
      settingsWin.show();
    }
  }
});

// --- IPC: Save credentials from setup page, then reload to main UI ---
ipcMain.handle("save-credentials", async (_event, { xaiKey, sonioxKey }) => {
  credentials.saveCredentials(xaiKey, sonioxKey);
  process.env.XAI_API_KEY = xaiKey;
  process.env.SONIOX_API_KEY = sonioxKey;
  settingsWin.loadURL(
    `file://${path.join(__dirname, "..", "ui", "index.html")}`
  );
});

// --- IPC: Update just the xAI key (without touching Soniox) ---
ipcMain.handle("update-xai-key", async (_event, { xaiKey }) => {
  credentials.saveXaiKey(xaiKey);
  process.env.XAI_API_KEY = xaiKey;
});

// --- IPC: Reset credentials, go back to setup ---
ipcMain.handle("reset-credentials", async () => {
  credentials.clearCredentials();
  delete process.env.XAI_API_KEY;
  delete process.env.SONIOX_API_KEY;
  settingsWin.loadURL(
    `file://${path.join(__dirname, "..", "ui", "setup.html")}`
  );
});

// --- IPC: Copy to clipboard ---
ipcMain.handle("copy-to-clipboard", async (_event, text) => {
  const { clipboard } = require("electron");
  clipboard.writeText(text);
});

// --- IPC: Quit app ---
ipcMain.on("quit-app", () => {
  app.quit();
});

// Toggle tray icon when mic state changes
ipcMain.on("mic-state", (_event, isActive) => {
  const icon = isActive ? activeIconPath : iconPath;
  if (tray) tray.setImage(icon);
});

// Provide config to renderer
ipcMain.handle("get-config", async () => config);

// Insert text at cursor in frontmost app
ipcMain.handle("insert-text", async (_event, { text, enterMode }) => {
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
  async (_event, { transcript }) => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      throw new Error("XAI_API_KEY not set — run setup or add .env");
    }
    return await llmService.correctTranscript(
      transcript,
      apiKey,
      config.llm
    );
  }
);

// Provide Soniox API key to renderer
ipcMain.handle("get-soniox-key", async () => {
  return process.env.SONIOX_API_KEY || "";
});

// Check if xAI key is configured
ipcMain.handle("has-xai-key", async () => {
  return !!process.env.XAI_API_KEY;
});
