# macOS Focus Capture & Reactivation for Tauri v2: Best Practices

**Research Date:** 29-03-2026  
**Focus:** Durable fix for AppleScript `System Events` keystroke/paste failures caused by focus drift  
**Context:** Tauri v2 app using `objc2`/`objc2-app-kit` for macOS native interop

---

## Executive Summary

| Option | Reliability | macOS 11+ Compatibility | Complexity | Recommendation |
|--------|--------------|-------------------------|------------|----------------|
| **A: Hide + Retry** | Low | Poor (race conditions) | Low | ❌ Not recommended |
| **B: NSWorkspace Capture + Reactivate** | **High** | **Problematic but best available** | Medium | ✅ **Preferred fallback** |
| **C: AppleScript Activation** | Medium | Broken (Big Sur+) | Low | ⚠️ Use only if B fails |

**Bottom line:** Capture the frontmost app via `NSWorkspace.shared.frontmostApplication` and reactivate it using `activateWithOptions([.ActivateAllWindows, .ActivateIgnoringOtherApps])` before sending paste. However, be aware of known macOS 11+ activation bugs where even this fails to properly bring windows forward.

---

## Option Analysis

### Option A: Hide/Retry

**Approach:** Hide your app window before insertion, rely on System Events retry to recover focus.

**Problems:**
- Race condition: your app hides, target app may not immediately gain focus
- No guarantee the previously-frontmost app is still the intended paste target
- Fullscreen apps may steal focus back immediately
- Hidden windows don't prevent focus drift to other apps

**Verdict:** Unreliable, not recommended for production.

---

### Option B: NSWorkspace/NSRunningApplication Capture + Reactivate

**Capture:**
```rust
// objc2/objc2-app-kit
use objc2_app_kit::{NSWorkspace, NSRunningApplication};

unsafe {
    let workspace = NSWorkspace::sharedWorkspace();
    let frontmost = workspace.frontmostApplication(); // Option<Retained<NSRunningApplication>>
}
```

**Reactivation:**
```rust
use objc2_app_kit::{NSRunningApplication, NSApplicationActivationOptions};

unsafe {
    // Preferred approach
    let options = NSApplicationActivationOptions::ActivateAllWindows 
               | NSApplicationActivationOptions::ActivateIgnoringOtherApps;
    frontmost.activateWithOptions(options);
}
```

**Key objc2 Types:**

| Type | Selector | Purpose |
|------|----------|---------|
| `NSWorkspace` | `sharedWorkspace()` | Access shared workspace |
| `NSWorkspace` | `frontmostApplication()` | Capture currently active app |
| `NSRunningApplication` | `activateWithOptions(_:)` | Reactivate captured app |
| `NSRunningApplication` | `bundleIdentifier()` | Identify the app |
| `NSRunningApplication` | `processIdentifier()` | Get PID for verification |
| `NSRunningApplication` | `hide()` / `unhide()` | Alternative activation path |
| `NSApplicationActivationOptions` | `ActivateAllWindows` | Bring all windows forward |
| `NSApplicationActivationOptions` | `ActivateIgnoringOtherApps` | Force activation (deprecated macOS 14+) |

**Critical Caveats (macOS 11+ Big Sur and later):**

1. **`ActivateAllWindows` not honored:** According to [Peter Maurer](https://twitter.com/petermaurer/status/1531635687686082562) (via [MJ Tsaiti's blog](https://mjtsai.com/blog/2022/05/31/activating-applications-via-applescript/)):
   > `NSRunningApplication` has the exact same problem, where `NSApplicationActivateAllWindows` isn't being honored. Started at around macOS 11.4.
   
   The only reliable workaround is the deprecated `SetFrontProcessWithOptions()`.

2. **`ActivateIgnoringOtherApps` deprecated in macOS 14:** The objc2 docs mark this as deprecated with the note: "This is deprecated in macOS 14 and will have no effect."

3. **Non-activating panels don't activate their owning app:** From [Phil Zakharchenko's analysis](https://philz.blog/nspanel-nonactivating-style-mask-flag/):
   > A panel with `NSWindowStyleMaskNonactivatingPanel` will be key but the application will not be considered active and will not own the menu bar. The window will "steal key focus" through `CPSStealKeyFocusReturningID`.
   
   Your HUD panel (`tauri-nspanel` backed) likely uses this behavior — so when your app is showing the HUD, your app is NOT the active app. This means `frontmostApplication` captures the app that WAS active before your HUD appeared.

4. **Fullscreen apps:** Activation may fail or be ignored when the target app is in a fullscreen space. The WindowServer may prevent activation of apps outside the current fullscreen context.

5. **Activation is not immediate:** Per the objc2 docs:
   > "You shouldn't assume the app will be active immediately after sending this message. The framework also does not guarantee that the app will be activated at all."

**Reliable Pattern:**
```rust
use objc2::rc::Retained;
use objc2_app_kit::{
    NSWorkspace, NSRunningApplication, 
    NSApplicationActivationOptions
};

struct CapturedApp {
    app: Retained<NSRunningApplication>,
    bundle_id: String,
}

unsafe fn capture_frontmost() -> Option<CapturedApp> {
    let workspace = NSWorkspace::sharedWorkspace();
    let frontmost = workspace.frontmostApplication()?;
    let bundle_id = frontmost.bundleIdentifier()
        .map(|b| b.to_string());
    Some(CapturedApp { app: frontmost, bundle_id })
}

unsafe fn reactivate_app(app: &NSRunningApplication) -> bool {
    let options = NSApplicationActivationOptions::ActivateAllWindows 
               | NSApplicationActivationOptions::ActivateIgnoringOtherApps;
    app.activateWithOptions(options)
}
```

---

### Option C: AppleScript-Based Activation

**Approach:**
```applescript
tell application "BundleIdentifier"
    activate
end tell
```

**Problems on macOS 11+ (Big Sur/Monterey/Ventura/Sonoma/Sequoia):**

From [John Gruber and Peter Maurer](https://mjtsai.com/blog/2022/05/31/activating-applications-via-applescript/):
> On MacOS 12 Monterey (and apparently MacOS 11 Big Sur), what happens instead is that TextEdit becomes the active application but only its frontmost window comes forward.

> On MacOS 10.15 Catalina, and all previous versions... all of the open windows in an app come forward when you tell that app to activate.

The behavior change is: AppleScript `activate` no longer brings all windows forward on Big Sur+.

**Additional issues:**
- Requires `automation.apple-events` entitlement
- Requires user to grant permission in System Settings > Privacy & Security > Automation
- Slower than native `NSRunningApplication` activation
- Adds AppleScript interpreter overhead

**When C might still be useful:**
- If you need to activate a SPECIFIC app by bundle ID and the native API fails
- As a fallback if `activateWithOptions` returns `false`

---

## Focus Drift Root Cause in Tauri v2 Context

Your app likely experiences focus drift because:

1. **HUD Panel (`tauri-nspanel`) uses non-activating behavior** — your app window stays active in WindowServer terms but doesn't "own" focus
2. **When you send clipboard/System Events paste**, macOS may route it to whatever app truly owns keyboard focus at that moment
3. **Your Tauri app (HUD panel) is not the `frontmostApplication`** in macOS terms — it's just "key" via key-focus-theft

**Sequence that causes failure:**
```
1. User types in target app (e.g., TextEdit)
2. User invokes voice command
3. Your HUD appears (non-activating panel)
4. macOS: TextEdit is still frontmostApplication, but HUD is key
5. Your Rust code captures TextEdit as frontmost
6. Your Rust code runs AppleScript paste
7. BUT: If focus shifted during step 3-4, paste goes to wrong app
```

---

## Recommended Implementation

### Phase 1: Capture + Reactivate (Option B)

```rust
// In your Rust code (src/src/text_inserter.rs or similar)
use objc2::rc::Retained;
use objc2_app_kit::{
    NSWorkspace, NSRunningApplication, 
    NSApplicationActivationOptions
};
use objc2_foundation::NSString;

pub struct FocusedApp {
    app: Retained<NSRunningApplication>,
    bundle_id: Option<Retained<NSString>>,
}

impl FocusedApp {
    /// Capture the currently frontmost application
    pub unsafe fn capture() -> Option<Self> {
        let workspace = NSWorkspace::sharedWorkspace();
        let app = workspace.frontmostApplication()?;
        let bundle_id = app.bundleIdentifier();
        Some(Self { app, bundle_id })
    }
    
    /// Reactivate this app with all windows, forcing focus
    pub unsafe fn reactivate(&self) -> bool {
        // Combine both options for maximum likelihood of success
        let options = NSApplicationActivationOptions::ActivateAllWindows 
                   | NSApplicationActivationOptions::ActivateIgnoringOtherApps;
        self.app.activateWithOptions(options)
    }
    
    /// Get bundle ID for logging/debugging
    pub fn bundle_id_string(&self) -> String {
        self.bundle_id
            .as_ref()
            .map(|b| b.to_string())
            .unwrap_or_else(|| "unknown".to_string())
    }
}
```

### Phase 2: Pre-Paste Sequence

```rust
// In your text insertion flow
pub unsafe fn insert_with_focus_restore<F>(&self, paste_fn: F) -> Result<(), Error>
where
    F: FnOnce() -> Result<(), Error>,
{
    // 1. Capture what was frontmost
    let frontmost = match FocusedApp::capture() {
        Some(app) => app,
        None => {
            // No frontmost app? May be in a weird state, proceed anyway
            return paste_fn();
        }
    };
    
    let original_bundle = frontmost.bundle_id_string();
    tracing::debug!("Captured frontmost app: {}", original_bundle);
    
    // 2. Optionally hide our HUD to reduce focus interference
    //    (your HUD is non-activating, but hiding it ensures
    //     WindowServer focus state is clean)
    
    // 3. Reactivate the target app
    let reactivate_success = frontmost.reactivate();
    tracing::debug!("Reactivation result: {}", reactivate_success);
    
    // 4. Small delay to let WindowServer settle
    //    (empirically needed on some macOS versions)
    std::thread::sleep(std::time::Duration::from_millis(50));
    
    // 5. Perform paste
    paste_fn()
    
    // 6. Optional: Log if reactivation failed for debugging
    if !reactivate_success {
        tracing::warn!(
            "Failed to reactivate {} - paste may have gone to wrong app",
            original_bundle
        );
    }
}
```

### Phase 3: Fallback with AppleScript (Option C)

If Option B repeatedly fails, fall back to AppleScript activation:

```rust
use std::process::Command;

fn apple_script_activate(bundle_id: &str) -> bool {
    let script = format!(
        r#"tell application id "{}" to activate"#,
        bundle_id
    );
    
    let output = Command::new("osascript")
        .args(["-e", &script])
        .output();
    
    match output {
        Ok(result) => result.status.success(),
        Err(e) => {
            tracing::error!("AppleScript activation failed: {}", e);
            false
        }
    }
}
```

---

## Entitlements Required

Regardless of which option you use, for System Events paste you'll need:

```xml
<!-- src/Entitlements.plist -->
<key>com.apple.security.automation.apple-events</key>
<true/>
```

And the user must grant permission in **System Settings > Privacy & Security > Automation** for your app to send Apple Events to other apps.

---

## Summary: Best Practice Recommendation

**For Tauri v2 apps using objc2/objc2-app-kit:**

1. **Primary:** Use `NSWorkspace.shared.frontmostApplication()` to capture, then `NSRunningApplication.activateWithOptions([.ActivateAllWindows, .ActivateIgnoringOtherApps])` to restore.

2. **Reality check:** This may not work reliably on macOS 11+ due to Apple's bugs. The WindowServer focus management APIs have known issues.

3. **If B fails:** Fall back to AppleScript `activate` for the specific bundle ID.

4. **Debug logging:** Log both the capture and reactivation success/failure so you can determine if this is the actual failure point in your case.

5. **Non-activating panel awareness:** Your HUD panel won't appear as `frontmostApplication` even when it's visually key. The captured app will be whatever was active BEFORE the HUD appeared.

6. **Consider hiding HUD before paste:** Since your HUD is non-activating, hiding it during paste may help WindowServer focus state settle more predictably.

---

## References

- [Apple: NSWorkspace.frontmostApplication](https://developer.apple.com/documentation/appkit/nsworkspace/frontmostapplication)
- [Apple: NSRunningApplication.activateWithOptions](https://developer.apple.com/documentation/appkit/nsrunningapplication/activatewithoptions)
- [Apple: NSApplicationActivationOptions](https://developer.apple.com/documentation/appkit/nsapplication/activationoptions)
- [MJ Tsai Blog: Activating Applications via AppleScript](https://mjtsai.com/blog/2022/05/31/activating-applications-via-applescript/) — Documents Big Sur+ behavior change
- [Phil Zakharchenko: Nonactivating Panel Style Mask Bug](https://philz.blog/nspanel-nonactivating-style-mask-flag/) — Deep dive into `kCGSPreventsActivationTagBit`
- [objc2-app-kit docs: NSWorkspace](https://docs.rs/objc2-app-kit/latest/objc2_app_kit/generated/NSWorkspace.rs)
- [objc2-app-kit docs: NSRunningApplication](https://docs.rs/objc2-app-kit/latest/objc2_app_kit/struct.NSRunningApplication)
- [Stack Overflow: activateWithOptions behavior change with Big Sur](https://stackoverflow.com/questions/65196498/nsrunningapplication-activatewithoptions-method-behavior-change-with-big-sur)
