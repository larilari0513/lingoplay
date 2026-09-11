const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { TranslationStream } = require('../src/realtime.cjs');
class Socket extends EventEmitter {
  constructor() { super(); this.readyState = 1; this.bufferedAmount = 0; this.sent = []; Socket.latest = this; queueMicrotask(() => this.emit('open')); }
  send(raw) { this.sent.push(JSON.parse(raw)); }
  terminate() { this.readyState = 3; this.emit('close'); }
  event(e) { this.emit('message', Buffer.from(JSON.stringify(e))); }
}
async function connect() { const events = []; const s = new TranslationStream('sk-test', 'ko', e => events.push(e), Socket); const start = s.start(); await Promise.resolve(); Socket.latest.event({ type: 'session.updated' }); await start; return { s, socket: Socket.latest, events }; }
test('audio is sent only after target language is acknowledged', async () => {
  const s = new TranslationStream('sk-test', 'ko', () => {}, Socket); const promise = s.start(); await Promise.resolve(); s.append(new Uint8Array(100));
  assert.equal(Socket.latest.sent.length, 1); assert.equal(Socket.latest.sent[0].session.audio.output.language, 'ko');
  Socket.latest.event({ type: 'session.updated' }); await promise; s.append(new Uint8Array(100)); assert.equal(Socket.latest.sent[1].type, 'session.input_audio_buffer.append'); s.cancel();
});
test('normal stop drains translation before closing, and accepts no new input', async () => {
  const { s, socket, events } = await connect(); s.finish(); assert.equal(socket.sent.at(-1).type, 'session.close'); const count = socket.sent.length; s.append(new Uint8Array(100)); assert.equal(socket.sent.length, count);
  socket.event({ type: 'session.output_transcript.delta', delta: '안녕' }); socket.event({ type: 'session.closed' });
  assert.deepEqual(events.map(e => e.type), ['ready','translation','drained','closed']); assert.equal(s.state, 'closed');
});
test('emergency cancel drops late output and clears timers and credentials', async () => {
  const { s, socket, events } = await connect(); s.cancel(); socket.event({ type: 'session.output_audio.delta', delta: 'AAAA' });
  assert.deepEqual(events.map(e => e.type), ['ready','closed']); assert.equal(s.timers.size, 0); assert.equal(s.key, '');
});
test('cancel during connecting settles the pending start promise', async () => {
  const s = new TranslationStream('sk-test', 'ko', () => {}, Socket); const p = s.start(); s.cancel(); await assert.rejects(p, /중지/);
});
test('network backlog terminates instead of replaying stale audio', async () => {
  const { s, socket, events } = await connect(); socket.bufferedAmount = 200000; s.append(new Uint8Array(100)); assert.equal(s.state, 'closed'); assert.equal(events.find(e => e.type === 'error').message.includes('네트워크'), true);
});
test('an upstream API error rejects startup without exposing a key', async () => {
  const events = [], s = new TranslationStream('sk-test', 'ko', e => events.push(e), Socket); const p = s.start(); Socket.latest.event({ type: 'error', error: { message: 'Invalid key sk-hidden' } }); await assert.rejects(p, /\[API 키\]/); assert.equal(s.state, 'closed');
});
