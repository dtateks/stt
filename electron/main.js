const { app, BrowserWindow, Tray, ipcMain, session, globalShortcut } = require("electron");

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
  // 1. Try Keychain (encrypted storage)
  if (credentials.hasCredentials()) {
    const creds = credentials.getCredentials();
    if (creds.xaiKey) process.env.XAI_API_KEY = creds.xaiKey;
    if (creds.sonioxKey) process.env.SONIOX_API_KEY = creds.sonioxKey;
    if (creds.xaiKey && creds.sonioxKey) return;
  }

  // 2. Try sourcing shell env vars (packaged apps don't inherit shell env)
  if (!process.env.XAI_API_KEY || !process.env.SONIOX_API_KEY) {
    try {
      const { execSync } = require("child_process");
      const shellEnv = execSync('zsh -ilc "env"', {
        encoding: "utf-8",
        timeout: 5000,
      });
      for (const line of shellEnv.split("\n")) {
        const eqIdx = line.indexOf("=");
        if (eqIdx > 0) {
          const key = line.slice(0, eqIdx);
          if (key === "SONIOX_API_KEY" || key === "XAI_API_KEY") {
            if (!process.env[key]) process.env[key] = line.slice(eqIdx + 1);
          }
        }
      }
    } catch {
      // Shell sourcing failed, continue to .env fallback
    }
  }

  // 3. Dev fallback: .env file in project root
  if (!process.env.XAI_API_KEY || !process.env.SONIOX_API_KEY) {
    const envPath = app.isPackaged
      ? null
      : path.join(__dirname, "..", ".env");
    if (envPath && fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, "utf-8");
      for (const line of envContent.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx);
            const value = trimmed.slice(eqIdx + 1);
            if (!process.env[key]) process.env[key] = value;
          }
        }
      }
    }
  }
}

loadApiKeys();

// --- Determine which page to show ---
function getStartUrl() {
  const needsSetup =
    !credentials.hasCredentials() && !(process.env.XAI_API_KEY && process.env.SONIOX_API_KEY);
  const page = needsSetup ? "setup.html" : "index.html";
  return `file://${path.join(__dirname, "..", "ui", page)}`;
}

const iconPath = path.join(__dirname, "..", "assets", "circleTemplate.png");
const activeIconPath = path.join(__dirname, "..", "assets", "circle-active.png");

let tray = null;
let win = null;

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
    if (win) {
      if (win.isVisible()) {
        win.focus();
      } else {
        win.show();
      }
    }
  });

  // --- Normal persistent window ---
  win = new BrowserWindow({
    width: 360,
    height: 480,
    resizable: true,
    title: "Voice Everywhere",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.loadURL(getStartUrl());

  // DevTools only in dev mode
  if (!app.isPackaged) {
    win.webContents.openDevTools({ mode: "detach" });
  }

  // Hide instead of close (keep running in tray)
  win.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  // Global shortcut: Ctrl+Option+Cmd+V to toggle mic
  globalShortcut.register("Control+Option+Command+V", () => {
    if (win) {
      win.webContents.send("toggle-mic");
    }
  });
});

// Quit properly when app.quit() is called
app.on("before-quit", () => {
  app.isQuitting = true;
});

// macOS: re-show window when dock icon clicked
app.on("activate", () => {
  if (win) win.show();
});

// --- IPC: Save credentials from setup page, then reload to main UI ---
ipcMain.handle("save-credentials", async (_event, { xaiKey, sonioxKey }) => {
  credentials.saveCredentials(xaiKey, sonioxKey);
  process.env.XAI_API_KEY = xaiKey;
  process.env.SONIOX_API_KEY = sonioxKey;
  win.loadURL(
    `file://${path.join(__dirname, "..", "ui", "index.html")}`
  );
});

// --- IPC: Reset credentials, go back to setup ---
ipcMain.handle("reset-credentials", async () => {
  credentials.clearCredentials();
  delete process.env.XAI_API_KEY;
  delete process.env.SONIOX_API_KEY;
  win.loadURL(
    `file://${path.join(__dirname, "..", "ui", "setup.html")}`
  );
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
