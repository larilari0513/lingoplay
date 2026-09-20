'use strict';
// Energy-based speech segmentation, not local speech recognition. Runs on the
// 24 kHz mono PCM already captured by the app and never writes audio to disk.
class SpeechSegments {
  constructor(onSegment, { threshold = 200, silenceMs = 550, maxMs = 6000 } = {}) {
    this.onSegment = onSegment; this.threshold = threshold; this.silenceBytes = silenceMs * 48; this.maxBytes = maxMs * 48; this.reset();
  }
  reset() { this.remainder = Buffer.alloc(0); this.before = []; this.beforeBytes = 0; this.frames = []; this.bytes = 0; this.voiced = 0; this.quiet = 0; }
  append(bytes) {
    const data = Buffer.from(bytes);
    if (data.length > 48000 || data.length % 2) throw new Error('음성 데이터 형식 오류');
    const pcm = Buffer.concat([this.remainder, data]);
    let offset = 0;
    for (; offset + 960 <= pcm.length; offset += 960) this.frame(pcm.subarray(offset, offset + 960));
    this.remainder = Buffer.from(pcm.subarray(offset));
  }
  frame(pcm) {
    if (!pcm.length) return;
    let energy = 0; for (let i = 0; i < pcm.length; i += 2) energy += Math.abs(pcm.readInt16LE(i));
    const speech = energy / (pcm.length / 2) >= this.threshold;
    if (!this.frames.length && !speech) {
      this.before.push(Buffer.from(pcm)); this.beforeBytes += pcm.length;
      while (this.beforeBytes > 9600) this.beforeBytes -= this.before.shift().length;
      return;
    }
    if (!this.frames.length) { this.frames = this.before; this.bytes = this.beforeBytes; this.before = []; this.beforeBytes = 0; }
    this.frames.push(Buffer.from(pcm)); this.bytes += pcm.length;
    if (speech) { this.voiced += pcm.length; this.quiet = 0; } else this.quiet += pcm.length;
    if (this.quiet >= this.silenceBytes || this.bytes >= this.maxBytes) this.flush();
  }
  flush() {
    const segment = this.voiced >= 5760 ? Buffer.concat(this.frames) : null; // 120 ms: keep short calls such as "No!".
    this.frames = []; this.bytes = 0; this.voiced = 0; this.quiet = 0;
    if (segment) this.onSegment(segment);
  }
  finish() { const remainder = this.remainder; this.remainder = Buffer.alloc(0); this.frame(remainder); this.flush(); this.before = []; this.beforeBytes = 0; }
}
module.exports = { SpeechSegments };
