# macOS Floating HUD Window Above Fullscreen Apps — Evidence

## TL;DR

**Tauri v2 does NOT expose the required native macOS configuration directly.** A non-focusable always-on-top HUD over fullscreen spaces requires:

1. `NSWindow.CollectionBehavior.canJoinAllSpaces`
2. `NSWindow.CollectionBehavior.fullScreenAuxiliary` (or `.auxiliary`)
3. Raw AppKit access via the `cocoa` crate — no public Tauri API

---

## 1. Required NSWindow Collection Behavior Flags

### `canJoinAllSpaces`

**Evidence** ([Apple Docs](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/canjoinallspaces)):
> The window can appear in all spaces. The menu bar behaves this way.

```swift
window.collectionBehavior.insert(.canJoinAllSpaces)
```

### `fullScreenAuxiliary`

**Evidence** ([Apple Docs](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/fullscreenauxiliary)):
> The window displays on the same space as the full screen window.

```swift
window.collectionBehavior.insert(.fullScreenAuxiliary)
```

### `.auxiliary` (alternative)

**Evidence** ([Apple Docs](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/auxiliary)):
> The behavior marking this window as auxiliary for both Stage Manager and full screen.

### Working Swift Implementation (FloatingPanel.swift)

**Evidence** ([sarunw/FloatingPanel.swift](https://gist.github.com/sarunw/26725860e3ac318971b7bc84a54d14b7)):

```swift
class FloatingPanel: NSPanel {
    init(contentRect: NSRect, backing: NSWindow.BackingStoreType, defer flag: Bool) {
        super.init(contentRect: contentRect, 
                   styleMask: [.nonactivatingPanel, .resizable, .closable, .fullSizeContentView],
                   backing: backing, defer: flag)
        
        self.isFloatingPanel = true
        self.level = .floating
        
        // Allow the panel to appear in a fullscreen space
        self.collectionBehavior.insert(.fullScreenAuxiliary)
        self.collectionBehavior.insert(.canJoinAllSpaces)
        
        // NSWindowCollectionBehaviorCanJoinAllSpaces and NSWindowCollectionBehaviorFullScreenAuxiliary
    }
}
```

---

## 2. Tauri Exposure (or Lack Thereof)

### `visibleOnAllWorkspaces` Is Insufficient

**Evidence** ([tauri#11488](https://github.com/tauri-apps/tauri/issues/11488)):
> When creating a window with the `visibleOnAllWorkspaces` parameter on macOS, the window does not appear on top of all workspaces and full-screen windows.

**State**: Closed as "not planned"

### `setLevel_` and `setCollectionBehavior_` Don't Work in Release

**Evidence** ([tauri#5566](https://github.com/tauri-apps/tauri/issues/5566)):
```rust
ns_win.setLevel_(((NSMainMenuWindowLevel + 1) as u64).try_into().unwrap());
ns_win.setCollectionBehavior_(
    NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces,
);
```
> Works in dev, but `setLevel_` and `setCollectionBehavior_` not work in fullscreen of release.

### Feature Request: `set_visible_on_fullscreen()` — Still Open

**Evidence** ([tao#189](https://github.com/tauri-apps/tao/issues/189)):
> Would allow for Spotlight-like panel windows.
> State: **open**

### Feature Request: Expose Collection Behavior — Still Open

**Evidence** ([tao#890](https://github.com/tauri-apps/tao/issues/890)):
> Expose the nswindowbehavior managed on macos.
> Also, would be nice if "set_always_on_top" also set this flag so the window wouldn't disappear from mission control.
> State: **open**

### NSPanel Support Request — Still Open

**Evidence** ([tao#414](https://github.com/tauri-apps/tao/issues/414)):
> I need Tauri/Tao windows to behave like `NSPanel` in macOS.
> State: **open**

### Window Cannot Join Spaces in Build Mode

**Evidence** ([tauri#9556](https://github.com/tauri-apps/tauri/issues/9556)):
> In `tauri dev` mode: window can be drawn on another workspace.
> In `tauri build` mode: window is always drawn on the original workspace and cannot be moved to another space.

### Show Window on Top of Fullscreen — Closed Not Planned

**Evidence** ([tauri#5793](https://github.com/tauri-apps/tauri/issues/5793)):
> Ability to make a window visible on top of everything.
> State: **closed (not planned)**

---

## 3. Workarounds and Caveats

### Workaround: `ActivationPolicy::Accessory`

**Evidence** ([tauri#11488](https://github.com/tauri-apps/tauri/issues/11488)):
```rust
app.set_activation_policy(tauri::ActivationPolicy::Accessory);
```
> The window appears above all system windows.

**Caveat**: The app icon disappears from the Dock.

### Non-Activating Panel for HUD Behavior

For a non-focusable HUD that doesn't steal focus:

**Evidence** ([sarunw/FloatingPanel.swift](https://gist.github.com/sarunw/26725860e3ac318971b7bc84a54d14b7)):
```swift
// Use .nonactivatingPanel style mask
styleMask: [.nonactivatingPanel, .resizable, .closable, .fullSizeContentView]

// Override to return true for text input focus
override var canBecomeKey: Bool { return true }
override var canBecomeMain: Bool { return true }
```

### Window Level

For a floating HUD:
```swift
self.level = .floating
self.isFloatingPanel = true
```

---

## 4. Native Access Required (No Public Tauri API)

Since Tauri does not expose collection behavior configuration, raw AppKit is required:

**Evidence** ([tauri#5566](https://github.com/tauri-apps/tauri/issues/5566) — working dev example):
```rust
#[cfg(target_os = "macos")]
{
    use cocoa::appkit::{NSMainMenuWindowLevel, NSWindow, NSWindowCollectionBehavior};
    use cocoa::base::id;
    let ns_win = main_window.ns_window().unwrap() as id;
    unsafe {
        ns_win.setLevel_(((NSMainMenuWindowLevel + 1) as u64).try_into().unwrap());
        ns_win.setCollectionBehavior_(
            NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces,
        );
    }
}
```

### Rust Dependencies Required
```toml
[target.'cfg(target_os = "macos")'.dependencies]
cocoa = "0.24"
objc = "0.2"
```

---

## 5. Summary Table

| Requirement | Tauri v2 Support | Native macOS |
|-------------|-------------------|-------------|
| `canJoinAllSpaces` | ❌ Not exposed | ✅ `NSWindow.CollectionBehavior.canJoinAllSpaces` |
| `fullScreenAuxiliary` | ❌ Not exposed | ✅ `NSWindow.CollectionBehavior.fullScreenAuxiliary` |
| `visibleOnAllWorkspaces` | ⚠️ Partial (no fullscreen) | N/A |
| `setLevel` | ✅ Exposed | ✅ Via `ns_window()` |
| Non-activating panel | ❌ Not exposed | ✅ NSPanel with `.nonactivatingPanel` |

---

## 6. Implications for /Users/dta.teks/dev/stt

Your Tauri v2 HUD at `/Users/dta.teks/dev/stt` cannot achieve fullscreen-space visibility through any public Tauri API. You must:

1. Use raw AppKit via the `cocoa` crate in your Rust backend
2. Call `setCollectionBehavior_` with `NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary`
3. Consider using `NSPanel` instead of `NSWindow` for the non-activating HUD behavior
4. Be aware that `ActivationPolicy::Accessory` would work but removes the Dock icon

The `visibleOnAllWorkspaces` window attribute is necessary but not sufficient for fullscreen spaces — the collection behavior flags are the actual requirement that Tauri never exposes.
