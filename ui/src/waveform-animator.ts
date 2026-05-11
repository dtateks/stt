/**
 * HUD waveform animator.
 *
 * Owns the RAF render loop, canvas context, layout cache, gradient cache,
 * smoothed-energy state, start-time anchor, and analyser sample buffer.
 *
 * Pure math (layout creation, RMS energy, beat intensity, cluster offset,
 * Y sampling, render-state thresholds) stays in `bar-render.ts`; this
 * factory only adds the stateful machinery around those helpers: when to
 * tick, when to invalidate caches, when to allocate a fresh sample buffer.
 *
 * Why a factory, not a class: matches the established pattern
 * (`createModelPicker`, `createShortcutRecorder`, `createSettingsDialog`,
 * `TemporaryApiKeyCache`) — caller passes the canvas + analyser getter,
 * gets back a tiny 4-method surface, never reaches into internal state.
 *
 * Load-bearing invariants preserved from the legacy inline implementation:
 *   - `waveformStartTime` is reset by both `start()` AND
 *     `drawStaticIdleFrame()` because the heartbeat cluster-offset math
 *     reads continuous elapsed-time from the last reset.
 *   - `smoothedEnergy` survives across start/stop cycles — the audio
 *     heartbeat is continuous across pauses.
 *   - Gradient cache invalidates on `stop()` AND on `resize()`; layout
 *     cache invalidates on `resize()` only.
 *   - `getContext("2d")` returning null (jsdom path) must not crash any
 *     entry point — match the legacy `if (!canvasCtx) return` guards.
 *   - `Uint8Array<ArrayBuffer>` generic stays explicit so TS 5.6+ accepts
 *     it as the `getByteTimeDomainData` argument.
 */
import {
  createWaveformLayout,
  type WaveformLayout,
  resizeCanvasWithContext,
  sampleWaveformY,
  computeRmsEnergy,
  computeAudioHeartbeatParams,
  computeBeatIntensity,
  computeHeartbeatClusterOffset,
  HEARTBEAT_IDLE_BPM,
  HEARTBEAT_IDLE_AMPLITUDE,
  HEARTBEAT_ENERGY_SMOOTHING,
  HEARTBEAT_GLOW_WIDTH,
  HEARTBEAT_MIN_AMPLITUDE,
} from "./bar-render.ts";

export interface WaveformAnimatorOptions {
  canvas: HTMLCanvasElement;
  /** Returns the live analyser, or null when no session is active. */
  getAnalyser: () => AnalyserNode | null;
}

export interface WaveformAnimator {
  /** Start the RAF render loop; idempotent — ignores duplicate calls. */
  start(): void;
  /** Cancel the loop, clear the canvas, invalidate gradient cache. */
  stop(): void;
  /**
   * Render a single static idle frame and exit. Used for visible non-audio
   * states (PROCESSING, INSERTING, etc.) where continuous animation is
   * thermal waste.
   */
  drawStaticIdleFrame(): void;
  /** Resize the backing canvas to its CSS box and invalidate caches. */
  resize(): void;
}

// Opacity bucketing granularity — gradients are rebuilt only when opacity
// crosses a bucket boundary, not on every sub-pixel energy change.
const GRADIENT_OPACITY_BUCKET_SIZE = 0.04;
const IDLE_HEARTBEAT_LINE_STYLE = "rgba(110, 117, 129, 0.65)";
const IDLE_HEARTBEAT_GLOW_STYLE = "rgba(110, 117, 129, 0.15)";

export function createWaveformAnimator(options: WaveformAnimatorOptions): WaveformAnimator {
  const { canvas, getAnalyser } = options;
  const canvasCtx = canvas.getContext("2d");

  let rafId: number | null = null;
  let waveformStartTime: number | null = null;
  let smoothedEnergy = 0;
  let layoutCache: WaveformLayout | null = null;
  let analyserDataBuffer: Uint8Array<ArrayBuffer> | null = null;

  let cachedGradientWidth = 0;
  let cachedLineOpacityBucket = -1;
  let cachedGlowOpacityBucket = -1;
  let cachedLineGradient: CanvasGradient | null = null;
  let cachedGlowGradient: CanvasGradient | null = null;

  function getLayout(width: number, height: number): WaveformLayout {
    if (
      layoutCache !== null
      && layoutCache.width === width
      && layoutCache.height === height
    ) {
      return layoutCache;
    }
    layoutCache = createWaveformLayout(width, height);
    return layoutCache;
  }

  function getSampleBuffer(analyser: AnalyserNode): Uint8Array<ArrayBuffer> {
    const nextLength = analyser.frequencyBinCount;
    if (analyserDataBuffer?.length === nextLength) {
      return analyserDataBuffer;
    }
    analyserDataBuffer = new Uint8Array(new ArrayBuffer(nextLength));
    return analyserDataBuffer;
  }

  function invalidateGradientCache(): void {
    cachedGradientWidth = 0;
    cachedLineOpacityBucket = -1;
    cachedGlowOpacityBucket = -1;
    cachedLineGradient = null;
    cachedGlowGradient = null;
  }

  function clearCanvas(): void {
    if (!canvasCtx) return;
    const dpr = window.devicePixelRatio || 1;
    canvasCtx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  }

  /**
   * Returns cached or fresh gradient pair for the audio heartbeat.
   * Rebuilds only when canvas width changes or opacity crosses a bucket
   * boundary — not on every frame.
   */
  function getAudioGradients(
    width: number,
    lineOpacity: number,
    glowOpacity: number,
  ): { lineGradient: CanvasGradient; glowGradient: CanvasGradient } {
    const lineBucket = Math.round(lineOpacity / GRADIENT_OPACITY_BUCKET_SIZE);
    const glowBucket = Math.round(glowOpacity / GRADIENT_OPACITY_BUCKET_SIZE);

    if (
      cachedLineGradient !== null
      && cachedGlowGradient !== null
      && cachedGradientWidth === width
      && cachedLineOpacityBucket === lineBucket
      && cachedGlowOpacityBucket === glowBucket
    ) {
      return { lineGradient: cachedLineGradient, glowGradient: cachedGlowGradient };
    }

    const bucketedLineOpacity = lineBucket * GRADIENT_OPACITY_BUCKET_SIZE;
    const bucketedGlowOpacity = glowBucket * GRADIENT_OPACITY_BUCKET_SIZE;

    const lineGradient = canvasCtx!.createLinearGradient(0, 0, width, 0);
    lineGradient.addColorStop(0, `rgba(255, 255, 255, ${bucketedLineOpacity})`);
    lineGradient.addColorStop(1, `rgba(200, 200, 200, ${bucketedLineOpacity * 0.85})`);

    const glowGradient = canvasCtx!.createLinearGradient(0, 0, width, 0);
    glowGradient.addColorStop(0, `rgba(255, 255, 255, ${bucketedGlowOpacity})`);
    glowGradient.addColorStop(1, `rgba(200, 200, 200, ${bucketedGlowOpacity * 0.8})`);

    cachedGradientWidth = width;
    cachedLineOpacityBucket = lineBucket;
    cachedGlowOpacityBucket = glowBucket;
    cachedLineGradient = lineGradient;
    cachedGlowGradient = glowGradient;

    return { lineGradient, glowGradient };
  }

  function drawHeartbeatTrace(
    layout: WaveformLayout,
    bpm: number,
    amplitude: number,
    strokeStyle: string | CanvasGradient,
    glowStyle: string | CanvasGradient | null,
  ): void {
    if (!canvasCtx) return;

    const elapsedMs = waveformStartTime !== null
      ? performance.now() - waveformStartTime
      : 0;
    const beatIntensity = computeBeatIntensity(elapsedMs, bpm);
    const clusterOffsetRatio = computeHeartbeatClusterOffset(elapsedMs, bpm, amplitude);

    canvasCtx.lineCap = "round";
    canvasCtx.lineJoin = "miter";
    const path = new Path2D();

    for (let i = 0; i < layout.pointCount; i++) {
      const t = i / (layout.pointCount - 1);
      const x = t * layout.width;
      const y = sampleWaveformY(
        t,
        layout.centerY,
        layout.maxAmplitude,
        amplitude,
        beatIntensity,
        clusterOffsetRatio,
      );

      if (i === 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
    }

    if (glowStyle !== null) {
      canvasCtx.strokeStyle = glowStyle;
      canvasCtx.lineWidth = HEARTBEAT_GLOW_WIDTH;
      canvasCtx.stroke(path);
    }

    canvasCtx.strokeStyle = strokeStyle;
    canvasCtx.lineWidth = layout.lineWidth;
    canvasCtx.stroke(path);
  }

  function drawIdleHeartbeat(layout: WaveformLayout): void {
    drawHeartbeatTrace(
      layout,
      HEARTBEAT_IDLE_BPM,
      HEARTBEAT_IDLE_AMPLITUDE,
      IDLE_HEARTBEAT_LINE_STYLE,
      IDLE_HEARTBEAT_GLOW_STYLE,
    );
  }

  function drawAudioHeartbeat(data: Uint8Array<ArrayBuffer>, layout: WaveformLayout): void {
    const rawEnergy = computeRmsEnergy(data);
    smoothedEnergy += (rawEnergy - smoothedEnergy) * HEARTBEAT_ENERGY_SMOOTHING;

    const { bpm, amplitude } = computeAudioHeartbeatParams(smoothedEnergy);
    const activeEnergy = Math.max(
      0,
      (amplitude - HEARTBEAT_MIN_AMPLITUDE) / (1 - HEARTBEAT_MIN_AMPLITUDE),
    );

    const glowOpacity = 0.05 + activeEnergy * 0.18;
    const lineOpacity = 0.36 + activeEnergy * 0.42;

    const { lineGradient, glowGradient } = getAudioGradients(
      layout.width,
      lineOpacity,
      glowOpacity,
    );

    drawHeartbeatTrace(layout, bpm, amplitude, lineGradient, glowGradient);
  }

  function tick(): void {
    rafId = requestAnimationFrame(tick);

    if (!canvasCtx) return;

    const analyser = getAnalyser();
    const dpr = window.devicePixelRatio || 1;
    const logicalWidth = canvas.width / dpr;
    const logicalHeight = canvas.height / dpr;
    const layout = getLayout(logicalWidth, logicalHeight);

    canvasCtx.clearRect(0, 0, logicalWidth, logicalHeight);

    if (!analyser) {
      drawIdleHeartbeat(layout);
      return;
    }

    const dataArray = getSampleBuffer(analyser);
    analyser.getByteTimeDomainData(dataArray);

    drawAudioHeartbeat(dataArray, layout);
  }

  function start(): void {
    if (rafId !== null) return;
    waveformStartTime = performance.now();
    tick();
  }

  function stop(): void {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    waveformStartTime = null;
    invalidateGradientCache();
    clearCanvas();
  }

  function drawStaticIdleFrame(): void {
    if (!canvasCtx) return;

    waveformStartTime = performance.now();
    const dpr = window.devicePixelRatio || 1;
    const logicalWidth = canvas.width / dpr;
    const logicalHeight = canvas.height / dpr;
    const layout = getLayout(logicalWidth, logicalHeight);

    canvasCtx.clearRect(0, 0, logicalWidth, logicalHeight);
    drawIdleHeartbeat(layout);
  }

  function resize(): void {
    resizeCanvasWithContext(canvas, canvasCtx, window.devicePixelRatio || 1);
    layoutCache = null;
    invalidateGradientCache();
  }

  return { start, stop, drawStaticIdleFrame, resize };
}
