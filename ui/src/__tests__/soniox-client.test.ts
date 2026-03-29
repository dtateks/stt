import { describe, expect, it, vi } from "vitest";

import type { TranscriptResult } from "../types.ts";
import { SonioxClient } from "../soniox-client.ts";

describe("SonioxClient", () => {
  it("keeps marker tokens out of visible transcript text", () => {
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
        finalText: "hello ",
        interimText: "world",
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
});
