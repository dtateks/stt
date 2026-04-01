/**
 * Pure logic tests for the UI layer.
 *
 * Covers:
 *   - stop-word normalization and detection (stop-word.ts)
 *   - bar state-machine transitions (bar-state-machine.ts)
 *   - connection-error handling and recovery paths (CRIT-01 / IMP-03)
 *   - shortcut display label conversion (shortcut-display.ts)
 *
 * Run with: vitest
 *
 * These tests import only pure modules — no DOM, no Tauri bridge, no network.
 */

import { describe, it, expect } from "vitest";
import {
  detectStopWord,
  detectStopWordWithNormalizedStopWord,
  normalizeStopWord,
  normalizeText,
  stripStopWord,
} from "../stop-word.ts";
import { transition, isActiveState } from "../bar-state-machine.ts";
import {
  canonicalToMacosLabel,
  shortcutCanonicalToDisplay,
} from "../shortcut-display.ts";

// ─── Stop-word: normalizeText ─────────────────────────────────────────────

describe("normalizeText", () => {
  it("lowercases input", () => {
    expect(normalizeText("Thank You")).toBe("thank you");
  });

  it("strips punctuation", () => {
    expect(normalizeText("thank you.")).toBe("thank you");
    expect(normalizeText("hello, world!")).toBe("hello world");
  });

  it("collapses multiple spaces", () => {
    expect(normalizeText("thank   you")).toBe("thank you");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeText("  thank you  ")).toBe("thank you");
  });

  it("handles empty string", () => {
    expect(normalizeText("")).toBe("");
  });

  it("handles punctuation-only string", () => {
    expect(normalizeText("...!!!")).toBe("");
  });
});

// ─── Stop-word: detectStopWord ────────────────────────────────────────────

describe("detectStopWord", () => {
  it("detects exact stop word at end", () => {
    expect(detectStopWord("send this message thank you", "thank you")).toBe(true);
  });

  it("detects stop word case-insensitively", () => {
    expect(detectStopWord("please do this Thank You", "thank you")).toBe(true);
    expect(detectStopWord("THANK YOU", "Thank You")).toBe(true);
  });

  it("detects stop word with trailing punctuation", () => {
    expect(detectStopWord("do the thing thank you.", "thank you")).toBe(true);
    expect(detectStopWord("submit now, thank you!", "thank you")).toBe(true);
  });

  it("does not detect stop word in the middle", () => {
    expect(detectStopWord("thank you for everything", "thank you")).toBe(false);
  });

  it("returns false when text does not end with stop word", () => {
    expect(detectStopWord("hello world", "thank you")).toBe(false);
  });

  it("returns false for empty stop word", () => {
    expect(detectStopWord("hello thank you", "")).toBe(false);
    expect(detectStopWord("hello thank you", "   ")).toBe(false);
  });

  it("returns false for empty text", () => {
    expect(detectStopWord("", "thank you")).toBe(false);
  });

  it("detects single-word stop word", () => {
    expect(detectStopWord("execute stop", "stop")).toBe(true);
  });

  it("matches normalized form through extra spaces", () => {
    expect(detectStopWord("done   thank   you", "thank you")).toBe(true);
  });

  it("matches detectStopWordWithNormalizedStopWord semantics", () => {
    const stopWord = "Thank   You";
    const normalizedStopWord = normalizeStopWord(stopWord);
    const samples = [
      "send this message thank you",
      "submit now, thank you!",
      "thank you for everything",
      "",
      "THANK YOU",
    ];

    for (const sample of samples) {
      expect(detectStopWordWithNormalizedStopWord(sample, normalizedStopWord)).toBe(
        detectStopWord(sample, stopWord),
      );
    }
  });

  it("returns false when normalized stop word is empty", () => {
    expect(detectStopWordWithNormalizedStopWord("hello thank you", "")).toBe(false);
  });
});

// ─── Stop-word: stripStopWord ─────────────────────────────────────────────

describe("stripStopWord", () => {
  it("strips stop word from end of text", () => {
    const result = stripStopWord("send this email thank you", "thank you");
    expect(result).toBe("send this email");
  });

  it("strips stop word with trailing punctuation", () => {
    const result = stripStopWord("do the thing thank you.", "thank you");
    expect(result.toLowerCase()).toContain("do the thing");
    expect(result.toLowerCase()).not.toContain("thank you");
  });

  it("returns empty string when only the stop word is present", () => {
    const result = stripStopWord("thank you", "thank you");
    expect(result).toBe("");
  });
});

// ─── Bar state machine: transitions ──────────────────────────────────────

describe("bar state machine — transition", () => {
  it("HIDDEN + TOGGLE → CONNECTING with showBar", () => {
    const r = transition("HIDDEN", "TOGGLE");
    expect(r.next).toBe("CONNECTING");
    expect(r.shouldShow).toBe(true);
    expect(r.shouldHide).toBe(false);
  });

  it("HIDDEN ignores non-TOGGLE events", () => {
    expect(transition("HIDDEN", "CONNECTED").next).toBe("HIDDEN");
    expect(transition("HIDDEN", "CLOSE").next).toBe("HIDDEN");
    expect(transition("HIDDEN", "CONNECTION_ERROR").next).toBe("HIDDEN");
  });

  it("CONNECTING + CONNECTED → LISTENING", () => {
    expect(transition("CONNECTING", "CONNECTED").next).toBe("LISTENING");
  });

  it("CONNECTING + PERMISSION_DENIED → ERROR", () => {
    expect(transition("CONNECTING", "PERMISSION_DENIED").next).toBe("ERROR");
  });

  it("CONNECTING + CONNECTION_ERROR → ERROR", () => {
    expect(transition("CONNECTING", "CONNECTION_ERROR").next).toBe("ERROR");
  });

  it("CONNECTING + TOGGLE → HIDDEN with hideBar", () => {
    const r = transition("CONNECTING", "TOGGLE");
    expect(r.next).toBe("HIDDEN");
    expect(r.shouldHide).toBe(true);
  });

  it("CONNECTING + CLEAR → CONNECTING", () => {
    const r = transition("CONNECTING", "CLEAR");
    expect(r.next).toBe("CONNECTING");
    expect(r.shouldShow).toBe(false);
    expect(r.shouldHide).toBe(false);
  });

  it("LISTENING + STOP_WORD_DETECTED → PROCESSING", () => {
    expect(transition("LISTENING", "STOP_WORD_DETECTED").next).toBe("PROCESSING");
  });

  it("LISTENING + TOGGLE → HIDDEN", () => {
    expect(transition("LISTENING", "TOGGLE").next).toBe("HIDDEN");
  });

  it("LISTENING + CLOSE → HIDDEN", () => {
    expect(transition("LISTENING", "CLOSE").next).toBe("HIDDEN");
  });

  it("LISTENING + CLEAR → CONNECTING", () => {
    expect(transition("LISTENING", "CLEAR").next).toBe("CONNECTING");
  });

  it("LISTENING + PAUSE → PAUSED", () => {
    expect(transition("LISTENING", "PAUSE").next).toBe("PAUSED");
  });

  it("PAUSED + RESUME → RESUMING", () => {
    const r = transition("PAUSED", "RESUME");
    expect(r.next).toBe("RESUMING");
    expect(r.shouldShow).toBe(false);
    expect(r.shouldHide).toBe(false);
  });

  it("PAUSED + CLEAR → CONNECTING", () => {
    expect(transition("PAUSED", "CLEAR").next).toBe("CONNECTING");
  });

  it("PAUSED + TOGGLE → HIDDEN", () => {
    const r = transition("PAUSED", "TOGGLE");
    expect(r.next).toBe("HIDDEN");
    expect(r.shouldHide).toBe(true);
  });

  it("PAUSED + CLOSE → HIDDEN", () => {
    const r = transition("PAUSED", "CLOSE");
    expect(r.next).toBe("HIDDEN");
    expect(r.shouldHide).toBe(true);
  });

  it("PAUSED ignores irrelevant events", () => {
    expect(transition("PAUSED", "CONNECTED").next).toBe("PAUSED");
    expect(transition("PAUSED", "STOP_WORD_DETECTED").next).toBe("PAUSED");
    expect(transition("PAUSED", "CONNECTION_ERROR").next).toBe("PAUSED");
  });

  it("RESUMING + CONNECTED → LISTENING", () => {
    const r = transition("RESUMING", "CONNECTED");
    expect(r.next).toBe("LISTENING");
    expect(r.shouldShow).toBe(false);
    expect(r.shouldHide).toBe(false);
  });

  it("RESUMING + CONNECTION_ERROR → ERROR", () => {
    expect(transition("RESUMING", "CONNECTION_ERROR").next).toBe("ERROR");
  });

  it("RESUMING + CLEAR → CONNECTING", () => {
    expect(transition("RESUMING", "CLEAR").next).toBe("CONNECTING");
  });

  it("RESUMING + CLOSE → HIDDEN", () => {
    const r = transition("RESUMING", "CLOSE");
    expect(r.next).toBe("HIDDEN");
    expect(r.shouldHide).toBe(true);
  });

  it("RESUMING ignores irrelevant events", () => {
    expect(transition("RESUMING", "STOP_WORD_DETECTED").next).toBe("RESUMING");
    expect(transition("RESUMING", "PAUSE").next).toBe("RESUMING");
  });

  // ── CRIT-01 regression: stream failure while LISTENING must not be ignored ──
  it("LISTENING + CONNECTION_ERROR → ERROR (stream failure mid-listen)", () => {
    const r = transition("LISTENING", "CONNECTION_ERROR");
    expect(r.next).toBe("ERROR");
    // Should neither show nor hide the bar — stays visible in error state.
    expect(r.shouldHide).toBe(false);
    expect(r.shouldShow).toBe(false);
  });

  // ── CRIT-01 regression: stream failure while PROCESSING must not be ignored ─
  it("PROCESSING + CONNECTION_ERROR → ERROR (stream failure mid-pipeline)", () => {
    const r = transition("PROCESSING", "CONNECTION_ERROR");
    expect(r.next).toBe("ERROR");
    expect(r.shouldHide).toBe(false);
    expect(r.shouldShow).toBe(false);
  });

  it("PROCESSING + LLM_DONE → INSERTING", () => {
    expect(transition("PROCESSING", "LLM_DONE").next).toBe("INSERTING");
  });

  it("PROCESSING + LLM_ERROR → INSERTING (pipeline continues)", () => {
    expect(transition("PROCESSING", "LLM_ERROR").next).toBe("INSERTING");
  });

  it("INSERTING + INSERT_SUCCESS → SUCCESS", () => {
    expect(transition("INSERTING", "INSERT_SUCCESS").next).toBe("SUCCESS");
  });

  it("INSERTING + INSERT_ERROR → ERROR", () => {
    expect(transition("INSERTING", "INSERT_ERROR").next).toBe("ERROR");
  });

  it("INSERTING + CLEAR → CONNECTING", () => {
    expect(transition("INSERTING", "CLEAR").next).toBe("CONNECTING");
  });

  it("SUCCESS + AUTO_RETURN → LISTENING", () => {
    expect(transition("SUCCESS", "AUTO_RETURN").next).toBe("LISTENING");
  });

  // ── IMP-03 regression: ERROR auto-returns to LISTENING for stream errors ──
  it("ERROR + AUTO_RETURN → LISTENING (stream error recovery path)", () => {
    expect(transition("ERROR", "AUTO_RETURN").next).toBe("LISTENING");
  });

  it("SUCCESS + TOGGLE → HIDDEN", () => {
    expect(transition("SUCCESS", "TOGGLE").next).toBe("HIDDEN");
  });

  it("ERROR + CLOSE → HIDDEN", () => {
    expect(transition("ERROR", "CLOSE").next).toBe("HIDDEN");
  });

  it("ERROR + TOGGLE → HIDDEN (user can abort error display)", () => {
    expect(transition("ERROR", "TOGGLE").next).toBe("HIDDEN");
  });

  it("ERROR + CLEAR → CONNECTING", () => {
    expect(transition("ERROR", "CLEAR").next).toBe("CONNECTING");
  });

  it("never leaks shouldShow AND shouldHide simultaneously", () => {
    const states = [
      "HIDDEN", "CONNECTING", "LISTENING", "PAUSED", "RESUMING", "PROCESSING",
      "INSERTING", "SUCCESS", "ERROR",
    ] as const;
    const events = [
      "TOGGLE", "CLOSE", "CONNECTED", "CONNECTION_ERROR",
      "PERMISSION_DENIED", "STOP_WORD_DETECTED", "LLM_DONE", "LLM_ERROR",
      "INSERT_SUCCESS", "INSERT_ERROR", "AUTO_RETURN", "CLEAR",
      "PAUSE", "RESUME",
    ] as const;

    for (const state of states) {
      for (const event of events) {
        const r = transition(state, event);
        expect(
          r.shouldShow && r.shouldHide,
          `${state} + ${event} leaked both shouldShow and shouldHide`
        ).toBe(false);
      }
    }
  });
});

// ─── Bar state machine: isActiveState ─────────────────────────────────────

describe("isActiveState", () => {
  it("returns false for HIDDEN", () => {
    expect(isActiveState("HIDDEN")).toBe(false);
  });

  it("returns true for all active states", () => {
    const activeStates = [
      "CONNECTING", "LISTENING", "PAUSED", "RESUMING", "PROCESSING",
      "INSERTING", "SUCCESS", "ERROR",
    ] as const;
    for (const state of activeStates) {
      expect(isActiveState(state)).toBe(true);
    }
  });
});

// ─── Connection error recovery scenarios (IMP-03 / CRIT-01) ──────────────

describe("connection error recovery — state sequences", () => {
  /**
   * Simulate the state sequence a stream error produces during LISTENING.
   * Expected: LISTENING → ERROR → LISTENING (stream error recovery path).
   */
  it("stream error during LISTENING produces ERROR then returns to LISTENING via AUTO_RETURN", () => {
    let state = transition("HIDDEN", "TOGGLE").next;        // → CONNECTING
    state = transition(state, "CONNECTED").next;            // → LISTENING
    state = transition(state, "CONNECTION_ERROR").next;     // → ERROR  (CRIT-01)
    expect(state).toBe("ERROR");
    state = transition(state, "AUTO_RETURN").next;          // → LISTENING (IMP-03)
    expect(state).toBe("LISTENING");
  });

  /**
   * Simulate the startup error path (PERMISSION_DENIED before CONNECTED).
   * Expected: CONNECTING → ERROR and remains visible until explicit CLOSE.
   */
  it("startup permission failure stays in ERROR until user closes", () => {
    let state = transition("HIDDEN", "TOGGLE").next;        // → CONNECTING
    state = transition(state, "PERMISSION_DENIED").next;    // → ERROR
    expect(state).toBe("ERROR");
    // No implicit close event is emitted by the state machine.
    state = transition(state, "PERMISSION_GRANTED").next;
    expect(state).toBe("ERROR");

    // User explicitly closes the HUD.
    state = transition(state, "CLOSE").next;                // → HIDDEN
    expect(state).toBe("HIDDEN");
  });

  /**
   * Simulate the startup error path (no API key).
   * Expected: CONNECTING → ERROR and remains visible until explicit CLOSE.
   */
  it("startup key-missing failure stays in ERROR until user closes", () => {
    let state = transition("HIDDEN", "TOGGLE").next;        // → CONNECTING
    state = transition(state, "CONNECTION_ERROR").next;     // → ERROR
    expect(state).toBe("ERROR");
    state = transition(state, "CLOSE").next;                // → HIDDEN
    expect(state).toBe("HIDDEN");
  });

  it("insert failure stays in ERROR until user closes", () => {
    let state = transition("HIDDEN", "TOGGLE").next;          // → CONNECTING
    state = transition(state, "CONNECTED").next;              // → LISTENING
    state = transition(state, "STOP_WORD_DETECTED").next;     // → PROCESSING
    state = transition(state, "LLM_DONE").next;               // → INSERTING
    state = transition(state, "INSERT_ERROR").next;           // → ERROR
    expect(state).toBe("ERROR");
    state = transition(state, "CLOSE").next;                  // → HIDDEN
    expect(state).toBe("HIDDEN");
  });

  /**
   * Simulate stream error during PROCESSING (CRIT-01 extension).
   * Expected: PROCESSING → ERROR → LISTENING via AUTO_RETURN.
   */
  it("stream error during PROCESSING routes to ERROR then recovers to LISTENING", () => {
    let state = transition("HIDDEN", "TOGGLE").next;        // → CONNECTING
    state = transition(state, "CONNECTED").next;            // → LISTENING
    state = transition(state, "STOP_WORD_DETECTED").next;   // → PROCESSING
    state = transition(state, "CONNECTION_ERROR").next;     // → ERROR  (CRIT-01)
    expect(state).toBe("ERROR");
    state = transition(state, "AUTO_RETURN").next;          // → LISTENING
    expect(state).toBe("LISTENING");
  });

  /**
   * User pressing TOGGLE during error display should always reach HIDDEN,
   * regardless of whether it was a startup or mid-session error.
   */
  it("TOGGLE during ERROR display always reaches HIDDEN", () => {
    const r = transition("ERROR", "TOGGLE");
    expect(r.next).toBe("HIDDEN");
    expect(r.shouldHide).toBe(true);
  });
});

// ─── Shortcut display labels (shortcut-display.ts) ───────────────────────

describe("canonicalToMacosLabel", () => {
  it("maps Alt → Option", () => {
    expect(canonicalToMacosLabel("Alt")).toBe("Option");
  });

  it("maps Super → Command", () => {
    expect(canonicalToMacosLabel("Super")).toBe("Command");
  });

  it("passes Control through unchanged", () => {
    expect(canonicalToMacosLabel("Control")).toBe("Control");
  });

  it("passes Shift through unchanged", () => {
    expect(canonicalToMacosLabel("Shift")).toBe("Shift");
  });

  it("passes letter keys through unchanged", () => {
    expect(canonicalToMacosLabel("K")).toBe("K");
    expect(canonicalToMacosLabel("Space")).toBe("Space");
  });
});

describe("shortcutCanonicalToDisplay — macOS label regression", () => {
  it("converts Control+Alt+Super+K to Control+Option+Command+K", () => {
    expect(shortcutCanonicalToDisplay("Control+Alt+Super+K")).toBe(
      "Control+Option+Command+K",
    );
  });

  it("converts Alt+Shift+Space to Option+Shift+Space", () => {
    expect(shortcutCanonicalToDisplay("Alt+Shift+Space")).toBe(
      "Option+Shift+Space",
    );
  });

  it("converts Super+K to Command+K", () => {
    expect(shortcutCanonicalToDisplay("Super+K")).toBe("Command+K");
  });

  it("passes Control+Shift+K through unchanged", () => {
    expect(shortcutCanonicalToDisplay("Control+Shift+K")).toBe(
      "Control+Shift+K",
    );
  });

  it("handles single token without + separator", () => {
    expect(shortcutCanonicalToDisplay("Super")).toBe("Command");
    expect(shortcutCanonicalToDisplay("Alt")).toBe("Option");
  });

  it("does not mutate the canonical runtime shortcut string", () => {
    const canonical = "Control+Alt+Super+K";
    const display = shortcutCanonicalToDisplay(canonical);

    expect(canonical).toBe("Control+Alt+Super+K");
    expect(display).toBe("Control+Option+Command+K");
  });
});
