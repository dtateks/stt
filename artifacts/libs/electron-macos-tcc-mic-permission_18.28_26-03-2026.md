# Electron/macOS Microphone Permission Failure — Evidence Report

**Date:** 26-03-2026  
**Research Type:** Conceptual / Implementation (TYPE A + B)

---

## Executive Summary

When a packaged signed Electron app opens the Microphone settings pane but never appears in the list, the root cause is **missing or misconfigured code signing entitlements**. Without the correct entitlements on the binary, TCC (Transparency, Consent, and Control) cannot register the app — no prompt appears, no entry is created, and media capture silently fails.

---

## 1. Does Electron microphone/camera permission belong to the main app bundle or a helper process?

**Answer: Main app bundle (the `.app` executable).**

Evidence: The TCC database is keyed by the code signature of the **process that requests the permission**. In Electron, the renderer process (Chromium) makes the media request, but it runs inside the main app bundle's address space. The entitlements must be on the **outer app bundle's main executable**, not on an internal helper.

From [electron-builder issue #9529](https://github.com/electron-userland/electron-builder/issues/9529#issue-3847106094) (closed, Mar 2026):

> "Without the fallback, the fix doesn't exist. The stricter entitlements/signing was already being enforced by macOS..."

From [an anthropics/claude-code issue #33023](https://github.com/anthropics/claude-code/issues/33023#issue-4055006369) (closed, Mar 2026) — **root cause confirmed**:

> "The native binary at `~/.local/share/claude/versions/2.1.72` is missing the `com.apple.security.device.audio-input` entitlement. Without this entitlement, macOS silently denies microphone access — **no TCC permission dialog is shown and no entry is created in the TCC database**."
>
> Verified via:
> ```bash
> codesign -d --entitlements - ~/.local/share/claude/versions/2.1.72
> ```
> Output contains only: `cs.allow-jit`, `cs.allow-unsigned-executable-memory`, `cs.disable-library-validation` — **no audio entitlement**.

Key insight: TCC associates permissions with the code signature of the binary. If the binary lacks `com.apple.security.device.audio-input`, macOS refuses the request silently and never creates a TCC database entry.

---

## 2. Are hardened runtime entitlements like `com.apple.security.device.audio-input` required for Electron microphone access outside the App Sandbox?

**Answer: YES — required when `hardenedRuntime: true` (default in electron-builder).**

When running **outside** the App Sandbox (standard distribution, not Mac App Store), microphone/camera access requires explicit entitlements under the Hardened Runtime. This is distinct from App Sandbox entitlements.

From [BigBinary blog (Dec 2024)](https://www.bigbinary.com/blog/request-camera-micophone-permission-electron):

> "For our purpose, we need `com.apple.security.device.camera` for the camera and `com.apple.security.device.microphone` for the microphone."

From [electron-builder issue #9529](https://github.com/electron-userland/electron-builder/issues/9529#issue-3847106094):

> "I think the reason this is happening is that the hardened runtime option is on by default in electron-builder's settings, and hardened runtime requires entitlements for camera and microphone."

The **key entitlements** for media capture under Hardened Runtime:

```xml
<key>com.apple.security.device.audio-input</key>
<true/>
<key>com.apple.security.device.camera</key>
<true/>
```

Without these, when `hardenedRuntime: true` is in effect (the default), the OS denies audio/video capture silently.

---

## 3. Can missing helper entitlements / inherited entitlements prevent TCC registration?

**Answer: YES — `entitlementsInherit` is critical for nested/multi-process Electron apps.**

Electron apps are multi-process: the main process spawns the renderer as a child. When using `hardenedRuntime: true`, each executable that needs to exercise a entitlement must have it **either directly or via inheritance**.

From electron-builder documentation (context7):

```yaml
mac:
  entitlements: build/entitlements.mac.plist        # for main app
  entitlementsInherit: build/entitlements.mac.inherit.plist  # for nested code
```

From [issue #9529 workaround](https://github.com/electron-userland/electron-builder/issues/9529#issue-3847106094):

> "entitlements: assets/mac/entitlements.mac.plist  
> entitlementsInherit: assets/mac/entitlements.mac.inherit.plist"

The `entitlementsInherit` file is embedded in the app and used when child processes or nested code needs to exercise the parent process's entitlements.

**What happens without it:** The renderer process (child) cannot access the camera/microphone even if the main process has the entitlement, because child processes do not automatically inherit Hardened Runtime entitlements. The `entitlementsInherit` plist provides a mechanism for the system to look up the correct entitlements for code running in a nested context.

From the [electron-builder mac configuration docs](https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/codeSign/macCodeSign.ts) (source code):

The signing process applies `entitlements` to the main executable and `entitlementsInherit` to nested executables (like `Helpers/`).

---

## 4. Known Electron/electron-builder requirements for `entitlements` and `entitlementsInherit`

### Minimum working configuration for camera/microphone in electron-builder:

**`build/entitlements.mac.plist`** (for main app):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <key>com.apple.security.device.audio-input</key>
    <true/>
    <key>com.apple.security.device.camera</key>
    <true/>
</dict>
</plist>
```

**`build/entitlements.mac.inherit.plist`** (for nested code):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <key>com.apple.security.device.audio-input</key>
    <true/>
    <key>com.apple.security.device.camera</key>
    <true/>
</dict>
</plist>
```

**electron-builder config:**
```json
{
  "mac": {
    "entitlements": "build/entitlements.mac.plist",
    "entitlementsInherit": "build/entitlements.mac.inherit.plist",
    "hardenedRuntime": true
  }
}
```

### The regression (v26.0.13+)

From [issue #9529](https://github.com/electron-userland/electron-builder/issues/9529#issue-3847106094):

> "Regression introduced between 26.0.12 → 26.0.13, likely related to PR #9007 (ad-hoc signing / fallback changes)."

In v26.0.13+, ad-hoc signed builds (`identity: "-"`) with `hardenedRuntime: true` produce a signing state that **fails to deliver capture frames despite a live MediaStream**. The workaround is either:

1. **`hardenedRuntime: false`** — restores camera/mic for ad-hoc builds
2. **Re-sign after build** with `codesign --force --deep --sign - "/path/to/App.app"`

### Also required: Info.plist usage descriptions

From [electron docs](https://github.com/electron/electron/blob/main/docs/api/system-preferences.md):

> "Must set `NSMicrophoneUsageDescription` and `NSCameraUsageDescription` strings in app's `Info.plist` file"

In electron-builder via `extendInfo`:
```json
{
  "mac": {
    "extendInfo": {
      "NSMicrophoneUsageDescription": "App requires microphone access",
      "NSCameraUsageDescription": "App requires camera access"
    }
  }
}
```

---

## Practical Fix Guidance

| Step | Action |
|------|--------|
| 1 | Add `com.apple.security.device.audio-input` and `com.apple.security.device.camera` to **both** `entitlements` and `entitlementsInherit` plists |
| 2 | Ensure `hardenedRuntime: true` in electron-builder `mac` config |
| 3 | Add `NSMicrophoneUsageDescription` and `NSCameraUsageDescription` to `extendInfo` |
| 4 | If using ad-hoc signing and camera/mic still broken, set `hardenedRuntime: false` as a workaround, OR re-sign post-build with `codesign --force --deep --sign -` |
| 5 | After changes, **reset TCC**: `tccutil reset Microphone && tccutil reset Camera` then reinstall the app |

**Diagnostic command** to verify entitlements on built app:
```bash
# Extract embedded entitlements from the main executable
codesign -d --entitlements - "/path/to/App.app/Contents/MacOS/Electron"

# Verify the app appears in TCC (after granting permission once)
sqlite3 ~/Library/Application\ Support/com.apple.TCC/TCC.db "SELECT client, service FROM access WHERE service LIKE '%microphone%'"
```

---

## References

| Source | URL | Key Takeaway |
|--------|-----|--------------|
| Electron system-preferences docs | [github.com/electron/electron/.../system-preferences.md](https://github.com/electron/electron/blob/main/docs/api/system-preferences.md) | `askForMediaAccess()` requires Info.plist usage descriptions |
| electron-builder mac config | [github.com/electron-userland/electron-builder/.../mac.md](https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/codeSign/macCodeSign.ts) | `entitlements` and `entitlementsInherit` required for hardened runtime |
| electron-builder issue #9529 | [github.com/electron-userland/electron-builder/issues/9529](https://github.com/electron-userland/electron-builder/issues/9529) | Hardened runtime regression + workaround |
| Claude Code bug #33023 | [github.com/anthropics/claude-code/issues/33023](https://github.com/anthropics/claude-code/issues/33023) | Missing `audio-input` entitlement → no TCC entry |
| BigBinary blog | [bigbinary.com/blog/request-camera-micophone-permission-electron](https://www.bigbinary.com/blog/request-camera-micophone-permission-electron) | Full entitlements plist example |
| Stack Overflow | [stackoverflow.com/questions/72024011](https://stackoverflow.com/questions/72024011/electron-app-not-asking-for-camera-and-microphone-permission-on-macos-monterey) | Extended Info + entitlements fix |
| pingdotgg t3code issue #728 | [github.com/pingdotgg/t3code/issues/728](https://github.com/pingdotgg/t3code/issues/728) | Re-signing after plist patching restores TCC |

---

## Conclusion

The symptom of "app opens Microphone settings but never appears in the list" is caused by **missing `com.apple.security.device.audio-input` (and optionally `com.apple.security.device.camera`) entitlements on the signed binary**. TCC can only create entries for binaries that declare the required entitlements. 

The fix requires:
1. Adding the media entitlements to both `entitlements` and `entitlementsInherit` plists
2. Ensuring `hardenedRuntime: true` (and therefore the entitlements are respected)
3. Having `NSMicrophoneUsageDescription` in Info.plist
4. If using electron-builder v26.0.13+ with ad-hoc signing and `hardenedRuntime: true`, the above may still fail — use `hardenedRuntime: false` or re-sign post-build
