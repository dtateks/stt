/**
 * Pure DOM-manipulation helpers for the main window.
 *
 * These functions accept explicit element parameters instead of capturing
 * module-scope DOM references, making them importable and testable in jsdom
 * without the full index.html shell.
 *
 * main.ts is the orchestration layer that wires DOM refs to these helpers.
 */

// ─── Setup error state ────────────────────────────────────────────────────

/**
 * Surfaces a validation or runtime error on the setup form.
 * Sets aria-invalid on the Soniox input so screen readers announce the error.
 */
export function applySetupError(
  message: string,
  errorRegion: HTMLElement,
  sonioxInput: HTMLInputElement,
): void {
  errorRegion.textContent = message;
  errorRegion.classList.add("is-visible");
  sonioxInput.classList.add("has-error");
  sonioxInput.setAttribute("aria-invalid", "true");
}

/**
 * Clears any active validation error on the setup form.
 */
export function clearSetupError(
  errorRegion: HTMLElement,
  sonioxInput: HTMLInputElement,
): void {
  errorRegion.textContent = "";
  errorRegion.classList.remove("is-visible");
  sonioxInput.classList.remove("has-error");
  sonioxInput.setAttribute("aria-invalid", "false");
}

/**
 * Returns an error message if the Soniox key is empty, otherwise null.
 */
export function validateSonioxKey(value: string): string | null {
  return value.trim() ? null : "Soniox API key is required.";
}

// ─── Dialog open / close ──────────────────────────────────────────────────

/**
 * Opens the settings dialog: makes the backdrop visible and marks the dialog
 * as no longer aria-hidden.
 */
export function applyDialogOpen(
  dialog: HTMLElement,
  backdrop: HTMLElement,
): void {
  backdrop.classList.add("is-open");
  dialog.setAttribute("aria-hidden", "false");
}

/**
 * Closes the settings dialog and restores focus to the element that opened it.
 */
export function applyDialogClose(
  dialog: HTMLElement,
  backdrop: HTMLElement,
  opener: HTMLElement | null,
): void {
  backdrop.classList.remove("is-open");
  dialog.setAttribute("aria-hidden", "true");
  opener?.focus();
}
