import { shortcutCanonicalToDisplay } from "./shortcut-display.ts";

const SHORTCUT_PLACEHOLDER_HTML = "<span class=\"shortcut-placeholder\">Click to record shortcut</span>";

export function renderShortcutRecorderState(
  recorder: HTMLElement,
  shortcut: string,
): void {
  if (!shortcut || shortcut === "Press keys…") {
    delete recorder.dataset.shortcut;
    recorder.innerHTML = SHORTCUT_PLACEHOLDER_HTML;
    return;
  }

  recorder.dataset.shortcut = shortcut;

  const parts = shortcutCanonicalToDisplay(shortcut).split("+");
  const html = parts
    .map((part) => `<span class="shortcut-key">${escapeHtml(part)}</span>`)
    .join('<span class="shortcut-separator">+</span>');

  recorder.innerHTML = `<span class="shortcut-keys">${html}</span>`;
}

export function readShortcutRecorderShortcut(recorder: HTMLElement): string | null {
  return recorder.dataset.shortcut || null;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
