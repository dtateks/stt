import { describe, expect, it, vi } from "vitest";

import {
  correctTranscriptWithRetry,
  LLM_CORRECTION_ATTEMPT_COUNT,
} from "../llm-correction.ts";
import type { LlmRequestOptions, OutputLang } from "../types.ts";

const LLM_OPTIONS: LlmRequestOptions = {
  provider: "xai",
  model: "grok-test",
  baseUrl: "https://example.test/v1",
};

const OUTPUT_LANG: OutputLang = "auto";
const stillCurrent = (): boolean => true;
const cancelled = (): boolean => false;

describe("correctTranscriptWithRetry", () => {
  describe("success path", () => {
    it("returns the corrected text on the first attempt", async () => {
      const correctTranscript = vi.fn(async () => "cleaned");

      const result = await correctTranscriptWithRetry({
        text: "raw",
        outputLang: OUTPUT_LANG,
        llmOptions: LLM_OPTIONS,
        correctTranscript,
        isStillCurrent: stillCurrent,
      });

      expect(result).toEqual({ kind: "success", text: "cleaned" });
      expect(correctTranscript).toHaveBeenCalledTimes(1);
    });

    it("passes the input text + outputLang + llmOptions through to the bridge call", async () => {
      const correctTranscript = vi.fn(async () => "");

      await correctTranscriptWithRetry({
        text: "raw text",
        outputLang: "english",
        llmOptions: LLM_OPTIONS,
        correctTranscript,
        isStillCurrent: stillCurrent,
      });

      expect(correctTranscript).toHaveBeenCalledWith("raw text", "english", LLM_OPTIONS);
    });
  });

  describe("cancellation", () => {
    it("returns cancelled when the success path observes a stale session", async () => {
      const correctTranscript = vi.fn(async () => "cleaned");

      const result = await correctTranscriptWithRetry({
        text: "raw",
        outputLang: OUTPUT_LANG,
        llmOptions: LLM_OPTIONS,
        correctTranscript,
        isStillCurrent: cancelled,
      });

      expect(result).toEqual({ kind: "cancelled" });
    });

    it("returns cancelled when the catch path observes a stale session", async () => {
      const correctTranscript = vi.fn(async () => {
        throw new Error("API error (429 TOO_MANY_REQUESTS): rate limited");
      });

      const result = await correctTranscriptWithRetry({
        text: "raw",
        outputLang: OUTPUT_LANG,
        llmOptions: LLM_OPTIONS,
        correctTranscript,
        isStillCurrent: cancelled,
      });

      expect(result).toEqual({ kind: "cancelled" });
      // No retry — cancellation short-circuits the loop after the first throw.
      expect(correctTranscript).toHaveBeenCalledTimes(1);
    });
  });

  describe("retry policy — HTTP status codes", () => {
    it("retries 429 and ultimately resolves the next success", async () => {
      const correctTranscript = vi
        .fn()
        .mockRejectedValueOnce(new Error("API error (429): throttled"))
        .mockResolvedValueOnce("ok");

      const result = await correctTranscriptWithRetry({
        text: "raw",
        outputLang: OUTPUT_LANG,
        llmOptions: LLM_OPTIONS,
        correctTranscript,
        isStillCurrent: stillCurrent,
      });

      expect(result).toEqual({ kind: "success", text: "ok" });
      expect(correctTranscript).toHaveBeenCalledTimes(2);
    });

    it.each([408, 500, 502, 503, 504])(
      "retries HTTP %i provider-API errors",
      async (status) => {
        const correctTranscript = vi
          .fn()
          .mockRejectedValueOnce(new Error(`API error (${status}): server hiccup`))
          .mockResolvedValueOnce("ok");

        const result = await correctTranscriptWithRetry({
          text: "raw",
          outputLang: OUTPUT_LANG,
          llmOptions: LLM_OPTIONS,
          correctTranscript,
          isStillCurrent: stillCurrent,
        });

        expect(result).toEqual({ kind: "success", text: "ok" });
        expect(correctTranscript).toHaveBeenCalledTimes(2);
      },
    );

    it("does NOT retry a non-retryable 4xx (e.g. 400)", async () => {
      const correctTranscript = vi
        .fn()
        .mockRejectedValue(new Error("API error (400): malformed request"));

      const result = await correctTranscriptWithRetry({
        text: "raw",
        outputLang: OUTPUT_LANG,
        llmOptions: LLM_OPTIONS,
        correctTranscript,
        isStillCurrent: stillCurrent,
      });

      expect(result.kind).toBe("failed");
      expect(correctTranscript).toHaveBeenCalledTimes(1);
    });

    it("does NOT retry an auth-failure 401", async () => {
      const correctTranscript = vi
        .fn()
        .mockRejectedValue(new Error("API error (401): unauthorized"));

      const result = await correctTranscriptWithRetry({
        text: "raw",
        outputLang: OUTPUT_LANG,
        llmOptions: LLM_OPTIONS,
        correctTranscript,
        isStillCurrent: stillCurrent,
      });

      expect(result.kind).toBe("failed");
      expect(correctTranscript).toHaveBeenCalledTimes(1);
    });
  });

  describe("retry policy — network-shaped error messages", () => {
    it.each([
      "request timed out after 15 seconds",
      "error sending request for url ...",
      "error trying to connect",
      "connection reset by peer",
      "connection refused",
      "dns error: name resolution failure",
      "network is unreachable",
    ])("retries on a network-shaped error: %s", async (message) => {
      const correctTranscript = vi
        .fn()
        .mockRejectedValueOnce(new Error(message))
        .mockResolvedValueOnce("ok");

      const result = await correctTranscriptWithRetry({
        text: "raw",
        outputLang: OUTPUT_LANG,
        llmOptions: LLM_OPTIONS,
        correctTranscript,
        isStillCurrent: stillCurrent,
      });

      expect(result).toEqual({ kind: "success", text: "ok" });
      expect(correctTranscript).toHaveBeenCalledTimes(2);
    });

    it("does NOT retry an unrecognised error message", async () => {
      const correctTranscript = vi
        .fn()
        .mockRejectedValue(new Error("Unhelpful upstream failure"));

      const result = await correctTranscriptWithRetry({
        text: "raw",
        outputLang: OUTPUT_LANG,
        llmOptions: LLM_OPTIONS,
        correctTranscript,
        isStillCurrent: stillCurrent,
      });

      expect(result.kind).toBe("failed");
      expect(correctTranscript).toHaveBeenCalledTimes(1);
    });
  });

  describe("attempt budget", () => {
    it(`fails after ${LLM_CORRECTION_ATTEMPT_COUNT} retryable attempts`, async () => {
      const error = new Error("API error (429): always throttled");
      const correctTranscript = vi.fn().mockRejectedValue(error);

      const result = await correctTranscriptWithRetry({
        text: "raw",
        outputLang: OUTPUT_LANG,
        llmOptions: LLM_OPTIONS,
        correctTranscript,
        isStillCurrent: stillCurrent,
      });

      expect(result).toEqual({ kind: "failed", error });
      expect(correctTranscript).toHaveBeenCalledTimes(LLM_CORRECTION_ATTEMPT_COUNT);
    });
  });
});
