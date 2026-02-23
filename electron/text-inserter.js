/**
 * Text inserter — pastes text at cursor position in ANY macOS app.
 *
 * 1. Save current clipboard
 * 2. Set clipboard to text
 * 3. Cmd+V via System Events
 * 4. (Enter Mode) Press Enter to submit
 * 5. Restore clipboard
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
 * Insert text at the current cursor position in the frontmost app.
 * @param {string} text - Text to insert
 * @param {object} [options]
 * @param {boolean} [options.enterMode] - Press Enter after paste to submit
 */
async function insertText(text, options = {}) {
  const savedClipboard = clipboard.readText();

  clipboard.writeText(text);
  await osascript('tell application "System Events" to keystroke "v" using command down');

  // Extra delay for long text so the app finishes processing input buffer
  await sleep(text.length > 200 ? 700 : 200);

  // Enter mode: press Enter to submit
  if (options.enterMode) {
    await osascript('tell application "System Events" to key code 36');
  }

  await sleep(100);
  clipboard.writeText(savedClipboard);
}

module.exports = { insertText };
