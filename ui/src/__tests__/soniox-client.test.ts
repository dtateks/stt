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
});
