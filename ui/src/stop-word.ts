/**
 * Stop-word detection with normalized suffix matching.
 *
 * Normalization: strip punctuation, collapse whitespace, trim, lowercase.
 * Detection: final transcript ends with the normalized stop word.
 */

export function normalizeText(text: string): string {
  return text
    .replace(/[^\w\s]/g, "")  // strip punctuation
    .replace(/\s+/g, " ")     // collapse whitespace
    .trim()
    .toLowerCase();
}

/**
 * Returns true if the normalized form of `text` ends with the normalized
 * form of `stopWord`.
 */
export function detectStopWord(text: string, stopWord: string): boolean {
  if (!stopWord.trim()) return false;

  const normalizedText = normalizeText(text);
  const normalizedStop = normalizeText(stopWord);

  if (!normalizedText || !normalizedStop) return false;

  return normalizedText.endsWith(normalizedStop);
}

/**
 * Strips the stop word from the end of `text` and returns the cleaned command.
 * Assumes detectStopWord returned true. Strips trailing whitespace/punctuation
 * from the result.
 */
export function stripStopWord(text: string, stopWord: string): string {
  const normalizedText = normalizeText(text);
  const normalizedStop = normalizeText(stopWord);

  // Find the last occurrence of normalizedStop in normalizedText
  const idx = normalizedText.lastIndexOf(normalizedStop);
  if (idx === -1) return text.trim();

  // Map back: we need to strip the stop word from the *original* text.
  // Since normalization removes punct and collapses spaces, we approximate
  // by trimming the right side of the original by the character length delta.
  // A safe approach: strip from the original text's end proportionally.
  const remainder = normalizedText.slice(0, idx).trimEnd();

  // Rebuild from original text by taking enough leading characters
  // that map to remainder length (approximate but faithful for latin scripts).
  if (!remainder) return "";

  // Walk the original to reconstruct the pre-stopword portion
  let kept = "";
  let keptNorm = "";
  for (const ch of text) {
    const norm = ch.replace(/[^\w\s]/g, "").replace(/\s+/, " ").toLowerCase();
    if ((keptNorm + norm).trimEnd() === remainder) {
      kept += ch;
      break;
    }
    kept += ch;
    keptNorm = (keptNorm + norm).replace(/\s+/g, " ");
  }

  return kept.replace(/[\s,;.!?]+$/, "").trim();
}
