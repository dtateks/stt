/**
 * Stop word detector — detects "thank you" (or custom) at end of transcript.
 *
 * Normalizes text before matching: removes punctuation, collapses spaces,
 * lowercases. So "Thank You", "thank.you", "THANK  YOU!" all match.
 */

class StopWordDetector {
  constructor(stopWord = "thank you") {
    this.stopWord = stopWord;
  }

  /**
   * Normalize text for comparison:
   * - Remove punctuation
   * - Collapse multiple spaces
   * - Trim
   * - Lowercase
   */
  _normalize(text) {
    return text
      .replace(/[.,!?;:'"()\[\]{}]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  /**
   * Check if transcript ends with stop word (after normalization).
   * Returns { detected, command } where command has stop word stripped.
   */
  process(transcript) {
    const normalizedTranscript = this._normalize(transcript);
    const normalizedStopWord = this._normalize(this.stopWord);

    if (!normalizedTranscript.endsWith(normalizedStopWord)) {
      return { detected: false, command: "" };
    }

    // Map normalized stop-word position back to original transcript
    const stopWordStart =
      normalizedTranscript.length - normalizedStopWord.length;

    const trimmed = transcript.trim();
    let origIndex = 0;
    let normCount = 0;

    for (let i = 0; i < trimmed.length && normCount < stopWordStart; i++) {
      const char = trimmed[i];
      // Only count chars that survive normalization
      if (!/[.,!?;:'"()\[\]{}]/.test(char)) {
        if (char === " " || /\s/.test(char)) {
          // Only count if not collapsing multiple spaces
          if (i === 0 || !/\s/.test(trimmed[i - 1])) {
            normCount++;
          }
        } else {
          normCount++;
        }
      }
      origIndex = i + 1;
    }

    const command = trimmed.substring(0, origIndex).trim();
    return { detected: true, command };
  }
}
