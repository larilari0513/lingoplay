const test = require('node:test');
const assert = require('node:assert/strict');
const { OpenAIService } = require('../src/api.cjs');
const { relevantGlossary } = require('../src/models.cjs');
const { settings } = require('../src/core.cjs');
const reply = text => ({ ok: true, json: async () => ({ usage: { input_tokens: 500, output_tokens: 100 }, output: [{ content: [{ type: 'output_text', text }] }] }) });
test('existing saved settings migrate to economical defaults without losing devices or languages', () => {
  const s = settings({ target: 'ja', outgoing: 'ko', mic: 'mic-1', incoming: 'cable', glossary: 'tank = 탱커' });
  assert.equal(s.translationProfile, 'balanced'); assert.equal(s.voiceMode, 'economy'); assert.equal(s.mic, 'mic-1'); assert.equal(s.target, 'ja');
  assert.throws(() => settings({ voiceMode: 'arbitrary-model' }));
});
test('Luna turns off reasoning; the legacy text profile does not route images to 4o mini', async () => {
  const requests = [], api = new OpenAIService(() => 'sk-test', async (_url, opts) => { const body = JSON.parse(opts.body); requests.push(body); return reply(body.text ? '{"blocks":[]}' : 'hello'); });
  await api.translate({ text: '안녕', target: 'en' });
  await api.translate({ text: '안녕', target: 'en', profile: 'economy' });
  await api.screen({ image: 'data:image/png;base64,YQ==', target: 'ko', profile: 'economy' });
  await api.translate({ text: '안녕', target: 'en', profile: 'compatible' });
  assert.deepEqual(requests.map(r => r.model), ['gpt-6-luna', 'gpt-4o-mini', 'gpt-6-luna', 'gpt-4.1-mini']);
  assert.deepEqual(requests[0].reasoning, { effort: 'none' }); assert.equal(requests[1].reasoning, undefined);
  assert.equal(requests[2].input[0].content[0].detail, 'auto');
});
test('glossary filtering keeps reverse mappings and notes but not unrelated words or substring collisions', () => {
  const glossary = 'tank = 탱커\nhealer = 힐러\nleft = 왼쪽\nKeep player names unchanged';
  assert.equal(relevantGlossary(glossary, '탱커는 왼쪽'), 'tank = 탱커\nleft = 왼쪽\nKeep player names unchanged');
  assert.equal(relevantGlossary(glossary, 'tankard'), 'Keep player names unchanged');
  assert.match(relevantGlossary(glossary, 'TANK!'), /tank =/);
});
test('identical simultaneous requests share one paid call, while context stays isolated', async () => {
  let calls = 0, resolve;
  const api = new OpenAIService(() => 'sk-test', () => { calls++; return new Promise(r => resolve = r); });
  const payload = { text: 'there', target: 'ko' }, a = api.translate(payload), b = api.translate(payload);
  assert.equal(calls, 1); resolve(reply('저기')); const results = await Promise.all([a, b]); assert.equal(results[1].cached, true);
  const c = api.translate({ ...payload, context: 'Go left.' }); assert.equal(calls, 2); resolve(reply('왼쪽')); await c;
});
test('cancelling a screen request leaves chat requests alive', async () => {
  const signals = [], api = new OpenAIService(() => 'sk-test', (_url, opts) => new Promise((resolve, reject) => {
    signals.push({ signal: opts.signal, resolve }); opts.signal.addEventListener('abort', () => reject(new DOMException('cancel', 'AbortError')));
  }));
  const screen = api.screen({ image: 'data:image/png;base64,YQ==', target: 'ko' });
  const text = api.translate({ text: 'hello', target: 'ko' }); api.abort('screen');
  await assert.rejects(screen, /중지/); assert.equal(signals[1].signal.aborted, false); signals[1].resolve(reply('안녕')); await text;
});
test('incomplete output is not cached or displayed as a valid translation', async () => {
  let count = 0;
  const api = new OpenAIService(() => 'sk-test', async () => { count++; return { ok: true, json: async () => ({ status: 'incomplete', output: [] }) }; });
  await assert.rejects(api.translate({ text: 'test', target: 'ko' }), /중간/);
  await assert.rejects(api.translate({ text: 'test', target: 'ko' }), /중간/); assert.equal(count, 2);
});
test('model-list checks reflect the selected features without requiring unused speech synthesis', async () => {
  const api = new OpenAIService(() => 'sk-test', async () => ({ ok: true, json: async () => ({ data: [{ id: 'gpt-6-luna' }, { id: 'gpt-4o-mini-transcribe' }] }) }));
  assert.deepEqual(await api.check(), { text: true, screen: true, incoming: true, outgoing: true });
  assert.equal((await api.check({ voiceMode: 'realtime' })).incoming, false);
  assert.equal((await api.check({ synthesize: true })).outgoing, false);
});
