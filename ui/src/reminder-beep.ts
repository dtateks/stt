/**
 * Audible reminder beep player.
 *
 * Owns the shared `AudioContext` + the oscillator+gain wiring needed to
 * play a single short tone. The factory does NOT own the reminder
 * interval or the state-machine gate — those stay in the bar session
 * controller because:
 *   - the 60-second `setInterval` is called from 7 controller paths
 *     (state transitions, prefs refresh, error recovery)
 *   - the `LISTENING`-only guard inside the interval callback reads
 *     controller state directly; folding it in would either re-add a
 *     `getState()` callback (extra indirection for one bool) or expose
 *     start/stop the controller would still drive from the same 7 sites
 *     (no net win)
 *
 * Single-method public surface (`play()`) — explicit dispose isn't worth
 * the API weight; the AudioContext lives for the page lifetime in the
 * legacy code and there's no compelling reason to change that.
 *
 * Preserved invariants from the inline implementation:
 *   - closed-state context rebuild (iOS / Safari can close audio
 *     contexts under memory pressure)
 *   - suspended-state resume (some browsers suspend on tab inactivity)
 *   - osc + gain disconnect on `onended` so nodes don't leak across
 *     repeated beeps
 *   - whole `play()` body wrapped in one try/catch — `new AudioContext()`
 *     throws in jsdom, and the catch is what keeps the controller's 51
 *     vitest cases green
 */

const BEEP_FREQUENCY_HZ = 880;
const BEEP_PEAK_GAIN = 0.05;
const BEEP_DECAY_TARGET = 0.001;
const BEEP_DURATION_S = 0.3;

export interface ReminderBeepPlayer {
  /** Play one short tone. Failures are warned and swallowed. */
  play(): void;
}

export function createReminderBeepPlayer(): ReminderBeepPlayer {
  let cachedContext: AudioContext | null = null;

  return {
    play(): void {
      try {
        if (!cachedContext || cachedContext.state === "closed") {
          cachedContext = new AudioContext();
        }

        const ctx = cachedContext;

        if (ctx.state === "suspended") {
          void ctx.resume();
        }

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "sine";
        osc.frequency.value = BEEP_FREQUENCY_HZ;
        gain.gain.setValueAtTime(BEEP_PEAK_GAIN, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(BEEP_DECAY_TARGET, ctx.currentTime + BEEP_DURATION_S);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + BEEP_DURATION_S);

        osc.onended = () => {
          osc.disconnect();
          gain.disconnect();
        };
      } catch (error) {
        const message = error instanceof Error && error.message.trim().length > 0
          ? error.message.trim()
          : typeof error === "string" && error.trim().length > 0
            ? error.trim()
            : "Unknown error";
        console.warn("[audio] reminder beep skipped", message);
      }
    },
  };
}
