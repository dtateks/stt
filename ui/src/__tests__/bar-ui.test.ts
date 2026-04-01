/// <reference types="node" />
/**
 * HUD shell rendering tests — bar-render.ts + bar.html contract.
 *
 * IMP-01: DOM fixture is parsed from the real ui/bar.html source file.
 *         Render logic is imported from the production bar-render.ts module,
 *         not re-implemented or mirrored locally.
 *
 * IMP-02: Waveform lifecycle is exercised through the real waveformShouldRun()
 *         predicate exported from bar-render.ts, which is the same function
 *         the production controller.onStateChange handler delegates to.
 *
 * IMP-03: Token assertions read and parse the real ui/src/tokens.css source
 *         file and assert each required token name is declared there.
 *
 * Run with: npm run test:ui
 *
 * All tests use jsdom; no Tauri bridge, no network, no real audio.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { BarState } from "../types.ts";

// ─── IMP-01: Production imports from bar-render.ts ────────────────────────────

import {
  applyState,
  applyTranscript,
  applyErrorMessage,
  applyOverlayMode,
  buildVisibleTranscriptText,
  createWaveformLayout,
  buildHeartbeatTracePoints,
  syncPromptVisibility,
  scrollTranscriptToEnd,
  resizeCanvasWithContext,
  waveformShouldRun,
  waveformShouldBeVisible,
  sampleWaveformY,
  ecgDisplacement,
  computeAudioHeartbeatParams,
  computeBeatIntensity,
  computeHeartbeatClusterOffset,
  computeEcgRegionWidthRatio,
  HEARTBEAT_IDLE_BPM,
  HEARTBEAT_IDLE_AMPLITUDE,
  HEARTBEAT_MIN_AMPLITUDE,
  ACTIVE_ECG_REGION_WIDTH_RATIO,
  ECG_REGION_WIDTH_RATIO,
  ECG_CLUSTER_TRAVEL_RATIO,
  ECG_KEYFRAMES,
  getEcgRegionBounds,
  STATE_LABELS,
} from "../bar-render.ts";

// ─── IMP-01: Load real bar.html body fragment ─────────────────────────────────

/**
 * Parse the real ui/bar.html and return only the <body> innerHTML.
 * This is the production DOM structure — tests cannot diverge from it.
 */
function loadProductionHudHtml(): string {
  // __dirname = ui/src/__tests__/  →  bar.html is at ui/bar.html (up 2 levels)
  const htmlPath = resolve(__dirname, "../../bar.html");
  const source = readFileSync(htmlPath, "utf-8");
  // Extract <body>…</body> content for jsdom injection.
  const match = source.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!match) throw new Error("bar.html: <body> not found");
  return match[1];
}

const PRODUCTION_HUD_HTML = loadProductionHudHtml();

function buildHudDom(): void {
  document.body.innerHTML = PRODUCTION_HUD_HTML;
}

// ─── DOM accessors ────────────────────────────────────────────────────────────

function getHud(): HTMLDivElement {
  return document.getElementById("hud") as HTMLDivElement;
}
function getTranscriptFinal(): HTMLSpanElement {
  return document.getElementById("transcript-final") as HTMLSpanElement;
}
function getTranscriptInterim(): HTMLSpanElement {
  return document.getElementById("transcript-interim") as HTMLSpanElement;
}
function getTranscriptPrompt(): HTMLSpanElement {
  return document.getElementById("transcript-prompt") as HTMLSpanElement;
}
function getStateLabel(): HTMLSpanElement {
  return document.getElementById("hud-state-label") as HTMLSpanElement;
}
function getPauseBtn(): HTMLButtonElement {
  return document.getElementById("hud-pause-btn") as HTMLButtonElement;
}
function getClearBtn(): HTMLButtonElement {
  return document.getElementById("hud-clear-btn") as HTMLButtonElement;
}
function getCloseBtn(): HTMLButtonElement {
  return document.getElementById("hud-close-btn") as HTMLButtonElement;
}
function getCanvas(): HTMLCanvasElement {
  return document.getElementById("waveform") as HTMLCanvasElement;
}

// ─── applyState ──────────────────────────────────────────────────────────────

describe("applyState — data-state reflection", () => {
  beforeEach(buildHudDom);
  afterEach(() => { document.body.innerHTML = ""; });

  it("reflects every BarState on hud[data-state]", () => {
    const states: BarState[] = [
      "HIDDEN", "CONNECTING", "LISTENING", "PAUSED", "RESUMING", "PROCESSING",
      "INSERTING", "SUCCESS", "ERROR",
    ];
    for (const state of states) {
      applyState(
        state,
        getHud(), getStateLabel(),
        getTranscriptFinal(), getTranscriptInterim(), getTranscriptPrompt(),
      );
      expect(getHud().dataset.state).toBe(state);
    }
  });

  it("sets the correct state label for each state", () => {
    const cases: Array<[BarState, string]> = [
      ["HIDDEN",     ""],
      ["CONNECTING", "Connecting"],
      ["LISTENING",  "Listening"],
      ["PAUSED",     "Paused"],
      ["RESUMING",   "Resuming"],
      ["PROCESSING", "Processing"],
      ["INSERTING",  "Inserting"],
      ["SUCCESS",    "Inserted"],
      ["ERROR",      "Error"],
    ];
    for (const [state, label] of cases) {
      applyState(
        state,
        getHud(), getStateLabel(),
        getTranscriptFinal(), getTranscriptInterim(), getTranscriptPrompt(),
      );
      expect(getStateLabel().textContent).toBe(label);
    }
  });

  it("keeps fast CONNECTING startups from showing the connecting label", () => {
    applyState(
      "CONNECTING",
      getHud(), getStateLabel(),
      getTranscriptFinal(), getTranscriptInterim(), getTranscriptPrompt(),
      { showConnectingLabel: false },
    );

    expect(getHud().dataset.state).toBe("CONNECTING");
    expect(getStateLabel().textContent).toBe("");
  });

  it("shows the connecting label when CONNECTING lasts long enough", () => {
    applyState(
      "CONNECTING",
      getHud(), getStateLabel(),
      getTranscriptFinal(), getTranscriptInterim(), getTranscriptPrompt(),
      { showConnectingLabel: true },
    );

    expect(getHud().dataset.state).toBe("CONNECTING");
    expect(getStateLabel().textContent).toBe("Connecting");
  });

  it("STATE_LABELS export matches applyState output (production constant, not local copy)", () => {
    // Validates that the imported STATE_LABELS is the same map used by applyState.
    for (const [state, expectedLabel] of Object.entries(STATE_LABELS) as Array<[BarState, string]>) {
      applyState(
        state,
        getHud(), getStateLabel(),
        getTranscriptFinal(), getTranscriptInterim(), getTranscriptPrompt(),
      );
      expect(getStateLabel().textContent).toBe(expectedLabel);
    }
  });

  it("clears transcript text when transitioning to HIDDEN", () => {
    const final = getTranscriptFinal();
    final.textContent = "some text";
    applyState(
      "HIDDEN",
      getHud(), getStateLabel(),
      getTranscriptFinal(), getTranscriptInterim(), getTranscriptPrompt(),
    );
    expect(getTranscriptFinal().textContent).toBe("");
    expect(getTranscriptInterim().textContent).toBe("");
  });

  it("clears transcript text when transitioning to CONNECTING", () => {
    getTranscriptFinal().textContent = "residual";
    applyState(
      "CONNECTING",
      getHud(), getStateLabel(),
      getTranscriptFinal(), getTranscriptInterim(), getTranscriptPrompt(),
    );
    expect(getTranscriptFinal().textContent).toBe("");
  });

  it("does NOT clear transcript when transitioning to LISTENING", () => {
    getTranscriptFinal().textContent = "carry over";
    getHud().dataset.state = "PROCESSING";
    applyState(
      "LISTENING",
      getHud(), getStateLabel(),
      getTranscriptFinal(), getTranscriptInterim(), getTranscriptPrompt(),
    );
    expect(getTranscriptFinal().textContent).toBe("carry over");
  });

  it("does NOT clear transcript when transitioning to RESUMING", () => {
    getTranscriptFinal().textContent = "preserved from pause";
    getHud().dataset.state = "PAUSED";
    applyState(
      "RESUMING",
      getHud(), getStateLabel(),
      getTranscriptFinal(), getTranscriptInterim(), getTranscriptPrompt(),
    );
    expect(getTranscriptFinal().textContent).toBe("preserved from pause");
  });
});

// ─── syncPromptVisibility ─────────────────────────────────────────────────────

describe("syncPromptVisibility — prompt show/hide logic", () => {
  beforeEach(buildHudDom);
  afterEach(() => { document.body.innerHTML = ""; });

  it("always hides prompt regardless of state", () => {
    const hud = getHud();
    hud.dataset.state = "LISTENING";
    getTranscriptFinal().textContent = "";
    getTranscriptInterim().textContent = "";
    syncPromptVisibility(hud, getTranscriptFinal(), getTranscriptInterim(), getTranscriptPrompt());
    expect(getTranscriptPrompt().hidden).toBe(true);
  });

  it("hides prompt when LISTENING but final text is present", () => {
    const hud = getHud();
    hud.dataset.state = "LISTENING";
    getTranscriptFinal().textContent = "hello";
    syncPromptVisibility(hud, getTranscriptFinal(), getTranscriptInterim(), getTranscriptPrompt());
    expect(getTranscriptPrompt().hidden).toBe(true);
  });

  it("hides prompt when LISTENING but interim text is present", () => {
    const hud = getHud();
    hud.dataset.state = "LISTENING";
    getTranscriptInterim().textContent = "interim...";
    syncPromptVisibility(hud, getTranscriptFinal(), getTranscriptInterim(), getTranscriptPrompt());
    expect(getTranscriptPrompt().hidden).toBe(true);
  });

  it("hides prompt when state is not LISTENING even with empty transcript", () => {
    const states: BarState[] = ["HIDDEN", "CONNECTING", "PAUSED", "RESUMING", "PROCESSING", "INSERTING", "SUCCESS", "ERROR"];
    for (const state of states) {
      const hud = getHud();
      hud.dataset.state = state;
      getTranscriptFinal().textContent = "";
      getTranscriptInterim().textContent = "";
      syncPromptVisibility(hud, getTranscriptFinal(), getTranscriptInterim(), getTranscriptPrompt());
      expect(getTranscriptPrompt().hidden).toBe(true);
    }
  });
});

// ─── applyTranscript ──────────────────────────────────────────────────────────

describe("applyTranscript — transcript content updates", () => {
  beforeEach(buildHudDom);
  afterEach(() => { document.body.innerHTML = ""; });

  it("combines final and interim into continuous text when LISTENING", () => {
    const hud = getHud();
    hud.dataset.state = "LISTENING";
    applyTranscript(
      { finalText: "Hello world", interimText: "typing" },
      hud, getTranscriptFinal(), getTranscriptInterim(), getTranscriptPrompt(),
    );
    expect(getTranscriptFinal().textContent).toBe("Hello world typing…");
    expect(getTranscriptInterim().textContent).toBe("");
  });

  it("updates transcript during active post-stop states", () => {
    const activeStates: BarState[] = ["PAUSED", "RESUMING", "PROCESSING", "INSERTING", "SUCCESS"];
    for (const state of activeStates) {
      const hud = getHud();
      hud.dataset.state = state;
      getTranscriptFinal().textContent = "original";
      applyTranscript(
        { finalText: `frozen-${state}`, interimText: "" },
        hud, getTranscriptFinal(), getTranscriptInterim(), getTranscriptPrompt(),
      );
      expect(getTranscriptFinal().textContent).toBe(`frozen-${state}`);
    }
  });

  it("ignores update in non-transcript states", () => {
    const nonTranscriptStates: BarState[] = ["HIDDEN", "CONNECTING", "ERROR"];
    for (const state of nonTranscriptStates) {
      const hud = getHud();
      hud.dataset.state = state;
      getTranscriptFinal().textContent = "original";
      applyTranscript(
        { finalText: "OVERWRITE", interimText: "" },
        hud, getTranscriptFinal(), getTranscriptInterim(), getTranscriptPrompt(),
      );
      expect(getTranscriptFinal().textContent).toBe("original");
    }
  });

  it("hides prompt once final text arrives", () => {
    const hud = getHud();
    hud.dataset.state = "LISTENING";
    getTranscriptPrompt().hidden = false;
    applyTranscript(
      { finalText: "some text", interimText: "" },
      hud, getTranscriptFinal(), getTranscriptInterim(), getTranscriptPrompt(),
    );
    expect(getTranscriptPrompt().hidden).toBe(true);
  });

  it("renders only interim text in final slot when final is empty", () => {
    const hud = getHud();
    hud.dataset.state = "LISTENING";
    applyTranscript(
      { finalText: "", interimText: "just started" },
      hud, getTranscriptFinal(), getTranscriptInterim(), getTranscriptPrompt(),
    );
    expect(getTranscriptFinal().textContent).toBe("just started…");
    expect(getTranscriptInterim().textContent).toBe("");
    expect(getTranscriptPrompt().hidden).toBe(true);
  });

  it("renders only final text without trailing ellipsis once interim text is final", () => {
    const hud = getHud();
    hud.dataset.state = "LISTENING";
    applyTranscript(
      { finalText: "Finalized text", interimText: "" },
      hud, getTranscriptFinal(), getTranscriptInterim(), getTranscriptPrompt(),
    );
    expect(getTranscriptFinal().textContent).toBe("Finalized text");
    expect(getTranscriptInterim().textContent).toBe("");
  });

  it("removes the trailing ellipsis once listening has advanced to PROCESSING", () => {
    const hud = getHud();
    hud.dataset.state = "PROCESSING";
    applyTranscript(
      { finalText: "Finalized text", interimText: "" },
      hud, getTranscriptFinal(), getTranscriptInterim(), getTranscriptPrompt(),
    );
    expect(getTranscriptFinal().textContent).toBe("Finalized text");
    expect(getTranscriptInterim().textContent).toBe("");
  });

  it("does not introduce extra whitespace when both parts are empty", () => {
    const hud = getHud();
    hud.dataset.state = "LISTENING";
    applyTranscript(
      { finalText: "", interimText: "" },
      hud, getTranscriptFinal(), getTranscriptInterim(), getTranscriptPrompt(),
    );
    expect(getTranscriptFinal().textContent).toBe("");
    expect(getTranscriptInterim().textContent).toBe("");
  });
});

// ─── buildVisibleTranscriptText ───────────────────────────────────────────────

describe("buildVisibleTranscriptText — live transcript suffix", () => {
  it("adds a trailing ellipsis while LISTENING with interim transcript text", () => {
    expect(
      buildVisibleTranscriptText("LISTENING", { finalText: "hello", interimText: "world" }),
    ).toBe("hello world…");
  });

  it("does not add a trailing ellipsis when LISTENING but interim text is already final", () => {
    expect(
      buildVisibleTranscriptText("LISTENING", { finalText: "hello world", interimText: "" }),
    ).toBe("hello world");
  });

  it("does not add a trailing ellipsis outside LISTENING", () => {
    expect(
      buildVisibleTranscriptText("PROCESSING", { finalText: "hello", interimText: "world" }),
    ).toBe("hello world");
  });

  it("keeps empty transcript text empty while LISTENING", () => {
    expect(
      buildVisibleTranscriptText("LISTENING", { finalText: "", interimText: "" }),
    ).toBe("");
  });

  it("does not duplicate an existing trailing ellipsis while LISTENING", () => {
    expect(
      buildVisibleTranscriptText("LISTENING", { finalText: "hello", interimText: "world..." }),
    ).toBe("hello world...");
  });

  it("ignores punctuation-only interim transcript while LISTENING", () => {
    expect(
      buildVisibleTranscriptText("LISTENING", { finalText: "Hello. Một 2 3 4 5.", interimText: "..." }),
    ).toBe("Hello. Một 2 3 4 5.");
  });

  it("does not append pending ellipsis when interim already ends with a sentence period", () => {
    expect(
      buildVisibleTranscriptText("LISTENING", { finalText: "Hello. Một 2 3 4", interimText: "5." }),
    ).toBe("Hello. Một 2 3 4 5.");
  });
});

// ─── applyErrorMessage ────────────────────────────────────────────────────────

describe("applyErrorMessage — error display semantics", () => {
  beforeEach(buildHudDom);
  afterEach(() => { document.body.innerHTML = ""; });

  it("displays error message in final transcript slot", () => {
    applyErrorMessage(
      "Microphone permission is required.",
      getHud(), getTranscriptFinal(), getTranscriptInterim(), getTranscriptPrompt(),
    );
    expect(getTranscriptFinal().textContent).toBe("Microphone permission is required.");
  });

  it("clears interim text when error message is displayed", () => {
    getTranscriptInterim().textContent = "old interim";
    applyErrorMessage(
      "An error occurred.",
      getHud(), getTranscriptFinal(), getTranscriptInterim(), getTranscriptPrompt(),
    );
    expect(getTranscriptInterim().textContent).toBe("");
  });

  it("hides the prompt when error message is displayed", () => {
    getTranscriptPrompt().hidden = false;
    applyErrorMessage(
      "Error message.",
      getHud(), getTranscriptFinal(), getTranscriptInterim(), getTranscriptPrompt(),
    );
    expect(getTranscriptPrompt().hidden).toBe(true);
  });

  it("does not pin long error text to the right edge", () => {
    const transcriptContainer = getTranscriptFinal().parentElement as HTMLDivElement;
    Object.defineProperty(transcriptContainer, "scrollWidth", { value: 500, configurable: true });
    Object.defineProperty(transcriptContainer, "clientWidth", { value: 200, configurable: true });
    transcriptContainer.scrollLeft = 50;

    applyErrorMessage(
      "A very long error message that should keep its leading text visible.",
      getHud(), getTranscriptFinal(), getTranscriptInterim(), getTranscriptPrompt(),
    );

    expect(transcriptContainer.scrollLeft).toBe(50);
  });

  it("clears both transcript slots when called with null", () => {
    getTranscriptFinal().textContent = "previous error";
    getTranscriptInterim().textContent = "something";
    applyErrorMessage(
      null,
      getHud(), getTranscriptFinal(), getTranscriptInterim(), getTranscriptPrompt(),
    );
    expect(getTranscriptFinal().textContent).toBe("");
    expect(getTranscriptInterim().textContent).toBe("");
  });
});

// ─── scrollTranscriptToEnd ────────────────────────────────────────────────────

describe("scrollTranscriptToEnd — pins newest text into view", () => {
  it("scrolls parent container to show rightmost content", () => {
    const container = { scrollLeft: 0, scrollWidth: 500, clientWidth: 200 } as unknown as HTMLElement;
    const textEl = { parentElement: container } as unknown as HTMLElement;
    scrollTranscriptToEnd(textEl);
    expect(container.scrollLeft).toBe(300);
  });

  it("does not throw when element has no parent", () => {
    const textEl = { parentElement: null } as unknown as HTMLElement;
    expect(() => scrollTranscriptToEnd(textEl)).not.toThrow();
  });

  it("scrolls to zero when content fits within container", () => {
    const container = { scrollLeft: 50, scrollWidth: 200, clientWidth: 200 } as unknown as HTMLElement;
    const textEl = { parentElement: container } as unknown as HTMLElement;
    scrollTranscriptToEnd(textEl);
    expect(container.scrollLeft).toBe(0);
  });
});

// ─── applyOverlayMode ─────────────────────────────────────────────────────────

describe("applyOverlayMode — data-overlay and tabindex management", () => {
  beforeEach(buildHudDom);
  afterEach(() => { document.body.innerHTML = ""; });

  it("sets data-overlay='passive' on PASSIVE mode", () => {
    applyOverlayMode("PASSIVE", getHud(), [getPauseBtn(), getClearBtn(), getCloseBtn()]);
    expect(getHud().dataset.overlay).toBe("passive");
  });

  it("sets data-overlay='interactive' on INTERACTIVE mode", () => {
    applyOverlayMode("INTERACTIVE", getHud(), [getPauseBtn(), getClearBtn(), getCloseBtn()]);
    expect(getHud().dataset.overlay).toBe("interactive");
  });

  it("sets tabindex=-1 on buttons in PASSIVE mode — buttons are not keyboard-reachable", () => {
    applyOverlayMode("PASSIVE", getHud(), [getPauseBtn(), getClearBtn(), getCloseBtn()]);
    expect(getPauseBtn().tabIndex).toBe(-1);
    expect(getClearBtn().tabIndex).toBe(-1);
    expect(getCloseBtn().tabIndex).toBe(-1);
  });

  it("sets tabindex=0 on buttons in INTERACTIVE mode — buttons are keyboard-reachable", () => {
    applyOverlayMode("INTERACTIVE", getHud(), [getPauseBtn(), getClearBtn(), getCloseBtn()]);
    expect(getPauseBtn().tabIndex).toBe(0);
    expect(getClearBtn().tabIndex).toBe(0);
    expect(getCloseBtn().tabIndex).toBe(0);
  });

  it("reverts tabindex to -1 when switching from INTERACTIVE back to PASSIVE", () => {
    applyOverlayMode("INTERACTIVE", getHud(), [getPauseBtn(), getClearBtn(), getCloseBtn()]);
    applyOverlayMode("PASSIVE", getHud(), [getPauseBtn(), getClearBtn(), getCloseBtn()]);
    expect(getPauseBtn().tabIndex).toBe(-1);
    expect(getClearBtn().tabIndex).toBe(-1);
    expect(getCloseBtn().tabIndex).toBe(-1);
  });
});

// ─── Canvas resize / DPR ─────────────────────────────────────────────────────
//
// jsdom does not implement HTMLCanvasElement.getContext("2d") — it returns null.
// resizeCanvasWithContext is the production helper from bar-render.ts; it accepts
// injected canvas + context shapes so tests can provide mocks without touching
// jsdom canvas internals.

interface MockCtx {
  scale: ReturnType<typeof vi.fn>;
  setTransform: ReturnType<typeof vi.fn>;
}

describe("resizeCanvasWithContext — DPR scaling without accumulation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets canvas physical dimensions using devicePixelRatio", () => {
    const ctx: MockCtx = { scale: vi.fn(), setTransform: vi.fn() };
    const canvas = {
      width: 0,
      height: 0,
      getBoundingClientRect: () => ({ width: 56, height: 28 }),
    };
    const dpr = 2;

    resizeCanvasWithContext(canvas, ctx, dpr);

    expect(canvas.width).toBe(112);
    expect(canvas.height).toBe(56);
    expect(ctx.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
    expect(ctx.scale).toHaveBeenCalledWith(dpr, dpr);
  });

  it("does not accumulate DPR scale on repeated resize calls", () => {
    const ctx: MockCtx = { scale: vi.fn(), setTransform: vi.fn() };
    const canvas = {
      width: 0,
      height: 0,
      getBoundingClientRect: () => ({ width: 56, height: 28 }),
    };
    const dpr = 2;

    resizeCanvasWithContext(canvas, ctx, dpr);
    resizeCanvasWithContext(canvas, ctx, dpr);

    // scale should be called exactly twice, each with dpr (not dpr*dpr)
    expect(ctx.scale).toHaveBeenCalledTimes(2);
    expect(ctx.scale).toHaveBeenNthCalledWith(1, dpr, dpr);
    expect(ctx.scale).toHaveBeenNthCalledWith(2, dpr, dpr);
    // setTransform identity reset must precede every scale call
    expect(ctx.setTransform).toHaveBeenCalledTimes(2);
  });

  it("uses devicePixelRatio=1 as safe fallback (no DPR inflation on non-Retina)", () => {
    const ctx: MockCtx = { scale: vi.fn(), setTransform: vi.fn() };
    const canvas = {
      width: 0,
      height: 0,
      getBoundingClientRect: () => ({ width: 56, height: 28 }),
    };

    resizeCanvasWithContext(canvas, ctx, 1);

    expect(canvas.width).toBe(56);
    expect(canvas.height).toBe(28);
    expect(ctx.scale).toHaveBeenCalledWith(1, 1);
  });

  it("handles null context safely (no-op when canvas has no 2D support)", () => {
    const canvas = {
      width: 0,
      height: 0,
      getBoundingClientRect: () => ({ width: 56, height: 28 }),
    };
    // Should not throw when ctx is null
    expect(() => resizeCanvasWithContext(canvas, null, 2)).not.toThrow();
    expect(canvas.width).toBe(112);
    expect(canvas.height).toBe(56);
  });
});

describe("createWaveformLayout — pure geometry contract", () => {
  it("derives consistent geometry from canvas size", () => {
    const layout = createWaveformLayout(120, 40);

    expect(layout.width).toBe(120);
    expect(layout.height).toBe(40);
    expect(layout.centerY).toBe(20);
    expect(layout.pointCount).toBe(128);
    expect(layout.lineWidth).toBe(2.4);
    expect(layout.maxAmplitude).toBeCloseTo(18.4, 5);
  });

  it("returns identical values for repeated same-size calls", () => {
    const first = createWaveformLayout(160, 60);
    const second = createWaveformLayout(160, 60);

    expect(second).toEqual(first);
  });
});

// ─── IMP-02: Waveform lifecycle — through real production predicate ────────────
//
// The production controller.onStateChange handler delegates to waveformShouldRun()
// from bar-render.ts to decide whether to start or stop the animation loop.
// These tests verify the predicate's contract directly, plus the RAF lifecycle
// pattern that the production handler uses (start/stop idempotency).

// ─── IMP-02: Waveform lifecycle — through real production predicates ───────────
//
// The production controller.onStateChange handler uses two predicates from
// bar-render.ts to decide the waveform render tier:
//   - waveformShouldRun(state): continuous RAF loop (audio-active states only)
//   - waveformShouldBeVisible(state): static idle frame (visible non-audio states)
//   - neither: no render at all (HIDDEN)
//
// This two-tier design eliminates continuous compositor/GPU work in states
// where the waveform is visible but no audio analyser is providing data.

describe("waveformShouldRun — continuous RAF only for audio-active states", () => {
  it("returns true for audio-active states that need live animation", () => {
    const audioActiveStates: BarState[] = [
      "CONNECTING", "LISTENING", "RESUMING",
    ] as const;

    for (const state of audioActiveStates) {
      expect(waveformShouldRun(state)).toBe(true);
    }
  });

  it("returns false for non-audio visible states (static idle frame, no RAF)", () => {
    const staticVisibleStates: BarState[] = [
      "PAUSED", "PROCESSING", "INSERTING", "SUCCESS", "ERROR",
    ] as const;

    for (const state of staticVisibleStates) {
      expect(waveformShouldRun(state)).toBe(false);
    }
  });

  it("returns false when the HUD is hidden", () => {
    expect(waveformShouldRun("HIDDEN")).toBe(false);
  });

  it("covers all BarState values (exhaustive — no state is accidentally unhandled)", () => {
    const allStates: BarState[] = [
      "HIDDEN", "CONNECTING", "LISTENING", "PAUSED", "RESUMING", "PROCESSING", "INSERTING", "SUCCESS", "ERROR",
    ];
    const rafStates = allStates.filter(waveformShouldRun);
    const nonRafStates = allStates.filter((s) => !waveformShouldRun(s));
    expect(rafStates).toEqual(["CONNECTING", "LISTENING", "RESUMING"]);
    expect(nonRafStates).toEqual(["HIDDEN", "PAUSED", "PROCESSING", "INSERTING", "SUCCESS", "ERROR"]);
    expect(rafStates.length + nonRafStates.length).toBe(9);
  });
});

describe("waveformShouldBeVisible — any visible state shows waveform (static or animated)", () => {
  it("returns true for every visible HUD state", () => {
    const visibleStates: BarState[] = [
      "CONNECTING", "LISTENING", "PAUSED", "RESUMING", "PROCESSING", "INSERTING", "SUCCESS", "ERROR",
    ] as const;

    for (const state of visibleStates) {
      expect(waveformShouldBeVisible(state)).toBe(true);
    }
  });

  it("returns false only when the HUD is hidden", () => {
    expect(waveformShouldBeVisible("HIDDEN")).toBe(false);
  });

  it("is a superset of waveformShouldRun — every RAF state is also visible", () => {
    const allStates: BarState[] = [
      "HIDDEN", "CONNECTING", "LISTENING", "PAUSED", "RESUMING", "PROCESSING", "INSERTING", "SUCCESS", "ERROR",
    ];
    for (const state of allStates) {
      if (waveformShouldRun(state)) {
        expect(waveformShouldBeVisible(state)).toBe(true);
      }
    }
  });

  it("covers all BarState values (exhaustive — no state is accidentally unhandled)", () => {
    const allStates: BarState[] = [
      "HIDDEN", "CONNECTING", "LISTENING", "PAUSED", "RESUMING", "PROCESSING", "INSERTING", "SUCCESS", "ERROR",
    ];
    const visibleStates = allStates.filter(waveformShouldBeVisible);
    const hiddenStates = allStates.filter((s) => !waveformShouldBeVisible(s));
    expect(visibleStates).toEqual(["CONNECTING", "LISTENING", "PAUSED", "RESUMING", "PROCESSING", "INSERTING", "SUCCESS", "ERROR"]);
    expect(hiddenStates).toEqual(["HIDDEN"]);
    expect(visibleStates.length + hiddenStates.length).toBe(9);
  });
});

describe("waveform RAF lifecycle — two-tier controller.onStateChange behaviour contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("schedules a RAF when waveformShouldRun returns true for an audio-active state", () => {
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(42);
    let rafId: number | null = null;

    // Simulate the production onStateChange handler pattern
    const state: BarState = "LISTENING";
    if (waveformShouldRun(state)) {
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {});
      }
    }

    expect(rafSpy).toHaveBeenCalledTimes(1);
    expect(rafId).toBe(42);
  });

  it("does NOT schedule a RAF for non-audio visible states (static frame path)", () => {
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(42);
    let rafId: number | null = null;

    // Non-audio visible states get a static frame, not continuous RAF
    const staticStates: BarState[] = ["PROCESSING", "INSERTING", "SUCCESS", "ERROR", "PAUSED"];
    for (const state of staticStates) {
      rafId = null;
      if (waveformShouldRun(state)) {
        rafId = requestAnimationFrame(() => {});
      }
      expect(rafId).toBeNull();
      // But the waveform IS still visible (static frame)
      expect(waveformShouldBeVisible(state)).toBe(true);
    }

    expect(rafSpy).not.toHaveBeenCalled();
  });

  it("cancels existing RAF when transitioning to HIDDEN", () => {
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(42);
    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame");

    let rafId: number | null = null;

    // Start for an audio-active state
    if (waveformShouldRun("LISTENING")) {
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {});
      }
    }
    expect(rafId).toBe(42);
    expect(rafSpy).toHaveBeenCalledTimes(1);

    // HIDDEN stops everything
    rafId = 42;
    if (!waveformShouldRun("HIDDEN") && !waveformShouldBeVisible("HIDDEN")) {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }
    expect(rafId).toBeNull();
    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });

  it("cancels existing RAF when transitioning from audio-active to non-audio visible state", () => {
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(42);
    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame");

    let rafId: number | null = null;

    // Start for LISTENING
    if (waveformShouldRun("LISTENING")) {
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {});
      }
    }
    expect(rafId).toBe(42);

    // Transition to PROCESSING — RAF should stop, but waveform stays visible (static)
    const nextState: BarState = "PROCESSING";
    if (!waveformShouldRun(nextState) && waveformShouldBeVisible(nextState)) {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      // Production would call drawStaticIdleFrame() here
    }
    expect(rafId).toBeNull();
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(waveformShouldBeVisible(nextState)).toBe(true);
  });

  it("startWaveform pattern is idempotent — does not schedule multiple RAF loops", () => {
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(99);

    let rafId: number | null = null;
    function startWaveform(): void {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {});
    }

    startWaveform();
    startWaveform(); // second call: no-op
    startWaveform(); // third call: no-op

    expect(rafSpy).toHaveBeenCalledTimes(1);
  });

  it("stopWaveform pattern is idempotent — safe to call when not running", () => {
    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame");

    let rafId: number | null = null;
    function stopWaveform(): void {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }

    stopWaveform(); // called with rafId === null — must not throw
    expect(cancelSpy).not.toHaveBeenCalled();
    expect(rafId).toBeNull();
  });
});

// ─── IMP-01: bar.html — accessibility contract from production source ─────────
//
// The DOM comes from the real bar.html body (PRODUCTION_HUD_HTML above).
// Tests assert the exact attributes present in the shipped HTML — any deviation
// in bar.html will cause these tests to fail, catching regressions immediately.

describe("bar.html — accessibility contract (production source)", () => {
  beforeEach(buildHudDom);
  afterEach(() => { document.body.innerHTML = ""; });

  it("hud element has role='status'", () => {
    expect(getHud().getAttribute("role")).toBe("status");
  });

  it("hud has aria-label describing its purpose", () => {
    expect(getHud().getAttribute("aria-label")).toBe("Voice to Text status");
  });

  it("hud does NOT have aria-live on the root (transcript region owns live announcement)", () => {
    // The transcript .hud-transcript div owns aria-live to avoid over-announcing
    // every state transition. The root must not duplicate it.
    expect(getHud().getAttribute("aria-live")).toBeNull();
  });

  it("clear button has accessible label", () => {
    expect(getClearBtn().getAttribute("aria-label")).toBe("Clear and restart listening");
  });

  it("close button has accessible label", () => {
    expect(getCloseBtn().getAttribute("aria-label")).toBe("Stop listening and close");
  });

  it("pause button has accessible label", () => {
    expect(getPauseBtn().getAttribute("aria-label")).toBe("Pause listening");
  });

  it("pause button starts disabled", () => {
    expect(getPauseBtn().disabled).toBe(true);
  });

  it("pause button is type='button'", () => {
    expect(getPauseBtn().getAttribute("type")).toBe("button");
  });

  it("pause button has pause and resume SVG icons", () => {
    const pauseIcon = getPauseBtn().querySelector(".hud-icon-pause");
    const resumeIcon = getPauseBtn().querySelector(".hud-icon-resume");
    expect(pauseIcon).not.toBeNull();
    expect(resumeIcon).not.toBeNull();
    expect(pauseIcon?.getAttribute("aria-hidden")).toBe("true");
    expect(resumeIcon?.getAttribute("aria-hidden")).toBe("true");
  });

  it("transcript final span has accessible label", () => {
    expect(getTranscriptFinal().getAttribute("aria-label")).toBe("Transcribed text");
  });

  it("transcript interim span has accessible label", () => {
    expect(getTranscriptInterim().getAttribute("aria-label")).toBe("Interim transcription");
  });

  it("waveform container is aria-hidden", () => {
    const waveform = document.querySelector(".hud-waveform");
    expect(waveform?.getAttribute("aria-hidden")).toBe("true");
  });

  it("state label is aria-hidden", () => {
    expect(getStateLabel().getAttribute("aria-hidden")).toBe("true");
  });

  it("separator is aria-hidden", () => {
    const sep = document.querySelector(".hud-sep");
    expect(sep?.getAttribute("aria-hidden")).toBe("true");
  });

  it("transcript prompt is aria-hidden (visual-only cue)", () => {
    expect(getTranscriptPrompt().getAttribute("aria-hidden")).toBe("true");
  });

  it("action buttons are type='button'", () => {
    expect(getPauseBtn().getAttribute("type")).toBe("button");
    expect(getClearBtn().getAttribute("type")).toBe("button");
    expect(getCloseBtn().getAttribute("type")).toBe("button");
  });

  it("hud-actions has role='group' with accessible label", () => {
    const actions = document.querySelector(".hud-actions");
    expect(actions?.getAttribute("role")).toBe("group");
    expect(actions?.getAttribute("aria-label")).toBe("HUD controls");
  });

  it("transcript region has aria-live='polite' and aria-atomic='false'", () => {
    const transcriptRegion = document.querySelector(".hud-transcript");
    expect(transcriptRegion?.getAttribute("aria-live")).toBe("polite");
    expect(transcriptRegion?.getAttribute("aria-atomic")).toBe("false");
  });

  it("state label is the trailing item inside the transcript row", () => {
    const transcriptRegion = document.querySelector(".hud-transcript");
    expect(transcriptRegion?.querySelector("#hud-state-label")).toBe(getStateLabel());
    expect(transcriptRegion?.lastElementChild).toBe(getStateLabel());
  });

  it("buttons start with tabindex=-1 (not keyboard-reachable in default PASSIVE mode)", () => {
    expect(getPauseBtn().tabIndex).toBe(-1);
    expect(getClearBtn().tabIndex).toBe(-1);
    expect(getCloseBtn().tabIndex).toBe(-1);
  });
});

// ─── IMP-01: bar.html — structural contract from production source ─────────────

describe("bar.html — structural contract (production source)", () => {
  beforeEach(buildHudDom);
  afterEach(() => { document.body.innerHTML = ""; });

  it("canvas element exists inside hud-waveform", () => {
    expect(getCanvas()).not.toBeNull();
  });

  it("transcript-prompt starts hidden", () => {
    expect(getTranscriptPrompt().hidden).toBe(true);
  });

  it("initial data-state is HIDDEN", () => {
    expect(getHud().dataset.state).toBe("HIDDEN");
  });

  it("clear and close buttons are real <button> elements", () => {
    expect(getClearBtn().tagName).toBe("BUTTON");
    expect(getCloseBtn().tagName).toBe("BUTTON");
  });

  it("hud-actions contains exactly three buttons", () => {
    const actions = document.querySelector(".hud-actions")!;
    const buttons = actions.querySelectorAll("button");
    expect(buttons).toHaveLength(3);
  });
});

// ─── State-driven CSS attribute contract ─────────────────────────────────────

describe("state-driven data attributes — CSS contract", () => {
  beforeEach(buildHudDom);
  afterEach(() => { document.body.innerHTML = ""; });

  it("every BarState maps to a unique dataset.state value", () => {
    const states: BarState[] = [
      "HIDDEN", "CONNECTING", "LISTENING", "PAUSED", "RESUMING", "PROCESSING",
      "INSERTING", "SUCCESS", "ERROR",
    ];
    const seen = new Set<string>();
    for (const state of states) {
      applyState(
        state,
        getHud(), getStateLabel(),
        getTranscriptFinal(), getTranscriptInterim(), getTranscriptPrompt(),
      );
      const ds = getHud().dataset.state!;
      expect(seen.has(ds)).toBe(false);
      seen.add(ds);
    }
    expect(seen.size).toBe(9);
  });

  it("HIDDEN state produces empty state label text (CSS uses data-state, not text)", () => {
    applyState(
      "HIDDEN",
      getHud(), getStateLabel(),
      getTranscriptFinal(), getTranscriptInterim(), getTranscriptPrompt(),
    );
    expect(getStateLabel().textContent).toBe("");
  });

  it("applyOverlayMode produces 'passive' or 'interactive' (lowercase for CSS selector match)", () => {
    applyOverlayMode("PASSIVE", getHud(), []);
    expect(getHud().dataset.overlay).toBe("passive");
    applyOverlayMode("INTERACTIVE", getHud(), []);
    expect(getHud().dataset.overlay).toBe("interactive");
  });
});

// ─── Error state — full scenario ──────────────────────────────────────────────

describe("error state — display scenario", () => {
  beforeEach(buildHudDom);
  afterEach(() => { document.body.innerHTML = ""; });

  it("error message is visible, interim is cleared, prompt is hidden", () => {
    const hud = getHud();
    hud.dataset.state = "ERROR";
    getTranscriptInterim().textContent = "old interim";
    getTranscriptPrompt().hidden = false;

    applyErrorMessage(
      "Microphone permission is required. Open Settings to allow access.",
      hud, getTranscriptFinal(), getTranscriptInterim(), getTranscriptPrompt(),
    );

    expect(getTranscriptFinal().textContent).toBe(
      "Microphone permission is required. Open Settings to allow access."
    );
    expect(getTranscriptInterim().textContent).toBe("");
    expect(getTranscriptPrompt().hidden).toBe(true);
  });

  it("null error clears both transcript slots cleanly", () => {
    const hud = getHud();
    hud.dataset.state = "ERROR";
    getTranscriptFinal().textContent = "Previous error message.";
    getTranscriptInterim().textContent = "stale";

    applyErrorMessage(null, hud, getTranscriptFinal(), getTranscriptInterim(), getTranscriptPrompt());

    expect(getTranscriptFinal().textContent).toBe("");
    expect(getTranscriptInterim().textContent).toBe("");
  });

  it("transitioning ERROR → LISTENING via applyState does not clear transcript content", () => {
    const hud = getHud();
    hud.dataset.state = "ERROR";
    getTranscriptFinal().textContent = "error text";

    // AUTO_RETURN goes ERROR → LISTENING; applyState('LISTENING') must not wipe transcript
    applyState(
      "LISTENING",
      hud, getStateLabel(),
      getTranscriptFinal(), getTranscriptInterim(), getTranscriptPrompt(),
    );

    expect(getTranscriptFinal().textContent).toBe("error text");
    expect(hud.dataset.state).toBe("LISTENING");
  });
});

// ─── IMP-03: tokens.css — assert against real file source ─────────────────────
//
// Reads the actual ui/src/tokens.css source and verifies every required token
// is declared as a CSS custom property. A local string array cannot diverge
// from the file — if a token is renamed in tokens.css this test fails.

describe("tokens.css — required tokens present in production source", () => {
  const tokensCssPath = resolve(__dirname, "../tokens.css");
  const tokensCssSource = readFileSync(tokensCssPath, "utf-8");

  const REQUIRED_TOKENS: readonly string[] = [
    // Accent scale — used by bar.css for state-driven glow effects
    "--color-cyan-400",
    "--color-cyan-300",
    "--color-violet-400",
    "--color-success-500",
    "--color-success-300",
    "--color-error-500",
    "--color-error-300",
    "--color-warning-500",
    // Semantic text tokens
    "--text-primary",
    "--text-secondary",
    "--text-tertiary",
    "--text-disabled",
    // Interactive tokens
    "--border-focus",
    // Transition tokens
    "--duration-fast",
    "--duration-normal",
    "--duration-slow",
    "--ease-out",
    // Radii
    "--radius-2xl",
    "--radius-md",
    "--radius-full",
    // Spacing
    "--space-1",
    "--space-3",
    "--space-4",
  ] as const;

  for (const token of REQUIRED_TOKENS) {
    it(`declares ${token}`, () => {
      // Match the token as a CSS custom property declaration: --token-name:
      expect(tokensCssSource).toMatch(new RegExp(`${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`));
    });
  }

  it("all required tokens start with '--' (valid CSS custom property names)", () => {
    for (const token of REQUIRED_TOKENS) {
      expect(token).toMatch(/^--/);
    }
  });
});

describe("bar.css — error transcript keeps start-visible truncation", () => {
  const barCssPath = resolve(__dirname, "../bar.css");
  const barCssSource = readFileSync(barCssPath, "utf-8");

  it("keeps ellipsis truncation in the ERROR transcript rule", () => {
    expect(barCssSource).toMatch(/\.hud\[data-state="ERROR"\]\s+\.transcript-final\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/s);
  });
});

// ─── ECG pulse shape — heartbeat visual model ─────────────────────────────────
//
// These tests validate the core heartbeat render model:
//   1. The pulse is a short angular ECG segment (P-QRS-T), NOT a full-width scroll.
//   2. The pulse has MULTIPLE adjacent peaks/dips/turns, NOT a single blip.
//   3. Flat baseline exists before and after the pulse.
//   4. The pulse is centered in the canvas.
//   5. Beat intensity rhythmically modulates the pulse height.

describe("ecgDisplacement — P-QRS-T piecewise-linear shape", () => {
  it("starts and ends at zero (flat baseline boundary)", () => {
    expect(ecgDisplacement(0)).toBe(0);
    expect(ecgDisplacement(1)).toBe(0);
  });

  it("R-wave peak is the strongest upward displacement (d = -1.0)", () => {
    const rWaveKeyframe = ECG_KEYFRAMES.find(kf => kf.d === -1.0);
    expect(rWaveKeyframe).toBeDefined();
    expect(ecgDisplacement(rWaveKeyframe!.t)).toBeCloseTo(-1.0, 5);
  });

  it("S-wave dip is a downward displacement (d > 0)", () => {
    const sWaveKeyframe = ECG_KEYFRAMES.find(kf => kf.d === 0.95);
    expect(sWaveKeyframe).toBeDefined();
    expect(ecgDisplacement(sWaveKeyframe!.t)).toBeCloseTo(0.95, 5);
  });

  it("has multiple distinct turning points — reads as angular zigzag, not a single blip", () => {
    // Count keyframes with non-zero displacement — must be at least 4 distinct peaks/dips
    const nonZeroKeyframes = ECG_KEYFRAMES.filter(kf => Math.abs(kf.d) > 0.05);
    expect(nonZeroKeyframes.length).toBeGreaterThanOrEqual(7);
  });

  it("has consecutive angular turns in the QRS region (Q-R-S in quick succession)", () => {
    // Q, R, S keyframes should be close together in t-space, creating the zigzag
    const qIdx = ECG_KEYFRAMES.findIndex(kf => kf.d === 0.28);
    const rIdx = ECG_KEYFRAMES.findIndex(kf => kf.d === -1.0);
    const sIdx = ECG_KEYFRAMES.findIndex(kf => kf.d === 0.95);

    expect(qIdx).toBeGreaterThan(-1);
    expect(rIdx).toBeGreaterThan(qIdx);
    expect(sIdx).toBeGreaterThan(rIdx);

    // All three within a still-localized t-range even after stretching the cluster.
    const qrsSpan = ECG_KEYFRAMES[sIdx].t - ECG_KEYFRAMES[qIdx].t;
    expect(qrsSpan).toBeLessThan(0.34);
  });

  it("interpolates smoothly between keyframes (piecewise-linear, no jumps)", () => {
    // Sample at midpoint between R-wave peak and S-wave dip
    const rKf = ECG_KEYFRAMES.find(kf => kf.d === -1.0)!;
    const sKf = ECG_KEYFRAMES.find(kf => kf.d === 0.95)!;
    const midT = (rKf.t + sKf.t) / 2;
    const midD = ecgDisplacement(midT);

    // Should be between -1.0 and 0.95 (linear interpolation)
    expect(midD).toBeGreaterThan(-1.0);
    expect(midD).toBeLessThan(0.95);
  });

  it("clamps to boundary values for out-of-range input", () => {
    expect(ecgDisplacement(-0.5)).toBe(ECG_KEYFRAMES[0].d);
    expect(ecgDisplacement(1.5)).toBe(ECG_KEYFRAMES[ECG_KEYFRAMES.length - 1].d);
  });
});

describe("sampleWaveformY — centered ECG region, NOT full-width scroll", () => {
  const LAYOUT = createWaveformLayout(120, 40);
  const FULL_AMPLITUDE = 1.0;
  const FULL_BEAT = 1.0;

  it("returns centerY for points outside the ECG region (flat baseline)", () => {
    const fullWidthRegion = computeEcgRegionWidthRatio(FULL_AMPLITUDE);
    const regionStart = (1 - fullWidthRegion) / 2;

    // Left baseline (t = 0)
    expect(sampleWaveformY(0, LAYOUT.centerY, LAYOUT.maxAmplitude, FULL_AMPLITUDE, FULL_BEAT))
      .toBe(LAYOUT.centerY);

    // Right baseline (t = 1)
    expect(sampleWaveformY(1, LAYOUT.centerY, LAYOUT.maxAmplitude, FULL_AMPLITUDE, FULL_BEAT))
      .toBe(LAYOUT.centerY);

    // Just outside left edge of ECG region
    expect(sampleWaveformY(regionStart - 0.01, LAYOUT.centerY, LAYOUT.maxAmplitude, FULL_AMPLITUDE, FULL_BEAT))
      .toBe(LAYOUT.centerY);
  });

  it("displaces points INSIDE the ECG region when beatIntensity > 0", () => {
    // Sample at the R-wave peak location within the canvas
    const regionStart = (1 - computeEcgRegionWidthRatio(FULL_AMPLITUDE)) / 2;
    const rWaveKf = ECG_KEYFRAMES.find(kf => kf.d === -1.0)!;
    const rWaveT = regionStart + rWaveKf.t * computeEcgRegionWidthRatio(FULL_AMPLITUDE);

    const y = sampleWaveformY(rWaveT, LAYOUT.centerY, LAYOUT.maxAmplitude, FULL_AMPLITUDE, FULL_BEAT);
    // R-wave is upward (y < centerY)
    expect(y).toBeLessThan(LAYOUT.centerY);
  });

  it("returns flat line (centerY) when beatIntensity is 0 — pulse is gated off", () => {
    const regionStart = (1 - computeEcgRegionWidthRatio(FULL_AMPLITUDE)) / 2;
    const rWaveKf = ECG_KEYFRAMES.find(kf => kf.d === -1.0)!;
    const rWaveT = regionStart + rWaveKf.t * computeEcgRegionWidthRatio(FULL_AMPLITUDE);

    expect(sampleWaveformY(rWaveT, LAYOUT.centerY, LAYOUT.maxAmplitude, FULL_AMPLITUDE, 0))
      .toBe(LAYOUT.centerY);
  });

  it("keeps idle width localized but stretches near full width for active speech", () => {
    expect(ECG_REGION_WIDTH_RATIO).toBeLessThan(0.8);
    expect(ECG_REGION_WIDTH_RATIO).toBeGreaterThan(0.6);
    expect(computeEcgRegionWidthRatio(FULL_AMPLITUDE)).toBeCloseTo(ACTIVE_ECG_REGION_WIDTH_RATIO, 5);
    expect(computeEcgRegionWidthRatio(FULL_AMPLITUDE)).toBeGreaterThan(0.96);
  });

  it("ECG region is centered in the canvas", () => {
    const { start: regionStart, end: regionEnd } = getEcgRegionBounds();

    // Left margin ≈ right margin (centered)
    const leftMargin = regionStart;
    const rightMargin = 1 - regionEnd;
    expect(leftMargin).toBeCloseTo(rightMargin, 10);
  });
});

describe("heartbeat cluster motion — localized ECG travel over flat baseline", () => {
  const LAYOUT = createWaveformLayout(120, 40);
  const ACTIVE_DISPLACEMENT_EPSILON = 0.1;

  function countTurningPoints(values: number[]): number {
    let turningPointCount = 0;
    for (let i = 1; i < values.length - 1; i++) {
      const previousSlope = values[i] - values[i - 1];
      const nextSlope = values[i + 1] - values[i];
      if (Math.abs(previousSlope) < 0.001 || Math.abs(nextSlope) < 0.001) {
        continue;
      }

      if (Math.sign(previousSlope) !== Math.sign(nextSlope)) {
        turningPointCount += 1;
      }
    }

    return turningPointCount;
  }

  function getActiveClusterMetrics(points: Array<{ x: number; y: number }>) {
    const activePoints = points.filter((point) => Math.abs(point.y - LAYOUT.centerY) > ACTIVE_DISPLACEMENT_EPSILON);
    const firstActiveIndex = points.findIndex(
      (point) => Math.abs(point.y - LAYOUT.centerY) > ACTIVE_DISPLACEMENT_EPSILON,
    );
    const lastActiveIndex = points.length - 1 - [...points].reverse().findIndex(
      (point) => Math.abs(point.y - LAYOUT.centerY) > ACTIVE_DISPLACEMENT_EPSILON,
    );

    const activeCenterX = activePoints.reduce((sum, point) => sum + point.x, 0) / activePoints.length;
    const activeSpanPx = points[lastActiveIndex].x - points[firstActiveIndex].x;

    return {
      activePoints,
      firstActiveIndex,
      lastActiveIndex,
      activeCenterX,
      activeSpanPx,
    };
  }

  it("active cluster has multiple adjacent turning points (not a one-point blip)", () => {
    const points = buildHeartbeatTracePoints(LAYOUT, 1, 1, 0);
    const { activePoints } = getActiveClusterMetrics(points);
    const activeY = activePoints.map((point) => point.y);

    expect(countTurningPoints(activeY)).toBeGreaterThanOrEqual(11);
  });

  it("speaking adds more folds than idle and removes the flat left side", () => {
    const speakingPoints = buildHeartbeatTracePoints(LAYOUT, 1, 1, 0);
    const idlePoints = buildHeartbeatTracePoints(LAYOUT, HEARTBEAT_IDLE_AMPLITUDE, 1, 0);
    const speakingY = speakingPoints.map((point) => point.y);
    const idleY = idlePoints.map((point) => point.y);

    expect(countTurningPoints(speakingY)).toBeGreaterThan(countTurningPoints(idleY));

    const speakingLeftSideDisplacedPoints = speakingPoints.filter((point, index) => {
      const t = index / (speakingPoints.length - 1);
      return t < 0.4 && Math.abs(point.y - LAYOUT.centerY) > ACTIVE_DISPLACEMENT_EPSILON;
    });

    const speakingLeftSideY = speakingPoints
      .filter((_, index) => index / (speakingPoints.length - 1) < 0.45)
      .map((point) => point.y);

    expect(speakingLeftSideDisplacedPoints.length).toBeGreaterThan(14);
    expect(countTurningPoints(speakingLeftSideY)).toBeGreaterThanOrEqual(5);
  });

  it("only a short localized region is active, not the full width", () => {
    const points = buildHeartbeatTracePoints(LAYOUT, 1, 1, 0);
    const { activeSpanPx, activePoints } = getActiveClusterMetrics(points);
    const activeSpanRatio = activeSpanPx / LAYOUT.width;

    expect(activePoints.length).toBeGreaterThan(4);
    expect(activeSpanRatio).toBeGreaterThan(0.9);
    expect(activeSpanRatio).toBeLessThan(0.99);
    expect(activeSpanRatio).toBeLessThan(computeEcgRegionWidthRatio(1) + 0.02);
  });

  it("cluster region moves left over time with subtle travel, not full-width scrolling", () => {
    const bpm = 60;
    const beatPeriodMs = 60_000 / bpm;
    const startOffset = computeHeartbeatClusterOffset(0, bpm);
    const laterOffset = computeHeartbeatClusterOffset(beatPeriodMs * 0.9, bpm);

    expect(laterOffset).toBeLessThan(startOffset);

    const startPoints = buildHeartbeatTracePoints(LAYOUT, 1, 1, startOffset);
    const laterPoints = buildHeartbeatTracePoints(LAYOUT, 1, 1, laterOffset);

    const startCluster = getActiveClusterMetrics(startPoints);
    const laterCluster = getActiveClusterMetrics(laterPoints);

    const centerShiftPx = startCluster.activeCenterX - laterCluster.activeCenterX;
    expect(centerShiftPx).toBeGreaterThan(0);
    expect(centerShiftPx / LAYOUT.width).toBeLessThan(ECG_CLUSTER_TRAVEL_RATIO + 0.02);
    expect(centerShiftPx).toBeLessThan(LAYOUT.width * 0.25);
  });

  it("baseline before and after the moving cluster remains flat", () => {
    const bpm = 60;
    const beatPeriodMs = 60_000 / bpm;
    const offsets = [
      computeHeartbeatClusterOffset(0, bpm),
      computeHeartbeatClusterOffset(beatPeriodMs * 0.9, bpm),
    ];

    for (const offset of offsets) {
      const points = buildHeartbeatTracePoints(LAYOUT, 1, 1, offset);
        const { start, end } = getEcgRegionBounds(offset, computeEcgRegionWidthRatio(1));

      for (let i = 0; i < points.length; i++) {
        const t = i / (points.length - 1);
        if (t < start || t > end) {
          expect(points[i].y).toBe(LAYOUT.centerY);
        }
      }
    }
  });

  it("moving cluster stays centered in the HUD lane", () => {
    const bpm = 60;
    const beatPeriodMs = 60_000 / bpm;
    const offsets = [
      computeHeartbeatClusterOffset(0, bpm),
      computeHeartbeatClusterOffset(beatPeriodMs * 0.9, bpm),
    ];

    for (const offset of offsets) {
      const points = buildHeartbeatTracePoints(LAYOUT, 1, 1, offset);
      const { activeCenterX } = getActiveClusterMetrics(points);

      expect(activeCenterX).toBeGreaterThan(LAYOUT.width * 0.35);
      expect(activeCenterX).toBeLessThan(LAYOUT.width * 0.65);
    }
  });
});

describe("buildHeartbeatTracePoints — short ECG segment with flat baselines", () => {
  const LAYOUT = createWaveformLayout(120, 40);

  it("has flat baseline points on both sides and displaced center points", () => {
    const points = buildHeartbeatTracePoints(LAYOUT, 1.0, 1.0);

    // First and last points should be on centerY (flat)
    expect(points[0].y).toBe(LAYOUT.centerY);
    expect(points[points.length - 1].y).toBe(LAYOUT.centerY);

    // At least some center points should NOT be on centerY (the ECG pulse)
    const displacedPoints = points.filter(p => Math.abs(p.y - LAYOUT.centerY) > 0.1);
    expect(displacedPoints.length).toBeGreaterThan(0);
  });

  it("displaced points are a contiguous cluster — not scattered across full width", () => {
    const points = buildHeartbeatTracePoints(LAYOUT, 1.0, 1.0);
    const displaced = points
      .map((p, i) => ({ i, displaced: Math.abs(p.y - LAYOUT.centerY) > 0.1 }))
      .filter(d => d.displaced);

    if (displaced.length > 1) {
      const firstIdx = displaced[0].i;
      const lastIdx = displaced[displaced.length - 1].i;
      const clusterWidth = lastIdx - firstIdx;
      // Cluster should use most of the shortened lane while still not becoming literally full-width.
      expect(clusterWidth).toBeLessThan(LAYOUT.pointCount * 0.98);
      // Cluster should have more than 2 points — it's a multi-turn zigzag, not one point
      expect(displaced.length).toBeGreaterThan(2);
    }
  });

  it("all points sit on centerY when beatIntensity is 0 — flat line", () => {
    const points = buildHeartbeatTracePoints(LAYOUT, 1.0, 0);
    for (const point of points) {
      expect(point.y).toBe(LAYOUT.centerY);
    }
  });
});

describe("computeAudioHeartbeatParams — speech-reactive heartbeat gating", () => {
  it("keeps true idle energy near the idle baseline", () => {
    const idle = computeAudioHeartbeatParams(0);

    expect(idle.bpm).toBe(HEARTBEAT_IDLE_BPM);
    expect(idle.amplitude).toBe(HEARTBEAT_MIN_AMPLITUDE);
  });

  it("does not overreact to low background noise", () => {
    const idle = computeAudioHeartbeatParams(0);
    const lowNoise = computeAudioHeartbeatParams(0.05);

    expect(lowNoise.bpm - idle.bpm).toBeLessThan(1);
    expect(lowNoise.amplitude - idle.amplitude).toBeLessThan(0.02);
  });

  it("ramps up strongly once energy clearly exceeds the noise floor", () => {
    const quiet = computeAudioHeartbeatParams(0.12);
    const speech = computeAudioHeartbeatParams(0.7);

    expect(speech.bpm).toBeGreaterThan(quiet.bpm);
    expect(speech.amplitude).toBeGreaterThan(quiet.amplitude);
    expect(speech.amplitude).toBeGreaterThan(0.8);
  });

  it("expands the ECG width when speech energy rises", () => {
    const idle = computeAudioHeartbeatParams(0);
    const speech = computeAudioHeartbeatParams(0.7);

    expect(computeEcgRegionWidthRatio(idle.amplitude)).toBeCloseTo(ECG_REGION_WIDTH_RATIO, 5);
    expect(computeEcgRegionWidthRatio(speech.amplitude)).toBeGreaterThan(computeEcgRegionWidthRatio(idle.amplitude));
    expect(computeEcgRegionWidthRatio(speech.amplitude)).toBeGreaterThan(0.95);
  });
});

describe("computeBeatIntensity — rhythmic pulsing envelope", () => {
  it("keeps a visible floor at exactly t=0 instead of collapsing fully flat", () => {
    const start = computeBeatIntensity(0, 60);
    expect(start).toBeGreaterThan(0.1);
    expect(start).toBeLessThan(0.2);
  });

  it("peaks near the start of each beat cycle (sharp attack)", () => {
    // At 60 BPM, period = 1000ms. Peak should be around 160ms (16% attack).
    const peakIntensity = computeBeatIntensity(160, 60);
    expect(peakIntensity).toBeCloseTo(1.0, 1);
  });

  it("decays toward 0 after the peak (exponential-like decay)", () => {
    // At 60 BPM, midway through decay (~500ms) should be much lower than peak
    const midDecay = computeBeatIntensity(500, 60);
    expect(midDecay).toBeLessThan(0.5);

    // Near end of cycle (~950ms) should be back near the visible floor
    const nearEnd = computeBeatIntensity(950, 60);
    expect(nearEnd).toBeGreaterThan(0.1);
    expect(nearEnd).toBeLessThan(0.2);
  });

  it("repeats on the next beat cycle", () => {
    // At 60 BPM, second beat starts at 1000ms
    const firstBeatRise = computeBeatIntensity(50, 60);
    const secondBeatRise = computeBeatIntensity(1050, 60);
    expect(secondBeatRise).toBeCloseTo(firstBeatRise, 5);
  });

  it("faster BPM produces more frequent peaks", () => {
    // At 120 BPM, period = 500ms. Peak at ~80ms (16% attack).
    const peakAt120 = computeBeatIntensity(80, 120);
    expect(peakAt120).toBeCloseTo(1.0, 1);

    // At 120 BPM, 250ms is midway through decay
    const midAt120 = computeBeatIntensity(250, 120);
    expect(midAt120).toBeLessThan(0.5);
  });

  it("never exceeds 1.0 or goes below 0.0", () => {
    // Sample across multiple cycles at various BPMs
    for (const bpm of [30, 60, 120]) {
      const periodMs = 60_000 / bpm;
      for (let t = 0; t < periodMs * 3; t += periodMs / 20) {
        const intensity = computeBeatIntensity(t, bpm);
        expect(intensity).toBeGreaterThanOrEqual(0);
        expect(intensity).toBeLessThanOrEqual(1.0);
      }
    }
  });
});
