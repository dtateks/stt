/**
 * Bar finite state machine.
 *
 * Transitions are pure functions — no side effects — making them testable
 * and auditable independently of the DOM.
 */

import type { BarState } from "./types.ts";

export type BarEvent =
  | "TOGGLE"
  | "PERMISSION_GRANTED"
  | "PERMISSION_DENIED"
  | "CONNECTED"
  | "CONNECTION_ERROR"
  | "STOP_WORD_DETECTED"
  | "LLM_DONE"
  | "LLM_ERROR"
  | "INSERT_SUCCESS"
  | "INSERT_ERROR"
  | "AUTO_RETURN"
  | "CLOSE"
  | "CLEAR";

export interface TransitionResult {
  next: BarState;
  /** True when this transition should show bar (native side must show the window). */
  shouldShow: boolean;
  /** True when this transition should hide bar. */
  shouldHide: boolean;
}

/**
 * Pure transition function. Returns the next state given current state + event.
 * Unknown events in a given state are silently ignored (return current state).
 */
export function transition(state: BarState, event: BarEvent): TransitionResult {
  const show = { shouldShow: true, shouldHide: false };
  const hide = { shouldShow: false, shouldHide: true };
  const noop = { shouldShow: false, shouldHide: false };

  switch (state) {
    case "HIDDEN":
      if (event === "TOGGLE") return { next: "CONNECTING", ...show };
      return { next: state, ...noop };

    case "CONNECTING":
      if (event === "CONNECTED") return { next: "LISTENING", ...noop };
      if (event === "PERMISSION_DENIED") return { next: "ERROR", ...noop };
      if (event === "CONNECTION_ERROR") return { next: "ERROR", ...noop };
      if (event === "CLEAR") return { next: "CONNECTING", ...noop };
      if (event === "TOGGLE" || event === "CLOSE")
        return { next: "HIDDEN", ...hide };
      return { next: state, ...noop };

    case "LISTENING":
      if (event === "STOP_WORD_DETECTED") return { next: "PROCESSING", ...noop };
      // Stream failure while listening — surface as recoverable error.
      if (event === "CONNECTION_ERROR") return { next: "ERROR", ...noop };
      if (event === "CLEAR") return { next: "CONNECTING", ...noop };
      if (event === "TOGGLE" || event === "CLOSE")
        return { next: "HIDDEN", ...hide };
      return { next: state, ...noop };

    case "PROCESSING":
      if (event === "LLM_DONE") return { next: "INSERTING", ...noop };
      if (event === "LLM_ERROR") return { next: "INSERTING", ...noop };
      // Stream failure mid-processing — surface as recoverable error.
      if (event === "CONNECTION_ERROR") return { next: "ERROR", ...noop };
      if (event === "CLEAR") return { next: "CONNECTING", ...noop };
      if (event === "TOGGLE" || event === "CLOSE")
        return { next: "HIDDEN", ...hide };
      return { next: state, ...noop };

    case "INSERTING":
      if (event === "INSERT_SUCCESS") return { next: "SUCCESS", ...noop };
      if (event === "INSERT_ERROR") return { next: "ERROR", ...noop };
      if (event === "CLEAR") return { next: "CONNECTING", ...noop };
      if (event === "TOGGLE" || event === "CLOSE")
        return { next: "HIDDEN", ...hide };
      return { next: state, ...noop };

    case "SUCCESS":
      if (event === "AUTO_RETURN") return { next: "LISTENING", ...noop };
      if (event === "CLEAR") return { next: "CONNECTING", ...noop };
      if (event === "TOGGLE" || event === "CLOSE")
        return { next: "HIDDEN", ...hide };
      return { next: state, ...noop };

    case "ERROR":
      if (event === "AUTO_RETURN") return { next: "LISTENING", ...noop };
      if (event === "CLEAR") return { next: "CONNECTING", ...noop };
      if (event === "TOGGLE" || event === "CLOSE")
        return { next: "HIDDEN", ...hide };
      return { next: state, ...noop };

    default:
      return { next: state, ...noop };
  }
}

/**
 * Returns true when the bar is in an active (non-hidden) state.
 */
export function isActiveState(state: BarState): boolean {
  return state !== "HIDDEN";
}
