/**
 * Soniox STT client.
 *
 * Protocol rules (from contract):
 * - First WebSocket frame: JSON config object
 * - All subsequent frames: binary ArrayBuffer (PCM S16LE)
 * - Incoming messages: JSON token objects; accumulate final/interim separately
 */

import type {
  SonioxConfig,
  SonioxContext,
  SonioxSTTClient,
  TranscriptCallback,
  ErrorCallback,
} from "./types.ts";
import pcmCaptureProcessorUrl from "./pcm-capture-processor.js?url&no-inline";

interface SonioxToken {
  text: string;
  is_final: boolean;
  start_ms?: number;
  end_ms?: number;
}

interface SonioxMessage {
  tokens?: SonioxToken[];
  error?: string;
  error_code?: string;
  error_message?: string;
}

interface SonioxControlMessage {
  type: "finalize";
}

interface PendingFinalization {
  fallbackTranscript: string;
  resolve: (finalizedTranscript: string) => void;
  reject: (error: Error) => void;
}

export class SonioxClient implements SonioxSTTClient {
  onTranscript: TranscriptCallback | null = null;
  onError: ErrorCallback | null = null;

  private config: SonioxConfig | null = null;
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private mediaStream: MediaStream | null = null;
  private finalText = "";
  private interimText = "";
  private active = false;
  private pendingFinalization: PendingFinalization | null = null;

  setConfig(config: SonioxConfig): void {
    this.config = config;
  }

  async start(apiKey: string, context: SonioxContext): Promise<void> {
    if (!this.config) throw new Error("Soniox config not set before start()");
    if (this.active) this.stop();

    this.active = true;
    this.finalText = "";
    this.interimText = "";
    this.pendingFinalization = null;

    await this.initAudio();
    this.openWebSocket(apiKey, context);
  }

  stop(): void {
    this.active = false;
    this.rejectPendingFinalization(new Error("Soniox session stopped before finalization completed"));
    this.closeWebSocket();
    this.releaseAudio();
  }

  async finalizeCurrentUtterance(fallbackTranscript: string): Promise<string> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Soniox connection is not open");
    }
    if (this.pendingFinalization) {
      throw new Error("Soniox finalization is already in progress");
    }

    const finalizedTranscript = new Promise<string>((resolve, reject) => {
      this.pendingFinalization = {
        fallbackTranscript,
        resolve,
        reject,
      };
    });

    const finalizeControlMessage: SonioxControlMessage = { type: "finalize" };
    this.ws.send(JSON.stringify(finalizeControlMessage));

    return finalizedTranscript;
  }

  resetTranscript(): void {
    this.finalText = "";
    this.interimText = "";
    this.emitTranscript();
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyserNode;
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private async initAudio(): Promise<void> {
    const config = this.config!;

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: config.sample_rate,
        channelCount: config.num_channels,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    this.audioContext = new AudioContext({ sampleRate: config.sample_rate });

    await this.audioContext.audioWorklet.addModule(pcmCaptureProcessorUrl);

    const source = this.audioContext.createMediaStreamSource(this.mediaStream);

    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 256;

    this.workletNode = new AudioWorkletNode(
      this.audioContext,
      "pcm-capture-processor",
      { processorOptions: { chunkSize: config.chunk_size } }
    );

    this.workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(event.data);
      }
    };

    source.connect(this.analyserNode);
    source.connect(this.workletNode);
  }

  private openWebSocket(apiKey: string, context: SonioxContext): void {
    const config = this.config!;
    this.ws = new WebSocket(config.ws_url);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      // First frame: JSON config — required by Soniox protocol
      const payloadContext = {
        ...(config.context_general?.length && {
          general: config.context_general,
        }),
        ...(config.context_text?.trim() && {
          text: config.context_text.trim(),
        }),
        ...(context.terms?.length && {
          terms: context.terms,
        }),
        ...(context.translationTerms?.length && {
          translation_terms: context.translationTerms.map((term) => ({
            source: term.source,
            target: term.target,
          })),
        }),
      };

      const initFrame = {
        api_key: apiKey,
        model: config.model,
        sample_rate: config.sample_rate,
        num_channels: config.num_channels,
        audio_format: config.audio_format,
        ...(config.enable_endpoint_detection !== undefined && {
          enable_endpoint_detection: config.enable_endpoint_detection,
        }),
        ...(config.max_endpoint_delay_ms !== undefined && {
          max_endpoint_delay_ms: config.max_endpoint_delay_ms,
        }),
        ...(config.max_non_final_tokens_duration_ms !== undefined && {
          max_non_final_tokens_duration_ms: config.max_non_final_tokens_duration_ms,
        }),
        ...(config.language_hints?.length && {
          language_hints: config.language_hints,
          language_hints_strict: config.language_hints_strict ?? false,
        }),
        ...(Object.keys(payloadContext).length > 0 && {
          context: payloadContext,
        }),
      };

      this.ws!.send(JSON.stringify(initFrame));
    };

    this.ws.onmessage = (event: MessageEvent) => {
      if (!this.active) return;
      this.handleMessage(event.data as string);
    };

    this.ws.onerror = () => {
      if (!this.active) return;
      this.rejectPendingFinalization(new Error("Soniox WebSocket error"));
      this.onError?.(new Error("Soniox WebSocket error"));
    };

    this.ws.onclose = (event) => {
      if (!this.active) return;
      this.rejectPendingFinalization(
        new Error(`Soniox connection closed before finalization completed (code ${event.code})`),
      );
      if (!event.wasClean) {
        this.onError?.(new Error(`Soniox connection closed (code ${event.code})`));
      }
    };
  }

  private handleMessage(raw: string): void {
    let message: SonioxMessage;
    try {
      message = JSON.parse(raw) as SonioxMessage;
    } catch {
      return;
    }

    if (message.error || message.error_message) {
      const errorCode = message.error_code?.trim();
      const errorMessage =
        message.error_message?.trim() ||
        message.error?.trim() ||
        "Unknown Soniox error";
      const details = errorCode ? `${errorCode}: ${errorMessage}` : errorMessage;
      const formattedError = new Error(`Soniox error: ${details}`);
      this.rejectPendingFinalization(formattedError);
      this.onError?.(formattedError);
      return;
    }

    if (!message.tokens) return;

    // Accumulate final tokens; replace interim tokens
    let newFinal = this.finalText;
    let newInterim = "";
    let receivedFinalizationMarker = false;

    for (const token of message.tokens) {
      if (token.text === "<fin>" || token.text === "<end>") {
        receivedFinalizationMarker = true;
        continue;
      }

      if (token.is_final) {
        newFinal += token.text;
      } else {
        newInterim += token.text;
      }
    }

    this.finalText = newFinal;
    this.interimText = newInterim;
    this.emitTranscript();

    if (receivedFinalizationMarker) {
      const finalizedTranscript = `${this.finalText} ${this.interimText}`.trim();
      const pendingFinalization = this.pendingFinalization;
      if (pendingFinalization) {
        this.pendingFinalization = null;
        pendingFinalization.resolve(
          finalizedTranscript.length > 0
            ? finalizedTranscript
            : pendingFinalization.fallbackTranscript,
        );
      }
    }
  }

  private emitTranscript(): void {
    this.onTranscript?.({
      finalText: this.finalText,
      interimText: this.interimText,
    });
  }

  private closeWebSocket(): void {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  private rejectPendingFinalization(error: Error): void {
    if (!this.pendingFinalization) {
      return;
    }

    const pendingFinalization = this.pendingFinalization;
    this.pendingFinalization = null;
    pendingFinalization.reject(error);
  }

  private releaseAudio(): void {
    this.workletNode?.disconnect();
    this.analyserNode?.disconnect();
    this.mediaStream?.getTracks().forEach((t) => { t.stop(); });
    this.audioContext?.close();

    this.workletNode = null;
    this.analyserNode = null;
    this.mediaStream = null;
    this.audioContext = null;
  }
}
