# Tauri v2 Research: Electron → Tauri Migration Analysis

**Research Date:** 26-03-2026  
**Source:** [v2.tauri.app](https://v2.tauri.app/) official documentation

---

## 1. Current Stable Versions and Package Names

Based on the [Tauri v2 Release Notes](https://v2.tauri.app/release/) and [official docs](https://v2.tauri.app/start/):

| Package | Package Name | Current Stable | Notes |
|---------|-------------|---------------|-------|
| **Core (Rust)** | `tauri` | `2.10.3` | [Release](https://v2.tauri.app/release/tauri/v2.10.3/) |
| **CLI** | `@tauri-apps/cli` | `2.10.1` | [Release](https://v2.tauri.app/release/@tauri-apps/cli/v2.10.1/) |
| **JS API** | `@tauri-apps/api` | `2.10.1` | [Release](https://v2.tauri.app/release/@tauri-apps/api/v2.10.1/) |
| **Global Shortcut** | `tauri-plugin-global-shortcut` + `@tauri-apps/plugin-global-shortcut` | `^2.0.0` | [Docs](https://v2.tauri.app/plugin/global-shortcut/) |
| **Clipboard Manager** | `tauri-plugin-clipboard-manager` + `@tauri-apps/plugin-clipboard-manager` | `^2.0.0` | [Docs](https://v2.tauri.app/plugin/clipboard/) |
| **Shell** | `tauri-plugin-shell` + `@tauri-apps/plugin-shell` | `^2.0.0` | [Docs](https://v2.tauri.app/plugin/shell/) |
| **Dialog** | `tauri-plugin-dialog` + `@tauri-apps/plugin-dialog` | `^2.0.0` | [Docs](https://v2.tauri.app/plugin/dialog/) |
| **FS/Store** | `tauri-plugin-fs` + `@tauri-apps/plugin-fs` | `^2.0.0` | [Docs](https://v2.tauri.app/plugin/file-system/) |
| **Store** | `tauri-plugin-store` + `@tauri-apps/plugin-store` | `^2.0.0` | [Docs](https://v2.tauri.app/plugin/store/) |

**Cargo.toml setup:**
```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-global-shortcut = "2"
tauri-plugin-clipboard-manager = "2"
tauri-plugin-shell = "2"
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
tauri-plugin-store = "2"
```

**NPM packages:**
```json
{
  "dependencies": {
    "@tauri-apps/api": "^2.0.0",
    "@tauri-apps/plugin-global-shortcut": "^2.0.0",
    "@tauri-apps/plugin-clipboard-manager": "^2.0.0",
    "@tauri-apps/plugin-shell": "^2.0.0",
    "@tauri-apps/plugin-dialog": "^2.0.0",
    "@tauri-apps/plugin-fs": "^2.0.0",
    "@tauri-apps/plugin-store": "^2.0.0"
  }
}
```

---

## 2. System Tray, Multiple Windows, and Window Properties

### System Tray (Official Support)

**Documentation:** [System Tray | Tauri](https://v2.tauri.app/learn/system-tray/)

Tauri v2 has **first-class system tray support** via the `tray-icon` feature.

**Cargo.toml:**
```toml
tauri = { version = "2", features = ["tray-icon"] }
```

**Rust API (recommended):**
```rust
use tauri::tray::TrayIconBuilder;
use tauri::menu::{Menu, MenuItem};

let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
let menu = Menu::with_items(app, &[&quit_i])?;

let tray = TrayIconBuilder::new()
    .menu(&menu)
    .menu_on_left_click(true)
    .on_menu_event(|app, event| match event.id.as_ref() {
        "quit" => { app.exit(0); }
        _ => {}
    })
    .on_tray_icon_event(|tray, event| {
        // Handle click, double-click, enter, move, leave events
    })
    .build(app)?;
```

**JS API:**
```typescript
import { TrayIcon } from '@tauri-apps/api/tray';
import { Menu } from '@tauri-apps/api/menu';

const menu = await Menu.new({
    items: [{ id: 'quit', text: 'Quit', action: () => {} }]
});
const tray = await TrayIcon.new({ menu, menuOnLeftClick: true });
```

**Key tray events:** `click`, `double-click`, `enter`, `move`, `leave`

### Multiple Windows/WebviewWindow

**Documentation:** [Multiwebview support](https://v2.tauri.app/start/migrate/from-tauri-1/#multiwebview-support)

Tauri v2 introduces multiwebview support (behind `unstable` feature). The Rust `Window` type was renamed to `WebviewWindow`.

```rust
// Create additional windows
let webview_window = tauri::WebviewWindowBuilder::new(app, "label", tauri::WebviewUrl::default())
    .title("Window Title")
    .inner_size(800.0, 600.0)
    .build()?;
```

### Window Properties for Overlay/Floating Window

**Transparency:** Supported via `transparent` window option in tauri.conf.json or via Rust API.

From [Window Customization docs](https://v2.tauri.app/learn/window-customization/):

```rust
// macOS transparent titlebar example (requires cocoa crate)
use tauri::{TitleBarStyle, WebviewUrl, WebviewWindowBuilder};

let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
    .title("Transparent Window")
    .inner_size(800.0, 600.0)
    .title_bar_style(TitleBarStyle::Transparent)  // macOS only
    .build()?;
```

**Always-on-Top:** ✅ Supported via `set_always_on_top()` method.

From [Rust docs](https://docs.rs/tauri/2.0.0/tauri/window/struct.Window.html#method.set_always_on_top):
```rust
window.set_always_on_top(true)?;
```

**Visible on All Workspaces:** ✅ Supported via `set_visible_on_all_workspaces()` method.

```rust
window.set_visible_on_all_workspaces(true)?;
```

**Skip Taskbar:** ✅ Supported via `set_skip_taskbar()` method.

```rust
window.set_skip_taskbar(true)?;
```

**Non-focusable Window:** From the Rust docs, `set_focus()` can be called but the window may not be focusable depending on OS behavior. For truly non-focusable, you may need platform-specific code.

**Mouse Event Passthrough / Ignore Cursor Events:** ✅ Supported via `set_ignore_cursor_events()` method.

From [Rust docs](https://docs.rs/tauri/2.0.0/tauri/window/struct.Window.html#method.set_ignore_cursor_events):
```rust
window.set_ignore_cursor_events(true)?;  // Mouse events pass through to window below
```

**Full list of relevant Window methods from docs.rs:**
- `set_always_on_top()`
- `set_always_on_bottom()`
- `set_visible_on_all_workspaces()`
- `set_skip_taskbar()`
- `set_ignore_cursor_events()`
- `set_cursor_grab()` - for cursor capture
- `set_cursor_visible()` - for cursor visibility
- `set_focus()`

---

## 3. Capabilities/Permissions Model

**Documentation:** [Capabilities | Tauri](https://v2.tauri.app/security/capabilities/)

**Key Principle:** Tauri v2 uses a **deny-by-default** capabilities system. All permissions must be explicitly granted.

### Capability File Structure

**src-tauri/capabilities/default.json:**
```json
{
    "$schema": "../gen/schemas/desktop-schema.json",
    "identifier": "main-capability",
    "description": "Capability for the main window",
    "windows": ["main"],
    "permissions": [
        "core:default",
        "core:window:default",
        "core:window:allow-set-always-on-top",
        "core:window:allow-set-skip-taskbar",
        "core:window:allow-set-visible-on-all-workspaces",
        "core:window:allow-set-ignore-cursor-events",
        "global-shortcut:allow-register",
        "global-shortcut:allow-unregister",
        "clipboard-manager:allow-read-text",
        "clipboard-manager:allow-write-text",
        "shell:allow-open",
        "dialog:allow-open",
        "dialog:allow-save",
        "fs:allow-read-text-file",
        "fs:allow-resource-read-recursive"
    ]
}
```

### Required Permissions for Electron-Replacement Features

| Feature | Required Permission |
|---------|---------------------|
| Window always-on-top | `core:window:allow-set-always-on-top` |
| Window skip-taskbar | `core:window:allow-set-skip-taskbar` |
| Visible on all workspaces | `core:window:allow-set-visible-on-all-workspaces` |
| Ignore cursor events | `core:window:allow-set-ignore-cursor-events` |
| System tray | `core:tray:default` |
| Global shortcuts | `global-shortcut:allow-register` |
| Clipboard read/write | `clipboard-manager:allow-read-text`, `clipboard-manager:allow-write-text` |
| Open URLs | `shell:allow-open` |
| File dialogs | `dialog:allow-open`, `dialog:allow-save` |
| Read bundled config.json | `fs:allow-resource-read-recursive` |

### Plugin Permission Migration (from Tauri 1.0)

**Global Shortcut:**
```json
"permissions": ["global-shortcut:allow-register", "global-shortcut:allow-unregister"]
```

**Clipboard:**
```json
"permissions": ["clipboard-manager:allow-read-text", "clipboard-manager:allow-write-text"]
```

---

## 4. Resource Path Access for Bundled Files (config.json)

**Documentation:** [Embedding Additional Files | Tauri](https://v2.tauri.app/develop/resources/)

### Configuration (tauri.conf.json)

```json
{
    "bundle": {
        "resources": {
            "config.json": "config.json"
        }
    }
}
```

Or with glob patterns:
```json
{
    "bundle": {
        "resources": ["config.json", "*.json"]
    }
}
```

### Accessing Resources at Runtime

**Rust API:**
```rust
use tauri::{path::BaseDirectory, Manager};

app.path().resolve("config.json", BaseDirectory::Resource)?;

// In a command:
#[tauri::command]
fn read_config(handle: tauri::AppHandle) -> String {
    let path = handle.path().resolve("config.json", BaseDirectory::Resource)?;
    std::fs::read_to_string(&path).unwrap()
}
```

**JavaScript API:**
```typescript
import { resolveResource } from '@tauri-apps/api/path';
import { readTextFile } from '@tauri-apps/plugin-fs';

const resourcePath = await resolveResource('config.json');
const config = JSON.parse(await readTextFile(resourcePath));
```

### Required Permissions for Resource Access

```json
{
    "permissions": [
        "core:default",
        "fs:allow-read-text-file",
        "fs:allow-resource-read-recursive"
    ]
}
```

---

## 5. Microphone and macOS Accessibility Permissions

### Microphone Access

**Finding:** Tauri v2 does **NOT** have a built-in microphone plugin. This must be handled via:

1. **Web API in Renderer:** Use the standard Web Audio API / `navigator.mediaDevices.getUserMedia()` for microphone access. This works because Tauri uses the system WebView.

2. **Custom Rust Code:** For native microphone handling, you would need to write custom Rust code using crates like `cpal` or `rodio`.

**Recommendation for your Electron app:** The microphone capture is likely done in the renderer via Web Audio API (AudioWorklet). This should port directly to Tauri v2 since it uses the system WebView.

### macOS Accessibility Permissions

**Finding:** Tauri v2 does **NOT** have a built-in accessibility permissions plugin. For clipboard paste via `osascript` (like your current Electron app), you will need:

1. **Accessibility permission check:** This is handled at the macOS System Preferences level - users must grant permission in System Settings > Privacy & Security > Accessibility.

2. **Custom Rust code for osascript execution:** The `shell` plugin can execute `osascript`, but clipboard operations are better handled via the `clipboard-manager` plugin.

3. **No automatic permission prompting:** Unlike Electron, Tauri does not have an automatic permission dialog for accessibility. Users must manually grant permission.

**Relevant Plugin:** The `clipboard-manager` plugin handles clipboard read/write but does NOT handle the "Accessibility" TCC permission requirement for controlling other apps.

**Your current approach** (clipboard swap + AppleScript paste) will require:
- The user to grant Accessibility permission manually in System Settings
- Using `@tauri-apps/plugin-clipboard-manager` for clipboard operations
- Using `@tauri-apps/plugin-shell` to execute `osascript` if needed

---

## 6. Migration Warnings from Electron to Tauri

### Critical Warnings from Official Docs

**From [Upgrade from Tauri 1.0](https://v2.tauri.app/start/migrate/from-tauri-1/):**

1. **`system-tray` renamed to `tray-icon`**
   ```toml
   # Old (v1)
   tauri = { version = "1", features = ["system-tray"] }
   
   # New (v2)
   tauri = { version = "2", features = ["tray-icon"] }
   ```

2. **All `@tauri-apps/api/*` modules moved to plugins**
   ```typescript
   // Old v1 imports
   import { invoke } from "@tauri-apps/api/tauri";
   import { readTextFile } from "@tauri-apps/api/fs";
   
   // New v2 imports
   import { invoke } from "@tauri-apps/api/core";
   import { readTextFile } from "@tauri-apps/plugin-fs";
   ```

3. **`@tauri-apps/api/window` renamed to `@tauri-apps/api/webviewWindow`**

4. **JavaScript API package naming:**
   > The v1 plugins are now published as `@tauri-apps/plugin-<plugin-name>`. Previously they were available from git as `tauri-plugin-<plugin-name>-api`.

5. **Rust `api` module completely removed** - All APIs moved to plugins

6. **Permissions system changed from allowlist to capabilities**
   > The allowlist is dead, long live the allowlist - We made it exclusive for Tauri core features and it did not even cover all of Tauri APIs. Our new system not only covers all of Tauri's core API surface, it also supports app and plugin developers.

### Electron-Specific Considerations

| Electron Feature | Tauri v2 Equivalent | Notes |
|------------------|---------------------|-------|
| `BrowserWindow` | `WebviewWindowBuilder` | |
| `Tray` | `TrayIconBuilder` | Different API |
| `globalShortcut` | `tauri-plugin-global-shortcut` | Plugin |
| `clipboard` | `tauri-plugin-clipboard-manager` | Plugin |
| `shell.openExternal` | `tauri-plugin-shell` | Plugin |
| `dialog.showOpenDialog` | `tauri-plugin-dialog` | Plugin |
| `app.getPath('userData')` | `app.path().app_data_dir()` | Via `tauri::Manager` |
| `window.setAlwaysOnTop` | `window.set_always_on_top()` | |
| `window.setSkipTaskbar` | `window.set_skip_taskbar()` | |
| `window.setIgnoreCursorEvents` | `window.set_ignore_cursor_events()` | |

### Known Limitations for Floating Overlay Use Case

1. **macOS title bar transparency** requires `cocoa` crate dependency and platform-specific code:
   ```toml
   [target."cfg(target_os = \"macos\")".dependencies]
   cocoa = "0.26"
   ```

2. **No built-in microphone plugin** - Web Audio API must be used in renderer

3. **No automatic accessibility permission prompting** - Users must manually grant in System Settings

4. **Multi-window for macOS menu** - macOS menus are app-wide, not per-window

### Automated Migration

Tauri provides a migration command:
```bash
npm install @tauri-apps/cli@latest
npm run tauri migrate
```

**Note from docs:** This command is not a substitute for the full guide - manual review required.

---

## Summary: Key Findings for Electron Tray App Migration

| Requirement | Tauri v2 Support | Method |
|-------------|------------------|--------|
| System tray | ✅ Full support | `TrayIconBuilder` + `tray-icon` feature |
| Floating overlay window | ✅ Full support | `WebviewWindow` with `set_always_on_top()`, `set_ignore_cursor_events()` |
| Transparency | ✅ Supported | `TitleBarStyle::Transparent` (macOS) + CSS |
| Always on top | ✅ Full support | `window.set_always_on_top(true)` |
| Skip taskbar | ✅ Full support | `window.set_skip_taskbar(true)` |
| Visible on all workspaces | ✅ Full support | `window.set_visible_on_all_workspaces(true)` |
| Non-focusable | ⚠️ Partial | Platform-dependent behavior |
| Mouse passthrough | ✅ Full support | `window.set_ignore_cursor_events(true)` |
| Global shortcuts | ✅ Full support | `tauri-plugin-global-shortcut` |
| Clipboard manager | ✅ Full support | `tauri-plugin-clipboard-manager` |
| Shell/dialog/fs | ✅ Full support | Official plugins |
| Bundled config.json | ✅ Full support | `bundle.resources` + `resolveResource()` |
| Microphone access | ⚠️ Web API only | Use `navigator.mediaDevices.getUserMedia()` in renderer |
| Accessibility permissions | ⚠️ Manual | No auto-prompt; users grant in System Settings |

---

## References

- [Tauri v2 Documentation](https://v2.tauri.app/)
- [System Tray Guide](https://v2.tauri.app/learn/system-tray/)
- [Window Customization](https://v2.tauri.app/learn/window-customization/)
- [Capabilities & Permissions](https://v2.tauri.app/security/capabilities/)
- [Embedding Resources](https://v2.tauri.app/develop/resources/)
- [Upgrade from Tauri 1.0](https://v2.tauri.app/start/migrate/from-tauri-1/)
- [Global Shortcut Plugin](https://v2.tauri.app/plugin/global-shortcut/)
- [Clipboard Plugin](https://v2.tauri.app/plugin/clipboard/)
- [Rust Window API](https://docs.rs/tauri/2.0.0/tauri/window/struct.Window.html)
