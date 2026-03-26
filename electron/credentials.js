/**
 * Credential storage — plain JSON file with env/shell fallback.
 *
 * Primary storage:
 *   ~/Library/Application Support/voice-to-text/credentials.json
 *
 * Fallback sources (checked in order when JSON is empty):
 *   1. process.env.XAI_API_KEY / SONIOX_API_KEY
 *   2. Exported keys from the user's default shell startup environment
 *
 * Previously used Electron safeStorage (macOS Keychain), but that breaks
 * across unsigned rebuilds (different code-signing identity = can't decrypt).
 */

const { app } = require("electron");
const fs = require("fs");
const path = require("path");
const { getCredentialsFromShellEnvironment } = require("./shell-credentials");

const CREDENTIALS_DIRECTORY_NAME = "voice-to-text";
const LEGACY_CREDENTIALS_DIRECTORY_NAME = "voice-everywhere";
const XAI_API_KEY_ENV_NAME = "XAI_API_KEY";
const SONIOX_API_KEY_ENV_NAME = "SONIOX_API_KEY";

function getCredentialsDirectoryPath() {
  return path.join(app.getPath("appData"), CREDENTIALS_DIRECTORY_NAME);
}

function getLegacyCredentialsPath() {
  return path.join(
    app.getPath("appData"),
    LEGACY_CREDENTIALS_DIRECTORY_NAME,
    "credentials.json"
  );
}

function getCredentialsPath() {
  const filePath = path.join(getCredentialsDirectoryPath(), "credentials.json");
  const legacyFilePath = getLegacyCredentialsPath();

  if (!fs.existsSync(filePath) && fs.existsSync(legacyFilePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    try {
      fs.renameSync(legacyFilePath, filePath);
    } catch {
      fs.copyFileSync(legacyFilePath, filePath);
    }
  }

  return filePath;
}

function readStore() {
  const filePath = getCredentialsPath();
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}

function writeStore(data) {
  const filePath = getCredentialsPath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function getEnvCredentials() {
  return {
    xaiKey: process.env[XAI_API_KEY_ENV_NAME] || "",
    sonioxKey: process.env[SONIOX_API_KEY_ENV_NAME] || "",
  };
}

function hasCredentials() {
  const creds = getCredentials();
  return !!(creds.xaiKey && creds.sonioxKey);
}

function getCredentials() {
  const store = readStore();
  const envCreds = getEnvCredentials();
  const needsShellFallback =
    !(store.xaiKey || envCreds.xaiKey) ||
    !(store.sonioxKey || envCreds.sonioxKey);
  const shellCreds = needsShellFallback
    ? getCredentialsFromShellEnvironment()
    : emptyCredentials();

  return {
    xaiKey: store.xaiKey || envCreds.xaiKey || shellCreds.xaiKey || "",
    sonioxKey: store.sonioxKey || envCreds.sonioxKey || shellCreds.sonioxKey || "",
  };
}

function emptyCredentials() {
  return {
    xaiKey: "",
    sonioxKey: "",
  };
}

function saveCredentials(xaiKey, sonioxKey) {
  writeStore({ xaiKey, sonioxKey });
}

function saveXaiKey(xaiKey) {
  const store = readStore();
  store.xaiKey = xaiKey;
  writeStore(store);
}

function clearCredentials() {
  const filePath = getCredentialsPath();
  const legacyFilePath = getLegacyCredentialsPath();
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  if (fs.existsSync(legacyFilePath)) fs.unlinkSync(legacyFilePath);
}

module.exports = {
  hasCredentials,
  getCredentials,
  saveCredentials,
  saveXaiKey,
  clearCredentials,
};
