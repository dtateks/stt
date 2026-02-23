/**
 * Encrypted credential storage using Electron safeStorage (macOS Keychain).
 *
 * Stores encrypted API keys as base64 in:
 *   ~/Library/Application Support/voice-everywhere/credentials.json
 */

const { app, safeStorage } = require("electron");
const fs = require("fs");
const path = require("path");

function getCredentialsPath() {
  return path.join(app.getPath("userData"), "credentials.json");
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

function hasCredentials() {
  const store = readStore();
  return !!(store.xaiKey && store.sonioxKey);
}

function getCredentials() {
  const store = readStore();
  const result = {};
  try {
    if (store.xaiKey && safeStorage.isEncryptionAvailable()) {
      result.xaiKey = safeStorage.decryptString(
        Buffer.from(store.xaiKey, "base64")
      );
    }
    if (store.sonioxKey && safeStorage.isEncryptionAvailable()) {
      result.sonioxKey = safeStorage.decryptString(
        Buffer.from(store.sonioxKey, "base64")
      );
    }
  } catch {
    // Decryption failed (e.g. different app identity) — treat as no credentials
    console.warn("Failed to decrypt credentials, will use .env fallback");
    return {};
  }
  return result;
}

function saveCredentials(xaiKey, sonioxKey) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Encryption not available on this system");
  }
  const store = {};
  store.xaiKey = safeStorage
    .encryptString(xaiKey)
    .toString("base64");
  store.sonioxKey = safeStorage
    .encryptString(sonioxKey)
    .toString("base64");
  writeStore(store);
}

function clearCredentials() {
  const filePath = getCredentialsPath();
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

module.exports = { hasCredentials, getCredentials, saveCredentials, clearCredentials };
