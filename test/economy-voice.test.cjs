const test = require('node:test');
const assert = require('node:assert/strict');
const { SpeechSegments } = require('../src/voice-segments.cjs');
const { EconomyVoice } = require('../src/economy-voice.cjs');
const { UsageMeter } = require('../src/usage.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
function pcm(ms, level = 1000) { const b = Buffer.alloc(ms * 48); for (let i = 0; i < b.length; i += 2) b.writeInt16LE(i % 4 ? level : -level, i); return b; }
function feed(s, b) { for (let i = 0; i < b.length; i += 4800) s.append(b.subarray(i, i + 4800)); }
function mock() {
  const calls = [];
  return { calls, fetch: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/audio/transcriptions')) return { ok: true, json: async () => ({ text: 'Do not go left.' }) };
    if (url.endsWith('/responses')) return { ok: true, json: async () => ({ usage: { input_tokens: 500, output_tokens: 100 }, output: [{ content: [{ type: 'output_text', text: '왼쪽으로 가지 마.' }] }] }) };
    throw new Error('Unexpected audio generation');
  } };
}
async function settle(s) { for (let i = 0; i < 20 && (s.active || s.queue.length); i++) await tick(); }
test('silence and isolated clicks never become paid speech segments', () => {
  const segments = [], s = new SpeechSegments(b => segments.push(b));
  feed(s, pcm(2000, 0)); feed(s, pcm(40)); feed(s, pcm(1000, 0)); s.finish();
  assert.equal(segments.length, 0); assert.equal(s.frames.length, 0);
});
test('fragmented PCM preserves pre-roll and only emits after the speech boundary', () => {
  const segments = [], s = new SpeechSegments(b => segments.push(b));
  const bytes = Buffer.concat([pcm(200, 0), pcm(300), pcm(540, 0)]);
  for (let i = 0; i < bytes.length; i += 142) s.append(bytes.subarray(i, i + 142));
  assert.equal(segments.length, 0);
  s.append(pcm(20, 0)); assert.equal(segments.length, 1);
  assert.equal(segments[0].length, 1060 * 48);
});
test('long continuous speech is bounded even without a pause', () => {
  const segments = [], s = new SpeechSegments(b => segments.push(b)); feed(s, pcm(13000)); s.finish();
  assert.equal(segments.length, 3); assert.ok(segments.every(b => b.length <= 6000 * 48));
});
test('short urgent calls survive segmentation while isolated clicks are discarded', () => {
  const segments = [], s = new SpeechSegments(b => segments.push(b));
  feed(s, pcm(160)); feed(s, pcm(600, 0));
  assert.equal(segments.length, 1); assert.ok(segments[0].length >= 160 * 48);
});
test('economy listening needs no paid connection and never generates audio', async () => {
  const m = mock(), events = [], meter = new UsageMeter();
  const s = new EconomyVoice('sk-test', 'ko', e => events.push(e), { meter, game: 'Test', glossary: 'left = 왼쪽' }, m.fetch);
  await s.start(); feed(s, pcm(1500, 0)); assert.equal(m.calls.length, 0);
  feed(s, pcm(400)); feed(s, pcm(600, 0)); await settle(s);
  assert.deepEqual(m.calls.map(c => c.url.split('/').at(-1)), ['transcriptions', 'responses']);
  assert.equal(events.find(e => e.type === 'translation').delta, '왼쪽으로 가지 마.');
  assert.equal(events.find(e => e.type === 'translation').segmentId, '1');
  assert.equal(s.state, 'streaming'); assert.ok(meter.snapshot().usd > 0);
  assert.match(m.calls[0].options.body.get('prompt'), /left, 왼쪽/);
  s.finish(); assert.equal(s.state, 'closed'); assert.equal(s.key, '');
});
test('normal stop drains the last incomplete speech segment, then closes exactly once', async () => {
  const m = mock(), events = [], s = new EconomyVoice('sk-test', 'ko', e => events.push(e), {}, m.fetch);
  await s.start(); feed(s, pcm(400)); s.finish(); s.append(pcm(400)); await settle(s);
  assert.equal(m.calls.length, 2); assert.equal(s.state, 'closed');
  assert.equal(events.filter(e => e.type === 'closed').length, 1);
  assert.ok(events.findIndex(e => e.type === 'translation') < events.findIndex(e => e.type === 'drained'));
});
test('empty recognition skips a noise segment and continues listening without translation', async () => {
  const events = [], calls = [];
  const s = new EconomyVoice('sk-test', 'ko', e => events.push(e), {}, async url => {
    calls.push(url); return { ok: true, json: async () => ({ text: '' }) };
  });
  await s.start(); feed(s, pcm(400)); feed(s, pcm(600, 0)); await settle(s);
  assert.equal(s.state, 'streaming'); assert.equal(calls.length, 1);
  assert.equal(events.some(e => e.type === 'error' || e.type === 'translation'), false);
  assert.equal(events.find(e => e.type === 'empty').segmentId, '1'); s.cancel();
});
test('turns are translated in order with bounded context from prior source text', async () => {
  const m = mock(), events = [], s = new EconomyVoice('sk-test', 'ko', e => events.push(e), {}, m.fetch);
  await s.start();
  for (let i = 0; i < 3; i++) { feed(s, pcm(400)); feed(s, pcm(600, 0)); }
  await settle(s);
  assert.deepEqual(events.filter(e => e.type === 'translation').map(e => e.segmentId), ['1', '2', '3']);
  const requests = m.calls.filter(c => c.url.endsWith('/responses')).map(c => JSON.parse(c.options.body));
  assert.match(requests[1].instructions, /Do not go left/);
  assert.equal(s.recent.length, 2); s.cancel();
});
test('emergency stop aborts the recognition request and drops late captions', async () => {
  let resolve, signal; const events = [];
  const s = new EconomyVoice('sk-test', 'ko', e => events.push(e), {}, (_url, opts) => { signal = opts.signal; return new Promise(r => resolve = r); });
  await s.start(); feed(s, pcm(400)); feed(s, pcm(600, 0)); await tick();
  s.cancel(); assert.equal(signal.aborted, true);
  resolve({ ok: true, json: async () => ({ text: 'late result' }) }); await tick();
  assert.equal(events.some(e => e.type === 'translation' || e.type === 'transcript'), false);
  assert.equal(s.queue.length, 0); assert.equal(s.segments.frames.length, 0); assert.equal(s.key, '');
});
test('a slow provider cannot build an unbounded queue of stale conversations', async () => {
  let resolve; const events = [];
  const s = new EconomyVoice('sk-test', 'ko', e => events.push(e), {}, () => new Promise(r => resolve = r));
  await s.start(); feed(s, pcm(400)); feed(s, pcm(600, 0)); await tick();
  for (let i = 0; i < 3; i++) { feed(s, pcm(400)); feed(s, pcm(600, 0)); }
  assert.equal(s.state, 'closed'); assert.equal(s.queue.length, 0);
  assert.match(events.find(e => e.type === 'error').message, /따라가지/);
  resolve({ ok: true, json: async () => ({ text: 'late' }) }); await tick();
});
