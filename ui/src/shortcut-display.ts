/**
 * Pure helpers for converting between canonical runtime shortcut tokens and
 * macOS-facing display labels.
 *
 * Canonical (storage/runtime) tokens: Control | Alt | Shift | Super
 * macOS display labels:               Control | Option | Shift | Command
 *
 * Keep this module free of DOM, bridge, and side effects so it can be unit-tested.
 */

export type ShortcutDisplayMode = "macos" | "windows";

const CANONICAL_TO_MACOS: Record<string, string> = {
  Alt: "Option",
  Super: "Command",
};

const CANONICAL_TO_WINDOWS: Record<string, string> = {
  Control: "Ctrl",
  Super: "Win",
};

const CANONICAL_TO_DISPLAY_LABELS: Record<ShortcutDisplayMode, Record<string, string>> = {
  macos: CANONICAL_TO_MACOS,
  windows: CANONICAL_TO_WINDOWS,
};

/**
 * Convert a single canonical token to its macOS display label.
 * Tokens that have no platform alias (Control, Shift, letter keys) pass through unchanged.
 */
export function canonicalToMacosLabel(token: string): string {
  return CANONICAL_TO_MACOS[token] ?? token;
}

export function canonicalToDisplayLabel(
  token: string,
  shortcutDisplay: ShortcutDisplayMode = "macos",
): string {
  return CANONICAL_TO_DISPLAY_LABELS[shortcutDisplay][token] ?? token;
}

/**
 * Convert a full canonical shortcut string (e.g. "Control+Alt+Super+K") to a
 * display string with macOS labels (e.g. "Control+Option+Command+K").
 */
export function shortcutCanonicalToDisplay(
  canonical: string,
  shortcutDisplay: ShortcutDisplayMode = "macos",
): string {
  return canonical
    .split("+")
    .map((token) => canonicalToDisplayLabel(token, shortcutDisplay))
    .join("+");
}
