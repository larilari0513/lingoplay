const test = require('node:test');
const assert = require('node:assert/strict');
const { SpeechTurn, wav } = require('../src/speech-turn.cjs');
function speech() { const data = Buffer.alloc(12000); for (let i = 0; i < data.length; i += 2) data.writeInt16LE(i % 4 ? -1000 : 1000, i); return data; }
function mock() { const calls = []; const fetch = async (url, options) => {
  calls.push({ url, options });
  if (url.endsWith('/audio/transcriptions')) return { ok: true, json: async () => ({ text: '회복하고 같이 갈게.' }) };
  if (url.endsWith('/responses')) return { ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text: 'I will heal up and go with you.' }] }] }) };
  return { ok: true, arrayBuffer: async () => new Uint8Array(4800).buffer };
}; return { calls, fetch }; }
test('outgoing speech waits for the end of the turn, then transcribes, translates and synthesizes', async () => {
  const m = mock(), events = [], s = new SpeechTurn('sk-test','en',e=>events.push(e), { synthesize: true }, m.fetch); await s.start(); s.append(speech()); assert.equal(m.calls.length,0);
  await s.finish(); assert.deepEqual(m.calls.map(c=>c.url.split('/').at(-1)),['transcriptions','responses','speech']);
  assert.equal(events.find(e=>e.type==='transcript').delta,'회복하고 같이 갈게.'); assert.ok(events.some(e=>e.type==='audio')); assert.equal(s.state,'closed'); assert.equal(s.chunks.length,0);
});
test('captions-only output does not request or emit synthesized audio', async () => {
  const m=mock(),events=[],s=new SpeechTurn('sk-test','en',e=>events.push(e),{},m.fetch);await s.start();s.append(speech());await s.finish();assert.equal(m.calls.length,2);assert.equal(events.some(e=>e.type==='audio'),false);
});
test('silent turns produce no hallucinated transcript or paid request', async () => {
  const m=mock(),events=[],s=new SpeechTurn('sk-test','en',e=>events.push(e),{},m.fetch);await s.start();s.append(Buffer.alloc(12000));await s.finish();assert.equal(m.calls.length,0);assert.equal(events.find(e=>e.type==='error').message.includes('말소리'),true);
});
test('cancel during transcription discards late results', async () => {
  let resolve;const events=[],s=new SpeechTurn('sk-test','en',e=>events.push(e),{},()=>new Promise(r=>resolve=r));await s.start();s.append(speech());const pending=s.finish();s.cancel();resolve({ok:true,json:async()=>({text:'hello'})});await pending;assert.equal(events.some(e=>e.type==='translation'),false);assert.equal(s.key,'');
});
test('repeated normal stop neither aborts nor duplicates a pending speech translation', async () => {
  let resolve, signal, calls = 0; const events = [];
  const s = new SpeechTurn('sk-test', 'en', e => events.push(e), {}, async (url, options) => {
    calls++;
    if (url.endsWith('/audio/transcriptions')) { signal = options.signal; return new Promise(r => resolve = r); }
    return { ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text: 'Wait.' }] }] }) };
  });
  await s.start(); s.append(speech()); const pending = s.finish(); await s.finish();
  assert.equal(signal.aborted, false); assert.equal(calls, 1);
  resolve({ ok: true, json: async () => ({ text: '잠깐만.' }) }); await pending;
  assert.equal(calls, 2); assert.equal(events.filter(e => e.type === 'translation').length, 1);
  assert.equal(events.filter(e => e.type === 'closed').length, 1);
});
test('WAV header accurately describes mono 24kHz PCM16 without touching the filesystem',()=>{const data=wav(speech());assert.equal(data.toString('ascii',0,4),'RIFF');assert.equal(data.readUInt32LE(24),24000);assert.equal(data.readUInt16LE(22),1);assert.equal(data.readUInt32LE(40),12000);});
