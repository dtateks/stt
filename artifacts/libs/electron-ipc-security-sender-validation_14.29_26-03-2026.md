# Electron IPC Security: Sender Origin Validation (Electron 38+)

> Research date: 26-03-2026 | Electron 38.x relevant

---

## Quick Reference

| Property | Type | Description |
|----------|------|-------------|
| `event.senderFrame` | `WebFrameMain \| null` | The **frame** that sent the message |
| `event.senderFrame.url` | `string` | URL of the specific frame (includes iframes) |
| `event.sender` | `WebContents` | The **webContents** that sent the message |
| `event.sender.getURL()` | `string` | URL of the WebContents (main frame only) |

---

## 1. `event.senderFrame.url` vs `event.sender.getURL()`

### Key Difference

**`event.senderFrame`** is a [WebFrameMain](https://github.com/electron/electron/blob/main/docs/api/web-frame-main.md) object representing the **specific frame** that sent the IPC message — this includes child frames like iframes.

**`event.sender`** is the [WebContents](https://github.com/electron/electron/blob/main/docs/api/web-contents.md) that sent the message — it always refers to the main frame's webContents.

```javascript
// senderFrame.url — gives you THE FRAME's URL (iframe-aware)
ipcMain.handle('get-data', (e) => {
  // e.senderFrame = WebFrameMain for the specific frame that sent
  // e.senderFrame.url = URL of that frame (including child frames)
  console.log(e.senderFrame.url)
})

// event.sender.getURL() — gives you THE WEBCONTENTS URL (always main frame)
ipcMain.handle('get-data', (e) => {
  // e.sender = WebContents instance
  // e.sender.getURL() = URL of the main frame only
  console.log(e.sender.getURL())
})
```

### When to Use Which

| Use Case | Recommended | Reason |
|----------|-------------|--------|
| Validate which page/frame sent the IPC | `event.senderFrame.url` | iframe-aware, validates exact frame |
| Get the window's current URL | `event.sender.getURL()` | Returns main frame URL only |
| Security-critical validation | `event.senderFrame.url` | Can distinguish main frame from iframes |

### Origin Property Nuances

From [web-frame-main.md#frame-origin](https://github.com/electron/electron/blob/main/docs/api/web-frame-main.md#L223-L231):

> `frame.origin` returns the serialized origin (RFC 6454). For `file://` pages, the origin is `"null"` (string). If the frame is a child window opened to `about:blank`, `frame.origin` returns the parent frame's origin while `frame.url` returns empty string.

---

## 2. `senderFrame` Can Be `null` — Critical Caveat

**Evidence** ([ipc-main-event.md](https://github.com/electron/electron/blob/main/docs/api/structures/ipc-main-event.md#L8)):
> `senderFrame` [WebFrameMain](../web-frame-main.md) | **null** — The frame that sent this message. **May be null if accessed after the frame has either navigated or been destroyed.**

**Evidence** ([breaking-changes.md](https://github.com/electron/electron/blob/main/docs/breaking-changes.md#L480-L488)):
```javascript
// ✅ Good: accessed immediately
ipcMain.on('unload-event', (event) => {
  event.senderFrame // ✅ accessed immediately
})

// ❌ Bad: late access after async operation
ipcMain.on('unload-event', async (event) => {
  await crossOriginNavigationPromise
  event.senderFrame // ❌ returns null due to late access
})
```

### Mitigation Pattern

```javascript
ipcMain.handle('privileged-action', (e) => {
  // Access senderFrame IMMEDIATELY at start of handler
  const frame = e.senderFrame
  if (!frame) {
    // Frame navigated or destroyed — deny access
    return null
  }
  
  const url = frame.url  // Cache the URL, not the frame
  // ... async operations now safe to use cached url
  return doPrivilegedAction(url)
})
```

---

## 3. `file://` Pages — Security Caveats

**Evidence** ([security.md #18](https://github.com/electron/electron/blob/main/docs/tutorial/security.md#L780-L794)):

> Pages running on `file://` have **unilateral access to every file on your machine** meaning that XSS issues can be used to load arbitrary files from the user's machine. Using a custom protocol prevents issues like this as you can limit the protocol to only serving a specific set of files.

### Why `file://` is Dangerous

1. **No origin sandbox** — `file://` pages have broader file system access than http/https
2. **XSS = file access** — A single XSS vulnerability can read arbitrary files
3. **Origin serializes to `"null"`** — Cannot use origin-based allowlists normally

### Validation Pattern for `file://` Pages

```javascript
function validateSender(frame) {
  if (!frame) return false
  
  const url = frame.url
  
  // file:// URLs have no host, path is the file system path
  if (url.startsWith('file://')) {
    // For file://, validate against known file paths
    const allowedPaths = [
      '/Applications/YourApp.app/Contents/Resources/',
      path.join(app.getPath('userData'), 'local/')
    ]
    return allowedPaths.some(allowed => url.startsWith(allowed))
  }
  
  // For http/https, use standard URL parser with allowlist
  try {
    const parsed = new URL(url)
    const allowedHosts = ['app.example.com', 'localhost']
    return allowedHosts.includes(parsed.host)
  } catch {
    return false
  }
}
```

### Recommended: Use Custom Protocol Instead

**Evidence** ([protocol.handle](https://github.com/electron/electron/blob/main/docs/api/protocol.md#protocolhandlescheme-handler)):

```javascript
// Instead of file://, serve via custom protocol
protocol.handle('app-local', (request) => {
  // Serve only specific files from your app bundle
  return filePath // served as app-local://...
})
```

---

## 4. Preload/contextBridge Security Best Practices

**Evidence** ([security.md #20](https://github.com/electron/electron/blob/main/docs/tutorial/security.md)):

### ❌ Never Expose Raw APIs

```javascript
// Bad — exposes entire ipcRenderer
contextBridge.exposeInMainWorld('electronAPI', {
  on: ipcRenderer.on  // DANGER: gives renderer access to ALL IPC events
})

// Bad — passes callback that leaks ipcRenderer via event.sender
contextBridge.exposeInMainWorld('electronAPI', {
  onUpdateCounter: (callback) => ipcRenderer.on('update-counter', callback)
})
```

### ✅ Safe Pattern — Wrap and Filter

```javascript
// Good — only exposes specific functionality, filters event
contextBridge.exposeInMainWorld('electronAPI', {
  onUpdateCounter: (callback) => 
    ipcRenderer.on('update-counter', (_event, value) => callback(value))
})
```

### Key Recommendations

| Setting | Value | Purpose |
|---------|-------|---------|
| `contextIsolation` | `true` | Isolates preload from renderer |
| `nodeIntegration` | `false` | Prevents renderer from using Node |
| `sandbox` | `true` | Limits renderer process capabilities |
| `preload` | path string | Loads secure preload script |

---

## 5. Complete Validation Pattern

```javascript
// main.js
const { ipcMain, app } = require('electron')
const path = require('node:path')

// Known trusted origins for your app
const ALLOWED_ORIGINS = new Set([
  'app-local://',  // if using custom protocol
  'https://yourtrusteddomain.com'
])

function validateSender(event) {
  const frame = event.senderFrame
  
  // Frame may be null if navigated away
  if (!frame) {
    console.warn('IPC from null frame - rejecting')
    return false
  }
  
  const url = frame.url
  
  // Parse and validate URL
  try {
    const parsed = new URL(url)
    
    // file:// requires path validation
    if (parsed.protocol === 'file:') {
      // Validate file path is within app resources
      const resourcePath = path.join(app.getAppPath(), 'resources')
      return url.startsWith(`file://${resourcePath}`)
    }
    
    // Custom protocol validation
    if (parsed.protocol === 'app-local:') {
      return true  // already served by your protocol handler
    }
    
    // HTTP/HTTPS — validate host against allowlist
    if (['http:', 'https:'].includes(parsed.protocol)) {
      return ALLOWED_ORIGINS.has(`${parsed.protocol}//${parsed.host}`)
    }
    
    return false
  } catch (e) {
    console.error('URL parse error:', e)
    return false
  }
}

// Handler with validation
ipcMain.handle('read-user-data', (event, filename) => {
  if (!validateSender(event)) {
    return { error: 'Unauthorized' }
  }
  // ... proceed with operation
})
```

---

## 6. Recent Security Fix: PR #50118 (Electron 38+)

**PR**: [electron/electron#50118](https://github.com/electron/electron/pull/50118) — merged 2026-03-08

**Fix summary**: Sender validation for internal IPC reply channels now uses strict positive checking instead of negative condition.

**Before** (vulnerable):
```javascript
// Only rejected mismatched frame, accepted anything else
if (type === 'frame' && sender !== expected) return
```

**After** (secure):
```javascript
// Only accepts exact expected frame
if (event.type !== 'frame') return
if (sender !== expectedFrame) return
```

**Affected versions**: Electron 38.x, 39.x, 40.x, 41.x (backported)

---

## Summary: Do's and Don'ts

| Do | Don't |
|----|-------|
| ✅ Use `event.senderFrame.url` for iframe-aware validation | ❌ Use `event.sender.getURL()` when you need iframe distinction |
| ✅ Access `senderFrame` immediately, cache URL for async use | ❌ Await anything before accessing `senderFrame` |
| ✅ Validate `file://` pages by path, not origin | ❌ Assume `file://` origin behaves like http/https |
| ✅ Use custom protocols instead of `file://` | ❌ Load untrusted content via `file://` |
| ✅ Wrap IPC in contextBridge with filtered callbacks | ❌ Expose raw `ipcRenderer.on` via contextBridge |
| ✅ Enable `contextIsolation: true` and `sandbox: true` | ❌ Disable security settings for "convenience" |

---

## Sources

- [Electron Security Tutorial - Validate IPC Senders](https://github.com/electron/electron/blob/main/docs/tutorial/security.md#17-validate-the-sender-of-all-ipc-messages)
- [IpcMainEvent Structure](https://github.com/electron/electron/blob/main/docs/api/structures/ipc-main-event.md)
- [IpcMainInvokeEvent Structure](https://github.com/electron/electron/blob/main/docs/api/structures/ipc-main-invoke-event.md)
- [WebFrameMain API](https://github.com/electron/electron/blob/main/docs/api/web-frame-main.md)
- [Breaking Changes - senderFrame null behavior](https://github.com/electron/electron/blob/main/docs/breaking-changes.md#L475-L488)
- [Security - Avoid file:// protocol](https://github.com/electron/electron/blob/main/docs/tutorial/security.md#18-avoid-usage-of-the-file-protocol-and-prefer-usage-of-custom-protocols)
- [PR #50118 - IPC reply validation fix](https://github.com/electron/electron/pull/50118)
