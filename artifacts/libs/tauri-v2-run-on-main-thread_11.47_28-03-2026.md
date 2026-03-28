# Tauri v2 `run_on_main_thread` API

## Method Signature

**Location**: [crates/tauri/src/app.rs#L462-L466](https://github.com/tauri-apps/tauri/blob/e5b00795c226c4d44f7b47257eb8982bd73b1025/crates/tauri/src/app.rs#L462-L466)

```rust
/// Runs the given closure on the main thread.
pub fn run_on_main_thread<F: FnOnce() + Send + 'static>(&self, f: F) -> crate::Result<()> {
  self
    .runtime_handle
    .run_on_main_thread(f)
    .map_err(Into::into)
}
```

**Available on**:
- `AppHandle<R>` (all runtimes)
- `Window<R>` (dispatcher proxy) — [crates/tauri/src/window/mod.rs#L1160-L1165](https://github.com/tauri-apps/tauri/blob/e5b00795c226c4d44f7b47257eb8982bd73b1025/crates/tauri/src/window/mod.rs#L1160-L1165)
- `WebviewWindow<R>` — [crates/tauri/src/webview/webview_window.rs#L1480-L1483](https://github.com/tauri-apps/tauri/blob/e5b00795c226c4d44f7b47257eb8982bd73b1025/crates/tauri/src/webview/webview_window.rs#L1480-L1483)
- `Webview<R>` — [crates/tauri/src/webview/mod.rs#L1347-L1351](https://github.com/tauri-apps/tauri/blob/e5b00795c226c4d44f7b47257eb8982bd73b1025/crates/tauri/src/webview/mod.rs#L1347-L1351)

**Generic parameter constraints**:
- `F: FnOnce() + Send + 'static` — closure must be shareable across threads and have static lifetime

**Return type**: `crate::Result<()>` — returns `Ok(())` on success, maps runtime errors via `Into::into`

---

## Real-World Usage: macOS NSWindow Mutation from Command Handler

**Claim**: Use `app.run_on_main_thread()` to mutate `NSWindow` from a Tauri command handler running on a background thread.

**Evidence** ([screenpipe/screenpipe](https://github.com/screenpipe/screenpipe/blob/73b1025/apps/screenpipe-app-tauri/src-tauri/src/window/util.rs#L27-L43)):

```rust
#[cfg(target_os = "macos")]
pub fn run_on_main_thread_safe<F: FnOnce() + Send + 'static>(app: &AppHandle, f: F) {
    let _ = app.run_on_main_thread(move || {
        if let Err(e) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
            error!("panic caught in run_on_main_thread: {:?}", e);
        }
    });
}
```

**Explanation**: This wrapper adds panic safety — Rust panics crossing the Obj-C FFI boundary (`tao::send_event`) are `nounwind` and would `abort()` without `catch_unwind`.

**Example: NSWindow mutation in a command handler** ([CapSoftware/Cap](https://github.com/CapSoftware/Cap/blob/main/apps/desktop/src-tauri/src/windows.rs#L138-L153)):

```rust
#[cfg(target_os = "macos"))]
{
    let (panel_close_tx, panel_close_rx) = tokio::sync::oneshot::channel();
    let app_for_close = app.clone();
    app.run_on_main_thread(move || {
        use tauri_nspanel::ManagerExt;
        let label = CapWindowId::Camera.label();
        if let Ok(panel) = app_for_close.get_webview_panel(&label) {
            panel.released_when_closed(false);
            panel.close();
        }
    });
    let _ = tokio::time::timeout(std::time::Duration::from_millis(500), panel_close_rx).await;
}
```

**Example: Direct NSWindow with objc2** ([fastrepl/char](https://github.com/fastrepl/char/blob/main/plugins/icon/src/ext.rs#L144-L166)):

```rust
let app_handle = self.manager.app_handle();
app_handle
    .run_on_main_thread(move || {
        use objc2::AnyThread;
        use objc2_app_kit::{NSApplication, NSImage};
        use objc2_foundation::{MainThreadMarker, NSString};

        let mtm = MainThreadMarker::new().expect("run_on_main_thread guarantees main thread");
        let ns_app = NSApplication::sharedApplication(mtm);

        let path_str = NSString::from_str(&icon_path_str);
        let Some(image) = NSImage::initWithContentsOfFile(NSImage::alloc(), &path_str)
        else { /* ... */ };
        // mutate NSWindow here
    })
```

---

## Thread Safety Notes

| Concern | Detail |
|---------|--------|
| **Main thread guarantee** | `run_on_main_thread` dispatches to the main thread event loop via `send_user_message(&self.context, Message::Task(Box::new(f)))` in wry runtime ([tauri-runtime-wry/src/lib.rs#L1566](https://github.com/tauri-apps/tauri/blob/e5b00795c226c4d44f7b47257eb8982bd73b1025/crates/tauri-runtime-wry/src/lib.rs#L1566)) |
| **Sync vs async** | `run_on_main_thread` is sync — it queues the closure and returns immediately; use `MainThreadMarker::new()` inside the closure to confirm main thread execution |
| **Panic boundary** | Closures run across the Obj-C FFI in `tao::send_event` which is `nounwind` — wrap in `catch_unwind` to prevent process abort on ObjC exceptions |
| **AppHandle clone** | Clone `AppHandle` before moving into the closure: `let app_clone = app.clone();` then `app_clone.run_on_main_thread(move || { ... })` |

---

## Tauri Version

The `dev` branch of tauri-apps/tauri at commit `e5b00795c226c4d44f7b47257eb8982bd73b1025` corresponds to the Tauri v2 codebase. The `run_on_main_thread` API has been stable since v2.x.
