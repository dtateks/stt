# Electron 38 / macOS Permission APIs — Evidence Report

**Repo context:** Voice to Text (Electron 38) — uses `navigator.mediaDevices.getUserMedia` for mic capture in renderer, and `osascript` + System Events keystroke for text insertion.

---

## 1. Microphone Permission: Check / Request in Electron 38 on macOS

### Status Check: `systemPreferences.getMediaAccessStatus()`

```javascript
const { systemPreferences } = require('electron');
const status = systemPreferences.getMediaAccessStatus('microphone');
// Returns: 'granted' | 'denied' | 'not determined' | 'restricted'
```

**Evidence** ([Electron docs](https://github.com/electron/electron/blob/main/docs/api/system-preferences.md)):
- `getMediaAccessStatus(mediaType)` plumbs through to Chromium's `GetMediaPermissionStatus` on macOS
- On macOS 10.14+, returns actual TCC permission state; on 10.13 returns `'granted'` always
- Does **not** trigger a permission prompt — read-only query

**Known issue** ([electron/electron#37091](https://github.com/electron/electron/issues/37091)):
> If the user manually changes permission in System Preferences and restarts the app, `getMediaAccessStatus` correctly reflects the new state. But if the app is **not** restarted after a System Preferences toggle, the OS caches the old value — `tccutil reset Microphone <bundle-id>` is required to clear the cache.

### Request Permission: `systemPreferences.askForMediaAccess()`

```javascript
const granted = await systemPreferences.askForMediaAccess('microphone');
// Returns: true | false
```

**Evidence** ([Electron docs](https://github.com/electron/electron/blob/main/docs/api/system-preferences.md)):
- Displays the native macOS permission dialog
- Returns `true` if user granted, `false` if denied
- **If already denied**: OS will not re-prompt; must direct user to System Preferences
- **After permission change in System Preferences**: app must be restarted for new state to be visible to these APIs

**Important prerequisite** — `Info.plist` must contain:
```xml
<key>NSMicrophoneUsageDescription</key>
<string>Voice to Text needs microphone access for speech-to-text.</string>
```
The repo's `package.json` already declares this under `build.mac.extendInfo`.

### Auto-Grant via Session Handler (current repo pattern)

The repo currently auto-grants all `media` permission in the main process:

**Evidence** ([main.js:93-102](https://github.com/hungson175/voice-everywhere/blob/main/electron/main.js#L93-L102)):
```javascript
session.defaultSession.setPermissionRequestHandler(
  (_webContents, permission, callback) => {
    if (permission === "media") {
      callback(true);  // auto-grant
    } else {
      callback(false);
    }
  }
);
```

This bypasses the system prompt entirely. However, Chromium may still query the OS-level TCC database, so the app can still be denied at the system level even after this handler approves the permission request from renderer code.

**Limitation**: `setPermissionRequestHandler` approves the renderer request, but does **not** change the macOS TCC permission state. The renderer still needs OS-level microphone permission granted. The current approach works because `getUserMedia()` in the renderer ultimately hits Chromium's permission system, which consults TCC — and since the app's TCC entry is "granted" (first launch would have prompted), it succeeds.

If the user revokes microphone permission in System Preferences, the next `getUserMedia()` call will silently fail (no audio frames) because Chromium's internal check fails before it reaches the Electron permission handler.

---

## 2. Accessibility Permission Check from Electron/Node

### Electron Built-in: `systemPreferences.isTrustedAccessibilityClient()`

```javascript
const { systemPreferences } = require('electron');

// Check without prompting
const isTrusted = systemPreferences.isTrustedAccessibilityClient(false);

// Check AND show system prompt
const prompted = systemPreferences.isTrustedAccessibilityClient(true);
```

**Evidence** ([Electron docs - system-preferences](https://github.com/electron/electron/blob/main/docs/api/system-preferences.md)) and ([electron/electron#20787](https://github.com/electron/electron/issues/20787)):
- `isTrustedAccessibilityClient(false)` returns boolean, does NOT show a prompt
- `isTrustedAccessibilityClient(true)` returns boolean, but **also** shows the system Accessibility permission dialog if not yet granted
- If user grants via the prompt, subsequent `isTrustedAccessibilityClient(false)` calls return `true`

**Critical bug** ([electron/electron#28395](https://github.com/electron/electron/issues/28395)):
> Calling `isTrustedAccessibilityClient(false)` first, then `isTrustedAccessibilityClient(true)` — the second call will **not** show the prompt. The macOS TCC API silently returns `false`. Workaround: only call `isTrustedAccessibilityClient(true)` when you actually need to prompt.

**In Electron 38**: This API still exists and is the canonical built-in way to check accessibility permission. It calls the private `AXIsProcessTrustedWithOptions` SPI internally.

### Third-Party: `node-mac-permissions` (broader API)

```javascript
const { permissions } = require('node-mac-permissions');

const status = permissions.getAuthStatus('accessibility');
// Returns: 'auth' | 'notAuth' | 'not determined'

// Trigger the permission prompt (opens System Preferences > Accessibility)
permissions.askForAccessibilityAccess();
```

**Evidence** ([node-mac-permissions README](https://github.com/codebytere/node-mac-permissions/blob/master/README.md)):
- `getAuthStatus(type)` — returns `'auth'` (granted), `'notAuth'` (denied), or `'not determined'`
- `askForAccessibilityAccess()` — no programmatic API to request; calling it opens System Preferences > Accessibility pane; returns `undefined`
- Works in both plain Node.js and Electron apps
- For Electron: requires `Info.plist` usage description keys (already present in this repo via `NSAppleEventsUsageDescription`)

**Recommendation for this repo**: Use `systemPreferences.isTrustedAccessibilityClient(false)` to check, and `systemPreferences.isTrustedAccessibilityClient(true)` to prompt (being aware of the bug where first call with `false` kills subsequent `true` calls). Alternatively, use `node-mac-permissions` for a cleaner API.

---

## 3. Opening System Settings Privacy Panes

### URL Scheme Approach (best supported)

```javascript
const { shell } = require('electron');

// Microphone privacy pane
shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');

// Accessibility privacy pane  
shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
```

**Evidence** ([Apple System Preferences URL Schemes](https://gist.github.com/jpr5/822d93c7bfa73856292411bb12292adc)):
```
Privacy-Microphone  x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone
Privacy-Accessibility x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility
```

**Additional anchors** (from [macOS Adventures blog](https://www.macosadventures.com/2022/02/06/scripting-system-preferences-panes/)):
```
x-apple.systempreferences:com.apple.preference.security?Privacy_Camera
x-apple.systempreferences:com.apple.preference.security?Privacy_Automation
x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles  (Full Disk Access)
```

### macOS Sequoia 15 Caveats

**Evidence** ([Apple System Preferences URL Schemes - Sequoia note](https://gist.github.com/jpr5/822d93c7bfa73856292411bb12292adc)):
> In macOS Sequoia the anchors are somewhat flaky. For example:
> `open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"` doesn't always switch to the Accessibility sub-pane.
> Running it twice with a 1 second delay seems to work.

**Practical recommendation**:
```javascript
// Open the main Privacy & Security pane first, then the specific anchor
async function openPrivacyPane(anchor) {
  const { shell } = require('electron');
  // First open the general pane
  await shell.openExternal('x-apple.systempreferences:com.apple.preference.security');
  // Then open the specific anchor (Sequoia workaround)
  await new Promise(r => setTimeout(r, 500));
  await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${anchor}`);
}
```

### Electron 38 Status

`shell.openExternal` works with these `x-apple.systempreferences:` URLs on macOS. The `systemPreferences` module itself does **not** expose an API to open preference panes — the shell URL approach is the standard workaround.

---

## 4. Apple Events/System Events Automation vs Accessibility for osascript keystroke

### The Two Permission Types

| Permission | Location in System Settings | Required For |
|---|---|---|
| **Accessibility** | Privacy & Security → Accessibility | Controlling the Mac (keystrokes, mouse, window control) |
| **Automation (Apple Events)** | Privacy & Security → Privacy → Automation | Sending Apple Events to other apps |
| **Input Monitoring** | Privacy & Security → Input Monitoring | Monitoring keypresses globally |

### osascript + `tell application "System Events" to keystroke` — What You Actually Need

**Evidence** ([Apple StackExchange discussion](https://apple.stackexchange.com/questions/394980/catalina-how-to-add-system-events-to-system-preferences-security-privacy)):
> To use System Events to control another application (e.g., send keystrokes), the **target application** needs to be in the Accessibility list, not just the script runner.

**For this repo's text insertion** (`osascript -e 'tell application "System Events" to keystroke "v" using command down'`):

1. **The app running osascript** (Electron's main process) needs Accessibility permission
2. **The target app** (whatever app is currently frontmost and has text input focus) needs Accessibility permission

**Evidence** ([StackOverflow - osascript Accessibility](https://stackoverflow.com/questions/54578125/apple-permission-hell-osascript-and-accessibility-assistive-access)):
> When running via `launchd`, the script fails because osascript cannot be added to assistive access directly — the target application must be added to the list instead.

### Apple Events Permission Is Separate

For **Apple Events** automation (e.g., `tell application "Finder" to open`), the Automation privacy pane is used. But for **System Events keystroke/mouse** operations, only **Accessibility** permission matters.

**Evidence** ([Apple StackExchange - Automation vs Accessibility](https://apple.stackexchange.com/questions/77138204/applescript-assistive-error-1719-when-using-system-events-click)):
> Error `-1719` ("not allowed assistive access") means the app is not in the Accessibility list. Adding it to the Automation list does not fix this.

### Practical Implications for This Repo

The `text-inserter.js` uses:
```javascript
osascript('tell application "System Events" to keystroke "v" using command down');
```

**Required**: The Electron app (Voice to Text) must be granted **Accessibility** permission in System Settings. The target application does **not** need to be in the list — the System Events process has the permission to send events to any app.

**Caveat**: On macOS 14+ (Sonoma) and 15 (Sequoia), there are reports of intermittent failures even when Accessibility is granted, because:
1. Permissions can silently reset after OS updates
2. The app bundle ID must match exactly what's in the TCC database (Electron apps built with `electron-builder` use `com.voiceeverywhere.app` as specified in `package.json`)
3. Running from Xcode/debug vs packaged app can result in different bundle IDs, causing permission state to not carry over

### Checking Before Use

```javascript
// In main process - check if we have Accessibility permission
const { systemPreferences } = require('electron');

function canInsertText() {
  return systemPreferences.isTrustedAccessibilityClient(false);
}

// If false, prompt the user
if (!canInsertText()) {
  // Open Accessibility settings
  const { shell } = require('electron');
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
  return false;
}
```

---

## Summary of Recommendations for This Repo

| Concern | API | Notes |
|---|---|---|
| Check mic permission | `systemPreferences.getMediaAccessStatus('microphone')` | Returns `'granted'`/`'denied'`/`'not determined'` |
| Request mic permission | `systemPreferences.askForMediaAccess('microphone')` | Shows native dialog; returns boolean |
| Check Accessibility | `systemPreferences.isTrustedAccessibilityClient(false)` | Boolean, no prompt |
| Prompt for Accessibility | `systemPreferences.isTrustedAccessibilityClient(true)` | Bug: don't call `false` before `true` |
| Open mic privacy pane | `shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone')` | Works on all modern macOS |
| Open Accessibility pane | `shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')` | Sequoia: may need double-open workaround |
| Verify osascript works | N/A — must be tested with actual permission | Target app does NOT need to be in Accessibility list |

### Key Files in This Repo

- [`electron/main.js:93-102`](https://github.com/hungson175/voice-everywhere/blob/main/electron/main.js#L93-L102) — current auto-grant `media` permission handler
- [`electron/text-inserter.js`](https://github.com/hungson175/voice-everywhere/blob/main/electron/text-inserter.js) — `osascript` + System Events keystroke; comment states "Requires macOS Accessibility permission"
- [`package.json:29-30`](https://github.com/hungson175/voice-everywhere/blob/main/package.json#L29-L30) — `NSMicrophoneUsageDescription` and `NSAppleEventsUsageDescription` in `extendInfo`
