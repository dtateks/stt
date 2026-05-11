/**
 * LLM transcript-correction retry policy.
 *
 * Concentrates everything provider-error-shape-specific the bar session
 * controller used to inline:
 *   - attempt count
 *   - retryable HTTP status codes (provider-API-error message format)
 *   - retryable error-message patterns (network/timeout-shaped failures)
 *   - cancellation-aware retry loop
 *
 * The controller now drives correction through one seam
 * (`correctTranscriptWithRetry`) and gets back a tagged result; mapping
 * the result to a state-machine event (`LLM_DONE` / `LLM_ERROR`) stays in
 * the controller because that's an orchestration decision, not retry
 * policy.
 *
 * `isStillCurrent` is checked after each await — both the success path
 * and the catch path — so a cancelled session never resolves into a
 * spurious success or failure. This mirrors the legacy inline placement
 * exactly; do not move the checks.
 *
 * Helpers (`shouldRetryLlmCorrectionError`,
 * `extractProviderApiErrorStatusCode`) stay private. Callers that need to
 * tune retry behaviour for a new provider edit this file, not the
 * controller.
 */
import type { LlmRequestOptions, OutputLang } from "./types.ts";

export const LLM_CORRECTION_ATTEMPT_COUNT = 3;

const RETRYABLE_LLM_HTTP_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const PROVIDER_API_ERROR_STATUS_PATTERN = /API error \((\d{3})(?: [A-Z_]+)?\):/i;
const RETRYABLE_LLM_ERROR_MESSAGE_PATTERNS = [
  /timed out after/i,
  /error sending request/i,
  /error trying to connect/i,
  /connection reset/i,
  /connection refused/i,
  /dns error/i,
  /network/i,
];

export type CorrectionResult =
  | { kind: "success"; text: string }
  | { kind: "cancelled" }
  | { kind: "failed"; error: unknown };

export interface CorrectTranscriptOptions {
  /** The user-spoken text to correct. */
  text: string;
  outputLang: OutputLang;
  llmOptions: LlmRequestOptions;
  /**
   * Bridge call. Separated from the retry algorithm so the policy can
   * be tested with a fake fetcher.
   */
  correctTranscript: (
    text: string,
    outputLang: OutputLang,
    llmOptions: LlmRequestOptions,
  ) => Promise<string>;
  /**
   * Cancellation predicate checked after each await. If it ever returns
   * false, the helper returns `{ kind: "cancelled" }` instead of either
   * a success or a failure result.
   */
  isStillCurrent: () => boolean;
}

export async function correctTranscriptWithRetry(
  options: CorrectTranscriptOptions,
): Promise<CorrectionResult> {
  const { text, outputLang, llmOptions, correctTranscript, isStillCurrent } = options;

  for (let attempt = 0; attempt < LLM_CORRECTION_ATTEMPT_COUNT; attempt += 1) {
    try {
      const corrected = await correctTranscript(text, outputLang, llmOptions);
      if (!isStillCurrent()) {
        return { kind: "cancelled" };
      }
      return { kind: "success", text: corrected };
    } catch (error) {
      if (!isStillCurrent()) {
        return { kind: "cancelled" };
      }
      const isLastAttempt = attempt === LLM_CORRECTION_ATTEMPT_COUNT - 1;
      if (isLastAttempt || !shouldRetryLlmCorrectionError(error)) {
        return { kind: "failed", error };
      }
    }
  }

  // Unreachable: the loop either returns success, cancelled, or failed
  // before exhausting attempts. Guarded for the type system.
  return { kind: "failed", error: new Error("LLM correction exhausted retries") };
}

function shouldRetryLlmCorrectionError(error: unknown): boolean {
  const message = formatErrorMessage(error);
  const statusCode = extractProviderApiErrorStatusCode(message);

  if (statusCode !== null) {
    return RETRYABLE_LLM_HTTP_STATUS_CODES.has(statusCode);
  }

  return RETRYABLE_LLM_ERROR_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

function extractProviderApiErrorStatusCode(message: string): number | null {
  const matchedStatusCode = message.match(PROVIDER_API_ERROR_STATUS_PATTERN)?.[1];
  if (!matchedStatusCode) {
    return null;
  }

  const statusCode = Number.parseInt(matchedStatusCode, 10);
  return Number.isNaN(statusCode) ? null : statusCode;
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error.trim();
  }

  return "Unknown error";
}
