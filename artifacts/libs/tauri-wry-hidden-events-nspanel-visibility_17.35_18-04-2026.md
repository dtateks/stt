## Findings: Tauri / Wry / tauri-nspanel hidden-event delivery and NSPanel visibility

### Direct Answer
- Fact: On current Tauri `dev` (`b536dce356c7e071e4688609fc1da68642870ceb`) and Wry `master` (`44e26ef27428f3b9f8d00f62a6ffda887ea8a982`), Rust-side Tauri event delivery to a webview goes through JS evaluation on the target webview; Tauri builds an inline event-dispatch script, then `tauri-runtime-wry` forwards it as `WebviewMessage::EvaluateScript`, and Wry’s macOS WKWebView backend executes it with `evaluateJavaScript:completionHandler:` once the page is past initial navigation. That means a hidden macOS webview/window still uses JS evaluation for event delivery; visibility is not checked in this path. [1][2][3][4]
- Trace: Wry buffers `eval()` calls in `pending_scripts` until `did_commit_navigation`, then flushes them with `evaluateJavaScript_completionHandler`; so the main delivery caveat is page-load readiness, not window visibility. If Rust emits before the page has committed, the event script is queued; if the web content process later dies, no hidden-window special retry path exists beyond the normal termination hook. [3][5]
- Fact: There is no evidence in current `tauri-nspanel` v2.1 (`a3122e894383aa068ec5365a42994e3ac94ba1b6`) that `WebviewWindow.is_visible()` is synchronized to `NSPanel.hide()` state. The plugin exposes its own `Panel::is_visible()` by calling Cocoa `isVisible` on the `NSPanel`, while `panel.hide()` is also a direct Cocoa call on the panel. That means the authoritative immediate visibility check after `panel.hide()` is the panel handle’s `is_visible()`, not `WebviewWindow.is_visible()`. [6][7]
- Synthesis: For `/Users/dta.teks/dev/stt`, if hidden-bar behavior matters, do not assume “hidden” suppresses event JS execution, and do not assume Tauri window visibility APIs mirror tauri-nspanel panel visibility immediately after `panel.hide()`. Prefer explicit page-ready gating for event consumers and panel-native visibility checks for NSPanel state. [1][3][6][7]

### Key Findings
#### 1) Hidden-window Tauri event delivery on macOS

**Claim**: Tauri JS event delivery is implemented by generating a JS dispatch snippet and evaluating it in the target webview; the emit path does not branch on window visibility. [1][2]

**Evidence** ([crates/tauri/src/webview/mod.rs#L1948-L1954](https://github.com/tauri-apps/tauri/blob/b536dce356c7e071e4688609fc1da68642870ceb/crates/tauri/src/webview/mod.rs#L1948-L1954) [1], [crates/tauri/src/event/mod.rs#L194-L206](https://github.com/tauri-apps/tauri/blob/b536dce356c7e071e4688609fc1da68642870ceb/crates/tauri/src/event/mod.rs#L194-L206) [2]):
```rust
pub(crate) fn emit_js(&self, emit_args: &EmitArgs, ids: &[u32]) -> crate::Result<()> {
  self.eval(crate::event::emit_js_script(
    self.manager().listeners().function_name(),
    emit_args,
    &serde_json::to_string(ids)?,
  )?)?;
  Ok(())
}
```

```rust
pub(crate) fn emit_js_script(
  event_emit_function_name: &str,
  emit_args: &EmitArgs,
  serialized_ids: &str,
) -> crate::Result<String> {
  Ok(format!(
    "(function () {{ const fn = window['{}']; fn && fn({{event: '{}', payload: {}}}, {ids}) }})()",
    event_emit_function_name,
    emit_args.event,
    emit_args.payload,
    ids = serialized_ids,
  ))
}
```

**Explanation**: `emit_js()` always turns the event into a JavaScript string and calls `self.eval(...)`. The generated script only checks whether the JS-side event function exists on `window`; it does not inspect native visibility, hidden state, focus, or occlusion.

- Trace: JS listeners are tracked per source webview label, then `emit_js_filter` walks matching webviews and calls `webview.emit_js(...)`; again, there is no visibility gate in this dispatch stage. [8]

#### 2) The runtime path on macOS WKWebView is JS evaluation

**Claim**: Tauri runtime-wry forwards webview eval requests to Wry as `EvaluateScript`, and Wry’s macOS backend executes them with WKWebView `evaluateJavaScript:completionHandler:`. [3][4]

**Evidence** ([crates/tauri-runtime-wry/src/lib.rs#L1831-L1839](https://github.com/tauri-apps/tauri/blob/b536dce356c7e071e4688609fc1da68642870ceb/crates/tauri-runtime-wry/src/lib.rs#L1831-L1839) [3], [crates/tauri-runtime-wry/src/lib.rs#L3759-L3763](https://github.com/tauri-apps/tauri/blob/b536dce356c7e071e4688609fc1da68642870ceb/crates/tauri-runtime-wry/src/lib.rs#L3759-L3763) [3], [src/wkwebview/mod.rs#L720-L770](https://github.com/tauri-apps/wry/blob/44e26ef27428f3b9f8d00f62a6ffda887ea8a982/src/wkwebview/mod.rs#L720-L770) [4]):
```rust
fn eval_script<S: Into<String>>(&self, script: S) -> Result<()> {
  send_user_message(
    &self.context,
    Message::Webview(
      *self.window_id.lock().unwrap(),
      self.webview_id,
      WebviewMessage::EvaluateScript(script.into()),
    ),
  )
}
```

```rust
WebviewMessage::EvaluateScript(script) => {
  if let Err(e) = webview.evaluate_script(&script) {
    log::error!("{e}");
  }
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

**Explanation**: On macOS the eval endpoint is WKWebView `evaluateJavaScript_completionHandler`, not a visibility-aware native event queue. If the webview exists and is load-ready, hidden-window event delivery still enters WebKit as JS evaluation.

- Caveat: The current Wry macOS backend excerpt shows `evaluateJavaScript_completionHandler`, not the newer `evaluateJavaScript:inFrame:inContentWorld:` / `runJavaScriptInFrameInScriptWorld` selector. Wry exposes those bindings on iOS, but the active macOS eval path in this revision uses plain `evaluateJavaScript`. [4]

#### 3) Delivery caveat is page readiness, not visibility

**Claim**: Wry queues eval scripts until navigation commits, then replays them; this is the concrete delivery caveat for early hidden-window emits. [4][5]

**Evidence** ([src/wkwebview/mod.rs#L569-L587](https://github.com/tauri-apps/wry/blob/44e26ef27428f3b9f8d00f62a6ffda887ea8a982/src/wkwebview/mod.rs#L569-L587) [4], [src/wkwebview/navigation.rs#L17-L35](https://github.com/tauri-apps/wry/blob/44e26ef27428f3b9f8d00f62a6ffda887ea8a982/src/wkwebview/navigation.rs#L17-L35) [5]):
```rust
let pending_scripts = Arc::new(Mutex::new(Some(Vec::new())));
let navigation_policy_delegate = WryNavigationDelegate::new(
  webview.clone(),
  pending_scripts.clone(),
  has_download_handler,
  attributes.navigation_handler,
  download_delegate.clone(),
  attributes.on_page_load_handler,
  pl_attrs.on_web_content_process_terminate_handler,
  mtm,
);
```

```rust
pub(crate) fn did_commit_navigation(
  this: &WryNavigationDelegate,
  webview: &WKWebView,
  _navigation: &WKNavigation,
) {
  unsafe {
    let mut pending_scripts = this.ivars().pending_scripts.lock().unwrap();
    if let Some(scripts) = &*pending_scripts {
      for script in scripts {
        webview.evaluateJavaScript_completionHandler(&NSString::from_str(script), None);
      }
      *pending_scripts = None;
    }
  }
}
```

**Explanation**: Before the initial commit, `eval()` just accumulates scripts. After commit, Wry flushes them into WKWebView. So a hidden webview can still receive the event later, but only once navigation reaches `did_commit_navigation`.

- History/contract gap: No official Tauri or Wry docs found that promise delivery timing for hidden-but-not-yet-committed webviews; the guarantee visible in code is only the pending-script flush on commit. [4][5]
- Additional caveat: Wry only surfaces web-content termination through `on_web_content_process_terminate`; there is no hidden-window-specific resend layer in the event path. If the content process died, app code must react to the termination hook. [5][9]

#### 4) tauri-nspanel visibility truth lives on the panel handle

**Claim**: `tauri-nspanel`’s visibility API is panel-native: `hide()` sends Cocoa `orderOut:` to the `NSPanel`, and `is_visible()` asks the `NSPanel` for `isVisible`. [6][7]

**Evidence** ([src/panel.rs#L341-L345](https://github.com/ahkohd/tauri-nspanel/blob/a3122e894383aa068ec5365a42994e3ac94ba1b6/src/panel.rs#L341-L345) [6], [src/panel.rs#L521-L525](https://github.com/ahkohd/tauri-nspanel/blob/a3122e894383aa068ec5365a42994e3ac94ba1b6/src/panel.rs#L521-L525) [7]):
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

**Explanation**: The plugin directly delegates both operations to AppKit on the `NSPanel`. This is the closest upstream evidence for “immediate and accurate” panel visibility state.

- Version scope: This behavior is from tauri-nspanel `v2.1` / SHA `a3122e894383aa068ec5365a42994e3ac94ba1b6`. [6][7]

#### 5) `WebviewWindow.is_visible()` is not proven to mirror `panel.hide()` immediately

**Claim**: Upstream evidence does not establish any guarantee that `WebviewWindow.is_visible()` stays in lockstep with `panel.hide()` after converting the window to `NSPanel`. [10][6][7]

**Evidence** ([src/lib.rs#L66-L71](https://github.com/ahkohd/tauri-nspanel/blob/a3122e894383aa068ec5365a42994e3ac94ba1b6/src/lib.rs#L66-L71) [10], [src/panel.rs#L341-L345](https://github.com/ahkohd/tauri-nspanel/blob/a3122e894383aa068ec5365a42994e3ac94ba1b6/src/panel.rs#L341-L345) [6], [src/panel.rs#L521-L525](https://github.com/ahkohd/tauri-nspanel/blob/a3122e894383aa068ec5365a42994e3ac94ba1b6/src/panel.rs#L521-L525) [7]):
```rust
pub trait Panel<R: tauri::Runtime = tauri::Wry>: Send + Sync {
    fn show(&self);
    fn hide(&self);
    fn to_window(&self) -> Option<tauri::WebviewWindow<R>>;
    fn as_panel(&self) -> &objc2_app_kit::NSPanel;
    fn set_level(&self, level: i64);
```

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

**Explanation**: The plugin preserves a path back to `WebviewWindow` (`to_window()`), but the visibility methods it exposes and documents are on the `Panel` itself. None of the retrieved tauri-nspanel code or docs state that the original Tauri `WebviewWindow` visibility getter is updated synchronously from panel `orderOut:`.

- Caveat: This is a lack-of-guarantee finding, not proof of divergence. The likely runtime result may often match, but upstream sources here do not promise it.
- Practical implication for `stt`: if correctness depends on native HUD visibility right after `panel.hide()`, query the `PanelHandle` or track visibility in your own shell abstraction rather than trusting `WebviewWindow.is_visible()` as a hard contract. [6][7]

### Execution Trace
| Step | Symbol / Artifact | What happens here | Source IDs |
|------|-------------------|-------------------|------------|
| 1 | `Listeners::emit_js_filter` | Chooses webviews with JS listeners for the event and calls `webview.emit_js(...)` | [8] |
| 2 | `Webview::emit_js` | Converts event payload into a JS dispatch snippet and calls `self.eval(...)` | [1][2] |
| 3 | `WebviewDispatch::eval_script` | Tauri runtime-wry sends `WebviewMessage::EvaluateScript` to the main thread | [3] |
| 4 | `handle_user_message` `EvaluateScript` arm | Runtime calls `webview.evaluate_script(&script)` | [3] |
| 5 | `wry::wkwebview::InnerWebView::eval` | On macOS, either buffers the script or calls WKWebView `evaluateJavaScript_completionHandler` directly | [4] |
| 6 | `did_commit_navigation` | Flushes buffered scripts after navigation commit | [5] |
| 7 | `Panel::hide` / `Panel::is_visible` | tauri-nspanel hides via `orderOut:` and reads visibility via `isVisible` on `NSPanel` | [6][7] |

### Change Context
- History: The current Wry macOS implementation inspected at `44e26ef27428f3b9f8d00f62a6ffda887ea8a982` uses `evaluateJavaScript_completionHandler` for eval. The iOS bindings include newer `evaluateJavaScript:inFrame:inContentWorld:` and `callAsyncJavaScript...` selectors, but they are not the active macOS event-delivery path in this revision. [4]

### Caveats and Gaps
- No upstream Tauri/Wry issue or doc located in this pass that states a formal contract for hidden-window event delivery timing on macOS; the answer is code-trace based.
- The user asked specifically about `runJavaScriptInFrameInScriptWorld`; current inspected Wry macOS code does not use that selector for Tauri event delivery. If another lower WebKit internal layer maps `evaluateJavaScript` onto that call, that would require Apple/WebKit implementation evidence not present in the inspected Tauri/Wry sources.
- No upstream tauri-nspanel source found asserting synchronization semantics between `WebviewWindow.is_visible()` and `NSPanel` `isVisible`; absence of guarantee is the supported conclusion.

### Source Register
| ID | Kind | Source | Version / Ref | Why kept | URL |
|----|------|--------|---------------|----------|-----|
| [1] | code | Tauri `Webview::emit_js` | `b536dce356c7e071e4688609fc1da68642870ceb` | Decisive event->eval bridge in Tauri | https://github.com/tauri-apps/tauri/blob/b536dce356c7e071e4688609fc1da68642870ceb/crates/tauri/src/webview/mod.rs#L1948-L1954 |
| [2] | code | Tauri `emit_js_script` | `b536dce356c7e071e4688609fc1da68642870ceb` | Shows emitted event becomes inline JS snippet | https://github.com/tauri-apps/tauri/blob/b536dce356c7e071e4688609fc1da68642870ceb/crates/tauri/src/event/mod.rs#L194-L206 |
| [3] | code | Tauri runtime-wry eval path | `b536dce356c7e071e4688609fc1da68642870ceb` | Shows `EvaluateScript` message and handler | https://github.com/tauri-apps/tauri/blob/b536dce356c7e071e4688609fc1da68642870ceb/crates/tauri-runtime-wry/src/lib.rs#L1831-L1839 |
| [4] | code | Wry macOS WKWebView eval implementation | `44e26ef27428f3b9f8d00f62a6ffda887ea8a982` | Shows direct `evaluateJavaScript_completionHandler` and pending buffer | https://github.com/tauri-apps/wry/blob/44e26ef27428f3b9f8d00f62a6ffda887ea8a982/src/wkwebview/mod.rs#L720-L770 |
| [5] | code | Wry navigation commit flush | `44e26ef27428f3b9f8d00f62a6ffda887ea8a982` | Shows pending scripts delivered at `did_commit_navigation` | https://github.com/tauri-apps/wry/blob/44e26ef27428f3b9f8d00f62a6ffda887ea8a982/src/wkwebview/navigation.rs#L17-L35 |
| [6] | code | tauri-nspanel `is_visible` | `a3122e894383aa068ec5365a42994e3ac94ba1b6` | Native source of panel visibility truth | https://github.com/ahkohd/tauri-nspanel/blob/a3122e894383aa068ec5365a42994e3ac94ba1b6/src/panel.rs#L341-L345 |
| [7] | code | tauri-nspanel `hide` | `a3122e894383aa068ec5365a42994e3ac94ba1b6` | Native hide implementation using `orderOut:` | https://github.com/ahkohd/tauri-nspanel/blob/a3122e894383aa068ec5365a42994e3ac94ba1b6/src/panel.rs#L521-L525 |
| [8] | code | Tauri JS listener fanout | `b536dce356c7e071e4688609fc1da68642870ceb` | Shows event delivery iterates target webviews without visibility gate | https://github.com/tauri-apps/tauri/blob/b536dce356c7e071e4688609fc1da68642870ceb/crates/tauri/src/event/listener.rs#L269-L294 |
| [9] | code | Wry web-content-terminate hook | `44e26ef27428f3b9f8d00f62a6ffda887ea8a982` | Shows process-termination hook but no resend behavior | https://github.com/tauri-apps/wry/blob/44e26ef27428f3b9f8d00f62a6ffda887ea8a982/src/wkwebview/navigation.rs#L107-L115 |
| [10] | code | tauri-nspanel `Panel` trait | `a3122e894383aa068ec5365a42994e3ac94ba1b6` | Shows plugin’s API boundary between panel and window | https://github.com/ahkohd/tauri-nspanel/blob/a3122e894383aa068ec5365a42994e3ac94ba1b6/src/lib.rs#L66-L71 |

### Evidence Appendix
**Supporting trace** ([crates/tauri/src/event/listener.rs#L269-L294](https://github.com/tauri-apps/tauri/blob/b536dce356c7e071e4688609fc1da68642870ceb/crates/tauri/src/event/listener.rs#L269-L294) [8]):
```rust
pub(crate) fn emit_js_filter<'a, R, I, F>(
  &self,
  mut webviews: I,
  emit_args: &EmitArgs,
  filter: Option<F>,
) -> crate::Result<()>
where
  R: Runtime,
  I: Iterator<Item = &'a Webview<R>>,
  F: Fn(&EventTarget) -> bool,
{
  let event = &emit_args.event;
  let js_listeners = self.inner.js_event_listeners.lock().unwrap();
  webviews.try_for_each(|webview| {
    if let Some(handlers) = js_listeners.get(webview.label()).and_then(|s| s.get(event)) {
      let ids = handlers
        .iter()
        .filter(|handler| match_any_or_filter(&handler.target, &filter))
        .map(|handler| handler.id)
        .collect::<Vec<_>>();
      webview.emit_js(emit_args, &ids)?;
    }

    Ok(())
  })
}
```
