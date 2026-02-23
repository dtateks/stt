/**
 * Soniox STT client — runs in renderer process.
 *
 * Uses Web Audio API for mic capture, WebSocket for Soniox streaming.
 *
 * CRITICAL PROTOCOL:
 * 1. Send JSON config FIRST (text frame)
 * 2. Then binary audio ONLY (no more JSON!)
 */

class SonioxSTT {
  constructor() {
    this.ws = null;
    this.audioContext = null;
    this.processor = null;
    this.stream = null;
    this.transcript = "";
    this.onTranscript = null; // (fullTranscript, finalTranscript, hasFinal) => void
    this.onError = null; // (error) => void
    this.sonioxConfig = null; // loaded from config.json
  }

  /**
   * Set Soniox config from config.json (called once at init).
   */
  setConfig(sonioxConfig) {
    this.sonioxConfig = sonioxConfig;
  }

  /**
   * Start mic capture and connect to Soniox.
   * @param {string} apiKey
   * @param {object} [context] - Soniox context injection object
   */
  async start(apiKey, context) {
    if (!this.sonioxConfig) {
      throw new Error("Soniox config not set — call setConfig() first");
    }

    const cfg = this.sonioxConfig;
    this.transcript = "";

    // Get microphone
    console.log("[stt] Requesting mic...");
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: cfg.num_channels,
        sampleRate: { ideal: cfg.sample_rate },
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    // Set up Web Audio pipeline
    this.audioContext = new AudioContext({ sampleRate: cfg.sample_rate });
    const source = this.audioContext.createMediaStreamSource(this.stream);

    // ScriptProcessorNode for raw PCM access
    this.processor = this.audioContext.createScriptProcessor(
      cfg.chunk_size || 4096,
      cfg.num_channels,
      cfg.num_channels
    );

    console.log("[stt] Mic OK, sample rate:", this.audioContext.sampleRate);

    // Connect to Soniox WebSocket
    console.log("[stt] Connecting to", cfg.ws_url);
    this.ws = new WebSocket(cfg.ws_url);

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Soniox connection timeout")),
        10000
      );
      this.ws.onopen = () => {
        clearTimeout(timeout);
        resolve();
      };
      this.ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("Soniox connection failed"));
      };
    });

    console.log("[stt] Connected! Sending config...");

    // CRITICAL: Send JSON config as FIRST message
    const initMsg = {
      api_key: apiKey,
      model: cfg.model,
      sample_rate: cfg.sample_rate,
      num_channels: cfg.num_channels,
      audio_format: cfg.audio_format,
    };
    if (cfg.language_hints) initMsg.language_hints = cfg.language_hints;
    if (cfg.language_hints_strict != null)
      initMsg.language_hints_strict = cfg.language_hints_strict;
    if (context) initMsg.context = context;

    console.log("[stt] Init msg:", JSON.stringify(initMsg, null, 2));
    this.ws.send(JSON.stringify(initMsg));

    // Handle incoming tokens
    this.ws.onmessage = (event) => this._handleMessage(event);
    this.ws.onerror = (e) => {
      console.error("[stt] WS error:", e);
      this.onError?.(new Error("Soniox WebSocket error"));
    };
    this.ws.onclose = (e) => {
      console.log("[stt] WS closed: code=" + e.code + " reason=" + e.reason);
    };

    // Stream audio chunks as binary
    this.processor.onaudioprocess = (e) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        const float32 = e.inputBuffer.getChannelData(0);
        const int16 = this._float32ToInt16(float32);
        this.ws.send(int16.buffer);
      }
    };

    source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
    console.log("[stt] Audio pipeline connected, streaming...");
  }

  /**
   * Stop mic and disconnect.
   */
  stop() {
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Reset accumulated transcript.
   */
  resetTranscript() {
    this.transcript = "";
  }

  /**
   * Handle Soniox WebSocket message — parse tokens, accumulate transcript.
   */
  _handleMessage(event) {
    try {
      const data = JSON.parse(event.data);

      if (data.error_message) {
        this.onError?.(new Error(data.error_message));
        return;
      }

      const tokens = data.tokens || [];
      let finalText = "";
      let interimText = "";

      for (const token of tokens) {
        if (token.is_final) {
          finalText += token.text;
        } else {
          interimText += token.text;
        }
      }

      if (finalText) {
        this.transcript += finalText;
      }

      const fullTranscript = this.transcript + interimText;
      this.onTranscript?.(fullTranscript, this.transcript, !!finalText);
    } catch (err) {
      console.error("STT message parse error:", err);
    }
  }

  /**
   * Convert Float32 audio samples to Int16 PCM.
   */
  _float32ToInt16(float32) {
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16;
  }
}
