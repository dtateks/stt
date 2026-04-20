## Findings: tauri-nspanel / AppKit NSPanel visibility after `hide()` / `orderOut:`

### Direct Answer
- Fact: Upstream `tauri-nspanel` does **not** maintain an independent visibility flag. Its `Panel::hide()` sends AppKit `orderOut:` directly to the backing `NSPanel`, and its `Panel::is_visible()` immediately asks that same `NSPanel` for `isVisible`. On the inspected `tauri-nspanel` v2.1 code, `panel.is_visible()` is therefore just AppKit `isVisible`, not a separate Tauri/plugin state machine. [1][2]
- Trace: On the Tauri side used by `/Users/dta.teks/dev/stt`, `WebviewWindow.is_visible()` routes through `tauri-runtime-wry` to Tao’s macOS window implementation, and Tao also answers by calling `ns_window.isVisible()`. So the upstream code path does **not** show a built-in discrepancy between `panel.is_visible()` and Tauri window visibility after `orderOut:`; both currently read the same AppKit `isVisible` property from the same native window object. [3][4][5]
- Fact: `isVisible` is still only an AppKit window-visibility bit. The inspected upstream code shows **no** occlusion-aware check in tauri-nspanel, Tauri runtime-wry, Tao, or Wry’s macOS WKWebView path, and Wry does not read `occlusionState` or window-occlusion notifications in the code located here. That means `is_visible()` can still differ from WebKit/page-level “actually visible to the user” notions such as occlusion, hidden-behind-other-windows, or page throttling heuristics. [1][3][4][6]
- Synthesis: For `stt`, the supported upstream conclusion is: after `panel.hide()` / `orderOut:`, `panel.is_visible()` should track AppKit `NSPanel.isVisible`, and Tauri `WebviewWindow.is_visible()` currently uses the same AppKit source; but neither API is evidence of WebKit/WebPage visual exposure or occlusion. Treat AppKit `isVisible` and WebKit/page visibility as different layers. [1][2][3][4][6]

### Key Findings
#### 1) tauri-nspanel visibility is a direct NSPanel proxy

**Claim**: `tauri-nspanel` implements both hide and visibility by delegating straight to AppKit on the backing `NSPanel`. [1][2]

**Evidence** ([src/panel.rs#L341-L345](https://github.com/ahkohd/tauri-nspanel/blob/a3122e894383aa068ec5365a42994e3ac94ba1b6/src/panel.rs#L341-L345) [1], [src/panel.rs#L521-L525](https://github.com/ahkohd/tauri-nspanel/blob/a3122e894383aa068ec5365a42994e3ac94ba1b6/src/panel.rs#L521-L525) [2]):
```rust
fn is_visible(&self) -> bool {
    unsafe {
        $crate::objc2::msg_send![&*self.panel, isVisible]
    }
}
```

```rust
fn hide(&self) {
    unsafe {
        let _: () = $crate::objc2::msg_send![&*self.panel, orderOut: $crate::objc2::ffi::nil];
    }
}
```

**Explanation**: The plugin does not wrap `hide()` with extra bookkeeping and does not compute visibility itself. `hide()` is Cocoa `orderOut:`; `is_visible()` is Cocoa `isVisible`. So any post-hide answer comes directly from AppKit’s `NSPanel` state.

- Version scope: tauri-nspanel `v2.1` / SHA `a3122e894383aa068ec5365a42994e3ac94ba1b6`. [1][2]

#### 2) Tauri window visibility on macOS currently reads the same AppKit property

**Claim**: Tauri `WebviewWindow.is_visible()` does not introduce a second visibility model on macOS; it routes to Tao, and Tao answers with `ns_window.isVisible()`. [3][4][5]

**Evidence** ([crates/tauri-runtime-wry/src/lib.rs#L2030-L2034](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-runtime-wry/src/lib.rs#L2030-L2034) [3], [crates/tauri-runtime-wry/src/lib.rs#L3396-L3402](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-runtime-wry/src/lib.rs#L3396-L3402) [4], [src/platform_impl/macos/window.rs#L1071-L1074](https://github.com/tauri-apps/tao/blob/dev/src/platform_impl/macos/window.rs#L1071-L1074) [5]):
```rust
fn is_visible(&self) -> Result<bool> {
  window_getter!(self, WindowMessage::IsVisible)
}
```

```rust
WindowMessage::IsVisible(tx) => tx.send(window.is_visible()).unwrap(),
```

```rust
#[inline]
pub fn is_visible(&self) -> bool {
  unsafe { self.ns_window.isVisible() }
}
```

**Explanation**: Tauri runtime-wry forwards the getter request as `WindowMessage::IsVisible`, and Tao’s macOS window implementation resolves that by directly asking the native `NSWindow`/`NSPanel` for `isVisible()`. Because tauri-nspanel also calls `isVisible()` on the panel, the inspected upstream path does not show a plugin-vs-Tauri mismatch for this specific getter.

- Trace: Tao’s setter uses the same AppKit pair in reverse: `set_visible(false)` calls `order_out_sync(&self.ns_window)`, so the read/write path is aligned around AppKit visibility, not a cached Rust-side flag. [7]
- Caveat: This is evidence for current upstream code paths, not a formal API guarantee from tauri-nspanel docs that the two wrappers must always stay identical across future releases. [1][3][5]

#### 3) AppKit visibility is not the same thing as WebKit/page occlusion

**Claim**: None of the inspected upstream layers use macOS occlusion state or a WebKit page-visibility/occlusion signal when answering `is_visible()`. [1][3][4][6]

**Evidence** ([src/panel.rs#L341-L345](https://github.com/ahkohd/tauri-nspanel/blob/a3122e894383aa068ec5365a42994e3ac94ba1b6/src/panel.rs#L341-L345) [1], [src/platform_impl/macos/window.rs#L1071-L1074](https://github.com/tauri-apps/tao/blob/dev/src/platform_impl/macos/window.rs#L1071-L1074) [5], [src/wkwebview/mod.rs#L720-L770](https://github.com/tauri-apps/wry/blob/44e26ef27428f3b9f8d00f62a6ffda887ea8a982/src/wkwebview/mod.rs#L720-L770) [6]):
```rust
fn is_visible(&self) -> bool {
    unsafe {
        $crate::objc2::msg_send![&*self.panel, isVisible]
    }
}
```

```rust
#[inline]
pub fn is_visible(&self) -> bool {
  unsafe { self.ns_window.isVisible() }
}
```

```rust
pub fn eval(&self, js: &str, callback: Option<impl Fn(String) + Send + 'static>) -> Result<()> {
  if let Some(scripts) = &mut *self.pending_scripts.lock().unwrap() {
    scripts.push(js.into());
  } else {
    unsafe {
      self
        .webview
        .evaluateJavaScript_completionHandler(&NSString::from_str(js), handler.as_deref());
    }
  }

  Ok(())
}
```

**Explanation**: The visibility getters only consult AppKit `isVisible`. Separately, Wry’s active macOS WKWebView path just evaluates JavaScript in the webview once it is ready; the inspected code does not consult `occlusionState`, hidden-window notifications, or any WebKit page-visibility bridge before doing so. So upstream supports a distinction between “native window is considered visible by AppKit” and “web content is actually exposed/unoccluded/rendering as the user sees it.”

- Fact: Searches against current `tauri-apps/wry` and `tauri-apps/tao` sources found no macOS `occlusionState` handling in the relevant window/webview paths inspected for this question. [8][9]
- Practical implication: a panel can be AppKit-visible yet visually covered, on another Space, or otherwise not effectively viewable; `is_visible()` does not answer those WebKit/page-exposure questions. [1][5][6]

#### 4) Evidence relevant to `stt`

**Claim**: The current `stt` concern should be framed as “AppKit visibility vs effective web-content visibility,” not “tauri-nspanel visibility vs Tauri visibility.” [1][2][3][4][5][6]

**Evidence** ([src/panel.rs#L521-L525](https://github.com/ahkohd/tauri-nspanel/blob/a3122e894383aa068ec5365a42994e3ac94ba1b6/src/panel.rs#L521-L525) [2], [src/platform_impl/macos/window.rs#L663-L668](https://github.com/tauri-apps/tao/blob/dev/src/platform_impl/macos/window.rs#L663-L668) [7], [src/platform_impl/macos/window.rs#L1071-L1074](https://github.com/tauri-apps/tao/blob/dev/src/platform_impl/macos/window.rs#L1071-L1074) [5]):
```rust
fn hide(&self) {
    unsafe {
        let _: () = $crate::objc2::msg_send![&*self.panel, orderOut: $crate::objc2::ffi::nil];
    }
}
```

```rust
pub fn set_visible(&self, visible: bool) {
  match visible {
    true => unsafe { util::make_key_and_order_front_sync(&self.ns_window) },
    false => unsafe { util::order_out_sync(&self.ns_window) },
  }
}
```

```rust
#[inline]
pub fn is_visible(&self) -> bool {
  unsafe { self.ns_window.isVisible() }
}
```

**Explanation**: Both the plugin path and the Tao/Tauri path center on AppKit `orderOut` / `isVisible`. That makes them good checks for whether the native panel was ordered out, but not good proxies for whether WKWebView considers the page visible, occluded, throttled, or display-active. For `stt`, if the bug is “hidden HUD still receives JS/events/timers” or “web content behaves as if visible/invisible differently from native panel state,” the right split is native ordering state versus webview lifecycle, not panel wrapper versus Tauri wrapper.

### Execution Trace
| Step | Symbol / Artifact | What happens here | Source IDs |
|------|-------------------|-------------------|------------|
| 1 | `Panel::hide` | tauri-nspanel orders the `NSPanel` out via AppKit `orderOut:` | [2] |
| 2 | `Panel::is_visible` | tauri-nspanel reads `NSPanel.isVisible` directly | [1] |
| 3 | `WebviewWindow.is_visible` | Tauri runtime-wry forwards the request as `WindowMessage::IsVisible` | [3][4] |
| 4 | `tao::window::is_visible` | Tao answers by reading `ns_window.isVisible()` | [5] |
| 5 | `wry::InnerWebView::eval` | WebKit JS execution path proceeds independently of any occlusion-aware visibility check in the inspected code | [6] |

### Caveats and Gaps
- Apple’s docs pages for `isVisible`, `orderOut(_:)`, and `occlusionState` are JS-rendered, and no verbatim text was retrievable here via static fetch; this artifact therefore anchors the answer in upstream code paths rather than quoting Apple contract text directly.
- The evidence supports “no located upstream occlusion-aware path” rather than a universal proof that WebKit never tracks occlusion internally. It only shows that tauri-nspanel/Tauri/Tao/Wry do not surface such a check in the inspected visibility APIs.
- No upstream issue/PR was located in this pass documenting a known bug where `panel.is_visible()` remains true after `orderOut:`. The supported conclusion is narrower: current code paths make that unlikely as a plugin-vs-Tauri divergence, but `isVisible` still may not match page-level exposure semantics.

### Source Register
| ID | Kind | Source | Version / Ref | Why kept | URL |
|----|------|--------|---------------|----------|-----|
| [1] | code | tauri-nspanel `Panel::is_visible` | `a3122e894383aa068ec5365a42994e3ac94ba1b6#L341-L345` | Direct implementation of plugin visibility getter | https://github.com/ahkohd/tauri-nspanel/blob/a3122e894383aa068ec5365a42994e3ac94ba1b6/src/panel.rs#L341-L345 |
| [2] | code | tauri-nspanel `Panel::hide` | `a3122e894383aa068ec5365a42994e3ac94ba1b6#L521-L525` | Direct implementation of plugin hide via `orderOut:` | https://github.com/ahkohd/tauri-nspanel/blob/a3122e894383aa068ec5365a42994e3ac94ba1b6/src/panel.rs#L521-L525 |
| [3] | code | Tauri runtime-wry `is_visible` dispatch | `dev#L2030-L2034` | Shows Tauri getter routing | https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-runtime-wry/src/lib.rs#L2030-L2034 |
| [4] | code | Tauri runtime-wry `WindowMessage::IsVisible` handling | `dev#L3396-L3402` | Shows native window getter used to answer visibility | https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-runtime-wry/src/lib.rs#L3396-L3402 |
| [5] | code | Tao macOS `is_visible` | `dev#L1071-L1074` | Decisive native visibility implementation on macOS | https://github.com/tauri-apps/tao/blob/dev/src/platform_impl/macos/window.rs#L1071-L1074 |
| [6] | code | Wry macOS WKWebView eval path | `44e26ef27428f3b9f8d00f62a6ffda887ea8a982#L720-L770` | Shows webview JS execution path is not visibility-gated here | https://github.com/tauri-apps/wry/blob/44e26ef27428f3b9f8d00f62a6ffda887ea8a982/src/wkwebview/mod.rs#L720-L770 |
| [7] | code | Tao macOS `set_visible` | `dev#L663-L668` | Shows Tao hide path also uses AppKit order-out | https://github.com/tauri-apps/tao/blob/dev/src/platform_impl/macos/window.rs#L663-L668 |
| [8] | code | GitHub code search: Wry `occlusionState` | 2026-04-20 search | Negative evidence that relevant Wry path did not expose occlusion handling | https://github.com/search?q=repo%3Atauri-apps%2Fwry+occlusionState&type=code |
| [9] | code | GitHub code search: Tao macOS `Occlusion` | 2026-04-20 search | Negative evidence that relevant Tao macOS path did not expose occlusion handling | https://github.com/search?q=repo%3Atauri-apps%2Ftao+path%3Asrc%2Fplatform_impl%2Fmacos+Occlusion&type=code |

### Evidence Appendix
**Supporting trace** ([src/platform_impl/macos/window.rs#L663-L668](https://github.com/tauri-apps/tao/blob/dev/src/platform_impl/macos/window.rs#L663-L668) [7]):
```rust
pub fn set_visible(&self, visible: bool) {
  match visible {
    true => unsafe { util::make_key_and_order_front_sync(&self.ns_window) },
    false => unsafe { util::order_out_sync(&self.ns_window) },
  }
}
```
