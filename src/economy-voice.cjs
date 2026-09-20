'use strict';
const { language, safeError } = require('./core.cjs');
const { OpenAIService } = require('./api.cjs');
const { SpeechTurn } = require('./speech-turn.cjs');
const { SpeechSegments } = require('./voice-segments.cjs');
class EconomyVoice {
  constructor(key, target, emit, options = {}, fetchImpl = fetch) {
    this.key = key; this.target = language(target); this.emit = emit; this.options = options; this.fetch = fetchImpl;
    this.state = 'idle'; this.queue = []; this.active = null; this.recent = []; this.nextId = 0;
    this.translator = new OpenAIService(() => this.key, fetchImpl, { meter: options.meter, getProfile: () => options.profile || 'balanced' });
    this.segments = new SpeechSegments(pcm => this.enqueue(pcm));
  }
  async start() { if (!this.key) throw new Error('설정에서 OpenAI API 키를 입력해 주세요.'); this.state = 'streaming'; this.emit({ type: 'ready' }); }
  append(bytes) { if (this.state === 'streaming') this.segments.append(bytes); if (this.state === 'closed') this.segments.reset(); }
  enqueue(pcm) {
    if (this.state === 'closed') return;
    if (this.queue.length >= 2) { this.fail('번역이 대화 속도를 따라가지 못해 중지했어요. 실시간 모드로 바꾸거나 연결 상태를 확인해 주세요.'); return; }
    this.queue.push({ pcm, id: String(++this.nextId), created: Date.now() }); this.process();
  }
  process() {
    if (this.active || this.state === 'closed') return;
    const item = this.queue.shift();
    if (!item) { if (this.state === 'draining') { this.emit({ type: 'drained' }); this.cancel(); } return; }
    if (Date.now() - item.created > 12000) { this.fail('번역이 지연되어 오래된 음성을 보내지 않았어요. 연결 상태를 확인한 뒤 다시 시작해 주세요.'); return; }
    let original = '', translated = '';
    const turn = new SpeechTurn(this.key, this.target, event => {
      if (this.state === 'closed') return;
      if (event.type === 'ready' || event.type === 'drained' || event.type === 'closed') return;
      if (event.type === 'error') { this.fail(event.message); return; }
      if (event.type === 'transcript') original = event.delta;
      if (event.type === 'translation') translated = event.delta;
      this.emit({ ...event, segmentId: item.id });
    }, { ...this.options, synthesize: false, skipEmpty: true, context: this.recent.join('\n').slice(-1200), translator: this.translator }, this.fetch);
    this.active = turn;
    this.emit({ type: 'turn', segmentId: item.id });
    this.processing = (async () => {
      await turn.start();
      if (this.state === 'closed') return;
      for (let offset = 0; offset < item.pcm.length; offset += 48000) turn.append(item.pcm.subarray(offset, offset + 48000));
      await turn.finish();
      if (this.state !== 'closed' && original && translated) { this.recent.push(original.slice(-600)); this.recent = this.recent.slice(-2); }
    })().catch(e => this.fail(safeError(e))).finally(() => {
      if (this.active === turn) this.active = null;
      if (this.state !== 'closed') { this.emit({ type: 'listening' }); this.process(); }
    });
  }
  finish() {
    if (this.state !== 'streaming') return;
    this.state = 'draining'; this.segments.finish(); this.process();
  }
  fail(message) { if (this.state === 'closed') return; this.emit({ type: 'error', message }); this.cancel(); }
  cancel() {
    if (this.state === 'closed') return;
    this.state = 'closed'; this.queue = []; this.segments.reset(); this.active?.cancel(); this.active = null;
    this.translator.abort(); this.translator.clearCache(); this.recent = []; this.key = ''; this.emit({ type: 'closed' });
  }
}
module.exports = { EconomyVoice };
