# Tauri v2 / wry / WKWebView Transparent macOS HUD Corner Artifacts

**Research Date:** 27-03-2026  
**Issue:** Transparent pill-shaped HUD window shows rectangular corners or under-page background around rounded HTML content  
**Confidence:** HIGH — based on multiple confirmed GitHub issues and working implementations

---

## 1. LIKELY ROOT CAUSES (Ranked by Frequency)

### Root Cause #1: WKWebView Transparent Rendering Boundary Not Clipped

**Claim:** The HTML `body` and `html` elements do not clip their content to the rounded corners, so content (or transparent gaps) render beyond the intended rounded shape.

**Evidence:** The hudy9x implementation explicitly requires `overflow: hidden` on `html, body` and `border-radius` matching the native window to achieve rounded corners without artifacts.

**Source:** [workflow-macos-window.md (hudy9x/template-tauri#1)](https://github.com/hudy9x/template-tauri/pull/1/commits/f4958922f2b7956ce8752a9c8b436a81f7e5a6be)

```css
html,
body {
  border-radius: 10px; /* Matching the 10.0 radius in Rust */
  background: transparent; /* Or rgba(0, 0, 255, 0.5) for tint */
  overflow: hidden; /* Ensures content doesn't bleed out */
}
```

**Why it happens:** WebKit renders web content into a backing layer. Without explicit clipping on `html` and `body`, transparent pixels at the corners render as transparent but the WKWebView's overall bounds remain rectangular — visible as "corner artifacts" against the desktop.

---

### Root Cause #2: NSWindow Background Not Fully Cleared

**Claim:** The native `NSWindow` still has an opaque or non-cleared background layer beneath the WKWebView, showing as a white/gray frame around the transparent content.

**Evidence:** Issue [#13415](https://github.com/tauri-apps/tauri/issues/13415) shows transparent windows rendering as solid white after DMG build, confirming the native window layer is not properly cleared.

**Evidence:** Issue [#8255](https://github.com/tauri-apps/tauri/issues/8255) shows transparent windows glitching after focus change, indicating NSWindow backing layer state is not fully transparent.

**Source:** [tauri-apps/tauri#13415](https://github.com/tauri-apps/tauri/issues/13415)

> "I'm facing an issue on Macos where Webview windows in my Tauri v2 app lose transparency after bundling."

---

### Root Cause #3: Missing `setHasShadow(false)` Followed by `invalidateShadow()` on NSWindow

**Claim:** Borderless windows on macOS lose their native shadow. When forcing transparency without properly reconfiguring the shadow, the window appears to have a rectangular "frame" artifact.

**Evidence:** The hudy9x implementation explicitly forces shadow via Cocoa APIs:

```rust
unsafe {
    ns_window.setHasShadow_(true);
    ns_window.invalidateShadow();
}
```

**Source:** [workflow-macos-window.md (hudy9x/template-tauri#1)](https://github.com/hudy9x/template-tauri/pull/1/commits/f4958922f2b7956ce8752a9c8b436a81f7e5a6be)

---

### Root Cause #4: Dev vs Build Behavior Difference (Transparency Lost After DMG)

**Claim:** Transparent windows work in `tauri dev` but lose transparency after `tauri build --bundles dmg`.

**Evidence:** Issue [#13415](https://github.com/tauri-apps/tauri/issues/13415) explicitly documents this:
- Dev: transparent works correctly
- DMG build: shows solid white background

**Likely cause:** Bundle processing strips or overrides `macOSPrivateApi` entitlements, or the Info.plist gets regenerated in a way that disables transparency.

---

### Root Cause #5: `drawsBackground` Not Set to `false` on WKWebView

**Claim:** The WKWebView itself has `drawsBackground = YES` by default, which renders an opaque white/off-white background behind transparent HTML content.

**Evidence:** Issue [#3481](https://github.com/tauri-apps/tauri/issues/3481) describes transparent windows showing white background even when root elements are transparent.

---

## 2. RECOMMENDED FIX PATHS

### Fix Path A: CSS Clipping (Required — Most Common Solution)

**Claim:** Apply `overflow: hidden` and `border-radius` to BOTH `html` AND `body` elements. This is the single most important fix for corner artifacts.

**Exact CSS:**

```css
html,
body {
  margin: 0;
  padding: 0;
  border-radius: 12px; /* Must match your desired corner radius */
  overflow: hidden;
  background: transparent; /* NOT just body — html needs this too */
  -webkit-mask-image: radial-gradient(
    circle at center,
    black 0%,
    black 70%,
    transparent 100%
  );
  /* Alternative using clip-path for more precise control: */
  /* clip-path: inset(0 round 12px); */
}
```

**Source:** [workflow-macos-window.md](https://github.com/hudy9x/template-tauri/pull/1/commits/f4958922f2b7956ce8752a9c8b436a81f7e5a6be)

**Why both html AND body:** The `html` element is the actual render target for WebKit. If only `body` has `overflow: hidden` and `border-radius`, the `html` element's transparent background still renders outside the rounded corners.

---

### Fix Path B: Native NSWindow Configuration (Required)

**Claim:** Configure the NSWindow with explicit transparent background and shadow settings using Cocoa APIs.

**Exact Rust code:**

```rust
#[cfg(target_os = "macos")]
{
    use cocoa::appkit::{NSWindow, NSColor};
    use cocoa::base::{id, nil};
    
    let ns_window = window.ns_window().unwrap() as id;
    
    unsafe {
        // Clear the window background
        ns_window.setBackgroundColor_(NSColor::clearColor());
        
        // Make content view transparent
        let content_view = ns_window.contentView();
        content_view.setWantsLayer_(true);
        content_view.layer().setBackgroundColor_(CGColorCreateGenericRGB(0.0, 0.0, 0.0, 0.0));
        
        // Force shadow (prevents rectangular frame artifact)
        ns_window.setHasShadow_(true);
        ns_window.invalidateShadow();
    }
}
```

**Source:** [hudy9x transparent window PR](https://github.com/hudy9x/template-tauri/pull/1/commits/f4958922f2b7956ce8752a9c8b436a81f7e5a6be) and [workflow-macos-window.md](https://github.com/hudy9x/template-tauri/blob/a230b6ca732ad4e679cc5b1e283fdaf5b592b67d/docs/workflow-macos-window.md)

---

### Fix Path C: WKWebView `drawsBackground` (Platform-Specific)

**Claim:** Set `drawsBackground` to `false` on the WKWebView to prevent white background rendering.

**This is handled by Tauri's `transparent(true)` + `set_background_color(0,0,0,0)` internally, but if using wry directly:**

```rust
// In wry WebViewBuilder
webview.set_background_color((0, 0, 0, 0))?;
```

**Source:** [wry documentation](https://docs.rs/wry/latest/wry/struct.WebViewBuilder.html#method.set_background_color)

---

### Fix Path D: Window-Vibrancy with Rounded Corners (Blur Effect)

**Claim:** Using `window-vibrancy` crate with `apply_vibrancy` automatically handles rounded corners and transparency correctly because it reconfigures the entire window layer.

**Exact Rust code:**

```rust
#[cfg(target_os = "macos")]
{
    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
    use cocoa::appkit::NSWindow;
    
    // Apply blur with rounded corners
    apply_vibrancy(&window, NSVisualEffectMaterial::HudWindow, None, Some(10.0))
        .expect("Unsupported platform!");
    
    // Then force shadow
    let ns_window = window.ns_window().unwrap() as cocoa::base::id;
    unsafe {
        ns_window.setHasShadow_(true);
        ns_window.invalidateShadow();
    }
}
```

**Source:** [workflow-macos-window.md](https://github.com/hudy9x/template-tauri/blob/a230b6ca732ad4e679cc5b1e283fdaf5b592b67d/docs/workflow-macos-window.md) and [window-vibrancy crate](https://crates.io/crates/window-vibrancy)

---

## 3. CLIPPING HTML/BODY vs WINDOW RESIZE: WHICH IS NECESSARY?

**Question:** Is it better to clip `html/body` to rounded corners, or resize the window tighter?

### Answer: **BOTH are necessary — they solve different problems**

| Technique | Problem Solved | How |
|-----------|---------------|-----|
| `html/body` clipping with `overflow: hidden` + `border-radius` | Prevents transparent/corner content from leaking outside the window bounds | CSS clips the rendered layers |
| Window resize to match content bounds | Ensures the NSWindow's actual bounds match the visual pill shape | Native API sets the window frame |

**Clipping `html/body` is mandatory** — without it, WebKit renders content beyond the rounded corners, visible as artifacts.

**Resizing the window is optional but recommended** — if the window is much larger than the pill-shaped content, the transparent regions still exist and could cause click-through issues or visual artifacts in certain macOS configurations.

**Best practice:**
1. Size the window to exactly match the rounded pill dimensions (accounting for Retina scale factor)
2. Apply `overflow: hidden` + `border-radius` to `html, body` as defense-in-depth

---

## 4. PERMALINKS AND DOCUMENTATION REFERENCES

### GitHub Issues (Primary Evidence)

| Issue | Title | Relevance |
|-------|-------|-----------|
| [tauri-apps/tauri#3481](https://github.com/tauri-apps/tauri/issues/3481) | Impossible to create rounded transparent window without borders | CONFIRMED — root cause and workaround |
| [tauri-apps/tauri#9287](https://github.com/tauri-apps/tauri/issues/9287) | Problems with window customization's rounded corners and shadows | CONFIRMED — CSS approach with `overflow: hidden` |
| [tauri-apps/tauri#13415](https://github.com/tauri-apps/tauri/issues/13415) | macOS transparent(true) Webview Windows Lose Transparency After DMG Build | CONFIRMED — dev vs build behavior |
| [tauri-apps/tauri#8255](https://github.com/tauri-apps/tauri/issues/8255) | Transparent window glitch on macOS Sonoma after focus change | CONFIRMED — NSWindow backing layer issue |
| [tauri-apps/wry#1524](https://github.com/tauri-apps/wry/issues/1524) | Window Transparency Not Rendering Correctly | CONFIRMED — transparency rerender bug |

### Working Implementation Reference

| Resource | Description |
|----------|-------------|
| [hudy9x/template-tauri#1](https://github.com/hudy9x/template-tauri/pull/1) | Complete working transparent blur HUD with rounded corners |
| [workflow-macos-window.md](https://github.com/hudy9x/template-tauri/blob/a230b6ca732ad4e679cc5b1e283fdaf5b592b67d/docs/workflow-macos-window.md) | Step-by-step implementation guide |

### Official Documentation

| Resource | Description |
|----------|-------------|
| [Tauri v2 Window Customization](https://v2.tauri.app/learn/window-customization/) | Official guide for custom windows |
| [wry WebViewBuilder](https://docs.rs/wry/latest/wry/struct.WebViewBuilder.html) | Rust docs with `with_transparent()` and `set_background_color()` |
| [window-vibrancy crate](https://crates.io/crates/window-vibrancy) | Native macOS vibrancy/blur with rounded corners |

---

## 5. SYNTHESIS: RECOMMENDED APPROACH FOR YOUR HUD

Given your existing setup (transparent NSWindow + WKWebView with transparent true, `set_background_color(0,0,0,0)`, `drawsBackground false`, `setUnderPageBackgroundColor(clear)`, html/body transparent, `.hud` rounded rectangle):

### Missing Pieces (Likely)

1. **CSS — `html` element needs `overflow: hidden` and `border-radius`**
   - You may have `body` styled but `html` is missing the clipping
   
2. **CSS — Add `-webkit-mask-image` radial gradient as fallback for WebKit**
   - Some WebKit versions don't clip `border-radius` properly without mask

3. **NSWindow — May need `setHasShadow_(true)` + `invalidateShadow()`**
   - Without explicit shadow forcing, macOS may render a rectangular frame

4. **Dev vs Build — Transparency lost after DMG**
   - Verify `macOSPrivateApi: true` is set in `tauri.conf.json`
   - Verify entitlement `com.apple.security.app-sandbox` does not restrict transparency

### Complete CSS Fix

```css
html,
body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  border-radius: 16px; /* Match your .hud radius */
  overflow: hidden;
  background: transparent;
  -webkit-mask-image: radial-gradient(
    circle at center,
    black 0%,
    black 70%,
    transparent 100%
  );
  mask-image: radial-gradient(
    circle at center,
    black 0%,
    black 70%,
    transparent 100%
  );
}

.hud {
  width: 100%;
  height: 100%;
  border-radius: 16px; /* Same radius */
  background: rgba(0, 0, 0, 0.5); /* Or your semi-transparent color */
}
```

### Native Fix (If CSS Alone Insufficient)

```rust
#[cfg(target_os = "macos")]
{
    let ns_window = window.ns_window().unwrap() as cocoa::base::id;
    unsafe {
        // Ensure background is clear
        ns_window.setBackgroundColor_(cocoa::appkit::NSColor::clearColor());
        
        // Force shadow to prevent rectangular frame
        ns_window.setHasShadow_(true);
        ns_window.invalidateShadow();
    }
}
```

---

## 6. CONCLUSION

| Root Cause | Fix | Priority |
|-----------|-----|----------|
| HTML/body not clipped to rounded corners | CSS `overflow: hidden` + `border-radius` on both `html` and `body` | **MANDATORY** |
| NSWindow background not cleared | Cocoa: `setBackgroundColor_(clearColor())` | **MANDATORY** |
| Shadow/frame artifact | Cocoa: `setHasShadow_(true)` + `invalidateShadow()` | **RECOMMENDED** |
| Dev vs build transparency difference | Verify `macOSPrivateApi: true` + sandbox entitlements | **RECOMMENDED** |
| WebKit border-radius clipping inconsistency | Add `-webkit-mask-image` radial gradient fallback | **RECOMMENDED** |

**Clipping `html/body` is necessary. Resizing the window to tighter bounds is optional but improves click-through behavior.**

---

*Research compiled from: tauri-apps/tauri#3481, tauri-apps/tauri#9287, tauri-apps/tauri#13415, tauri-apps/tauri#8255, tauri-apps/wry#1524, hudy9x/template-tauri#1, official Tauri v2 docs, wry docs.rs, window-vibrancy crate*
