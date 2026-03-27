/**
 * AudioWorklet processor for PCM S16LE capture.
 *
 * Runs in the isolated audio thread. Converts Float32 samples to Int16 and
 * posts binary ArrayBuffer chunks back to the main thread.
 *
 * Loaded via AudioContext.audioWorklet.addModule() — must be a separate file.
 */

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._chunkSize = options?.processorOptions?.chunkSize ?? 4096;
    this._buffer = new Int16Array(this._chunkSize);
    this._bufferIndex = 0;
  }

  process(inputs) {
    const channelData = inputs?.[0]?.[0];
    if (!channelData) return true;

    for (let i = 0; i < channelData.length; i++) {
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      this._buffer[this._bufferIndex++] =
        sample < 0 ? sample * 32768 : sample * 32767;

      if (this._bufferIndex >= this._chunkSize) {
        const chunk = this._buffer.slice(0);
        this.port.postMessage(chunk.buffer, [chunk.buffer]);
        this._buffer = new Int16Array(this._chunkSize);
        this._bufferIndex = 0;
      }
    }

    return true;
  }
}

registerProcessor("pcm-capture-processor", PcmCaptureProcessor);
