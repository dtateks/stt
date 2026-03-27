# Tauri v2 macOS HUD Overlay Window Research

**Date:** 27-03-2026  
**Project:** Voice to Text (Tauri v2 macOS app)

---

## 1. Transparent WebViewWindow on macOS

### Finding: `transparent()` method requires `macos-private-api` feature

**Evidence** ([docs.rs tauri 2.9.5](https://docs.rs/tauri/2.9.5/src/tauri/webview/webview_window.rs#)):
```rust
/// Whether the window should be transparent. If this is true, writing colors
/// with alpha values different than `1.0` will produce a transparent window.
#[cfg(any(not(target_os = "macos"), feature = "macos-private-api"))]
#[cfg_attr(
  docsrs,
  doc(cfg(any(not(target_os = "macos"), feature = "macos-private-api")))
)]
#[must_use]
pub fn transparent(mut self, transparent: bool) -> Self {
    #[cfg(desktop)]
    {
      self.window_builder = self.window_builder.transparent(transparent);
    }
    self.webview_builder = self.webview_builder.transparent(transparent);
    self
}
```

**Key constraint:** The `transparent()` API is **disabled on macOS by default**. It only becomes available when:
1. The Tauri app has the `macos-private-api` Cargo feature enabled, **OR**
2. Running on a non-macOS platform

**Usage:**
```rust
WebviewWindowBuilder::new(app, "bar", WebviewUrl::App("bar.html".into()))
    .transparent(true)  // Requires macos-private-api feature on macOS
    .build()?;
```

### Enabling the feature in `src/Cargo.toml`:
```toml
[target.'cfg(target_os = "macos")'.dependencies]
tauri = { version = "2", features = ["macos-private-api"] }
```

---

## 2. Window Position APIs

### 2a. Center on screen (built-in)
```rust
WebviewWindowBuilder::new(app, "bar", WebviewUrl::App("bar.html".into()))
    .center()  // Centers on current monitor
    .build()?;
```

### 2b. Explicit position via `position(x, y)`
```rust
WebviewWindowBuilder::new(app, "bar", WebviewUrl::App("bar.html".into()))
    .position(100.0, 100.0)  // Physical pixels from top-left
    .build()?;
```

### 2c. Get current position
```rust
let pos = window.outer_position()?;  // Returns PhysicalPosition<i32>
```

### 2d. Positioner plugin for well-known positions

**Position enum** ([source](https://github.com/tauri-apps/tauri-plugin-positioner/blob/v1/src/ext.rs#L14-L36)):
```rust
pub enum Position {
    TopLeft = 0,
    TopRight,
    BottomLeft,
    BottomRight,
    TopCenter,    // <-- Horizontally centered at TOP of screen
    BottomCenter,
    LeftCenter,
    RightCenter,
    Center,
    // ... tray variants (feature-gated)
}
```

**Rust usage:**
```rust
use tauri_plugin_positioner::{WindowExt, Position};

let win = app.get_webview_window("bar").unwrap();
win.as_ref().window().move_window(Position::TopCenter)?;
```

**JavaScript usage:**
```javascript
import { moveWindow, Position } from '@tauri-apps/plugin-positioner';
await moveWindow(Position.TopCenter);
```

**`TopCenter` calculation** (from [ext.rs lines 88-91](https://github.com/tauri-apps/tauri-plugin-positioner/blob/v1/src/ext.rs#L88-L91)):
```rust
TopCenter => PhysicalPosition {
    x: screen_position.x + ((screen_size.width / 2) - (window_size.width / 2)),
    y: screen_position.y,  // <-- Top of current monitor
},
```

---

## 3. macOS Transparent WebView Caveats

| Issue | Detail |
|-------|--------|
| **Feature flag required** | `macos-private-api` must be enabled in Cargo.toml |
| **Webview background** | Per [docs](https://v2.tauri.app/reference/javascript/api/namespacewebview): *"macOS / iOS: Not implemented for the webview layer"* — `setBackgroundColor()` does NOT work on macOS |
| **NSWindow background** | Must use Cocoa API via `window.ns_window()` after build to set `setBackgroundColor_()` |
| **CSS must support transparency** | `bar.html` body/root element must have `background: transparent` |

### Solution for transparent HUD on macOS:

```rust
#[cfg(target_os = "macos")]
{
    use cocoa::appkit::{NSColor, NSWindow};
    use cocoa::base::{id, nil};

    let ns_window = bar_window.ns_window().unwrap() as id;
    unsafe {
        // Clear the background to transparent
        ns_window.setBackgroundColor_(cocoa::base::nil);
        // Or for translucent content:
        // let bg_color = NSColor::colorWithRed_green_blue_alpha_(nil, 0.0, 0.0, 0.0, 0.0);
        // ns_window.setBackgroundColor_(bg_color);
    }
}
```

---

## 4. Hidden vs Visible Window Pattern for HUDs

### Finding: `visible(false)` + `show()` after build is correct

**Evidence from current code** ([lib.rs line 63](https://github.com/dta-teks/stt/blob/main/src/src/lib.rs#L63)):
```rust
fn build_bar_window(app: &tauri::App) -> tauri::Result<()> {
    let bar_window =
        WebviewWindowBuilder::new(app, BAR_WINDOW_LABEL, WebviewUrl::App("bar.html".into()))
            // ... config ...
            .visible(true)  // Visible on creation
            .build()?;      // <-- window created and shown here

    bar_window.set_visible_on_all_workspaces(true)?;
    bar_window.set_focusable(false)?;
    bar_window.set_ignore_cursor_events(true)?;
    bar_window.show()?;  // Redundant since visible(true) already showed it

    Ok(())
}
```

### Recommended pattern for overlay HUD:

```rust
// Step 1: Build hidden
WebviewWindowBuilder::new(app, "bar", WebviewUrl::App("bar.html".into()))
    .visible(false)  // Start hidden
    .always_on_top(true)
    .decorations(false)
    .focused(false)
    .resizable(false)
    .skip_taskbar(true)
    .build()?;

// Step 2: Configure after build
bar_window.set_visible_on_all_workspaces(true)?;
bar_window.set_focusable(false)?;
bar_window.set_ignore_cursor_events(true)?;

// Step 3: Position (use positioner plugin or explicit coords)
bar_window.as_ref().window().move_window(Position::TopCenter)?;

// Step 4: Show when ready
bar_window.show()?;
```

### Why this pattern:
- `visible(false)` creates the window but keeps it hidden
- Post-build configuration can happen before first paint
- Avoids white flash during window setup
- `show()` explicitly reveals when ready

---

## Summary of Required Changes

| Issue | Fix |
|-------|-----|
| White background showing while inactive | Enable `macos-private-api`, use `.transparent(true)` + Cocoa background clear |
| Wrong HUD position | Use `tauri_plugin_positioner::Position::TopCenter` or calculate explicit position |
| White flash on startup | Build with `.visible(false)`, call `.show()` after all configuration |

---

## References

- [Tauri WebviewWindowBuilder docs (v2.9.5)](https://docs.rs/tauri/2.9.5/tauri/webview/struct.WebviewWindowBuilder)
- [tauri-plugin-positioner source](https://github.com/tauri-apps/tauri-plugin-positioner)
- [Window customization docs](https://v2.tauri.app/learn/window-customization)
- [Positioner plugin docs](https://v2.tauri.app/plugin/positioner)
