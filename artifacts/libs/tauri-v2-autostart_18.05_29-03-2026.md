# Tauri v2 Autostart Plugin — Research Summary

**Date**: 18.05_29-03-2026  
**Topic**: macOS login-item/start-at-login for Tauri v2

---

## Recommended Approach

Use the official **`tauri-plugin-autostart`** plugin.

- **Rust crate**: [`tauri-plugin-autostart`](https://crates.io/crates/tauri-plugin-autostart) — current latest **2.5.1** (2025-10-27)
- **JS package**: [`@tauri-apps/plugin-autostart`](https://www.npmjs.com/package/@tauri-apps/plugin-autostart)
- **Repository**: [tauri-apps/plugins-workspace / v2 / autostart](https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/autostart)
- **Docs**: [v2.tauri.app/plugin/autostart](https://v2.tauri.app/plugin/autostart)

---

## Exact Setup Steps

### 1. Rust — Add Cargo dependency

```toml
# src-tauri/Cargo.toml
[dependencies]
tauri-plugin-autostart = "2.5"
```

Or via CLI:
```bash
cargo add tauri-plugin-autostart --target 'cfg(any(target_os = "macos", windows, target_os = "linux"))'
```

### 2. Rust — Initialize in lib.rs (setup phase)

```rust
// src-tauri/src/lib.rs
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri_plugin_autostart::MacosLauncher;
                use tauri_plugin_autostart::ManagerExt;

                app.handle().plugin(tauri_plugin_autostart::init(
                    MacosLauncher::LaunchAgent,   // macOS default
                    Some(vec!["--flag1", "--flag2"]),
                ));

                // Get the autostart manager and enable it
                let autostart_manager = app.autolaunch();
                let _ = autostart_manager.enable();
                // Or check state first:
                // if !autostart_manager.is_enabled().unwrap() {
                //     let _ = autostart_manager.enable();
                // }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### 3. JS — Install bindings (optional if using Rust-only)

```bash
npm install @tauri-apps/plugin-autostart
```

---

## Enabling Autostart Entirely from Rust (No Frontend)

**YES — fully possible.** As shown above, the plugin is initialized and `enable()` is called in the Rust `setup()` closure. No frontend invoke needed.

The `ManagerExt` trait provides `app.autolaunch()` which returns `State<'_, AutoLaunchManager>`, and `AutoLaunchManager` has synchronous `enable()`, `disable()`, and `is_enabled()` methods.

Rust-side API ([source](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/autostart/src/lib.rs)):
```rust
pub trait ManagerExt<R: Runtime> {
    fn autolaunch(&self) -> State<'_, AutoLaunchManager>;
}

impl AutoLaunchManager {
    pub fn enable(&self) -> Result<()>;
    pub fn disable(&self) -> Result<()>;
    pub fn is_enabled(&self) -> Result<bool>;
}
```

---

## Capability / Permission Requirements

**Yes, capability permissions are required** for the frontend to call the plugin commands. The default permission set is:

```json
// src-tauri/capabilities/default.json (or relevant window capability)
{
  "permissions": [
    "autostart:allow-enable",
    "autostart:allow-disable",
    "autostart:allow-is-enabled"
  ]
}
```

Source: [default.toml permissions](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/autostart/permissions/default.toml)

**If using only Rust-side** (no `invoke` from frontend), no capability is needed because Tauri commands invoked from Rust itself bypass the capability system.

---

## macOS-Specific Caveats

### 1. Two macOS Backends: `LaunchAgent` vs `AppleScript`

```rust
pub enum MacosLauncher {
    #[default]
    LaunchAgent,
    AppleScript,
}
```

- **`LaunchAgent`** (default): Uses `launchd` via the `auto-launch` crate. Registers a `.plist` in `~/Library/LaunchAgents/`.
- **`AppleScript`**: Uses AppleScript `login item` API. Requires Accessibility permission (for `tell application "System Events"`).

Recommendation: **Use `LaunchAgent`** (the default). It does not require Accessibility permission and is more reliable.

### 2. `.app` Bundle Path Requirement

From the [source code](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/autostart/src/lib.rs#L130-L145):

```rust
// on macOS, current_exe gives path to /Applications/Example.app/MacOS/Example
// but this results in seeing a Unix Executable in macOS login items
// It must be: /Applications/Example.app
// If it didn't find exactly a single occurance of .app, it will default to
// exe path to not break it.
let exe_path = current_exe.canonicalize()?.display().to_string();
let parts: Vec<&str> = exe_path.split(".app/").collect();
let app_path = if parts.len() == 2
    && matches!(self.macos_launcher, MacosLauncher::AppleScript)
{
    format!("{}.app", parts.first().unwrap())
} else {
    exe_path
};
builder.set_app_path(&app_path);
```

The plugin auto-corrects the path for `LaunchAgent` mode. For `AppleScript` mode, the path **must** be the `.app` bundle path, not the binary inside.

### 3. No Admin Password Required

`LaunchAgent` approach registers a user-level agent — **no admin/sudo password needed**. It appears in **System Settings → General → Login Items** (macOS 13+).

### 4. Rust Version Requirement

> *"This plugin requires a Rust version of at least **1.77.2**"*

### 5. Not Available on Mobile

The plugin is **desktop-only** (macOS, Windows, Linux). Android and iOS are excluded at build time:

```rust
#![cfg(not(any(target_os = "android", target_os = "ios")))]
```

---

## Quick-Reference Snippet (Rust-only, no JS)

```rust
// Minimum Rust-only autostart enable at startup
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_autostart::ManagerExt;

app.handle().plugin(tauri_plugin_autostart::init(
    MacosLauncher::LaunchAgent,
    None,  // no extra args
));

let manager = app.autolaunch();
let _ = manager.enable();
```

---

## Source Links

| Item | Link |
|------|------|
| Official docs (v2.tauri.app) | https://v2.tauri.app/plugin/autostart |
| Crates.io (Rust) | https://crates.io/crates/tauri-plugin-autostart |
| npm (JS) | https://www.npmjs.com/package/@tauri-apps/plugin-autostart |
| Source (GitHub) | https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/autostart |
| Permissions TOML | https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/autostart/permissions/default.toml |
| Rust lib.rs source | https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/autostart/src/lib.rs |
| Docs.rs (API) | https://docs.rs/tauri-plugin-autostart/latest/tauri_plugin_autostart/ |
