'use strict';
const { OpenAIService } = require('./api.cjs');
const { language, safeError } = require('./core.cjs');
function wav(pcm) {
  const header = Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8); header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40); return Buffer.concat([header, pcm]);
}
// A bounded push-to-talk turn. Speech recognition gives the text translator an explicit source,
// avoiding opaque speech-to-speech substitutions. No recording is written to disk.
class SpeechTurn {
  constructor(key, target, emit, { game = '', glossary = '', synthesize = false } = {}, fetchImpl = fetch) { this.key = key; this.target = language(target); this.emit = emit; this.game = game; this.glossary = glossary; this.synthesize = synthesize; this.fetch = fetchImpl; this.api = new OpenAIService(() => this.key, fetchImpl); this.state = 'idle'; this.chunks = []; this.length = 0; this.energy = 0; this.controller = new AbortController(); }
  async start() { if (!this.key) throw new Error('설정에서 OpenAI API 키를 입력해 주세요.'); this.state = 'streaming'; this.emit({ type: 'ready' }); }
  append(bytes) {
    if (this.state !== 'streaming') return;
    const chunk = Buffer.from(bytes); if (chunk.length > 48000 || chunk.length % 2) throw new Error('음성 데이터 형식 오류');
    if (this.length + chunk.length > 48000 * 20) { this.emit({ type: 'error', message: '한 번에 20초까지 말할 수 있어요. 짧게 나누어 다시 말해 주세요.' }); this.cancel(); return; }
    for (let i = 0; i < chunk.length; i += 2) this.energy += Math.abs(chunk.readInt16LE(i)); this.length += chunk.length; this.chunks.push(chunk);
  }
  async request(path, body, json, binary = false) {
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(45000)]);
    const response = await this.fetch(`https://api.openai.com/v1${path}`, { method: 'POST', headers: { Authorization: `Bearer ${this.key}`, ...(json ? { 'Content-Type': 'application/json' } : {}) }, body: json ? JSON.stringify(body) : body, signal });
    if (!response.ok) { if (response.status === 401) throw new Error('API 키를 확인해 주세요.'); if (response.status === 429) throw new Error('OpenAI API 잔액 또는 사용 한도를 확인해 주세요.'); throw new Error(`음성 처리 실패 (${response.status}). API 모델 권한을 확인해 주세요.`); }
    return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
  }
  async finish() {
    if (this.state !== 'streaming') return this.cancel(); this.state = 'draining';
    try {
      if (this.length < 9600 || this.energy / (this.length / 2) < 50) throw new Error('말소리가 충분히 들리지 않았어요. 마이크를 확인하고 다시 말해 주세요.');
      const form = new FormData(); form.append('model', 'gpt-4o-mini-transcribe'); form.append('file', new Blob([wav(Buffer.concat(this.chunks))], { type: 'audio/wav' }), 'speech.wav');
      if (this.game) form.append('prompt', `A player speaking during ${this.game}.`);
      this.chunks = []; this.emit({ type: 'processing', stage: '말한 내용을 인식하고 있어요…' });
      const transcript = await this.request('/audio/transcriptions', form, false); if (this.state === 'closed') return;
      if (!transcript.text?.trim()) throw new Error('말소리를 인식하지 못했어요. 다시 말해 주세요.');
      this.emit({ type: 'transcript', delta: transcript.text }); this.emit({ type: 'processing', stage: '외국어로 번역하고 있어요…' });
      const translated = await this.api.translate({ text: transcript.text, target: this.target, game: this.game, glossary: this.glossary }); if (this.state === 'closed') return;
      this.emit({ type: 'translation', delta: translated.translated });
      if (this.synthesize) { this.emit({ type: 'processing', stage: '번역 음성을 만들고 있어요…' }); const pcm = await this.request('/audio/speech', { model: 'gpt-4o-mini-tts', voice: 'coral', input: translated.translated, response_format: 'pcm', instructions: 'Speak naturally and clearly, like a friendly teammate. Read only the supplied text.' }, true, true); if (this.state === 'closed') return; this.emit({ type: 'audio', data: pcm.toString('base64') }); }
      this.emit({ type: 'drained' }); this.cancel();
    } catch (e) { if (this.state !== 'closed') { this.emit({ type: 'error', message: safeError(e.name === 'AbortError' || e.name === 'TimeoutError' ? '음성 요청이 중지되었거나 시간이 초과됐어요.' : e) }); this.cancel(); } }
  }
  cancel() { if (this.state === 'closed') return; this.state = 'closed'; this.controller.abort(); this.api.abort(); this.chunks = []; this.key = ''; this.emit({ type: 'closed' }); }
}
module.exports = { SpeechTurn, wav };
