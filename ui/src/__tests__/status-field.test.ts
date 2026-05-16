import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { statusField } from "../status-field.ts";

function buildElement(): HTMLDivElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

describe("statusField", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("setSuccess", () => {
    it("writes the message text and tags the element with is-success", () => {
      const el = buildElement();
      const field = statusField(el);

      field.setSuccess("Saved.");

      expect(el.textContent).toBe("Saved.");
      expect(el.classList.contains("is-success")).toBe(true);
      expect(el.classList.contains("is-error")).toBe(false);
    });

    it("auto-clears after the default 4-second window", () => {
      const el = buildElement();
      const field = statusField(el);

      field.setSuccess("Saved.");
      vi.advanceTimersByTime(3_999);
      expect(el.textContent).toBe("Saved.");

      vi.advanceTimersByTime(1);
      expect(el.textContent).toBe("");
      expect(el.classList.contains("is-success")).toBe(false);
    });

    it("honors a custom autoClearMs", () => {
      const el = buildElement();
      const field = statusField(el, { autoClearMs: 200 });

      field.setSuccess("Saved.");
      vi.advanceTimersByTime(199);
      expect(el.textContent).toBe("Saved.");
      vi.advanceTimersByTime(1);
      expect(el.textContent).toBe("");
    });

    it("strips a prior is-error class when transitioning success → error → success → …", () => {
      const el = buildElement();
      const field = statusField(el);

      field.setError("Boom.");
      expect(el.classList.contains("is-error")).toBe(true);

      field.setSuccess("Recovered.");
      expect(el.classList.contains("is-error")).toBe(false);
      expect(el.classList.contains("is-success")).toBe(true);
    });
  });

  describe("setError", () => {
    it("writes the message and tags the element with is-error", () => {
      const el = buildElement();
      const field = statusField(el);

      field.setError("Boom.");

      expect(el.textContent).toBe("Boom.");
      expect(el.classList.contains("is-error")).toBe(true);
      expect(el.classList.contains("is-success")).toBe(false);
    });

    it("does NOT auto-clear", () => {
      const el = buildElement();
      const field = statusField(el);

      field.setError("Boom.");
      vi.advanceTimersByTime(60_000);

      expect(el.textContent).toBe("Boom.");
      expect(el.classList.contains("is-error")).toBe(true);
    });

    it("cancels a pending auto-clear from an earlier success so the error stays visible", () => {
      const el = buildElement();
      const field = statusField(el);

      field.setSuccess("Saved.");
      vi.advanceTimersByTime(3_000);
      field.setError("Boom.");

      // Past the original 4s deadline — the cancelled timer must not wipe the error.
      vi.advanceTimersByTime(2_000);
      expect(el.textContent).toBe("Boom.");
      expect(el.classList.contains("is-error")).toBe(true);
    });
  });

  describe("clear", () => {
    it("removes message text and both kind classes", () => {
      const el = buildElement();
      const field = statusField(el);

      field.setSuccess("Saved.");
      field.clear();

      expect(el.textContent).toBe("");
      expect(el.classList.contains("is-success")).toBe(false);
      expect(el.classList.contains("is-error")).toBe(false);
    });

    it("cancels any pending auto-clear so a later message is not wiped", () => {
      const el = buildElement();
      const field = statusField(el);

      field.setSuccess("Saved.");
      field.clear();

      field.setError("Boom.");
      vi.advanceTimersByTime(5_000);

      expect(el.textContent).toBe("Boom.");
      expect(el.classList.contains("is-error")).toBe(true);
    });
  });

  describe("rapid success → success", () => {
    it("each new success message resets the auto-clear timer", () => {
      const el = buildElement();
      const field = statusField(el);

      field.setSuccess("First.");
      vi.advanceTimersByTime(3_500);

      field.setSuccess("Second.");
      // The clock is now 3.5s into the original timer, but the second
      // setSuccess should have cancelled it. After +1s we are 4.5s past
      // the first call — but only 1s past the second — so the message
      // should still be visible.
      vi.advanceTimersByTime(1_000);
      expect(el.textContent).toBe("Second.");

      // After the full new 4s have elapsed it auto-clears.
      vi.advanceTimersByTime(3_000);
      expect(el.textContent).toBe("");
    });
  });
});
