import { describe, expect, it, vi } from "vitest";

import type { SonioxConfig, TranscriptResult } from "../types.ts";
import { SonioxClient } from "../soniox-client.ts";

describe("SonioxClient", () => {
  it("promotes pending transcript text into final text when a finalization marker arrives", () => {
    const client = new SonioxClient();
    const transcriptUpdates: TranscriptResult[] = [];
    client.onTranscript = (result) => transcriptUpdates.push(result);

    (client as unknown as { active: boolean }).active = true;

    (client as unknown as { handleMessage(raw: string): void }).handleMessage(
      JSON.stringify({
        tokens: [
          { text: "hello ", is_final: true },
          { text: "<fin>", is_final: true },
          { text: "world", is_final: false },
          { text: "<end>", is_final: false },
        ],
      }),
    );

    expect(transcriptUpdates).toEqual([
      {
        finalText: "hello world",
        interimText: "",
      },
    ]);
  });

  it("resolves pending manual finalization when fin marker arrives", () => {
    const client = new SonioxClient();
    const resolve = vi.fn();
    const reject = vi.fn();

    (client as unknown as { active: boolean }).active = true;
    (client as unknown as { finalText: string }).finalText = "ship ";
    (client as unknown as { interimText: string }).interimText = "";
    (client as unknown as {
      pendingFinalization: {
        fallbackTranscript: string;
        resolve: (text: string) => void;
        reject: (error: Error) => void;
      };
    }).pendingFinalization = {
      fallbackTranscript: "fallback",
      resolve,
      reject,
    };

    (client as unknown as { handleMessage(raw: string): void }).handleMessage(
      JSON.stringify({
        tokens: [
          { text: "update", is_final: true },
          { text: "<fin>", is_final: true },
        ],
      }),
    );

    expect(resolve).toHaveBeenCalledWith("ship update");
    expect(reject).not.toHaveBeenCalled();
  });

  it("surfaces server error code and message", () => {
    const client = new SonioxClient();
    const onError = vi.fn();

    client.onError = onError;
    (client as unknown as { active: boolean }).active = true;

    (client as unknown as { handleMessage(raw: string): void }).handleMessage(
      JSON.stringify({
        error_code: "unauthorized",
        error_message: "invalid key",
      }),
    );

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Soniox error: unauthorized: invalid key" }),
    );
  });

  it("sends Soniox terms without translation_terms in the init frame", async () => {
    const sentFrames: string[] = [];

    class MockWebSocket {
      static OPEN = 1;
      binaryType = "";
      readyState = MockWebSocket.OPEN;
      onopen: (() => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;

      constructor(_url: string) {
        queueMicrotask(() => {
          this.onopen?.();
        });
      }

      send(frame: string): void {
        sentFrames.push(frame);
      }

      close(): void {}
    }

    const client = new SonioxClient();
    const config: SonioxConfig = {
      ws_url: "wss://example.test/stt",
      model: "stt-rt-v4",
      sample_rate: 16_000,
      num_channels: 1,
      audio_format: "pcm_s16le",
      chunk_size: 4_096,
      context_general: [{ key: "domain", value: "software" }],
      context_text: "CLI tools and code terms",
    };

    client.setConfig(config);
    vi.stubGlobal("WebSocket", MockWebSocket);

    (client as unknown as { openWebSocket(apiKey: string, context: { terms: string[] }): void }).openWebSocket(
      "temporary-key",
      { terms: ["Claude Code", "tmux"] },
    );

    expect(sentFrames).toHaveLength(0);

    await Promise.resolve();

    expect(sentFrames).toHaveLength(1);
    expect(JSON.parse(sentFrames[0])).toEqual({
      api_key: "temporary-key",
      model: "stt-rt-v4",
      sample_rate: 16_000,
      num_channels: 1,
      audio_format: "pcm_s16le",
      context: {
        general: [{ key: "domain", value: "software" }],
        text: "CLI tools and code terms",
        terms: ["Claude Code", "tmux"],
      },
    });
    expect(sentFrames[0]).not.toContain("translation_terms");
    vi.unstubAllGlobals();
  });

  it("accumulates final tokens while replacing interim tokens across messages", () => {
    const client = new SonioxClient();
    const transcriptUpdates: TranscriptResult[] = [];
    client.onTranscript = (result) => transcriptUpdates.push(result);

    (client as unknown as { active: boolean }).active = true;
    const dispatch = (raw: string) =>
      (client as unknown as { handleMessage(raw: string): void }).handleMessage(raw);

    dispatch(
      JSON.stringify({
        tokens: [
          { text: "hello ", is_final: true },
          { text: "wo", is_final: false },
        ],
      }),
    );
    dispatch(
      JSON.stringify({
        tokens: [
          { text: "world", is_final: true },
          { text: " typi", is_final: false },
        ],
      }),
    );
    dispatch(
      JSON.stringify({
        tokens: [{ text: "typing", is_final: false }],
      }),
    );

    // Final accumulates, interim is replaced wholesale on each update.
    expect(transcriptUpdates).toEqual([
      { finalText: "hello ", interimText: "wo" },
      { finalText: "hello world", interimText: " typi" },
      { finalText: "hello world", interimText: "typing" },
    ]);
  });

  it("promotes leftover interim into final on the finalization marker", () => {
    const client = new SonioxClient();
    const transcriptUpdates: TranscriptResult[] = [];
    client.onTranscript = (result) => transcriptUpdates.push(result);

    (client as unknown as { active: boolean }).active = true;
    const dispatch = (raw: string) =>
      (client as unknown as { handleMessage(raw: string): void }).handleMessage(raw);

    dispatch(
      JSON.stringify({
        tokens: [
          { text: "hello ", is_final: true },
          { text: "leftover", is_final: false },
          { text: "<fin>", is_final: true },
        ],
      }),
    );

    expect(transcriptUpdates.at(-1)).toEqual({
      finalText: "hello leftover",
      interimText: "",
    });
  });

  it("ignores messages with no tokens and no error fields", () => {
    const client = new SonioxClient();
    const transcriptUpdates: TranscriptResult[] = [];
    const errors: Error[] = [];
    client.onTranscript = (result) => transcriptUpdates.push(result);
    client.onError = (error) => errors.push(error);

    (client as unknown as { active: boolean }).active = true;

    (client as unknown as { handleMessage(raw: string): void }).handleMessage(
      JSON.stringify({ unrelated: "field" }),
    );

    expect(transcriptUpdates).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("surfaces error_message without error_code as 'Soniox error: <message>'", () => {
    const client = new SonioxClient();
    const onError = vi.fn();
    client.onError = onError;
    (client as unknown as { active: boolean }).active = true;

    (client as unknown as { handleMessage(raw: string): void }).handleMessage(
      JSON.stringify({ error_message: "internal upstream blip" }),
    );

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Soniox error: internal upstream blip" }),
    );
  });

  it("ignores a payload that carries only error_code (no error / error_message)", () => {
    const client = new SonioxClient();
    const onError = vi.fn();
    client.onError = onError;
    (client as unknown as { active: boolean }).active = true;

    // The error branch keys on `error` or `error_message`; a code-only
    // payload is not surfaced as an error.
    (client as unknown as { handleMessage(raw: string): void }).handleMessage(
      JSON.stringify({ error_code: "rate_limited" }),
    );

    expect(onError).not.toHaveBeenCalled();
  });

  it("rejects pending finalization when a server error arrives mid-finalization", () => {
    const client = new SonioxClient();
    const resolve = vi.fn();
    const reject = vi.fn();

    (client as unknown as { active: boolean }).active = true;
    (client as unknown as {
      pendingFinalization: {
        fallbackTranscript: string;
        resolve: (text: string) => void;
        reject: (error: Error) => void;
      };
    }).pendingFinalization = {
      fallbackTranscript: "fallback",
      resolve,
      reject,
    };

    (client as unknown as { handleMessage(raw: string): void }).handleMessage(
      JSON.stringify({ error_code: "unauthorized", error_message: "bad key" }),
    );

    expect(reject).toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  describe("WebSocket lifecycle handlers", () => {
    function makeLifecycleHarness() {
      const errors: Error[] = [];

      class MockWebSocket {
        static OPEN = 1;
        binaryType = "";
        readyState = MockWebSocket.OPEN;
        onopen: (() => void) | null = null;
        onmessage: ((event: MessageEvent) => void) | null = null;
        onerror: (() => void) | null = null;
        onclose: ((event: CloseEvent) => void) | null = null;
        constructor(_url: string) {
          queueMicrotask(() => {
            this.onopen?.();
          });
        }
        send(_frame: string): void {}
        close(): void {}
      }

      vi.stubGlobal("WebSocket", MockWebSocket);

      const client = new SonioxClient();
      client.onError = (error) => errors.push(error);

      const config: SonioxConfig = {
        ws_url: "wss://example.test/stt",
        model: "stt-rt-v4",
        sample_rate: 16_000,
        num_channels: 1,
        audio_format: "pcm_s16le",
        chunk_size: 4_096,
      };
      client.setConfig(config);

      (client as unknown as { openWebSocket(apiKey: string, context: { terms?: string[] }): void }).openWebSocket(
        "temporary-key",
        {},
      );

      return {
        client,
        errors,
        socket: (client as unknown as { ws: InstanceType<typeof MockWebSocket> }).ws,
      };
    }

    it("onerror fires onError with the canonical message while active", async () => {
      const { client, errors, socket } = makeLifecycleHarness();
      (client as unknown as { active: boolean }).active = true;

      await Promise.resolve();
      socket.onerror?.();

      expect(errors.map((e) => e.message)).toContain("Soniox WebSocket error");
      vi.unstubAllGlobals();
    });

    it("onerror is silent when the client is inactive", async () => {
      const { errors, socket } = makeLifecycleHarness();
      // active stays false (default).

      await Promise.resolve();
      socket.onerror?.();

      expect(errors).toEqual([]);
      vi.unstubAllGlobals();
    });

    it("onclose with wasClean=false fires onError naming the close code", async () => {
      const { client, errors, socket } = makeLifecycleHarness();
      (client as unknown as { active: boolean }).active = true;

      await Promise.resolve();
      socket.onclose?.({
        code: 1006,
        wasClean: false,
      } as CloseEvent);

      expect(errors.map((e) => e.message)).toContain(
        "Soniox connection closed (code 1006)",
      );
      vi.unstubAllGlobals();
    });

    it("onclose with wasClean=true does NOT fire onError (clean shutdown)", async () => {
      const { client, errors, socket } = makeLifecycleHarness();
      (client as unknown as { active: boolean }).active = true;

      await Promise.resolve();
      socket.onclose?.({
        code: 1000,
        wasClean: true,
      } as CloseEvent);

      expect(errors).toEqual([]);
      vi.unstubAllGlobals();
    });

    it("onclose rejects a pending finalization with the close-code message", async () => {
      const { client, socket } = makeLifecycleHarness();
      (client as unknown as { active: boolean }).active = true;

      const resolve = vi.fn();
      const reject = vi.fn();
      (client as unknown as {
        pendingFinalization: {
          fallbackTranscript: string;
          resolve: (text: string) => void;
          reject: (error: Error) => void;
        };
      }).pendingFinalization = {
        fallbackTranscript: "fallback",
        resolve,
        reject,
      };

      await Promise.resolve();
      socket.onclose?.({
        code: 1006,
        wasClean: false,
      } as CloseEvent);

      expect(reject).toHaveBeenCalledTimes(1);
      expect(reject.mock.calls[0]?.[0]?.message).toContain(
        "Soniox connection closed before finalization completed (code 1006)",
      );
      expect(resolve).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  });

  it("returns the fallback transcript when finalization completes with no accumulated text", () => {
    const client = new SonioxClient();
    const resolve = vi.fn();
    const reject = vi.fn();

    (client as unknown as { active: boolean }).active = true;
    (client as unknown as { finalText: string }).finalText = "";
    (client as unknown as { interimText: string }).interimText = "";
    (client as unknown as {
      pendingFinalization: {
        fallbackTranscript: string;
        resolve: (text: string) => void;
        reject: (error: Error) => void;
      };
    }).pendingFinalization = {
      fallbackTranscript: "fallback content",
      resolve,
      reject,
    };

    (client as unknown as { handleMessage(raw: string): void }).handleMessage(
      JSON.stringify({
        tokens: [{ text: "<fin>", is_final: true }],
      }),
    );

    expect(resolve).toHaveBeenCalledWith("fallback content");
    expect(reject).not.toHaveBeenCalled();
  });

});
