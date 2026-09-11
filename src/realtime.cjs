'use strict';
const WebSocket = require('ws');
const { language, safeError } = require('./core.cjs');
class TranslationStream {
  constructor(key, target, emit, Socket = WebSocket) { this.key = key; this.target = language(target); this.emit = emit; this.Socket = Socket; this.state = 'idle'; this.socket = null; this.timers = new Set(); }
  timer(fn, ms) { const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms); this.timers.add(t); return t; }
  async start() {
    if (!this.key) throw new Error('설정에서 OpenAI API 키를 입력해 주세요.');
    this.state = 'connecting';
    return new Promise((resolve, reject) => {
      this.rejectStartup = reject;
      let ready = false;
      const fail = error => { if (this.state === 'closed') return; const message = safeError(error); if (!ready) reject(new Error(message)); this.emit({ type: 'error', message }); this.cancel(); };
      const timeout = this.timer(() => fail(new Error('음성 번역 연결 시간이 초과됐어요.')), 15000);
      const socket = this.socket = new this.Socket('wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate', { headers: { Authorization: `Bearer ${this.key}` }, handshakeTimeout: 12000, maxPayload: 2 * 1024 * 1024 });
      socket.on('open', () => this.send({ type: 'session.update', session: { audio: { output: { language: this.target } } } }));
      socket.on('message', raw => {
        if (this.state === 'closed') return;
        let e; try { e = JSON.parse(raw.toString()); } catch { return; }
        if (e.type === 'error') return fail(new Error(e.error?.message || '음성 번역 API 오류'));
        if (e.type === 'session.updated' && !ready) { ready = true; this.rejectStartup = null; clearTimeout(timeout); this.timers.delete(timeout); this.state = 'streaming'; this.emit({ type: 'ready' }); resolve(); }
        if (e.type === 'session.output_audio.delta') this.emit({ type: 'audio', data: e.delta });
        if (e.type === 'session.output_transcript.delta') this.emit({ type: 'translation', delta: e.delta || '' });
        if (e.type === 'session.input_transcript.delta') this.emit({ type: 'transcript', delta: e.delta || '' });
        if (e.type === 'session.closed') { this.emit({ type: 'drained' }); this.cancel(); }
      });
      socket.on('error', fail);
      socket.on('close', () => { if (this.state === 'closed') return; if (this.state !== 'draining') fail(new Error('음성 연결이 끊겼어요. 다시 시작해 주세요.')); else this.cancel(); });
    });
  }
  send(value) { if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(value)); }
  append(bytes) {
    if (this.state !== 'streaming') return;
    const audio = Buffer.from(bytes); if (audio.length > 48000 || audio.length % 2) throw new Error('음성 데이터 형식 오류');
    if (this.socket.bufferedAmount > 96000) { this.emit({ type: 'error', message: '네트워크가 느려 음성 전송을 중지했어요. 다시 시작해 주세요.' }); this.cancel(); return; }
    this.send({ type: 'session.input_audio_buffer.append', audio: audio.toString('base64') });
  }
  finish() {
    if (this.state !== 'streaming') return this.cancel();
    this.state = 'draining'; this.send({ type: 'session.close' });
    this.timer(() => { this.emit({ type: 'error', message: '음성 마무리 시간이 초과됐어요. 남은 출력을 중지했습니다.' }); this.cancel(); }, 12000);
  }
  cancel() { if (this.state === 'closed') return; this.state = 'closed'; this.rejectStartup?.(new Error('음성 연결을 중지했어요.')); this.rejectStartup = null; for (const t of this.timers) clearTimeout(t); this.timers.clear(); this.socket?.terminate(); this.key = ''; this.emit({ type: 'closed' }); }
}
module.exports = { TranslationStream };
