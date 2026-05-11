/**
 * Main window auto-fit: keeps the OS window height tracking the
 * settings panel's content height.
 *
 * Owns:
 *   - debounced setTimeout that batches rapid layout changes into one
 *     bridge call
 *   - ResizeObserver on the target element (when the runtime has one)
 *   - self-disposal when the target detaches from the DOM (jsdom test
 *     teardown clears `document.body`; a late-firing timer would
 *     otherwise call into a disposed environment or a missing bridge)
 *
 * Auto-start: observation begins at construction. Callers store the
 * returned handle only to keep the closure alive; explicit `dispose()`
 * is provided for symmetry but not currently used (page-lifetime
 * fire-and-forget).
 *
 * The `fit` callback is optional because the bridge type declares
 * `fitMainWindowToContent?(...)`. Missing-bridge-method silently skips
 * the call — preserving the legacy "best effort sizing, never blocks
 * setup" semantic.
 *
 * Sizing failures are swallowed in the factory's catch block: the
 * window stays its current size and the user can resize manually if
 * needed. Treat sizing as advisory.
 */

const DEBOUNCE_MS = 80;

export interface MainWindowAutoFitOptions {
  /** Element whose `scrollHeight` drives the requested window height. */
  targetEl: HTMLElement;
  /** Bridge call. Optional — missing-on-bridge silently no-ops. */
  fit?: (contentHeight: number) => Promise<void>;
}

export interface MainWindowAutoFit {
  /** Cancel the pending timer + disconnect the observer. Idempotent. */
  dispose(): void;
}

export function createMainWindowAutoFit(options: MainWindowAutoFitOptions): MainWindowAutoFit {
  const { targetEl, fit } = options;

  let pendingFitTimer: ReturnType<typeof setTimeout> | null = null;
  let resizeObserver: ResizeObserver | null = null;

  function dispose(): void {
    if (pendingFitTimer !== null) {
      clearTimeout(pendingFitTimer);
      pendingFitTimer = null;
    }
    if (resizeObserver !== null) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
  }

  async function fitToContent(): Promise<void> {
    if (!fit) {
      return;
    }

    const contentHeight = Math.ceil(targetEl.scrollHeight);
    try {
      await fit(contentHeight);
    } catch {
      // Non-fatal: sizing is best effort and should never block setup.
    }
  }

  function scheduleFit(): void {
    if (pendingFitTimer !== null) {
      clearTimeout(pendingFitTimer);
    }

    pendingFitTimer = setTimeout(() => {
      pendingFitTimer = null;
      // Guard against the panel being detached (e.g. test teardown
      // clearing document.body). Without this, a late-firing timer
      // would call into a disposed jsdom environment or a missing
      // bridge.
      if (!targetEl.isConnected) {
        return;
      }
      void fitToContent();
    }, DEBOUNCE_MS);
  }

  scheduleFit();

  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      if (!targetEl.isConnected) {
        // Target detached — self-dispose so a stale callback never
        // fires against a missing bridge.
        dispose();
        return;
      }
      scheduleFit();
    });
    resizeObserver.observe(targetEl);
  }

  return { dispose };
}
