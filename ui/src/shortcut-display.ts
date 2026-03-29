/**
 * Pure helpers for converting between canonical runtime shortcut tokens and
 * macOS-facing display labels.
 *
 * Canonical (storage/runtime) tokens: Control | Alt | Shift | Super
 * macOS display labels:               Control | Option | Shift | Command
 *
 * Keep this module free of DOM, bridge, and side effects so it can be unit-tested.
 */

const CANONICAL_TO_MACOS: Record<string, string> = {
  Alt: "Option",
  Super: "Command",
};

/**
 * Convert a single canonical token to its macOS display label.
 * Tokens that have no platform alias (Control, Shift, letter keys) pass through unchanged.
 */
export function canonicalToMacosLabel(token: string): string {
  return CANONICAL_TO_MACOS[token] ?? token;
}

/**
 * Convert a full canonical shortcut string (e.g. "Control+Alt+Super+K") to a
 * display string with macOS labels (e.g. "Control+Option+Command+K").
 */
export function shortcutCanonicalToDisplay(canonical: string): string {
  return canonical
    .split("+")
    .map(canonicalToMacosLabel)
    .join("+");
}
