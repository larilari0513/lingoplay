class PCMCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Int16Array(2400); this.offset = 0; this.port.onmessage = e => { if (e.data === 'flush') { this.flush(); this.port.postMessage({ flushed: true }); } }; }
  flush() { if (this.offset) { const bytes = this.buffer.slice(0, this.offset).buffer; this.port.postMessage(bytes, [bytes]); this.offset = 0; } }
  process(inputs, outputs) {
    const channels = inputs[0];
    if (channels?.length) for (let i = 0; i < channels[0].length; i++) {
      let sample = 0; for (const channel of channels) sample += channel[i]; sample /= channels.length;
      sample = Math.max(-1, Math.min(1, sample)); this.buffer[this.offset++] = Math.round(sample * (sample < 0 ? 32768 : 32767));
      if (this.offset === this.buffer.length) this.flush();
    }
    for (const output of outputs) for (const channel of output) channel.fill(0);
    return true;
  }
}
registerProcessor('pcm-capture', PCMCapture);
