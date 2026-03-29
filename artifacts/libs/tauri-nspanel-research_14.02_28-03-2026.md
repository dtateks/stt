# tauri-nspanel Research: NSPanel for Tauri v2

**Research Date:** 28-03-2026  
**Crate:** `tauri-nspanel` v2.1.0  
**Tauri v2 Compatibility:** ✅ YES  
**crates.io:** https://crates.io/crates/tauri-nspanel  
**Repository:** https://github.com/ahkohd/tauri-nspanel

---

## 1. Does tauri-nspanel Exist? What Version? Tauri v2 Compatible?

**YES.** The crate `tauri-nspanel` exists and is actively maintained.

| Property | Value |
|----------|-------|
| **Crate Name** | `tauri-nspanel` |
| **Latest Version** | 2.1.0 |
| **Repository Branch** | `v2.1` (default) |
| **Tauri Version** | 2.8.5 |
| **MSRV** | Rust 1.75 |
| **License** | Apache 2.0 |

**Evidence** ([Cargo.toml](https://github.com/ahkohd/tauri-nspanel/blob/v2.1/Cargo.toml#L1-L20)):

```toml
[package]
name = "tauri-nspanel"
version = "2.1.0"
description = "A plugin for subclassing Tauri's NSWindow to NSPanel"

[dependencies]
tauri = { version = "2.8.5", features = ["macos-private-api"] }
pastey = "0.2"

[target."cfg(target_os = \"macos\")".dependencies]
objc2 = "0.6.1"
objc2-app-kit = "0.3.1"
objc2-foundation = "0.3.1"
```

**⚠️ npm package:** There is NO npm package for `tauri-nspanel`. It is a **Rust-only plugin** for the Tauri backend.

---

## 2. What Does It Do?

`tauri-nspanel` converts Tauri's `NSWindow` into an `NSPanel` — a floating/panel window class that supports behaviors unavailable to regular windows.

### Key Capabilities

| Feature | Description |
|---------|-------------|
| **Panel conversion** | `window.to_panel::<Panel>()` converts existing Tauri window to NSPanel |
| **Custom panel class** | `panel!` macro generates custom Objective-C NSPanel subclass |
| **Floating level** | `PanelLevel::Floating` (4), `PanelLevel::Status` (25), `PanelLevel::PopUpMenu` (101), etc. |
| **Collection behavior** | Builder for `NSWindowCollectionBehavior` flags |
| **Non-activating** | Panels can be non-activating (`is_floating_panel`, `nonactivating_panel` style mask) |
| **Mouse tracking** | Built-in `NSTrackingArea` support via `tracking_area` config |
| **Event handlers** | `NSWindowDelegate` event handlers for key/resign/mouse events |

### Core API

```rust
// In lib.rs - the Panel trait
pub trait Panel<R: tauri::Runtime = tauri::Wry>: Send + Sync {
    fn show(&self);
    fn hide(&self);
    fn to_window(&self) -> Option<tauri::WebviewWindow<R>>;
    fn as_panel(&self) -> &objc2_app_kit::NSPanel;
    fn set_level(&self, level: i64);
    fn set_collection_behavior(&self, behavior: objc2_app_kit::NSWindowCollectionBehavior);
    // ... many more methods
}

pub trait WebviewWindowExt<R: Runtime> {
    fn to_panel<P: FromWindow<R> + 'static>(&self) -> tauri::Result<PanelHandle<R>>;
}
```

---

## 3. Usage in Practice: Real-World Examples

### Example A: BongoCat (ayangweb/BongoCat)

**Location:** [src-tauri/src/core/setup/macos.rs](https://github.com/ayangweb/BongoCat/blob/master/src-tauri/src/core/setup/macos.rs)

```rust
#![allow(deprecated)]
use tauri::{AppHandle, Emitter, EventTarget, WebviewWindow};
use tauri_nspanel::{WebviewWindowExt, cocoa::appkit::NSWindowCollectionBehavior, panel_delegate};
use tauri_plugin_custom_window::MAIN_WINDOW_LABEL;

#[allow(non_upper_case_globals)]
const NSWindowStyleMaskNonActivatingPanel: i32 = 1 << 7;
#[allow(non_upper_case_globals)]
const NSResizableWindowMask: i32 = 1 << 3;

pub fn platform(
    app_handle: &AppHandle,
    main_window: WebviewWindow,
    _preference_window: WebviewWindow,
) {
    let _ = app_handle.plugin(tauri_nspanel::init());
    let _ = app_handle.set_dock_visibility(false);

    let panel = main_window.to_panel().unwrap();

    panel.set_style_mask(NSWindowStyleMaskNonActivatingPanel | NSResizableWindowMask);

    // KEY: Collection behavior for floating over fullscreen
    panel.set_collection_behaviour(
        NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
            | NSWindowCollectionBehavior::NSWindowCollectionBehaviorStationary
            | NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary,
    );

    let delegate = panel_delegate!(EcoPanelDelegate {
        window_did_become_key,
        window_did_resign_key,
        window_did_resize,
        window_did_move
    });
    // ... event handling setup
    panel.set_delegate(delegate);
}
```

### Example B: screenpipe (Real-world overlay with fullscreen support)

**Location:** [apps/screenpipe-app-tauri/src-tauri/src/window/show.rs](https://github.com/screenpipe/screenpipe/blob/main/apps/screenpipe-app-tauri/src-tauri/src/window/show.rs#L237-L260)

```rust
// Show existing main window with fullscreen support
run_on_main_thread_safe(app, move || {
    if let Ok(panel) = app_clone.get_webview_panel(&lbl) {
        use objc::{msg_send, sel, sel_impl};
        use tauri_nspanel::cocoa::appkit::NSWindowCollectionBehavior;

        // KEY: Level 1001 is NSPopUpMenuWindowLevel - above most windows
        panel.set_level(1001);

        panel.set_collection_behaviour(
            NSWindowCollectionBehavior::NSWindowCollectionBehaviorMoveToActiveSpace |
            NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary
        );
        let sharing: u64 = if capturable { 1 } else { 0 };
        let _: () = unsafe { msg_send![&*panel, setSharingType: sharing] };

        // Show panel
        unsafe { show_panel_visible(&panel, &app_clone, true); }

        // KEY: Remove MoveToActiveSpace to pin panel to current Space
        panel.set_collection_behaviour(
            NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary
        );
    }
});
```

### Example C: Basic panel definition (from examples)

**Location:** [examples/fullscreen/src-tauri/src/main.rs](https://github.com/ahkohd/tauri-nspanel/blob/v2.1/examples/fullscreen/src-tauri/src/main.rs)

```rust
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, PanelLevel, StyleMask, TrackingAreaOptions,
    WebviewWindowExt,
};

tauri_panel! {
    panel!(BasicPanel {
        config: {
            can_become_key_window: true,
            is_floating_panel: true
        }
        with: {
            tracking_area: {
                options: TrackingAreaOptions::new()
                    .active_always()
                    .mouse_entered_and_exited()
                    .mouse_moved(),
                auto_resize: true
            }
        }
    })
}

fn init(app_handle: &AppHandle) {
    let window = app_handle.get_webview_window("main").unwrap();
    let panel = window.to_panel::<BasicPanel>().unwrap();

    // Float level + non-activating
    panel.set_level(PanelLevel::Floating.value());
    panel.set_style_mask(StyleMask::empty().nonactivating_panel().into());

    // Fullscreen-aware collection behavior
    panel.set_collection_behavior(
        CollectionBehavior::new()
            .full_screen_auxiliary()
            .can_join_all_spaces()
            .into(),
    );
}
```

---

## 4. Collection Behavior and Window Level for Fullscreen

### The Critical Combination

For a panel to appear **above fullscreen apps**, you need BOTH:

1. **Window Level** ≥ `NSPopUpMenuWindowLevel` (101) — preferably **1001** or `NSScreenSaverWindowLevel` (1000)
2. **Collection Behavior** flags: `FullScreenAuxiliary` + `Stationary` (NOT `MoveToActiveSpace` after show)

### Window Levels (from `PanelLevel` enum in [builder.rs](https://github.com/ahkohd/tauri-nspanel/blob/v2.1/src/builder.rs#L130-L165))

```rust
pub enum PanelLevel {
    Normal = 0,
    Submenu = 3,
    TornOffMenu = 3,
    Floating = 4,      // NSNormalWindowLevel
    ModalPanel = 8,
    Utility = 19,
    Dock = 20,
    MainMenu = 24,
    Status = 25,       // NSStatusWindowLevel - YOUR CURRENT LEVEL (too low)
    PopUpMenu = 101,   // NSPopUpMenuWindowLevel
    ScreenSaver = 1000, // NSScreenSaverWindowLevel
    Custom(i32),
}
```

### Collection Behavior Flags (from [builder.rs](https://github.com/ahkohd/tauri-nspanel/blob/v2.1/src/builder.rs))

```rust
impl CollectionBehavior {
    pub fn can_join_all_spaces(mut self) -> Self { ... }
    pub fn move_to_active_space(mut self) -> Self { ... }  // Remove after show!
    pub fn managed(mut self) -> Self { ... }
    pub fn transient(mut self) -> Self { ... }
    pub fn stationary(mut self) -> Self { ... }
    pub fn participates_in_cycle(mut self) -> Self { ... }
    pub fn ignores_cycle(mut self) -> Self { ... }
    pub fn full_screen_auxiliary(mut self) -> Self { ... }
}
```

### Why Your Current Approach Fails

| Your Current Setting | Problem |
|---------------------|---------|
| `NSStatusWindowLevel` (25) | Too low — fullscreen apps use higher levels |
| `CanJoinAllSpaces \| FullScreenAuxiliary \| Stationary` | Correct flags, but level is wrong |
| Missing `MoveToActiveSpace` removal | screenpipe shows you must remove it AFTER show |

### Working Configuration (from screenpipe)

```rust
// Step 1: Set high window level FIRST
panel.set_level(1001);  // NSPopUpMenuWindowLevel or higher

// Step 2: Initially include MoveToActiveSpace
panel.set_collection_behaviour(
    NSWindowCollectionBehavior::MoveToActiveSpace |
    NSWindowCollectionBehavior::FullScreenAuxiliary
);

// Step 3: Show the panel
unsafe { show_panel_visible(&panel, &app, true); }

// Step 4: Remove MoveToActiveSpace to PIN to current Space
panel.set_collection_behaviour(
    NSWindowCollectionBehavior::FullScreenAuxiliary
);
```

---

## 5. Alternative Approaches Without tauri-nspanel

### Option A: Pure Rust with objc2 (without plugin)

You can directly subclass NSWindow to NSPanel using `objc2`:

```rust
// NOT RECOMMENDED - reinventing the wheel
use objc2_app_kit::{NSPanel, NSWindowStyleMask};
```

### Option B: Use `tauri-plugin-macos-window` (if available)

No such official plugin exists in the Tauri v2 ecosystem.

### Option C: Direct `NSWindow` manipulation via `macos-private-api`

Your current approach attempts this, but:
- Tauri's `NSWindow` is wrapped and may not expose all needed APIs
- The `NSWindow` backing your WebViewWindow may not support `NSPanel`-specific behaviors
- You cannot easily convert an existing `NSWindow` to `NSPanel` without the subclassing `tauri-nspanel` does

### Why tauri-nspanel is the Correct Solution

| Approach | Converts NSWindow → NSPanel? | Custom Class? | Panel API? |
|----------|----------------------------|--------------|-----------|
| Your current code | ❌ No | ❌ No | ❌ No |
| `tauri-nspanel` | ✅ Yes (via macro) | ✅ Yes | ✅ Yes |

The key insight: **Tauri v2's `WebviewWindow` wraps an `NSWindow`, not an `NSPanel`**. To get NSPanel behavior, you must subclass it. `tauri-nspanel` does this via the `panel!` macro and `to_panel()` conversion.

---

## 6. Summary: Exact Answers

| Question | Answer |
|----------|--------|
| **Crate name** | `tauri-nspanel` |
| **crates.io** | https://crates.io/crates/tauri-nspanel |
| **npm package** | **None** (Rust-only) |
| **Latest version** | 2.1.0 |
| **Tauri v2 compatible** | ✅ Yes (tauri ≥2.8.5) |
| **What it does** | Subclasses Tauri's NSWindow to NSPanel using `panel!` macro + `to_panel()` |
| **Window level for fullscreen** | Use **1001** (`PanelLevel::Custom(1001)`) — NOT 25 |
| **Collection behavior for fullscreen** | `FullScreenAuxiliary` + initially `MoveToActiveSpace`, then remove `MoveToActiveSpace` after show |
| **Example projects** | BongoCat, screenpipe |

### Minimal Integration Steps

```rust
// Cargo.toml
[dependencies]
tauri-nspanel = "2.1"

[features]
macos-private-api = ["tauri/macos-private-api"]
```

```rust
// main.rs
use tauri_nspanel::{tauri_panel, WebviewWindowExt, cocoa::appkit::NSWindowCollectionBehavior, ManagerExt};

tauri_panel! {
    panel!(HUDPanel {
        config: {
            can_become_key_window: true,
            is_floating_panel: true
        }
    })
}

fn setup_hud(window: WebviewWindow) {
    let _ = window.app_handle().plugin(tauri_nspanel::init());
    let panel = window.to_panel::<HUDPanel>().unwrap();

    // Level 1001 = above fullscreen apps
    panel.set_level(1001);

    // Fullscreen-aware collection behavior
    panel.set_collection_behaviour(
        NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary
    );

    panel.show();
}
```

---

## 7. Critical Caveats

| Caveat | Impact | Mitigation |
|--------|--------|------------|
| **Rust-only** | No JavaScript/TypeScript API | All panel config must be in Rust |
| **macOS only** | Plugin does nothing on Windows/Linux | Use `#[cfg(target_os = "macos")]` |
| **Main thread only** | All panel operations must be on main thread | Use `app.run_on_main_thread()` |
| **Not in default capabilities** | Must explicitly add to `src/capabilities/default.json` | Add `tauri-nspanel` plugin permissions |
| **NSWindow ↔ NSPanel conversion** | `to_panel()` subclasses the window at creation time | Convert BEFORE window is shown |
| **MoveToActiveSpace removal** | Required to stay pinned to Space | Remove AFTER `show_panel_visible()` call |

---

## 8. Related Issues

- [tauri-apps/tauri#11488](https://github.com/tauri-apps/tauri/issues/11488) — `visibleOnAllWorkspaces` window not staying on top of full-screen apps
- [tauri-apps/tao#414](https://github.com/tauri-apps/tao/issues/414) — `NSPanel` behavior needed for TaoWindow
- [tauri-apps/tauri#5793](https://github.com/tauri-apps/tauri/issues/5793) — feat: show window on top of full-screen app (closed not_planned)
- [tauri-apps/tao#189](https://github.com/tauri-apps/tao/issues/189) — feat: `window.set_visible_on_fullscreen()` (open)
