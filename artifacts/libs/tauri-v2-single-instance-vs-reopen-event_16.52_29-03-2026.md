# macOS Dock/Finder Reopen vs. Second Instance Launch in Tauri v2

## Concise Answer

**`tauri-plugin-single-instance` does NOT handle Dock/Finder reopen events.** It only prevents multiple process instances via Unix socket and forwards command-line arguments from a second process to the first.

**`tauri::RunEvent::Reopen`** is the separate, dedicated handler for macOS Dock icon clicks when the app is already running. These are two distinct macOS activation pathways:

| Event | Trigger | Handler |
|-------|---------|---------|
| `tauri-plugin-single-instance` callback | Second process launch (terminal, Finder double-click of `.app`) | Prevent second instance, forward args |
| `tauri::RunEvent::Reopen` | Dock icon click while app running | Show/restore main window |

---

## Authoritative Sources

### 1. `tauri-plugin-single-instance` macOS implementation

**Source**: [plugins-workspace/v2/plugins/single-instance/src/platform_impl/macos.rs](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/single-instance/src/platform_impl/macos.rs)

```rust
pub fn init<R: Runtime>(cb: Box<SingleInstanceCallback<R>>) -> TauriPlugin<R> {
    plugin::Builder::new("single-instance")
        .setup(|app, _api| {
            let socket = socket_path(app.config(), app.package_info());
            // Unix socket at /tmp/{identifier}_si.sock
            match notify_singleton(&socket) {
                Ok(_) => {
                    std::process::exit(0);  // second instance exits immediately
                }
                Err(e) => {
                    match e.kind() {
                        ErrorKind::NotFound | ErrorKind::ConnectionRefused => {
                            // This process claims itself as singleton
                            socket_cleanup(&socket);
                            listen_for_other_instances(&socket, app.clone(), cb);
                        }
                        _ => { }
                    }
                }
            }
            Ok(())
        })
        // ...
}
```

**Key mechanism**: Unix domain socket (`/tmp/{bundle_id}_si.sock`). When a second process tries to connect, the singleton receives args+cwd and the second process exits with code 0. This has **no knowledge of Dock icon clicks**.

### 2. `tauri::RunEvent::Reopen` usage in production apps

**Source**: [loft-sh/devpod/main/desktop/src-tauri/src/main.rs](https://github.com/loft-sh/devpod/blob/main/desktop/src-tauri/src/main.rs)

```rust
let mut app_builder = tauri::Builder::default();
// this case is handled by macos itself + tauri::RunEvent::Reopen
#[cfg(not(target_os = "macos"))]
{
    app_builder = app_builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        // ...
    }));
}
// ...
app.run(move |app_handle, event| {
    #[cfg(target_os = "macos")]
    {
        if let tauri::RunEvent::Reopen { has_visible_windows, .. } = event {
            // Show dashboard on Dock icon click
            tauri::async_runtime::block_on(async move {
                if let Err(err) = reopen_tx.send(UiMessage::ShowDashboard).await {
                    error!("...");
                };
            });
            return;
        }
    }
    // ...
});
```

**Key comment**: `"this case is handled by macos itself + tauri::RunEvent::Reopen"` — explicitly acknowledging these are separate concerns.

### 3. Multiple production examples of `RunEvent::Reopen`

**Source**: [tw93/Pake/src-tauri/src/lib.rs](https://github.com/tw93/Pake/blob/main/src-tauri/src/lib.rs)

```rust
.run(|_app, _event| {
    #[cfg(target_os = "macos")]
    if let tauri::RunEvent::Reopen { has_visible_windows, .. } = _event {
        if !has_visible_windows {
            // reopen hidden window
        }
    }
});
```

**Source**: [clash-verge-rev/clash-verge-rev/src-tauri/src/lib.rs](https://github.com/clash-verge-rev/clash-verge-rev/blob/dev/src-tauri/src/lib.rs)

```rust
#[cfg(target_os = "macos")]
tauri::RunEvent::Reopen { has_visible_windows, .. } => {
    // handle dock icon click
}
```

---

## Exact Implications for `/Users/dta.teks/dev/stt/src/src/lib.rs`

### Current Implementation (lines 569-616)

```rust
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(main_window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                let _ = show_main_window_with_runtime_invariants(&main_window);
            }
        }))
        .plugin(tauri_nspanel::init())
        // ...
        .run(tauri::generate_context!())
        // NO RunEvent::Reopen handler
}
```

### What's Missing

**There is no `RunEvent::Reopen` handler.** The current setup only handles the case where a **second process tries to launch** (which the single-instance plugin kills with `std::process::exit(0)`).

If a user:
1. Launches the app normally
2. Hides all windows (e.g., Cmd+H)
3. Clicks the Dock icon

**What happens**: macOS will activate the app and show the hidden main window *by default*. However, if the main window was closed (not just hidden), or if custom restore behavior is needed (e.g., unminimize + show + focus sequence), this is **not handled**.

### Why This Matters for This Repo

Looking at `show_main_window_with_runtime_invariants`:

```rust
pub fn show_main_window_with_runtime_invariants(main_window: &WebviewWindow) -> tauri::Result<()> {
    run_main_window_show_sequence(
        || main_window.unminimize(),
        || main_window.show(),
        || main_window.set_focus(),
    )
}
```

This sequence (unminimize → show → focus) is **only triggered** when `tauri_plugin_single_instance` detects a second instance. It is **NOT triggered** on Dock icon click unless `RunEvent::Reopen` is explicitly handled.

### What Should Be Added

A `RunEvent::Reopen` handler in the `.run()` closure:

```rust
.run(tauri::generate_context!())
// Should become something like:
.run(|app, event| {
    #[cfg(target_os = "macos")]
    if let tauri::RunEvent::Reopen { has_visible_windows, .. } = event {
        if !has_visible_windows {
            if let Some(main_window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                let _ = show_main_window_with_runtime_invariants(&main_window);
            }
        }
    }
    // ... existing exit handling
})
```

---

## Summary

| Concern | Handled by `tauri-plugin-single-instance`? | Handled by `RunEvent::Reopen`? |
|---------|-------------------------------------------|-------------------------------|
| Second process launch (terminal, Finder double-click) | ✅ Yes — kills 2nd instance, forwards args | ❌ No |
| Dock icon click while app running | ❌ No | ❌ No — **current code is missing this** |
| App already open, all windows hidden | N/A (no second instance) | ⚠️ macOS default behavior may handle, but custom restore sequence not applied |

**The repo's `lib.rs` has the single-instance plugin correctly positioned first, but lacks a `RunEvent::Reopen` handler for macOS Dock icon restore scenarios.**
