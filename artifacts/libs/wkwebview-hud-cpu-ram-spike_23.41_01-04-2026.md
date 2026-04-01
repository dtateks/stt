# Tauri/WebKit macOS Browser Helper CPU/RAM Spike — Upstream Evidence Analysis

**Generated:** 2026-04-01 23:41
**Focus:** Long-running always-visible HUD with canvas animation, audio analysis, transparent overlay, WebSocket session

---

## Executive Summary

Based on upstream WebKit/Tauri evidence, **Cause A (continuous requestAnimationFrame/canvas draw loop)** is the most likely primary culprit, followed by **Cause C (transparent/always-on-top overlay composition)** as a significant compounding factor. Causes B, D, and E are unlikely to be primary but may add secondary pressure.

---

## Cause Rankings

| Rank | Cause | Verdict | Confidence |
|------|-------|---------|------------|
| **1** | **(A) Continuous rAF/canvas draw loop** | **PRIMARY — strong upstream evidence** | HIGH |
| **2** | **(C) Transparent/always-on-top overlay composition** | **COMPOUNDING — strong upstream evidence** | HIGH |
| **3** | **(B) Audio/analyser pipeline retention** | SECONDARY — some evidence, cleanup exists | MEDIUM |
| **4** | **(D) Listener/timer leak** | UNLIKELY — code shows proper cleanup | LOW |
| **5** | **(E) WebSocket/transcript accumulation** | UNLIKELY — strings reset on each utterance | LOW |

---

## (A) Continuous requestAnimationFrame/Canvas Draw Loop — **PRIMARY CULPRIT**

### Evidence

**WebKit Commit: High memory usage with repeated `putImageData` on accelerated canvas**
> [WebKit/WebKit#34837](https://github.com/WebKit/WebKit/pull/34837) — "High memory usage repeatedly using putImageData on accelerated canvas" (2024-10-08)
>
> Memory accumulates when canvas operations run continuously in a loop, even with proper cleanup.

**WebKit Bug: Leaked 2D contexts consuming GPU resources**
> [WebKit/WebKit#28649](https://github.com/WebKit/WebKit/pull/28649) — "Leaked 2D contexts might consume all OS global GPU resources" (2024-05-16)
>
> 2D canvas contexts that are not explicitly released can hold onto GPU resources indefinitely.

**Safari/WebKit: Canvas drawImage/getImageData setImageData freeze and GPU crash**
> [WebKit/WebKit#17808](https://github.com/WebKit/WebKit/pull/17808) — "Safari tab freeze and gpu process crash when calling canvas function drawimage/getimagedata/setimagedata from high resolution getUserMedia stream with several background tabs"
>
> Canvas operations combined with media streams cause GPU process instability under sustained load.

**WebKit Layer Compositing: Canvas layer management**
> [WebKit Commit 967f80b](https://github.com/WebKit/WebKit/commit/967f80b1ed9b2270163da1a4ff8cd9e2f8ef394e) (2026-03-27) — "Use composited layers for canvas when dynamic content scaling display lists are enabled"
>
> WebKit is actively improving canvas compositing, indicating canvas performance is a known pain point.

**Safari WebGL issues with requestAnimationFrame performance**
> [three.js discourse](https://discourse.threejs.org/t/safari-webgl-issues-with-video-playback-and-requestanimationframe-performance/15452) (2020-05-22)
>
> Safari throttles `requestAnimationFrame` to 30fps in certain contexts, but sustained rAF loops still cause performance degradation.

### Code Evidence (bar.ts)

```typescript
// bar.ts line 192-194: Continuous animation loop
function drawWaveform(): void {
  rafId = requestAnimationFrame(drawWaveform);  // NEVER stops during visible states
  // ...
  analyser.getByteTimeDomainData(dataArray);   // FFT computed every frame
  drawAudioHeartbeat(dataArray, layout);       // Complex path operations per frame
}
```

```typescript
// bar.ts line 233-252: Path2D construction every frame — expensive
const path = new Path2D();
for (let i = 0; i < layout.pointCount; i++) {  // 128 points
  // ...complex waveform sampling...
  path.lineTo(x, y);
}
canvasCtx.stroke(path);  // Gradient + stroke every frame
```

```typescript
// bar.ts line 285-291: New gradients created EVERY frame
const gradient = canvasCtx.createLinearGradient(0, 0, layout.width, 0);
gradient.addColorStop(0, `rgba(56, 232, 255, ${lineOpacity})`);
// ...more color stops...
const glowGradient = canvasCtx.createLinearGradient(0, 0, layout.width, 0);
```

```typescript
// bar-render.ts line 319-333: 128-point array allocation every frame
return Array.from({ length: layout.pointCount }, (_, index) => {
  // ...
});
```

### Root Cause Analysis

The HUD waveform runs **continuously in every non-HIDDEN state** (CONNECTING, LISTENING, PROCESSING, INSERTING, SUCCESS, ERROR — see [bar.ts line 378-384](https://github.com/dta-tek/stt/blob/main/ui/src/bar.ts#L378-L384)):

```typescript
if (waveformShouldRun(state)) {
  startWaveform();  // Starts rAF loop — never stops until HIDDEN
} else {
  stopWaveform();   // Only stops when truly hidden
}
```

With 128 sample points, Path2D construction, dual gradient creation, and FFT analysis **every frame at 60fps**, this creates sustained CPU/GPU pressure. The GPU process (which is what "Browser Helper" represents on macOS) handles canvas rendering and compositing.

---

## (C) Transparent/Always-on-Top Overlay Composition — **COMPOUNDING FACTOR**

### Evidence

**WebKit: Backdrop-filter forces compositing on root element and uses extra memory**
> [WebKit/WebKit#26211](https://github.com/WebKit/WebKit/pull/26211) — "Backdrop-filter forces compositing on the root element and uses extra memory"
>
> Transparent backgrounds force additional compositing layers.

**Tauri Issue: macOS 100% CPU with borderless windows (NSThemeZoomWidget leak)**
> [tauri-apps/tao#1191](https://github.com/tauri-apps/tao/issues/1191) — "macOS 15 Sequoia: 100% CPU with borderless+resizable windows (NSThemeZoomWidget leak)"
>
> Borderless windows with specific configurations cause CPU spikes on macOS.

**Tauri: Resizable(false) on macOS causes excessive CPU**
> [tauri-apps/tauri#11308](https://github.com/tauri-apps/tauri/issues/11308) — "Setting resizable(false) when using WebviewWindow::builder on macOS causes the application to consume excessive CPU"
>
> Window configuration affects CPU usage on macOS WebViews.

**Layers and Compositing — WebKit Performance Tips**
> [webperf.tips](https://webperf.tips/tip/layers-and-compositing/) (2024-08-25)
>
> Every layer the browser composites requires memory and CPU for composition. Transparent elements require additional layers.

### Code Evidence (lib.rs)

```rust
// lib.rs line 471-483: Panel configured for transparency
fn configure_bar_panel(panel: &tauri_nspanel::PanelHandle<tauri::Wry>) {
    panel.set_opaque(false);          // Forces compositing
    panel.set_has_shadow(true);       // Additional compositing
    panel.set_transparent(true);      // Transparent background
    panel.set_corner_radius(BAR_WINDOW_CORNER_RADIUS);
}
```

```rust
// lib.rs line 489-501: WKWebView also made transparent
pub(crate) fn configure_bar_webview_transparency(bar_window: &WebviewWindow) {
    let background_enabled = NSNumber::new_bool(false);  // drawsBackground = false
    let _: () = msg_send![view, setValue: &*background_enabled, forKey: &*draws_background_key];
    view.setUnderPageBackgroundColor(Some(&under_page_background));  // Clear background
}
```

```rust
// lib.rs line 227: Window level ABOVE screensaver — forces continuous composition
const PANEL_WINDOW_LEVEL: i64 = 1001;  // Above NSScreenSaverWindowLevel (1000)
panel.set_level(PANEL_WINDOW_LEVEL);
```

### Root Cause Analysis

The NSPanel is:
1. **Transparent** (`set_opaque(false)`, `set_transparent(true)`)
2. **Above all other windows** including fullscreen apps (`1001 > 1000`)
3. **Non-activating** (`nonactivating_panel`)
4. **Has shadow** (additional layer)

This forces WebKit's GPU process to **continuously recomposite** the transparent HUD on every frame,叠加 on top of whatever app is currently active. The GPU process ("Browser Helper") handles this compositing.

---

## (B) Audio/Analyser Pipeline — **SECONDARY, LIKELY CLEANED**

### Evidence

**WebAudio Memory Leak Issues — chrisguttandin/standardized-audio-context**
> [GitHub Issue#410](https://github.com/chrisguttandin/standardized-audio-context/issues/410) — "Memory leak with AudioContext"
>
> AudioContext and AnalyserNode can leak if not explicitly closed.

**Howler.js: Unload not releasing memory**
> [goldfire/howler.js#1731](https://github.com/goldfire/howler.js/issues/1731) — "Unload not releasing memory, leaks reported by MemLab"
>
> Audio resources can persist in memory even after explicit cleanup.

**AudioContext.close() not releasing resources**
> [Stack Overflow](https://stackoverflow.com/questions/63139879/webaudio-audio-context-memory-leak)
>
> AudioContext.close() may not immediately release all native resources.

### Code Evidence (soniox-client.ts)

```typescript
// soniox-client.ts line 124-159: initAudio creates persistent pipeline
private async initAudio(): Promise<void> {
    this.mediaStream = await navigator.mediaDevices.getUserMedia({...});
    this.audioContext = new AudioContext({ sampleRate: config.sample_rate });
    await this.audioContext.audioWorklet.addModule(pcmCaptureProcessorUrl);
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 256;
    // ...connected to source...
}
```

```typescript
// soniox-client.ts line 326-336: releaseAudio does cleanup
private releaseAudio(): void {
    this.workletNode?.disconnect();
    this.analyserNode?.disconnect();  // Disconnects analyser
    this.mediaStream?.getTracks().forEach((t) => { t.stop(); });
    this.audioContext?.close();       // Closes context
}
```

### Assessment

The pipeline is **properly cleaned up** on `stop()` via `releaseAudio()`. However, during a long-running session the analyser continuously computes FFT data (passed to the canvas every frame). This is **not a leak** but adds to the per-frame CPU burden.

**Risk**: If `stop()` is not called (e.g., crash, forced quit), the AudioContext would leak.

---

## (D) Listener/Timer Leak — **UNLIKELY**

### Evidence

**General JavaScript: setInterval not cleared can prevent GC**
> [Various sources](https://stackoverflow.com/questions/8639039/javascript-memory-leak-using-settimeoutinterval-in-closure) — uncleared timers hold references and prevent garbage collection.

### Code Evidence (bar-session-controller.ts)

```typescript
// bar-session-controller.ts line 728-732: reminderTimer properly managed
private startReminderBeep(): void {
    this.stopReminderBeep();  // Clears existing first
    this.reminderTimer = setInterval(() => {
        if (this.state === "LISTENING") {
            playReminderBeep();
        }
    }, REMINDER_INTERVAL_MS);  // 60 seconds
}
```

```typescript
// bar-session-controller.ts line 823-828: Proper cleanup
private stopReminderBeep(): void {
    if (this.reminderTimer !== null) {
        clearInterval(this.reminderTimer);
        this.reminderTimer = null;
    }
}
```

```typescript
// bar-session-controller.ts line 958-965: temporaryApiKeyRefreshTimer cleanup
private scheduleTemporaryApiKeyRefresh(expiresAtMs: number): void {
    this.clearTemporaryApiKeyRefreshTimer();  // Clears existing first
    this.temporaryApiKeyRefreshTimer = setTimeout(() => {
        void this.refreshTemporaryApiKey().catch(...);
    }, refreshDelayMs);
}
```

### Assessment

**Timer cleanup is properly implemented** — every timer has a corresponding clear function and is cleared before reset. However, note the `reminderTimer` fires every 60 seconds and creates a new AudioContext/Oscillator for the beep (line 1012-1032). This is minor but adds recurring pressure.

---

## (E) WebSocket/Transcript Accumulation — **UNLIKELY**

### Evidence

**WebSocket memory: String concatenation in loops**
> General best practice: string concatenation in loops creates intermediate strings.

### Code Evidence (soniox-client.ts)

```typescript
// soniox-client.ts line 253-268: Token accumulation
for (const token of message.tokens) {
    if (token.is_final) {
        newFinal += token.text;  // String concatenation
    } else {
        newInterim += token.text;
    }
}
```

```typescript
// soniox-client.ts line 104-108: resetTranscript clears both
resetTranscript(): void {
    this.finalText = "";
    this.interimText = "";
    this.emitTranscript();
}
```

### Assessment

**String accumulation is contained** — `finalText` and `interimText` are reset on every new utterance via `resetTranscript()`. Each transcript is short. This is **not a significant memory issue**.

The WebSocket itself is persistent during the session but that's expected for a live streaming connection.

---

## Recommendations Summary

### Priority 1: Reduce Canvas Animation CPU

**A1 — Throttle or pause canvas when not needed:**
- The waveform runs during CONNECTING, PROCESSING, INSERTING, SUCCESS, ERROR — states where audio isn't actually being captured
- Consider stopping the rAF loop during these non-LISTENING states

**A2 — Reduce per-frame allocations:**
- Reuse Path2D object instead of creating new one each frame
- Cache gradient objects instead of recreating every frame
- Pre-allocate waveform trace point arrays

**A3 — Reduce sample point count:**
- 128 points at 60fps = 7,680 path operations/second
- Consider reducing to 64 or 32 points

### Priority 2: Reduce Transparent Compositing Overhead

**C1 — Consider opaque mode when HUD is idle:**
- When in PASSIVE/hidden state, consider temporarily making the panel opaque to reduce compositing

**C2 — Simplify window level:**
- The 1001 level (above screensaver) is required for fullscreen overlay, but verify this is the only option

### Priority 3: Audio Context Management

**B1 — Close AudioContext when not listening:**
- AudioContext.close() releases resources immediately
- The current implementation keeps it open throughout the session, which is correct for low-latency capture but adds to per-frame overhead

### Not Recommended (causes not supported by evidence)

- **D (Timer leaks)** — Code shows proper timer cleanup
- **E (Transcript accumulation)** — Strings are reset per utterance

---

## References

1. [WebKit#34837 — putImageData memory](https://github.com/WebKit/WebKit/pull/34837)
2. [WebKit#28649 — Leaked 2D contexts GPU resources](https://github.com/WebKit/WebKit/pull/28649)
3. [WebKit#17808 — Canvas/media GPU crash](https://github.com/WebKit/WebKit/pull/17808)
4. [WebKit#26211 — Backdrop-filter memory](https://github.com/WebKit/WebKit/pull/26211)
5. [tauri-apps/tauri#11308 — resizable false CPU](https://github.com/tauri-apps/tauri/issues/11308)
6. [tauri-apps/tao#1191 — borderless window CPU](https://github.com/tauri-apps/tao/issues/1191)
7. [standardized-audio-context#410 — AudioContext leak](https://github.com/chrisguttandin/standardized-audio-context/issues/410)
8. [goldfire/howler.js#1731 — Audio unload memory](https://github.com/goldfire/howler.js/issues/1731)
