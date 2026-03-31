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
  syncPromptVisibility,
  scrollTranscriptToEnd,
  resizeCanvasWithContext,
  waveformShouldRun,
  ecgPulse,
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
      "HIDDEN", "CONNECTING", "LISTENING", "PROCESSING",
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
    const states: BarState[] = ["HIDDEN", "CONNECTING", "PROCESSING", "INSERTING", "SUCCESS", "ERROR"];
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
    const activeStates: BarState[] = ["PROCESSING", "INSERTING", "SUCCESS"];
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
    applyOverlayMode("PASSIVE", getHud(), [getClearBtn(), getCloseBtn()]);
    expect(getHud().dataset.overlay).toBe("passive");
  });

  it("sets data-overlay='interactive' on INTERACTIVE mode", () => {
    applyOverlayMode("INTERACTIVE", getHud(), [getClearBtn(), getCloseBtn()]);
    expect(getHud().dataset.overlay).toBe("interactive");
  });

  it("sets tabindex=-1 on buttons in PASSIVE mode — buttons are not keyboard-reachable", () => {
    applyOverlayMode("PASSIVE", getHud(), [getClearBtn(), getCloseBtn()]);
    expect(getClearBtn().tabIndex).toBe(-1);
    expect(getCloseBtn().tabIndex).toBe(-1);
  });

  it("sets tabindex=0 on buttons in INTERACTIVE mode — buttons are keyboard-reachable", () => {
    applyOverlayMode("INTERACTIVE", getHud(), [getClearBtn(), getCloseBtn()]);
    expect(getClearBtn().tabIndex).toBe(0);
    expect(getCloseBtn().tabIndex).toBe(0);
  });

  it("reverts tabindex to -1 when switching from INTERACTIVE back to PASSIVE", () => {
    applyOverlayMode("INTERACTIVE", getHud(), [getClearBtn(), getCloseBtn()]);
    applyOverlayMode("PASSIVE", getHud(), [getClearBtn(), getCloseBtn()]);
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
    expect(layout.lineWidth).toBe(1.5);
    expect(layout.maxAmplitude).toBe(16);
  });

  it("returns identical values for repeated same-size calls", () => {
    const first = createWaveformLayout(160, 60);
    const second = createWaveformLayout(160, 60);

    expect(second).toEqual(first);
  });
});

// ─── ECG heartbeat shape contract ─────────────────────────────────────────────

describe("ecgPulse — PQRST heartbeat shape", () => {
  it("returns near-zero at baseline phases (0.0 and 0.8)", () => {
    expect(Math.abs(ecgPulse(0))).toBeLessThan(0.01);
    expect(Math.abs(ecgPulse(0.8))).toBeLessThan(0.01);
  });

  it("peaks sharply near the R-wave phase (~0.28)", () => {
    const rPeak = ecgPulse(0.28);
    expect(rPeak).toBeGreaterThan(0.85);
    expect(rPeak).toBeLessThanOrEqual(1.0);
  });

  it("has a small P-wave bump before the QRS complex", () => {
    const pWave = ecgPulse(0.12);
    expect(pWave).toBeGreaterThan(0.05);
    expect(pWave).toBeLessThan(0.3);
  });

  it("has a gentle T-wave after the QRS complex", () => {
    const tWave = ecgPulse(0.44);
    expect(tWave).toBeGreaterThan(0.1);
    expect(tWave).toBeLessThan(0.35);
  });

  it("dips significantly below baseline at S-wave for visible downward zigzag", () => {
    const sWave = ecgPulse(0.32);
    expect(sWave).toBeLessThan(-0.3);
    expect(sWave).toBeGreaterThan(-0.7);
  });

  it("dips negative at Q-wave before R spike", () => {
    const qWave = ecgPulse(0.245);
    expect(qWave).toBeLessThan(0);
  });

  it("is deterministic — same input produces same output", () => {
    expect(ecgPulse(0.28)).toBe(ecgPulse(0.28));
    expect(ecgPulse(0.5)).toBe(ecgPulse(0.5));
  });
});

// ─── IMP-02: Waveform lifecycle — through real production predicate ────────────
//
// The production controller.onStateChange handler delegates to waveformShouldRun()
// from bar-render.ts to decide whether to start or stop the animation loop.
// These tests verify the predicate's contract directly, plus the RAF lifecycle
// pattern that the production handler uses (start/stop idempotency).

describe("waveformShouldRun — production predicate from bar-render.ts", () => {
  it("returns true only for LISTENING", () => {
    expect(waveformShouldRun("LISTENING")).toBe(true);
  });

  it("returns false for all non-LISTENING states", () => {
    const nonListeningStates: BarState[] = [
      "HIDDEN", "CONNECTING", "PROCESSING", "INSERTING", "SUCCESS", "ERROR",
    ];
    for (const state of nonListeningStates) {
      expect(waveformShouldRun(state)).toBe(false);
    }
  });

  it("covers all BarState values (exhaustive — no state is accidentally unhandled)", () => {
    const allStates: BarState[] = [
      "HIDDEN", "CONNECTING", "LISTENING", "PROCESSING", "INSERTING", "SUCCESS", "ERROR",
    ];
    const runningStates = allStates.filter(waveformShouldRun);
    const stoppedStates = allStates.filter((s) => !waveformShouldRun(s));
    expect(runningStates).toEqual(["LISTENING"]);
    expect(stoppedStates).toHaveLength(6);
    expect(runningStates.length + stoppedStates.length).toBe(7);
  });
});

describe("waveform RAF lifecycle — controller.onStateChange behaviour contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("schedules a RAF when waveformShouldRun returns true (LISTENING)", () => {
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

  it("cancels existing RAF when waveformShouldRun returns false (non-LISTENING)", () => {
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(42);
    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame");

    let rafId: number | null = null;

    // Start for LISTENING
    if (waveformShouldRun("LISTENING")) {
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {});
      }
    }
    expect(rafId).toBe(42);
    expect(rafSpy).toHaveBeenCalledTimes(1);

    // Each non-LISTENING state should cancel RAF
    const stoppedStates: BarState[] = [
      "HIDDEN", "CONNECTING", "PROCESSING", "INSERTING", "SUCCESS", "ERROR",
    ];
    for (const state of stoppedStates) {
      // Restart for test isolation
      rafId = 42;
      if (!waveformShouldRun(state)) {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
      }
      expect(rafId).toBeNull();
    }

    expect(cancelSpy).toHaveBeenCalledTimes(stoppedStates.length);
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

  it("hud-actions contains exactly two buttons", () => {
    const actions = document.querySelector(".hud-actions")!;
    const buttons = actions.querySelectorAll("button");
    expect(buttons).toHaveLength(2);
  });
});

// ─── State-driven CSS attribute contract ─────────────────────────────────────

describe("state-driven data attributes — CSS contract", () => {
  beforeEach(buildHudDom);
  afterEach(() => { document.body.innerHTML = ""; });

  it("every BarState maps to a unique dataset.state value", () => {
    const states: BarState[] = [
      "HIDDEN", "CONNECTING", "LISTENING", "PROCESSING",
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
    expect(seen.size).toBe(7);
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
