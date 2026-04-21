## Findings: Tauri macOS NSPanel + global hotkey long-uptime invisibility bug

### Direct Answer
#### 1) When can an `NSPanel` stop responding to `orderFrontRegardless` / `orderFront:` for the rest of the process?
- Fact: Apple’s documented contract for `orderFrontRegardless()` is narrow: it only “moves the window to the front of its level, even if its application isn’t active,” and Apple says it should be used rarely for cooperating-app scenarios. The retrieved Apple docs do **not** say it revives a detached WindowServer connection, reconstructs a discarded backing store, or repairs a broken Space/window registration. [Apple `orderFrontRegardless()` docs](https://developer.apple.com/documentation/appkit/nswindow/orderfrontregardless()) [1]
- Fact: Apple’s `NSApplication.ActivationPolicy.accessory` docs say an accessory (`LSUIElement`) app “doesn’t appear in the Dock and doesn’t have a menu bar, but it may be activated programmatically or by clicking on one of its windows.” That is the official contract located here; no Apple doc found in this pass says accessory apps are suspended after N idle minutes or lose their WindowServer connection purely because they are accessory agents. [Apple `ActivationPolicy.accessory` docs](https://developer.apple.com/documentation/appkit/nsapplication/activationpolicy-swift.enum/accessory?language=objc) [2]
- History: There is in-the-wild upstream evidence that macOS can leave panel/window ordering wrong or unstable across fullscreen/Space transitions when using `CanJoinAllSpaces | FullScreenAuxiliary | Stationary`. In `ahkohd/tauri-nspanel` issue #76, users reported that “after using the app for a while it doesn't work properly, restart the app and it works again,” and later narrowed it to fullscreen window exit/rearrangement; the maintainer called it “a macOS bug,” and one reproducer reported that replacing `CanJoinAllSpaces` with `MoveToActiveSpace` resolved that specific case. [tauri-nspanel issue #76 comments](https://github.com/ahkohd/tauri-nspanel/issues/76) [3]
- History: Apple Developer Forums also contain an older but directly relevant report from a pre-login agent where the process “thinks it's displaying the window on top (using `orderFrontRegardless`)” but the window does not appear in `CGWindowListCopyWindowInfo` until the code waits for WindowServer per-session services again. That is not the same lifecycle as your user-session accessory app, but it is primary evidence that `orderFrontRegardless` alone is **not** sufficient when WindowServer/session registration state is bad. [Apple Forums thread 739438](https://developer.apple.com/forums/thread/739438) [4]
- Synthesis: Supported upstream evidence points to **Space/fullscreen/window-server registration state** as a real class of failure where `orderFrontRegardless` can become effectively a no-op even though the process and event loop are still alive; I found **no primary evidence** that this exact signature is caused by a documented permanent AppKit “coalesced update starvation,” RunningBoard idle timer for LSUIElement apps, or a known official “rest of process lifetime” `NSPanel` bug. [1][2][3][4]

#### 2) Is there evidence for `isVisible == false` + `orderFrontRegardless` no-op after lost WindowServer connection / suspension, and what is the official recovery?
- Fact: I found **no Apple or upstream Tauri/AppKit primary source** that documents a pattern where `NSWindow.isVisible == false` specifically means “the window lost its WindowServer connection because RunningBoard suspended the process,” nor any Apple-documented recovery such as reconnecting `_NSWindowAuxOpaque` or reviving an existing `NSWindow` handle in place. [2][4]
- History: The closest primary evidence is Apple’s pre-login agent thread: when the WindowServer per-session services were not ready, `orderFrontRegardless` looked successful from the app’s perspective but the window did not show until the app waited for the WindowServer registration edge. Apple’s old sample comment quoted there says waiting for WindowServer registration used to be necessary, then became necessary again for that edge case. [Apple Forums thread 739438](https://developer.apple.com/forums/thread/739438) [4]
- History: In the Tauri ecosystem, the only clearly documented recovery path I found for post-sleep macOS webview breakage is **web-content recovery**, not native-window recovery: in Tauri issue #10662, Screenpipe reports that after wake “WKWebView's content process gets killed by the OS and the window renders as a black rectangle,” and their workaround is to observe wake and reload webviews; upstream replied that a `webViewWebContentProcessDidTerminate` hook was coming. That addresses dead web content, not an `NSPanel` that refuses to order in. [tauri issue #10662 comments](https://github.com/tauri-apps/tauri/issues/10662) [5]
- Synthesis: For the exact native-window symptom you described, the strongest upstream-supported runtime recovery is **recreate/re-register the panel/window** rather than expecting `orderFrontRegardless` to repair a bad native registration state, but this is supported mostly by negative evidence (no in-place repair API found) plus the fact that restart reconstructs the native objects. I found **no official Apple doc** prescribing an in-process reconnect sequence for an existing detached `NSPanel`. [1][3][4][5]

#### 3) Is there documented RunningBoard / CoreSuspend behavior suspending accessory apps and breaking future `NSWindow` calls?
- Fact: I found **no Apple documentation, Apple forum post, Tauri issue, Tao/Wry issue, or tauri-nspanel issue** in this pass that says modern macOS suspends `ActivationPolicy::Accessory` / `LSUIElement` apps after N minutes of no activation and thereby makes future `NSWindow` / `NSPanel` calls silently no-op. Explicit no-evidence finding. [2]
- Fact: The only RunningBoard-adjacent primary source found here is an Apple Forums post about WKWebView video playback logging RunningBoard assertion entitlement errors; it does not describe suspending accessory apps or severing WindowServer connections for idle background agents. [Apple Forums thread 747253](https://developer.apple.com/forums/thread/747253) [6]
- Synthesis: “RunningBoard suspends accessory agents and silently detaches their windows after idle” remains a hypothesis, not a supported conclusion from the sources gathered here. **No evidence found.** [2][6]

#### 4) Are Carbon hotkey events guaranteed on main thread after long uptime / sleep-wake?
- Fact: `tauri-plugin-global-shortcut` explicitly marshals `global-hotkey` registration/unregistration onto Tauri’s main thread with `run_on_main_thread`. [plugins/global-shortcut/src/lib.rs#L75-L85](https://github.com/tauri-apps/plugins-workspace/blob/c1fd33b3a2735f2e25c1d026dc524af932db3315/plugins/global-shortcut/src/lib.rs#L75-L85) [7]
- Fact: `global-hotkey`’s macOS implementation installs a Carbon event handler on `GetApplicationEventTarget()` and registers ordinary shortcuts with `RegisterEventHotKey(..., GetApplicationEventTarget(), ...)`; its docs require that “an event loop must be running on the main thread” and that the manager be created on the main thread. [src/platform_impl/macos/mod.rs#L43-L80](https://github.com/tauri-apps/global-hotkey/blob/a7058be984c7d5dfa1efa711b7531d97b250926a/src/platform_impl/macos/mod.rs#L43-L80) [src/platform_impl/macos/mod.rs#L98-L139](https://github.com/tauri-apps/global-hotkey/blob/a7058be984c7d5dfa1efa711b7531d97b250926a/src/platform_impl/macos/mod.rs#L98-L139) [`global-hotkey` docs.rs](https://docs.rs/global-hotkey/latest/global_hotkey/) [8][9][10]
- Fact: I found **no upstream issue or doc** proving that Carbon hotkey callbacks may start arriving on a different thread after long uptime or sleep/wake. Also, your observed “toggle fired” means the Carbon path is still delivering events, which argues against a dead hotkey handler as the primary failure. Explicit no-evidence finding for a thread-hop bug. [7][8][9][10]
- Synthesis: Upstream evidence supports “shortcut delivery is still alive” more strongly than “Carbon delivered on the wrong thread and AppKit no-op’d because of that.” **No evidence found** for a known long-uptime thread-detach bug in `global-hotkey` 0.7.0’s Carbon path. [7][8][9][10]

#### 5) `tauri-nspanel` v2.1 known issues where `Panel::show()` / `orderFrontRegardless` stops working?
- Fact: `tauri-nspanel` v2.1 maps `Panel::show()` directly to Cocoa `orderFrontRegardless`, `hide()` to `orderOut:`, and exposes separate helpers for `makeKeyAndOrderFront:` and `show_and_make_key()`. [src/panel.rs#L241-L250](https://github.com/ahkohd/tauri-nspanel/blob/a3122e894383aa068ec5365a42994e3ac94ba1b6/src/panel.rs#L241-L250) [src/panel.rs#L397-L415](https://github.com/ahkohd/tauri-nspanel/blob/a3122e894383aa068ec5365a42994e3ac94ba1b6/src/panel.rs#L397-L415) [11][12]
- History: I found no tauri-nspanel issue matching “after 8–12h, `show()` still called but panel never appears, restart fixes it.” I did find #76, where macOS fullscreen/Space transitions made shared NSPanel windows unstable after time/use, with restart helping and `MoveToActiveSpace` reported as the workaround in that reproducer. [tauri-nspanel issue #76](https://github.com/ahkohd/tauri-nspanel/issues/76) [3]
- History: I found no tauri-nspanel issue specifically tying this to WebKit occlusion logs or sleep/wake. Explicit no-evidence finding. [3]
- Synthesis: The community-known `tauri-nspanel` workaround closest to your signature is **changing Space behavior (`CanJoinAllSpaces` → `MoveToActiveSpace`)** for a macOS rearrangement bug, not a documented fix for a dead `orderFrontRegardless` path after long idle. [3][11][12]

#### 6) `tauri-plugin-global-shortcut` / `global-hotkey` long-uptime or sleep-wake bugs where handler fires but UI work must be re-scheduled?
- Fact: I found **no upstream issue** in `tauri-apps/plugins-workspace` or `tauri-apps/global-hotkey` documenting a macOS long-uptime bug where the hotkey callback still fires but UI work must be manually re-scheduled via `run_on_main_thread` because nested Tauri dispatch detached. Explicit no-evidence finding. [7][8][9]
- Fact: Tao itself documents that `makeKeyAndOrderFront:` is not thread-safe and routes it onto the main thread; its `set_focus` path additionally calls `activateIgnoringOtherApps:YES`. That is evidence for the general AppKit main-thread rule, but not for a specific plugin detachment bug. [src/platform_impl/macos/util/async.rs#L210-L237](https://github.com/tauri-apps/tao/blob/3ecc2a833fc9746acfd2dc3bbf9200bc036cc2fd/src/platform_impl/macos/util/async.rs#L210-L237) [13]
- Synthesis: If the shortcut handler log already fires and your code already runs on the main thread, upstream evidence does **not** support blaming a known Tauri global-shortcut nested-dispatch bug. **No evidence found.** [7][13]

#### 7) Difference between `panel.show()` / `orderFrontRegardless`, `makeKeyAndOrderFront:`, and activation?
- Fact: `tauri-nspanel` exposes all three layers separately: `show()` → `orderFrontRegardless`; `make_key_and_order_front()` → `makeKeyAndOrderFront:`; `show_and_make_key()` does `makeFirstResponder` + `orderFrontRegardless` + `makeKeyWindow`. [src/panel.rs#L241-L250](https://github.com/ahkohd/tauri-nspanel/blob/a3122e894383aa068ec5365a42994e3ac94ba1b6/src/panel.rs#L241-L250) [src/panel.rs#L397-L415](https://github.com/ahkohd/tauri-nspanel/blob/a3122e894383aa068ec5365a42994e3ac94ba1b6/src/panel.rs#L397-L415) [11][12]
- Fact: Apple’s `orderFrontRegardless()` doc says it moves the window to the front of its level even if the app is not active, **without changing either the key window or the main window**. [Apple `orderFrontRegardless()` docs](https://developer.apple.com/documentation/appkit/nswindow/orderfrontregardless()) [1]
- Fact: Tao’s focus helper uses a stronger sequence than plain ordering: `makeKeyAndOrderFront(None)` followed by `activateIgnoringOtherApps:YES`. [src/platform_impl/macos/util/async.rs#L230-L237](https://github.com/tauri-apps/tao/blob/3ecc2a833fc9746acfd2dc3bbf9200bc036cc2fd/src/platform_impl/macos/util/async.rs#L230-L237) [13]
- Synthesis: Upstream evidence supports a real semantic ladder: `orderFrontRegardless` only orders; `makeKeyAndOrderFront:` also makes the window key; `activateIgnoringOtherApps:` explicitly activates the app. What I did **not** find is evidence that any of these officially repair a detached WindowServer registration on an existing panel. [1][11][12][13]

#### 8) When CGWindow says `kCGWindowIsOnscreen=false` and `isVisible=false`, what re-attaches it?
- Fact: I found **no Apple/Tauri/AppKit primary source** specifying that `setFrame:display:` before `orderFrontRegardless` re-attaches such a window, nor any official API contract that “re-registers” a CGWindow ID for an existing `NSWindow`. Explicit no-evidence finding. [1][4]
- History: The strongest related evidence remains Apple’s WindowServer-registration thread and tauri-nspanel #76’s fullscreen/Space rearrangement issue; both suggest that once the native registration/Space state is bad, plain `orderFrontRegardless` may be insufficient. [3][4]
- Synthesis: Among runtime operations mentioned in upstream code/issues, the evidence is strongest for either a **stronger fronting path** (`makeKeyAndOrderFront:` and app activation) or **recreation of the panel/window**; I found **no evidence** for a documented in-place CGWindow reattach call. [11][12][13]

#### 9) Sonoma/Sequoia background-app-suspension or Carbon/NSPanel regressions?
- History: There is confirmed Apple-side Sequoia behavior change for `RegisterEventHotKey`: Apple staff said on the forums that Sequoia intentionally blocks hotkeys using only Shift/Option modifiers, and there is “no workaround” for that modifier class. Your `Control+Alt+V` shortcut does **not** match that restricted shape. [Apple Forums thread 763878](https://developer.apple.com/forums/thread/763878) [14]
- History: Tauri issue #10662 documents macOS post-sleep UI breakage and a user-reported workaround based on wake notification + webview reload; upstream linked PR #14523 for a `webViewWebContentProcessDidTerminate` hook. [tauri issue #10662](https://github.com/tauri-apps/tauri/issues/10662) [5] [tauri PR #14523](https://github.com/tauri-apps/tauri/pull/14523) [15]
- Fact: Wry now has the native `webViewWebContentProcessDidTerminate:` hook and forwards it to an optional handler, but that covers dead WKWebView content processes, not an `NSPanel` failing to order in. [src/wkwebview/class/wry_navigation_delegate.rs#L101-L118](https://github.com/tauri-apps/wry/blob/44e26ef27428f3b9f8d00f62a6ffda887ea8a982/src/wkwebview/class/wry_navigation_delegate.rs#L101-L118) [src/wkwebview/navigation.rs#L107-L115](https://github.com/tauri-apps/wry/blob/44e26ef27428f3b9f8d00f62a6ffda887ea8a982/src/wkwebview/navigation.rs#L107-L115) [16][17]
- Fact: I found **no 2024–2026 Tauri/Tao/Wry/tauri-nspanel issue** that specifically matches your full signature: Carbon hotkey keeps firing, `NSPanel.isVisible()==false`, CGWindow exists at level 1001 with `kCGWindowIsOnscreen=false`, and `orderFrontRegardless` becomes a durable no-op until process restart. Explicit no-evidence finding. [3][5]

### Key Findings
#### Upstream code path: the hotkey path is still alive

**Claim**: `tauri-plugin-global-shortcut` already executes registration on the main thread, and `global-hotkey` uses Carbon application-target hotkeys for ordinary combinations like `Control+Alt+V`. [7][8][9][10]

**Evidence** ([plugins/global-shortcut/src/lib.rs#L75-L85](https://github.com/tauri-apps/plugins-workspace/blob/c1fd33b3a2735f2e25c1d026dc524af932db3315/plugins/global-shortcut/src/lib.rs#L75-L85) [7]):
```rust
macro_rules! run_main_thread {
    ($handle:expr, $manager:expr, |$m:ident| $ex:expr) => {{
        let (tx, rx) = std::sync::mpsc::channel();
        let manager = $manager.clone();
        let task = move || {
            let f = |$m: &GlobalHotKeyManager| $ex;
            let _ = tx.send(f(&*manager));
        };
        $handle.run_on_main_thread(task)?;
        rx.recv()?
    }};
}
```

**Evidence** ([src/platform_impl/macos/mod.rs#L55-L65](https://github.com/tauri-apps/global-hotkey/blob/a7058be984c7d5dfa1efa711b7531d97b250926a/src/platform_impl/macos/mod.rs#L55-L65) [8], [src/platform_impl/macos/mod.rs#L114-L123](https://github.com/tauri-apps/global-hotkey/blob/a7058be984c7d5dfa1efa711b7531d97b250926a/src/platform_impl/macos/mod.rs#L114-L123) [9]):
```rust
let result = InstallEventHandler(
    GetApplicationEventTarget(),
    Some(hotkey_handler),
    2,
    event_types.as_ptr(),
    std::ptr::null_mut(),
    &mut handler_ref,
);
```

```rust
let result = RegisterEventHotKey(
    scan_code,
    mods,
    hotkey_id,
    GetApplicationEventTarget(),
    0,
    &mut hotkey_ref,
);
```

**Evidence** ([`global-hotkey` docs.rs](https://docs.rs/global-hotkey/latest/global_hotkey/) [10]):
```text
On macOS, an event loop must be running on the main thread so you also need to create the global hotkey manager on the main thread.
```

**Explanation**: The upstream plugin/backend pair already follows the documented macOS threading contract. Because your logs show the handler still firing, the best-supported reading is that the Carbon shortcut path is still healthy while the panel/window ordering path is what failed.

#### Upstream code path: `Panel::show()` is only `orderFrontRegardless`

**Claim**: `tauri-nspanel`’s default `show()` does not activate the app or make the panel key; it only calls `orderFrontRegardless`. [11][12]

**Evidence** ([src/panel.rs#L241-L250](https://github.com/ahkohd/tauri-nspanel/blob/a3122e894383aa068ec5365a42994e3ac94ba1b6/src/panel.rs#L241-L250) [11]):
```rust
impl<R: tauri::Runtime> $crate::Panel<R> for $class_name<R> {
    fn show(&self) {
        unsafe {
            let _: () = $crate::objc2::msg_send![&*self.panel, orderFrontRegardless];
        }
    }

    fn hide(&self) {
        unsafe {
            let _: () = $crate::objc2::msg_send![&*self.panel, orderOut: $crate::objc2::ffi::nil];
        }
    }
```

**Evidence** ([src/panel.rs#L397-L415](https://github.com/ahkohd/tauri-nspanel/blob/a3122e894383aa068ec5365a42994e3ac94ba1b6/src/panel.rs#L397-L415) [12]):
```rust
fn make_key_and_order_front(&self) {
    unsafe {
        let _: () = $crate::objc2::msg_send![&*self.panel, makeKeyAndOrderFront: $crate::objc2::ffi::nil];
    }
}

fn order_front_regardless(&self) {
    unsafe {
        let _: () = $crate::objc2::msg_send![&*self.panel, orderFrontRegardless];
    }
}

fn show_and_make_key(&self) {
    unsafe {
        let content_view: $crate::objc2::rc::Retained<$crate::objc2_app_kit::NSView> =
            $crate::objc2::msg_send![&*self.panel, contentView];
        let _: bool = $crate::objc2::msg_send![&*self.panel, makeFirstResponder: &*content_view];
        let _: () = $crate::objc2::msg_send![&*self.panel, orderFrontRegardless];
        let _: () = $crate::objc2::msg_send![&*self.panel, makeKeyWindow];
    }
}
```

**Explanation**: Upstream explicitly treats “order to front,” “make key,” and “make responder/key” as distinct operations. That matters because Apple’s `orderFrontRegardless` contract is also narrower than full activation/focus.

#### Apple/Tao semantics: stronger fronting includes app activation

**Claim**: Tao’s stronger focus path uses `makeKeyAndOrderFront` plus `activateIgnoringOtherApps`, which is semantically stronger than tauri-nspanel’s `show()`. [13]

**Evidence** ([src/platform_impl/macos/util/async.rs#L210-L237](https://github.com/tauri-apps/tao/blob/3ecc2a833fc9746acfd2dc3bbf9200bc036cc2fd/src/platform_impl/macos/util/async.rs#L210-L237) [13]):
```rust
// `makeKeyAndOrderFront:` isn't thread-safe. Calling it from another thread
// actually works, but with an odd delay.
pub unsafe fn make_key_and_order_front_sync(ns_window: &NSWindow) {
  let ns_window = MainThreadSafe(ns_window.retain());
  run_on_main(move || {
    ns_window.makeKeyAndOrderFront(None);
  });
}

pub unsafe fn set_focus(ns_window: &NSWindow) {
  let ns_window = MainThreadSafe(ns_window.retain());
  run_on_main(move || {
    ns_window.makeKeyAndOrderFront(None);
    let app: id = msg_send![class!(NSApplication), sharedApplication];
    let () = msg_send![app, activateIgnoringOtherApps: YES];
  });
}
```

**Explanation**: Upstream Tao draws a distinction between ordering the window and fully focusing/activating it. That is evidence for question 7, not proof that activation fixes your bug.

#### In-the-wild macOS issue: Spaces/fullscreen state can strand NSPanel behavior

**Claim**: `tauri-nspanel` users have reported macOS-native instability for panels configured with `CanJoinAllSpaces | Stationary | FullScreenAuxiliary`, especially around fullscreen transitions, with restart helping and `MoveToActiveSpace` reported as a workaround in at least one reproducer. [3]

**Evidence** ([tauri-nspanel issue #76](https://github.com/ahkohd/tauri-nspanel/issues/76) [3]):
```text
After using the app for a while it doesn't work properly, restart the app and it works again!
```

```text
At present, it can be confirmed that the problem occurs when the full-screen window exits the maximized state.
```

```text
Resolved, by changing `NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces` to `NSWindowCollectionBehavior::NSWindowCollectionBehaviorMoveToActiveSpace`
```

```text
Alright, I see the issue, it's a macOS bug. I'll see if I can find a workaround.
```

**Explanation**: This is the closest upstream field report to your symptom cluster because it involves the same panel class and the same collection-behavior family. It is not a perfect match: the reproducer there centers on fullscreen exit/rearrangement, not multi-hour idle with wake cycles.

#### Post-sleep WKWebView death is real, but it is a different layer

**Claim**: Tauri/Wry have upstream evidence for post-sleep **web-content-process** failure, but that evidence does not explain a native panel remaining off-screen with `isVisible == false`. [5][15][16][17]

**Evidence** ([tauri issue #10662 comments](https://github.com/tauri-apps/tauri/issues/10662) [5]):
```text
We're experiencing this in our Tauri v2 app (screenpipe) on macOS — after sleep/wake, WKWebView's content process gets killed by the OS and the window renders as a black rectangle.

Our workaround: poll `NSWorkspaceDidWakeNotification` ... then after a 3s delay ... reload all webview windows via `window.eval("window.location.reload()")`.
```

**Evidence** ([src/wkwebview/class/wry_navigation_delegate.rs#L101-L118](https://github.com/tauri-apps/wry/blob/44e26ef27428f3b9f8d00f62a6ffda887ea8a982/src/wkwebview/class/wry_navigation_delegate.rs#L101-L118) [16], [src/wkwebview/navigation.rs#L107-L115](https://github.com/tauri-apps/wry/blob/44e26ef27428f3b9f8d00f62a6ffda887ea8a982/src/wkwebview/navigation.rs#L107-L115) [17]):
```rust
#[unsafe(method(webViewWebContentProcessDidTerminate:))]
fn web_content_process_did_terminate(&self, webview: &WKWebView) {
  web_content_process_did_terminate(self, webview);
}
```

```rust
pub(crate) fn web_content_process_did_terminate(
  this: &WryNavigationDelegate,
  _webview: &WKWebView,
) {
  if let Some(on_web_content_process_terminate) =
    &this.ivars().on_web_content_process_terminate_handler
  {
    on_web_content_process_terminate();
  }
}
```

**Explanation**: This supports a real macOS post-sleep failure mode in Tauri apps, but it is the WKWebView content process, not the NSWindow/NSPanel ordering state. Your `CGWindowListCopyWindowInfo` evidence places the problem one layer lower, in native window presence/onscreen state.

#### Apple-side evidence: WindowServer registration state can defeat `orderFrontRegardless`

**Claim**: Apple primary sources support the narrower claim that when WindowServer/session registration is not in the expected state, a process can believe it ordered a window front while the window still does not appear. [4]

**Evidence** ([Apple Forums thread 739438](https://developer.apple.com/forums/thread/739438) [4]):
```text
the process is working correctly and it thinks it's displaying the window on top (using orderFrontRegardless), but in fact it is not. If we call CGWindowListCopyWindowInfo:(CGWindowListOptionAll, kCGNullWindowId), the relevant window does not show up at all
```

```text
This routine waits for the window server to register its per-session services in our session.
```

```text
It turns out that it is necessary to wait for the window server again.
```

**Explanation**: This is not your exact user-session/accessory-app scenario, but it is direct Apple-platform evidence against the assumption that `orderFrontRegardless` alone guarantees visible ordering whenever the process is alive.

### Execution Trace
| Step | Symbol / Artifact | What happens here | Source IDs |
|------|-------------------|-------------------|------------|
| 1 | `tauri-plugin-global-shortcut::run_main_thread!` | Registers/unregisters the hotkey manager on Tauri’s main thread | [7] |
| 2 | `global_hotkey::GlobalHotKeyManager::new` | Installs Carbon `InstallEventHandler` on `GetApplicationEventTarget()` | [8] |
| 3 | `global_hotkey::register` | Ordinary shortcuts call `RegisterEventHotKey(..., GetApplicationEventTarget(), ...)` | [9] |
| 4 | `hotkey_handler` | Carbon dispatches pressed/released events into `GlobalHotKeyEvent::send(...)` | [18] |
| 5 | App hotkey handler | Your app logs `toggle fired`, proving the shortcut/event path is still alive | user symptom |
| 6 | `tauri_nspanel::Panel::show` | `show()` only sends `orderFrontRegardless` | [11] |
| 7 | Native panel state | In the broken process, `isVisible == false` and CGWindow reports layer 1001 but `kCGWindowIsOnscreen=false` | user symptom |
| 8 | Result | Best-supported failure layer is native panel/Space/window-server state, not Carbon event delivery | [1][3][4][11] |

### Change Context
- History: Apple DTS continues to describe `RegisterEventHotKey` as valid background-hotkey machinery, though not the preferred modern API versus `CGEventTap`. [Apple Forums thread 735223](https://developer.apple.com/forums/thread/735223) [19]
- History: Apple staff documented a Sequoia change where `RegisterEventHotKey` registrations using only Shift/Option modifiers intentionally no longer trigger. That is unrelated to `Control+Alt+V`, but it proves Apple is still changing Carbon hotkey behavior in current macOS releases. [14]
- History: Since 2024, the Tauri ecosystem has recorded a distinct macOS sleep/wake regression class around WKWebView content-process death, leading to PR #14523 and Wry termination hooks. [5][15][16][17]

### Ranked shortlist: most likely root causes
1. **macOS Space/fullscreen/window-ordering bug involving `CanJoinAllSpaces | FullScreenAuxiliary | Stationary` on an NSPanel** — **confidence: medium-high**. Supported by tauri-nspanel issue #76 reproducing prolonged instability/restart-fixes-it behavior in the same configuration family and the maintainer calling it a macOS bug. Gaps: not the same exact 8–12h uptime signature. [3][11][12]
2. **Native window-server/session registration state became stale while the process remained alive** — **confidence: medium**. Supported by Apple’s own forum evidence that `orderFrontRegardless` can appear to succeed while the window is not actually present because WindowServer/session registration is not ready/right. Gaps: Apple evidence is from a pre-login agent, not a regular Aqua-session LSUIElement app. [4]
3. **WKWebView content-process/occlusion churn is a secondary symptom, not the primary root cause** — **confidence: low-medium as primary, medium as co-factor**. Supported by real Tauri sleep/wake WKWebView failures and your WebKit occlusion spam, but contradicted by CGWindow evidence showing the native window itself is off-screen/not ordered in. [5][16][17]

### Ranked shortlist: most credible runtime fixes mentioned by upstream evidence
1. **Recreate the panel/window object** — **confidence: medium**. Evidence: restart reliably fixes it; no in-place Apple repair API found; tauri-nspanel issues and WindowServer-registration evidence both point to native state getting wedged beyond plain `orderFrontRegardless`. This is the strongest evidence-backed recovery class, but still indirect. [3][4][11][12]
2. **Use a stronger fronting path than plain `orderFrontRegardless` (`makeKeyAndOrderFront:` and possibly app activation)** — **confidence: low-medium**. Evidence: Apple/Tao semantics clearly distinguish ordering from keying/activation; Tao uses a stronger path for focus. But no source found proving this revives a wedged panel after long uptime. [1][12][13]
3. **Change Space behavior away from `CanJoinAllSpaces` in this panel class (for example `MoveToActiveSpace`)** — **confidence: low-medium for your exact bug, medium for fullscreen/Space-related variants**. Evidence: direct tauri-nspanel issue #76 workaround. Gap: only proven for that issue’s fullscreen-exit rearrangement reproduction. [3]

### Caveats and Gaps
- No evidence found that RunningBoard/CoreSuspend officially suspends `ActivationPolicy::Accessory` apps after idle and breaks future `NSPanel` calls.
- No evidence found that Carbon hotkey callbacks in `global-hotkey` 0.7.0 migrate to a non-main thread after long uptime or sleep/wake.
- No evidence found for an official Apple “reattach this existing `NSWindow` to WindowServer” API or sequence.
- Apple docs pages for many AppKit symbols are JS-rendered; the exa-discovered highlights were used where webfetch could not retrieve full prose.
- Your specific signature includes CGWindow on layer 1001 with `kCGWindowIsOnscreen=false`; I found no Apple source directly explaining that exact combination for accessory NSPanels.

### Source Register
| ID | Kind | Source | Version / Ref | Why kept | URL |
|----|------|--------|---------------|----------|-----|
| [1] | docs | Apple `NSWindow.orderFrontRegardless()` | current docs page | Official contract for plain order-front semantics | https://developer.apple.com/documentation/appkit/nswindow/orderfrontregardless() |
| [2] | docs | Apple `NSApplication.ActivationPolicy.accessory` | current docs page | Official contract for accessory/LSUIElement activation policy | https://developer.apple.com/documentation/appkit/nsapplication/activationpolicy-swift.enum/accessory?language=objc |
| [3] | issue | `ahkohd/tauri-nspanel` issue #76 | 2025-03 to 2025-08 | Closest in-the-wild NSPanel fullscreen/Spaces instability report with workaround | https://github.com/ahkohd/tauri-nspanel/issues/76 |
| [4] | docs | Apple Developer Forums thread 739438 | 2023 thread, surfaced in 2025 search | Primary Apple-platform evidence that `orderFrontRegardless` can appear to succeed while window never becomes present due to WindowServer/session state | https://developer.apple.com/forums/thread/739438 |
| [5] | issue | `tauri-apps/tauri` issue #10662 | 2024-08 onward | Primary Tauri sleep/wake WKWebView failure report and workaround | https://github.com/tauri-apps/tauri/issues/10662 |
| [6] | docs | Apple Developer Forums thread 747253 | 2024 | RunningBoard-related WKWebView entitlement/errors evidence; negative relevance for accessory-app suspension claim | https://developer.apple.com/forums/thread/747253 |
| [7] | code | `tauri-plugin-global-shortcut` main-thread macro | `c1fd33b3a2735f2e25c1d026dc524af932db3315#L75-L85` | Shows plugin marshals macOS hotkey work onto the main thread | https://github.com/tauri-apps/plugins-workspace/blob/c1fd33b3a2735f2e25c1d026dc524af932db3315/plugins/global-shortcut/src/lib.rs#L75-L85 |
| [8] | code | `global-hotkey` macOS handler install | `a7058be984c7d5dfa1efa711b7531d97b250926a#L43-L80` | Shows Carbon handler installation on application target | https://github.com/tauri-apps/global-hotkey/blob/a7058be984c7d5dfa1efa711b7531d97b250926a/src/platform_impl/macos/mod.rs#L43-L80 |
| [9] | code | `global-hotkey` macOS hotkey registration | `a7058be984c7d5dfa1efa711b7531d97b250926a#L98-L139` | Shows ordinary shortcuts use `RegisterEventHotKey` on application target | https://github.com/tauri-apps/global-hotkey/blob/a7058be984c7d5dfa1efa711b7531d97b250926a/src/platform_impl/macos/mod.rs#L98-L139 |
| [10] | docs | `global-hotkey` docs.rs | crate 0.7.x current docs | States main-thread/event-loop contract on macOS | https://docs.rs/global-hotkey/latest/global_hotkey/ |
| [11] | code | `tauri-nspanel` `Panel::show` / `hide` | `a3122e894383aa068ec5365a42994e3ac94ba1b6#L241-L250` | Decisive implementation showing `show()` is plain `orderFrontRegardless` | https://github.com/ahkohd/tauri-nspanel/blob/a3122e894383aa068ec5365a42994e3ac94ba1b6/src/panel.rs#L241-L250 |
| [12] | code | `tauri-nspanel` `make_key_and_order_front` / `show_and_make_key` | `a3122e894383aa068ec5365a42994e3ac94ba1b6#L397-L415` | Shows stronger native operations exposed separately from `show()` | https://github.com/ahkohd/tauri-nspanel/blob/a3122e894383aa068ec5365a42994e3ac94ba1b6/src/panel.rs#L397-L415 |
| [13] | code | Tao macOS focus helpers | `3ecc2a833fc9746acfd2dc3bbf9200bc036cc2fd#L210-L237` | Shows stronger focus path uses `makeKeyAndOrderFront` plus activation | https://github.com/tauri-apps/tao/blob/3ecc2a833fc9746acfd2dc3bbf9200bc036cc2fd/src/platform_impl/macos/util/async.rs#L210-L237 |
| [14] | docs | Apple Developer Forums thread 763878 | 2024 Sequoia | Official Apple explanation of Sequoia `RegisterEventHotKey` modifier restriction | https://developer.apple.com/forums/thread/763878 |
| [15] | pr | `tauri-apps/tauri` PR #14523 | 2025 | Upstream change adding web-content-process-terminated handling path | https://github.com/tauri-apps/tauri/pull/14523 |
| [16] | code | Wry navigation delegate termination hook | `44e26ef27428f3b9f8d00f62a6ffda887ea8a982#L101-L118` | Shows WKWebView termination callback is implemented upstream | https://github.com/tauri-apps/wry/blob/44e26ef27428f3b9f8d00f62a6ffda887ea8a982/src/wkwebview/class/wry_navigation_delegate.rs#L101-L118 |
| [17] | code | Wry termination handler dispatch | `44e26ef27428f3b9f8d00f62a6ffda887ea8a982#L107-L115` | Shows termination callback just notifies app code | https://github.com/tauri-apps/wry/blob/44e26ef27428f3b9f8d00f62a6ffda887ea8a982/src/wkwebview/navigation.rs#L107-L115 |
| [18] | code | `global-hotkey` Carbon callback | `a7058be984c7d5dfa1efa711b7531d97b250926a#L303-L337` | Shows Carbon callback still just dispatches hotkey events | https://github.com/tauri-apps/global-hotkey/blob/a7058be984c7d5dfa1efa711b7531d97b250926a/src/platform_impl/macos/mod.rs#L303-L337 |
| [19] | docs | Apple Developer Forums thread 735223 | 2023 | Apple DTS comparison of `RegisterEventHotKey` and `CGEventTap` | https://developer.apple.com/forums/thread/735223 |

### Evidence Appendix
**Carbon callback path** ([src/platform_impl/macos/mod.rs#L303-L337](https://github.com/tauri-apps/global-hotkey/blob/a7058be984c7d5dfa1efa711b7531d97b250926a/src/platform_impl/macos/mod.rs#L303-L337) [18]):
```rust
unsafe extern "C" fn hotkey_handler(
    _next_handler: EventHandlerCallRef,
    event: EventRef,
    _user_data: *mut c_void,
) -> OSStatus {
    let mut event_hotkey: EventHotKeyID = std::mem::zeroed();

    let result = GetEventParameter(
        event,
        kEventParamDirectObject,
        typeEventHotKeyID,
        std::ptr::null_mut(),
        std::mem::size_of::<EventHotKeyID>() as _,
        std::ptr::null_mut(),
        &mut event_hotkey as *mut _ as *mut _,
    );

    if result == noErr as _ {
        let event_kind = GetEventKind(event);
        match event_kind {
            kEventHotKeyPressed => GlobalHotKeyEvent::send(GlobalHotKeyEvent {
                id: event_hotkey.id,
                state: crate::HotKeyState::Pressed,
            }),
            kEventHotKeyReleased => GlobalHotKeyEvent::send(GlobalHotKeyEvent {
                id: event_hotkey.id,
                state: crate::HotKeyState::Released,
            }),
            _ => {}
        };
    }

    noErr as _
}
```
