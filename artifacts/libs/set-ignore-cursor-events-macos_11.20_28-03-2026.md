# `set_ignore_cursor_events(bool)` in Tauri v2 on macOS

**Date**: 2026-03-28  
**Research Type**: Implementation Analysis + Known Issues

---

## 1. Underlying macOS API

**Claim**: `set_ignore_cursor_events(true)` calls `NSWindow.setIgnoresMouseEvents(_:)` on macOS.

**Evidence** ([async.rs in tao](https://github.com/tauri-apps/tao/blob/HEAD/src/platform_impl/macos/util/async.rs#L252-L256)):

```rust
// `setIgnoresMouseEvents_:` isn't thread-safe, and fails silently.
pub unsafe fn set_ignore_mouse_events(ns_window: &NSWindow, ignore: bool) {
  let ns_window = MainThreadSafe(ns_window.retain());
  DispatchQueue::main().exec_async(move || {
    ns_window.setIgnoresMouseEvents(ignore);
  });
}
```

**Call chain**:
1. Tauri JS API: `window.setIgnoreCursorEvents(true)` (snake_case in JS)
2. Rust: `set_ignore_cursor_events()` in [window/mod.rs](https://github.com/tauri-apps/tauri/blob/HEAD/crates/tauri/src/window/mod.rs#L2213-L2218)
3. Runtime: `WindowMessage::SetIgnoreCursorEvents(ignore)` sent via channel
4. tao: `window.set_ignore_cursor_events(ignore)` in [macos/window.rs#L968-L973](https://github.com/tauri-apps/tao/blob/HEAD/src/platform_impl/macos/window.rs#L968-L973)
5. **Native**: `NSWindow.setIgnoresMouseEvents(ignore)`

---

## 2. The Three-States Problem (Critical Limitation)

**Claim**: `NSWindow.ignoresMouseEvents` has **three distinct states**, and once any state-changing call is made, the window **cannot return to State 1**.

**Evidence** (from [ElectronMacOSClickThrough monkey-patch comments](https://github.com/loomhq/ElectronMacOSClickThrough/blob/master/setIgnoresMouseEventsPatch.mm)):

```objc
// See the comment on this answer that says NSWindow.ignoresMouseEvents has THREE states
// https://stackoverflow.com/a/29451199/22147

// 1. ignoresMouseEvents on transparent areas (the initial state)
// 2. ignores all events (YES)
// 3. does not ignore any events (NO)

// The first state is what we want for partial click through, and once setIgnoresMouseEvents
// has been called, you can never return to the initial state, so we turn calls to
// setIgnoreMouseEvents into a no-op using a monkey patch.
```

**States explained**:

| State | `ignoresMouseEvents` value | Behavior |
|-------|--------------------------|----------|
| **1. Initial (natural click-through)** | `nil` (undefined) | Transparent areas pass clicks through; opaque areas receive events |
| **2. Full ignore** | `YES` | ALL clicks pass through the window |
| **3. No ignore** | `NO` | ALL clicks are captured by the window |

**The core problem**: macOS does not provide a way to restore State 1 after any call to `setIgnoresMouseEvents:`. Setting it to `NO` gives you full click capture, not the original partial transparency behavior.

---

## 3. Known Issues with Transparent Windows

### Issue A: macOS Sonoma 14.0 Broke Transparent Click-Through

**Evidence**: [Apple Developer Forums - transparent window can't click through in macOS sonoma](https://developer.apple.com/forums/thread/737584)

> "i crate a fully transparent NSWindow... in macos sonoma, i found that when after multiple calls setNeedDisplay:YES, the transparent window can't click through. This feature run correctly in previous versions, like macos 13"

**Confirmed also in**:
- [nw.js Issue #8125: Transparent clickthrough window not working on MacOS Sonoma 14.0](https://github.com/nwjs/nw.js/issues/8125)
- [Wails Issue #2969: Ignore mouse operations on a transparent window](https://github.com/wailsapp/wails/issues/2969)

### Issue B: `set_ignore_cursor_events(false)` After `true` Does NOT Restore Original Behavior

**Claim**: Calling `set_ignore_cursor_events(false)` after `set_ignore_cursor_events(true)` does **NOT** restore the original transparent click-through behavior. It sets the window to State 3 (full click capture), not State 1 (partial transparency based on opacity).

**Explanation**:
- `set_ignore_cursor_events(true)` → State 2 (all events pass through)
- `set_ignore_cursor_events(false)` → State 3 (all events captured)
- **State 1 is unreachable once any `setIgnoresMouseEvents:` call has been made**

This is a fundamental macOS limitation, not a Tauri bug.

### Issue C: `setIgnoresMouseEvents:false` with `isOpaque = false`, `NSStatusWindowLevel`, No Title Bar

**Claim**: On a transparent, always-on-top (NSStatusWindowLevel), non-decorated NSWindow, calling `setIgnoresMouseEvents(false)` will set the window to full click-capture mode (State 3). It does **not** restore the natural click-through behavior of transparent areas.

**Why this matters for Tauri HUD windows**:
- Tauri HUD windows use `NSStatusWindowLevel` (above fullscreen apps)
- Tauri HUD windows are non-decorated (no title bar)
- Tauri HUD windows are typically transparent
- Once `setIgnoresMouseEvents(true)` is called on such a window, there's no way to get back to "natural" partial transparency

---

## 4. Tauri GitHub Issues

### Issue [#6164](https://github.com/tauri-apps/tauri/issues/6164) - `[feat] Add forward option to setIgnoreCursorEvents`

**Status**: Open (reopened)

This issue requests a `forward` option similar to Electron's `setIgnoreMouseEvents(ignore, { forward: true })`. The discussion reveals:

- Electron has a `forward` option that passes click events to the window behind
- Tauri does not have this feature
- The workaround suggested is hitbox detection: emit mouse position from Rust backend and toggle `setIgnoreCursorEvents` based on whether the cursor is over a "hitbox" region

**Workaround from Issue #6164** (by @Xinyu-Li-123):
```typescript
// Track cursor position via Rust backend event 'device-mouse-move'
// Then in frontend:
appWebview.setIgnoreCursorEvents(false);
appWebview.listen<{ x: number; y: number }>('device-mouse-move', async ({ payload }) => {
  const inHitbox = isInBox(payload.x, payload.y, boxPos);
  const shouldIgnore = !isDragging && !inHitbox;
  if (shouldIgnore != isIgnored) {
    appWebview.setIgnoreCursorEvents(shouldIgnore);
    isIgnored = shouldIgnore;
  }
});
```

### Issue [#10564](https://github.com/tauri-apps/tauri/issues/10564) - `[feat] [v2] Make set_ignore_cursor_events available for Webview`

**Status**: Open

Requests that `set_ignore_cursor_events` be available on `Webview` in addition to `Window`.

### Issue #2090 (referenced in #6164) - Per-element click-through

**Status**: Closed (workarounds available)

This is the real feature request: selectively ignoring cursor events based on HTML element transparency/opacity, not the entire window.

---

## 5. Workarounds

### Workaround A: Hitbox Detection (Recommended for Tauri)

Instead of relying on `setIgnoresMouseEvents`, calculate which window regions should be clickable and dynamically toggle cursor event ignoring:

1. Use Rust backend to emit global mouse position via `listen('device-mouse-move', ...)`
2. In frontend, maintain a "hitbox" bounding box for interactive elements
3. When cursor is outside hitbox → `setIgnoreCursorEvents(true)` (clicks pass through)
4. When cursor is inside hitbox → `setIgnoreCursorEvents(false)` (clicks captured)

**Trade-offs**:
- Requires calculating transparent regions manually
- Works for rectangular regions but not irregular SVG shapes
- Performance cost from continuous mouse position polling

### Workaround B: Electron Monkey-Patch (Not Applicable to Tauri)

The [ElectronMacOSClickThrough](https://github.com/loomhq/ElectronMacOSClickThrough) project monkey-patches `setIgnoresMouseEvents:` to be a no-op, preserving State 1 (initial transparent click-through).

This is not directly applicable to Tauri because:
- It requires Objective-C runtime manipulation
- It only works when `setIgnoresMouseEvents` is never called
- It can't restore State 1 once lost

### Workaround C: Don't Use `set_ignore_cursor_events` at All

If you need partial click-through from the start:
1. Create window with correct transparency settings
2. Never call `set_ignore_cursor_events`
3. Handle all click logic via HTML/CSS `pointer-events: none/auto` on child elements
4. Use CSS to make specific regions interactive

**Trade-offs**:
- Requires all interactive regions to be HTML elements
- Doesn't work for native window chrome or irregular shapes
- Limited to what's achievable with CSS pointer events

---

## 6. Summary

| Question | Answer |
|----------|--------|
| **Underlying macOS API** | `NSWindow.setIgnoresMouseEvents(_:)` |
| **Does `set(false)` restore click-through?** | **NO** - it sets full click-capture (State 3), not partial transparency (State 1) |
| **Is there a `forward` option?** | **NO** - Tauri does not have Electron's forward feature |
| **Known macOS bugs?** | **YES** - macOS Sonoma 14.0 broke transparent click-through for many apps |
| **Does it work with transparent always-on-top windows?** | `setIgnoresMouseEvents(false)` works (captures all clicks), but you cannot restore partial transparency after calling `setIgnoresMouseEvents` |
| **Reliable workaround?** | Hitbox detection via global mouse position polling |

---

## 7. Key References

- [tauri-apps/tao - set_ignore_mouse_events implementation](https://github.com/tauri-apps/tao/blob/HEAD/src/platform_impl/macos/util/async.rs#L252-L256)
- [Tauri Issue #6164 - forward option request](https://github.com/tauri-apps/tauri/issues/6164)
- [nw.js Issue #8125 - macOS Sonoma click-through](https://github.com/nwjs/nw.js/issues/8125)
- [Apple Developer Forums - transparent window click-through](https://developer.apple.com/forums/thread/737584)
- [ElectronMacOSClickThrough - monkey-patch workaround](https://github.com/loomhq/ElectronMacOSClickThrough)
- [Stack Overflow: Click through custom NSWindow](https://stackoverflow.com/questions/29441015/click-through-custom-nswindow)
