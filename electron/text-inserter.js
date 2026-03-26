/**
 * Text inserter — pastes text at cursor position in ANY macOS app.
 *
 * 1. Snapshot current clipboard (best-effort multi-format)
 * 2. Set clipboard to plain text
 * 3. Cmd+V via System Events
 * 4. (Enter Mode) Press Enter to submit
 * 5. Restore clipboard (in finally block — always runs)
 *
 * Requires macOS Accessibility permission.
 */

const { clipboard } = require("electron");
const { execFile } = require("child_process");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function osascript(script) {
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-e", script], { timeout: 5000 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Best-effort snapshot of current clipboard contents.
 * Captures text, HTML, RTF, and image formats so restoration can
 * preserve richer content than just plain text.
 *
 * Returns a plain object describing what to restore.
 */
function snapshotClipboard() {
  const formats = clipboard.availableFormats();
  const snapshot = {
    hadFormats: formats.length > 0,
    formats: [],
  };

  for (const format of formats) {
    try {
      if (format === "text/plain") {
        snapshot.formats.push({ format, data: clipboard.readText() });
      } else if (format === "text/html") {
        snapshot.formats.push({ format, data: clipboard.readHTML() });
      } else if (format === "text/rtf") {
        snapshot.formats.push({ format, data: clipboard.readRTF() });
      } else if (format.startsWith("image/")) {
        // readImage may throw if called before app is fully ready
        snapshot.formats.push({ format, data: clipboard.readImage() });
      }
      // Skip unknown formats — clipboard.write() handles the most common ones
    } catch (e) {
      // Best-effort: skip formats that can't be read
    }
  }

  return snapshot;
}

/**
 * Restore clipboard from a snapshot captured by snapshotClipboard().
 * Best-effort: failures on individual formats are logged but do not throw.
 */
function restoreClipboard(snapshot) {
  if (!snapshot) {
    return;
  }

  if (snapshot.formats.length === 0) {
    if (!snapshot.hadFormats) {
      clipboard.clear();
    }
    return;
  }

  const writeData = {};

  for (const item of snapshot.formats) {
    try {
      if (item.format === "text/plain") {
        writeData.text = item.data;
      } else if (item.format === "text/html") {
        writeData.html = item.data;
      } else if (item.format === "text/rtf") {
        writeData.rtf = item.data;
      } else if (item.format.startsWith("image/")) {
        writeData.image = item.data;
      }
    } catch (e) {
      console.warn(`[clipboard] Failed to restore format ${item.format}: ${e.message}`);
    }
  }

  if (Object.keys(writeData).length === 0) {
    if (!snapshot.hadFormats) {
      clipboard.clear();
    }
    return;
  }

  try {
    clipboard.write(writeData);
  } catch (e) {
    // Final fallback: at least restore plain text if multi-format write fails
    console.warn(`[clipboard] Multi-format restore failed, falling back to text: ${e.message}`);
    if (writeData.text) clipboard.writeText(writeData.text);
  }
}

/**
 * Insert text at the current cursor position in the frontmost app.
 * @param {string} text - Text to insert
 * @param {object} [options]
 * @param {boolean} [options.enterMode] - Press Enter after paste to submit
 */
async function insertText(text, options = {}) {
  const savedSnapshot = snapshotClipboard();
  try {
    clipboard.writeText(text);
    await osascript('tell application "System Events" to keystroke "v" using command down');

    // Extra delay for long text so the app finishes processing input buffer
    await sleep(text.length > 200 ? 700 : 200);

    // Enter mode: press Enter after paste to submit
    if (options.enterMode) {
      await osascript('tell application "System Events" to key code 36');
    }

    await sleep(100);
  } finally {
    restoreClipboard(savedSnapshot);
  }
}

module.exports = { insertText };
