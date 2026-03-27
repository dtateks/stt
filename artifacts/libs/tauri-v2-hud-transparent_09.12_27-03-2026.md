# Tauri v2 macOS HUD Overlay Window Research (CORRECTED)

**Date:** 27-03-2026  
**Project:** Voice to Text (Tauri v2 macOS app)

---

## 1. Is `transparent(true)` Available on `WebviewWindowBuilder`?

### Answer: YES — but gated behind `macos-private-api` feature flag

**Evidence** ([tauri source line 1070-1082](https://github.com/tauri-apps/tauri/blob/v2.9.5/crates/tauri/src/webview/webview_window.rs#L1070-L1082)):

```rust
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

**Compile guard:** The method is only available when:
- `target_os != "macos"`, **OR**
- The `macos-private-api` Cargo feature is enabled

### Why the compile error occurs

**Current `src/Cargo.toml` (line 20):**
```toml
tauri = { version = "2", features = ["tray-icon"] }
```

**Missing:** `macos-private-api` feature.

### Fix: Enable the feature

```toml
# src/Cargo.toml
[dependencies]
tauri = { version = "2", features = ["tray-icon", "macos-private-api"] }
```

### WARNING from Tauri source ([tauri lib.rs line ~](https://github.com/tauri-apps/tauri/blob/v2.9.5/crates/tauri/src/lib.rs)):
```
/// - **macos-private-api**: Enables features only available in **macOS**'s private APIs,
///   currently the `transparent` window functionality and the `fullScreenEnabled`
///   preference setting to `true`. Enabled by default if the `tauri > macosPrivateApi`
///   config flag is set to `true` on the `tauri.conf.json` file.
```

**App Store implication:** Using private APIs on macOS prevents App Store acceptance.

---

## 2. Alternative: Configure Transparency via `tauri.conf.json`

The config file can set `transparent: true` per-window, which bypasses the builder API:

**`src/tauri.conf.json` (or `tauri.conf.json` at project root):**
```json
{
  "app": {
    "windows": [
      {
        "label": "bar",
        "transparent": true
      }
    ]
  },
  "tauri": {
    "macOSPrivateApi": true
  }
}
```

**Evidence** ([config.rs line 1757-1762](https://github.com/tauri-apps/tauri/blob/v2.9.5/crates/tauri-utils/src/config.rs#L1757-L1762)):
```rust
/// Whether the window is transparent or not.
///
/// Note that on `macOS` this requires the `macos-private-api` feature flag,
/// enabled under `tauri > macOSPrivateApi`.
/// WARNING: Using private APIs on `macOS` prevents your application from
/// being accepted to the `App Store`.
#[serde(default)]
pub transparent: bool,
```

The config also requires:
```json
"tauri": {
  "macOSPrivateApi": true
}
```

---

## 3. macOS Transparent Window Caveats

| Issue | Detail |
|-------|--------|
| **App Store rejection** | Using `macos-private-api` / `transparent` on macOS disqualifies App Store distribution |
| **Webview background** | Per [Tauri docs](https://v2.tauri.app/reference/javascript/api/namespacewebview): *"macOS / iOS: Not implemented for the webview layer"* — `setBackgroundColor()` does NOT work on macOS |
| **CSS must support transparency** | `bar.html` body/root element must have `background: transparent` |
| **NSWindow post-build config** | Must use Cocoa API via `window.ns_window()` to clear background |

---

## 4. Best-Supported Fallback for Inactive HUD (No White Background)

Since `transparent(true)` requires `macos-private-api` (and App Store implications), here's the **supported fallback**:

### Option A: Build hidden, position, then show

```rust
fn build_bar_window(app: &tauri::App) -> tauri::Result<()> {
    let bar_window =
        WebviewWindowBuilder::new(app, BAR_WINDOW_LABEL, WebviewUrl::App("bar.html".into()))
            .initialization_script(include_str!("../../ui/tauri-bridge.js"))
            .title("Voice to Text Bar")
            .inner_size(600.0, 56.0)
            .decorations(false)
            .always_on_top(true)
            .focused(false)
            .resizable(false)
            .skip_taskbar(true)
            .visible(false)  // <-- Build HIDDEN first
            .build()?;

    bar_window.set_visible_on_all_workspaces(true)?;
    bar_window.set_focusable(false)?;
    bar_window.set_ignore_cursor_events(true)?;

    // Position using positioner plugin
    use tauri_plugin_positioner::{WindowExt, Position};
    bar_window.as_ref().window().move_window(Position::TopCenter)?;

    // Show only after all setup, preventing white flash
    bar_window.show()?;

    Ok(())
}
```

**Result:** No white background because window isn't visible during setup. When shown, it appears positioned at TopCenter.

### Option B: Use positioner + explicit CSS background

In `bar.html`:
```css
html, body {
  background: transparent !important;
  margin: 0;
  padding: 0;
}
```

### Option C: For non-App Store builds only — enable transparency properly

If App Store distribution is not required:

```toml
# src/Cargo.toml
[target.'cfg(target_os = "macos")'.dependencies]
tauri = { version = "2", features = ["tray-icon", "macos-private-api"] }
```

Then use:
```rust
WebviewWindowBuilder::new(app, BAR_WINDOW_LABEL, WebviewUrl::App("bar.html".into()))
    .transparent(true)  // Now compiles on macOS
    // ...
    .build()?;
```

And post-build (from [window-customization docs](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/learn/window-customization.mdx)):
```rust
#[cfg(target_os = "macos")] {{
    use cocoa::appkit::{NSColor, NSWindow};
    use cocoa::base::{id, nil};

    let ns_window = window.ns_window().unwrap() as id;
    unsafe {
        ns_window.setBackgroundColor_(nil);  // Transparent
    }
}}
```

---

## Summary of Findings

| Question | Answer |
|----------|--------|
| Does `transparent(true)` exist on `WebviewWindowBuilder`? | **YES** — but gated behind `macos-private-api` feature |
| Why compile error? | `macos-private-api` feature not enabled in `Cargo.toml` |
| How to enable? | Add `macos-private-api` to tauri features **OR** set `tauri.macOSPrivateApi: true` in config |
| App Store safe? | **NO** — private APIs violate App Store guidelines |
| Best HUD fallback? | Build with `visible(false)`, position, then `show()` — avoids white background entirely |

---

## References

- [Tauri WebviewWindowBuilder transparent() source](https://github.com/tauri-apps/tauri/blob/v2.9.5/crates/tauri/src/webview/webview_window.rs#L1070-L1082)
- [Config transparent field](https://github.com/tauri-apps/tauri/blob/v2.9.5/crates/tauri-utils/src/config.rs#L1757-L1762)
- [tauri-plugin-positioner Position enum](https://github.com/tauri-apps/tauri-plugin-positioner/blob/v1/src/ext.rs#L14-L36)
- [Window customization with Cocoa background](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/learn/window-customization.mdx)
