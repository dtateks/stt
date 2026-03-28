import type { VoiceToTextBridge } from "./types.ts";

const BRIDGE_READY_POLL_MS = 10;
const BRIDGE_READY_TIMEOUT_MS = 10_000;

export function waitForVoiceToTextBridge(): Promise<VoiceToTextBridge> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    const check = (): void => {
      const bridge = (window as Window & { voiceToText?: VoiceToTextBridge }).voiceToText;
      if (bridge) {
        resolve(bridge);
        return;
      }

      if (Date.now() - startedAt >= BRIDGE_READY_TIMEOUT_MS) {
        reject(new Error("Voice to Text bridge was not injected"));
        return;
      }

      window.setTimeout(check, BRIDGE_READY_POLL_MS);
    };

    check();
  });
}
