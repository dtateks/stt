class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const processorOptions = options.processorOptions || {};
    this.chunkSize = processorOptions.chunkSize || 4096;
    this.pendingChunk = new Float32Array(this.chunkSize);
    this.pendingOffset = 0;
  }

  process(inputs, outputs) {
    const inputChannels = inputs[0];
    const outputChannels = outputs[0] || [];

    for (const outputChannel of outputChannels) {
      outputChannel.fill(0);
    }

    if (!inputChannels || inputChannels.length === 0) {
      return true;
    }

    const inputSamples = inputChannels[0];
    if (!inputSamples || inputSamples.length === 0) {
      return true;
    }

    let readOffset = 0;
    while (readOffset < inputSamples.length) {
      const remainingChunkSpace = this.chunkSize - this.pendingOffset;
      const samplesToCopy = Math.min(
        remainingChunkSpace,
        inputSamples.length - readOffset
      );

      this.pendingChunk.set(
        inputSamples.subarray(readOffset, readOffset + samplesToCopy),
        this.pendingOffset
      );

      this.pendingOffset += samplesToCopy;
      readOffset += samplesToCopy;

      if (this.pendingOffset === this.chunkSize) {
        const completedChunk = this.pendingChunk;
        this.port.postMessage(completedChunk.buffer, [completedChunk.buffer]);
        this.pendingChunk = new Float32Array(this.chunkSize);
        this.pendingOffset = 0;
      }
    }

    return true;
  }
}

registerProcessor("pcm-capture-processor", PcmCaptureProcessor);
