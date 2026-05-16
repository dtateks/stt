import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readShortcutRecorderShortcut,
  renderShortcutRecorderState,
} from "../shortcut-recorder-logic.ts";

function createRecorder(): HTMLButtonElement {
  const recorder = document.createElement("button");
  recorder.type = "button";
  return recorder;
}

describe("shortcut recorder logic", () => {
  let recorder: HTMLButtonElement;

  beforeEach(() => {
    recorder = createRecorder();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders macOS labels while keeping the canonical shortcut in dataset storage", () => {
    renderShortcutRecorderState(recorder, "Control+Alt+Super+K");

    const renderedKeys = Array.from(recorder.querySelectorAll(".shortcut-key")).map(
      (el) => el.textContent,
    );

    expect(renderedKeys).toEqual(["Control", "Option", "Command", "K"]);
    expect(recorder.dataset.shortcut).toBe("Control+Alt+Super+K");
  });

  it("renders Windows labels while keeping the canonical shortcut in dataset storage", () => {
    renderShortcutRecorderState(recorder, "Control+Alt+Super+K", "windows");

    const renderedKeys = Array.from(recorder.querySelectorAll(".shortcut-key")).map(
      (el) => el.textContent,
    );

    expect(renderedKeys).toEqual(["Ctrl", "Alt", "Win", "K"]);
    expect(recorder.dataset.shortcut).toBe("Control+Alt+Super+K");
  });

  it("reads the canonical shortcut back from dataset storage", () => {
    renderShortcutRecorderState(recorder, "Control+Alt+Shift+Super+K");

    expect(readShortcutRecorderShortcut(recorder)).toBe("Control+Alt+Shift+Super+K");
  });

  it("clears dataset storage when placeholder state is rendered", () => {
    renderShortcutRecorderState(recorder, "Control+Alt+Super+K");
    renderShortcutRecorderState(recorder, "");

    expect(readShortcutRecorderShortcut(recorder)).toBeNull();
    expect(recorder.querySelector(".shortcut-placeholder")?.textContent).toBe(
      "Click to record shortcut",
    );
  });

  it("treats the in-progress 'Press keys…' sentinel as a placeholder", () => {
    renderShortcutRecorderState(recorder, "Control+Alt+Super+K");
    renderShortcutRecorderState(recorder, "Press keys…");

    // The sentinel must clear dataset and render the placeholder copy, so
    // the recorder's idle and in-progress states are visually distinct
    // from a real canonical shortcut.
    expect(readShortcutRecorderShortcut(recorder)).toBeNull();
    expect(recorder.querySelector(".shortcut-placeholder")?.textContent).toBe(
      "Click to record shortcut",
    );
  });

  it("readShortcutRecorderShortcut returns null when no shortcut was ever rendered", () => {
    expect(readShortcutRecorderShortcut(recorder)).toBeNull();
  });

  it("renders the macOS '+' separator between every adjacent key span", () => {
    renderShortcutRecorderState(recorder, "Control+Alt+Super+K");

    const separators = recorder.querySelectorAll(".shortcut-separator");
    // For 4 keys, there are 3 separators between them.
    expect(separators).toHaveLength(3);
    for (const sep of separators) {
      expect(sep.textContent).toBe("+");
    }
  });

  it("renders a single-key shortcut without trailing separators", () => {
    renderShortcutRecorderState(recorder, "F1");

    const renderedKeys = Array.from(recorder.querySelectorAll(".shortcut-key")).map(
      (el) => el.textContent,
    );
    expect(renderedKeys).toEqual(["F1"]);
    expect(recorder.querySelectorAll(".shortcut-separator")).toHaveLength(0);
  });
});
