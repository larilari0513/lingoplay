const test = require('node:test');
const assert = require('node:assert/strict');
const { UsageMeter } = require('../src/usage.cjs');
const { OpenAIService } = require('../src/api.cjs');
test('usage accounts for cached input once and reports text/image charges separately', () => {
  const m = new UsageMeter();
  m.text('text', 'gpt-5.6-luna', { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 500 } });
  m.text('screen', 'gpt-4.1-mini', { input_tokens: 2000, output_tokens: 200 }); m.cached();
  const s = m.snapshot(); assert.ok(Math.abs(s.usd - 0.00135) < 1e-10); assert.equal(s.cacheHits, 1); assert.equal(s.rows.length, 2);
});
test('audio estimates accumulate actual transmitted duration, not idle connection time', () => {
  const m = new UsageMeter(); m.audio('live', 'gpt-realtime-translate', 0); m.audio('live', 'gpt-realtime-translate', 30, false); m.audio('live', 'gpt-realtime-translate', 30, false);
  m.audio('transcription', 'gpt-4o-mini-transcribe', 60);
  assert.ok(Math.abs(m.snapshot().usd - 0.037) < 1e-10); assert.equal(m.snapshot().rows[0].requests, 1);
});
test('unknown and generated-speech costs are visibly excluded instead of reported as known zero', () => {
  const m = new UsageMeter(); m.uncertain('speech'); m.text('text', 'gpt-5.6-luna');
  assert.equal(m.snapshot().unpriced, 2); assert.equal(m.snapshot().usd, 0);
  const external = m.snapshot(); external.rows[0].usd = 10; assert.equal(m.snapshot().usd, 0);
});
test('cache hits and shared in-flight responses do not double-charge the session estimate', async () => {
  const meter = new UsageMeter();
  const api = new OpenAIService(() => 'sk-test', async () => ({ ok: true, json: async () => ({ usage: { input_tokens: 500, output_tokens: 100 }, output: [{ content: [{ type: 'output_text', text: 'hello' }] }] }) }), { meter });
  await Promise.all([api.translate({ text: '안녕', target: 'en' }), api.translate({ text: '안녕', target: 'en' })]);
  await api.translate({ text: '안녕', target: 'en' });
  assert.equal(meter.snapshot().rows[0].requests, 1); assert.equal(meter.snapshot().cacheHits, 2); assert.equal(meter.snapshot().usd, 0.00022);
});
