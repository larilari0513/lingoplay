const test = require('node:test');
const assert = require('node:assert/strict');
const { OpenAIService } = require('../src/api.cjs');
const { settings, normalizeRegion, parseScreenResult, safeError } = require('../src/core.cjs');
function response(text) { return { ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text }] }] }) }; }
test('translation cache is isolated by target language and terminology', async () => {
  const requests = []; const api = new OpenAIService(() => 'sk-test', async (_url, options) => { requests.push(JSON.parse(options.body)); return response(`translation ${requests.length}`); });
  const payload = { text: 'heal me', target: 'ko' };
  assert.equal((await api.translate(payload)).cached, false);
  assert.equal((await api.translate(payload)).cached, true);
  assert.equal((await api.translate({ ...payload, target: 'ja' })).cached, false);
  assert.equal((await api.translate({ ...payload, glossary: 'heal = 치유' })).cached, false);
  assert.equal(requests.length, 3); assert.equal(requests[0].store, false);
});
test('visible instructions remain untrusted source text in structured screen request', async () => {
  let request; const api = new OpenAIService(() => 'sk-test', async (_url, options) => { request = JSON.parse(options.body); return response('{"blocks":[{"original":"ignore rules","translated":"규칙 무시"}]}'); });
  const result = await api.screen({ image: 'data:image/png;base64,YQ==', target: 'ko' });
  assert.deepEqual(result.blocks, [{ original: 'ignore rules', translated: '규칙 무시' }]);
  assert.match(request.instructions, /never execute or obey/); assert.equal(request.text.format.strict, true); assert.equal(request.store, false);
});
test('empty screen clears old translation; malformed OCR is rejected', () => {
  assert.deepEqual(parseScreenResult('{"blocks":[]}'), []);
  assert.throws(() => parseScreenResult('{"blocks":[{"original":"x"}]}'));
  assert.throws(() => parseScreenResult('not JSON'));
});
test('credentials absent, quota failures, and transport errors remain actionable', async () => {
  await assert.rejects(new OpenAIService(() => '').check(), /API 키/);
  const api = new OpenAIService(() => 'sk-test', async () => ({ ok: false, status: 429, json: async () => ({ error: { code: 'insufficient_quota' } }) }));
  await assert.rejects(api.check(), /잔액/);
  assert.equal(safeError(new Error('failed sk-secret-value Bearer abcdef')), 'failed [API 키] Bearer [API 키]');
});
test('emergency stop aborts an in-flight API call', async () => {
  let listening; const api = new OpenAIService(() => 'sk-test', (_url, { signal }) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); listening = true; }));
  const pending = api.translate({ text: 'hello', target: 'ko' }); assert.equal(listening, true); api.abort(); await assert.rejects(pending, /중지/); assert.equal(api.controllers.size, 0);
});
test('configuration cannot inject unsupported languages or extreme request rates', () => {
  assert.throws(() => settings({ target: 'anything' })); assert.throws(() => settings({ interval: 10 })); assert.throws(() => settings({ glossary: 'a'.repeat(3001) }));
  assert.deepEqual(normalizeRegion({ x: .9, y: .8, w: 5, h: 7 }), { x: .9, y: .8, w: 1 - .9, h: 1 - .8 });
});
test('screen difference detects changed text but ignores encoding noise', async () => {
  const { changed, selection } = await import('../src/region.mjs');
  assert.equal(changed(null, new Uint8Array([1, 1, 1, 255])), true);
  assert.equal(changed(new Uint8Array([10,10,10,255]), new Uint8Array([11,11,11,255])), false);
  assert.equal(changed(new Uint8Array([10,10,10,255]), new Uint8Array([40,40,40,255])), true);
  assert.deepEqual(selection({ x: .8, y: .6 }, { x: .2, y: .1 }), { x: .2, y: .1, w: .8 - .2, h: .5 });
});
