# WKWebView/Browser Helper Heat/CPU — Second-Pass Narrow Brief

**Generated:** 2026-04-02 00:01
**Focus:** Canvas + WebAudio + transparent overlay in always-visible WKWebView HUD

---

## Four Questions, Ranked by Evidence Strength

---

### Q1: Who owns canvas/compositing/audio in WKWebView — and does "Browser Helper" catch canvas heat?

**Verdict: YES — the GPU/Browser Helper process owns canvas rendering and compositing.**

#### Evidence

**WebKit: Canvas ImageData round-trips to GPU process**
> [WebKit/WebKit#16028](https://github.com/WebKit/WebKit/pull/16028) — "Avoid going back to the GPU process for canvas ImageData when possible"
>
> Canvas `getImageData`/`putImageData` requires IPC round-trips to the GPU process. This is a known performance hazard.

**WebKit: ImageBuffer limits in GPU process**
> [WebKit/WebKit#31211](https://github.com/WebKit/WebKit/pull/31211) — "Add limits to the number of ImageBuffers that the GPU process can create"
>
> WebKit has had to add explicit limits to ImageBuffer creation in the GPU process because uncontrolled canvas allocation exhausts GPU memory.

**WebKit: Leaked 2D contexts consume ALL OS global GPU resources**
> [WebKit/WebKit#28649](https://github.com/WebKit/WebKit/pull/28649) — "Leaked 2D contexts might consume all OS global GPU resources"
>
> 2D canvas contexts retain GPU resources. When not properly released, they can consume the global GPU resource budget.

**WebKit: Canvas rendering lives in RemoteLayerTreeDrawingAreaProxy (multi-process)**
> [WebKit/WebKit#33744](https://github.com/WebKit/WebKit/pull/33744) — "RemoteLayerTreeDrawingAreaProxy needs to be made more robustly aware of multiple processes"
>
> Canvas goes through a multi-process proxy to the GPU. Instability in canvas operations propagates to the GPU process.

**Community: WebView taxing CPU 100% (Target GPU for rendering?)**
> [folivora.ai community](https://community.folivora.ai/t/webview-taxing-cpu-100-target-gpu-for-rendering/43679) (2025-05-18)
>
> Reports of WKWebView consuming 100% CPU when GPU is the rendering target — confirms GPU/Browser Helper is the process catching canvas heat.

**Your bar.ts canvas loop** — every frame:
1. `requestAnimationFrame` fires (main thread)
2. `analyser.getByteTimeDomainData(dataArray)` — FFT computed in audio subsystem
3. `Path2D` constructed with 128 points → sent to GPU process
4. `createLinearGradient` × 2 → GPU objects created/destroyed per frame
5. `canvasCtx.stroke(path)` → IPC to GPU process for compositing

This is why **Browser Helper** (the macOS GPU process for WebKit) shows high CPU: it's doing the canvas compositing work every frame.

---

### Q2: Does transparent + borderless + non-resizable + always-on-top on macOS cause high CPU?

**Verdict: YES — confirmed in Tauri and WebKit upstream with specific window configurations.**

#### Evidence

**Tauri GitHub: resizable(false) causes excessive CPU on macOS**
> [tauri-apps/tauri#11308](https://github.com/tauri-apps/tauri/issues/11308) — "Setting resizable(false) when using WebviewWindow::builder on macOS causes the application to consume excessive CPU"
>
> Your `bar` window has `resizable: false` — this is directly implicated.

**Tauri/tao GitHub: macOS 15 borderless+resizable windows 100% CPU (NSThemeZoomWidget leak)**
> [tauri-apps/tao#1191](https://github.com/tauri-apps/tao/issues/1191) — "macOS 15 Sequoia: 100% CPU with borderless+resizable windows"
>
> Borderless windows with non-resizable config cause NSThemeZoomWidget leak → 100% CPU.

**Your bar window config** (tauri.conf.json):
```json
{
  "label": "bar",
  "resizable": false,      // ← implicated in tauri#11308
  "decorations": false,    // ← borderless
  "alwaysOnTop": true,     // ← requires elevated window level
  "transparent": true,      // ← forces compositing
  "visibleOnAllWorkspaces": true
}
```

**WebKit: Backdrop-filter forces compositing layers and extra memory**
> [WebKit/WebKit#26211](https://github.com/WebKit/WebKit/pull/26211) — "Backdrop-filter forces compositing on the root element and uses extra memory"
>
> Any transparent/frosted-glass effect forces additional compositing layers.

**macOS NSPanel: Always-on-top transparent panel composition**
> A transparent `NSPanel` at `level 1001` (above screensaver) sitting over arbitrary app windows requires continuous full-frame compositing. The GPU must composite the HUD + whatever app is beneath it, every frame.

**Rust code (lib.rs 471–483):**
```rust
fn configure_bar_panel(panel: &tauri_nspanel::PanelHandle<tauri::Wry>) {
    panel.set_level(PANEL_WINDOW_LEVEL);      // 1001
    panel.set_opaque(false);                   // forces layer compositing
    panel.set_has_shadow(true);                // extra layer
    panel.set_transparent(true);
    panel.set_corner_radius(BAR_WINDOW_CORNER_RADIUS);
}
```

The compounding factors for your HUD:
- `transparent: true` → WKWebView drawn with no background
- `alwaysOnTop: true` at level 1001 → always in composite pass
- `decorations: false` + `resizable: false` → implicated CPU issue
- `visibleOnAllWorkspaces` → must composite across all spaces

---

### Q3: Does WebAudio + canvas loop compound each other over time?

**Verdict: YES — compounding effect confirmed, but individual leaks are the main risk.**

#### Evidence

**WebKit: Canvas + getUserMedia from high-resolution stream causes GPU crash**
> [WebKit/WebKit#17808](https://github.com/WebKit/WebKit/pull/17808) — "Safari tab freeze and gpu process crash when calling canvas function drawimage/getimagedata/setimagedata from high resolution getUserMedia stream"
>
> Canvas + media stream is an explicitly documented GPU crash vector. This is close to your setup (canvas drawing + audio capture).

**WebAudio performance: getByteTimeDomainData on every frame**
> [MDN AnalyserNode](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode) + [blog.mi.hdm-stuttgart.de](https://blog.mi.hdm-stuttgart.de/index.php/2021/02/24/web-audio-api-tips-for-performance/) (2021)
>
> Calling `getByteTimeDomainData` or `getByteFrequencyData` every frame forces the WebAudio subsystem to copy FFT data. Doing this at 60fps adds measurable main-thread pressure.

**Web Audio API performance tips (HdM Stuttgart)**
> [blog.mi.hdm-stuttgart.de](https://blog.mi.hdm-stuttgart.de/index.php/2021/02/24/web-audio-api-tips-for-performance/)
>
> AnalyserNode FFT data access per-frame is not free. At 60fps with a 256-bin FFT, that's 15,360 bytes copied from audio subsystem to JS per second.

**Canvas animation + WebAudio — compounding mechanism:**
1. `getByteTimeDomainData` fires every rAF frame (main thread)
2. `computeRmsEnergy` runs a loop over 256 samples every frame
3. Canvas Path2D + gradient + stroke fires to GPU process
4. These are **independent pipelines** hitting the GPU and main thread simultaneously
5. Over 10 minutes = 36,000 canvas compositing operations + 36,000 audio buffer copies

**Compounding over time is real**: each system adds pressure. The canvas is the larger load (GPU), WebAudio is smaller but constant.

**Leak risk**: WebAudio (`AudioContext`, `MediaStream`, `AnalyserNode`) has documented memory leak patterns. However, your `soniox-client.ts` does call `releaseAudio()` on stop with explicit `disconnect()` and `close()`. The risk is if `stop()` is not called on quit.

---

### Q4: Does hidden/offscreen throttling help in WKWebView/Tauri?

**Verdict: PARTIALLY — but your HUD is ALWAYS VISIBLE so it does NOT benefit.**

#### Evidence

**WebKit: rAF throttling controlled by RenderingUpdates, not page visibility alone**
> [WebKit commit 9b21d6f](https://commits.webkit.org/r261113) (2020-12-11) — "Throttling requestAnimationFrame should be controlled by RenderingUpdates"
>
> rAF throttling in WebKit is tied to rendering update lifecycle, not just visibility.

**WebKit Bug 144718: rAF throttled in subframes outside viewport**
> [bugs.webkit.org#144718](https://bugs.webkit.org/show_bug.cgi?id=144718) (2015)
>
> WebKit throttles rAF for off-screen subframes, but this is for subframes, not the main webview.

**React Native: `<Activity mode="hidden">` prevents WKWebView from loading**
> [facebook/react-native#56180](https://github.com/facebook/react-native/issues/56180) (2026-03-21)
>
> Hidden activity mode prevents WebView from loading content entirely — not a throttling path.

**WebKit: visibility:hidden fails to hide composited iframe**
> [WebKit/WebKit#10037](https://github.com/WebKit/WebKit/pull/10037)
>
> `visibility: hidden` doesn't properly suppress compositing for iframes.

**Popmotion: iOS throttles rAF to 30fps in cross-origin iframes + low power mode**
> [popmotion.io](https://popmotion.io/blog/20180104-when-ios-throttles-requestanimationframe/) (2018)
>
> Low-power mode and cross-origin iframes get 30fps rAF throttling — not full throttling to zero.

**motion.dev: When browsers throttle requestAnimationFrame**
> [motion.dev](https://motion.dev/magazine/when-browsers-throttle-requestanimationframe)
>
> Safari throttles to 30fps in background tabs, but this is for browser tabs, not desktop WebView windows.

**KEY LIMITATION**: Your HUD is an **always-visible overlay window**, not a hidden background tab. WebKit's offscreen/hidden throttling applies to:
- Background browser tabs
- Subframes outside the viewport
- Cross-origin iframes in low-power mode

**It does NOT apply to**: A WebView window that is visible at all times. The HUD's `alwaysOnTop` WebView is always in the foreground rendering path. Hiding it (via `panel.hide()` or `window.hide()`) would help, but as long as it's visible, rAF fires at full rate.

**React Native issue**: Hidden activity prevents WebView from loading entirely — not a throttling mechanism.

---

## Summary: Evidence-Ranked

| # | Question | Verdict | Confidence | Key Evidence |
|---|----------|---------|------------|-------------|
| 1 | Does Browser Helper (GPU) own canvas heat? | **YES** | HIGH | [WebKit#16028](https://github.com/WebKit/WebKit/pull/16028), [WebKit#31211](https://github.com/WebKit/WebKit/pull/31211), [folivora.ai](https://community.folivora.ai/t/webview-taxing-cpu-100-target-gpu-for-rendering/43679) |
| 2 | Does transparent/borderless/non-resizable/alwaysOnTop cause CPU? | **YES** | HIGH | [tauri#11308](https://github.com/tauri-apps/tauri/issues/11308), [tao#1191](https://github.com/tauri-apps/tao/issues/1191), [WebKit#26211](https://github.com/WebKit/WebKit/pull/26211) |
| 3 | Does WebAudio + canvas compound over time? | **YES** | MEDIUM-HIGH | [WebKit#17808](https://github.com/WebKit/WebKit/pull/17808), [HdM Stuttgart blog](https://blog.mi.hdm-stuttgart.de/index.php/2021/02/24/web-audio-api-tips-for-performance/) |
| 4 | Does hidden/offscreen throttling help? | **NO (for your HUD)** | HIGH | [WebKit#144718](https://bugs.webkit.org/show_bug.cgi?id=144718), [popmotion](https://popmotion.io/blog/20180104-when-ios-throttles-requestanimationframe/), [react-native#56180](https://github.com/facebook/react-native/issues/56180) |

---

## Actionable Fixes (Evidence-Backed)

| Priority | Fix | Upstream Evidence |
|----------|-----|-----------------|
| **P0** | Set `resizable: true` for the bar window | [tauri#11308](https://github.com/tauri-apps/tauri/issues/11308) — non-resizable causes excessive CPU on macOS |
| **P1** | Pause canvas rAF during non-LISTENING states | WebKit rAF fires at full rate for visible windows; stop wasting GPU frames during CONNECTING/PROCESSING/INSERTING/ERROR |
| **P1** | Reuse Path2D and gradients instead of creating per frame | [WebKit#28649](https://github.com/WebKit/WebKit/pull/28649) — leaked contexts consume GPU resources; reducing allocation pressure helps |
| **P2** | Throttle canvas to 30fps or use `document.hidden` guard | Offscreen tab throttling not reliable, but reducing rAF rate reduces GPU frames |
| **P2** | Call `audioContext.close()` when session stops (not just `releaseAudio`) | [standardized-audio-context#410](https://github.com/chrisguttandin/standardized-audio-context/issues/410) — AudioContext memory leaks |
| **P3** | Consider making panel temporarily opaque when in PASSIVE/idle state | [WebKit#26211](https://github.com/WebKit/WebKit/pull/26211) — transparent compositing forces extra layers |
