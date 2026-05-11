/**
 * Status-line helper bound to a single feedback element.
 *
 * Replaces the repeated setXxxStatus/clearXxxStatus pairs in main.ts.
 * Success messages auto-clear after `autoClearMs`; errors stay visible
 * until replaced or explicitly cleared. A new error or success cancels any
 * scheduled clear so later messages cannot be wiped by a stale timer.
 */
export interface StatusField {
  setSuccess(message: string): void;
  setError(message: string): void;
  clear(): void;
}

export interface StatusFieldOptions {
  autoClearMs?: number;
}

const DEFAULT_AUTO_CLEAR_MS = 4_000;

export function statusField(
  element: HTMLElement,
  options: StatusFieldOptions = {},
): StatusField {
  const autoClearMs = options.autoClearMs ?? DEFAULT_AUTO_CLEAR_MS;
  let timerId: ReturnType<typeof setTimeout> | null = null;

  function cancelScheduledClear(): void {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  }

  function applyMessage(message: string, kind: "success" | "error"): void {
    element.textContent = message;
    element.classList.toggle("is-error", kind === "error");
    element.classList.toggle("is-success", kind === "success");
  }

  function clear(): void {
    cancelScheduledClear();
    element.textContent = "";
    element.classList.remove("is-error", "is-success");
  }

  function setSuccess(message: string): void {
    cancelScheduledClear();
    applyMessage(message, "success");
    timerId = setTimeout(() => {
      timerId = null;
      clear();
    }, autoClearMs);
  }

  function setError(message: string): void {
    cancelScheduledClear();
    applyMessage(message, "error");
  }

  return { setSuccess, setError, clear };
}
