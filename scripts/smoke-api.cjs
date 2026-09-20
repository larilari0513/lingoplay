// Explicitly invoked smoke test. Uses only synthetic text, image and audio, never microphone or Discord.
const fs = require('node:fs');
const { OpenAIService } = require('../src/api.cjs');
const { TranslationStream } = require('../src/realtime.cjs');
const { EconomyVoice } = require('../src/economy-voice.cjs');
const { safeError } = require('../src/core.cjs');
async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required');
  const api = new OpenAIService(() => process.env.OPENAI_API_KEY);
  const result = await api.translate({ text: '잠깐만, 회복하고 같이 갈게!', target: 'en', game: 'cooperative game' });
  console.log(JSON.stringify({ check: 'text', original: result.original, translated: result.translated }));
  if (!result.translated || /[가-힣]/.test(result.translated)) throw new Error('Expected an English translation');
  if (process.argv[2]) { const image = `data:image/png;base64,${fs.readFileSync(process.argv[2]).toString('base64')}`; const screen = await api.screen({ image, target: 'ko' }); console.log(JSON.stringify({ check: 'vision', blocks: screen.blocks })); if (!screen.blocks.length || !screen.blocks.some(b => /[가-힣]/.test(b.translated))) throw new Error('Expected Korean screen translation'); }
  const speech = await fetch('https://api.openai.com/v1/audio/speech', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'coral', input: 'Wait a moment. I need to heal. Let us go together.', response_format: 'pcm' }), signal: AbortSignal.timeout(45000) });
  if (!speech.ok) throw new Error(`Synthetic speech HTTP ${speech.status}`);
  const pcm = Buffer.from(await speech.arrayBuffer()); let original = '', translated = '', audioBytes = 0;
  let economyText = '', economyError = '';
  const economy = new EconomyVoice(process.env.OPENAI_API_KEY, 'ko', e => { if (e.type === 'translation') economyText += e.delta; if (e.type === 'error') economyError = e.message; });
  await economy.start();
  for (let i = 0; i < pcm.length; i += 4800) { economy.append(pcm.subarray(i, i + 4800)); await new Promise(r => setTimeout(r, 100)); }
  economy.finish(); const economyDeadline = Date.now() + 60000;
  while (economy.state !== 'closed' && Date.now() < economyDeadline) await new Promise(r => setTimeout(r, 100));
  economy.cancel(); console.log(JSON.stringify({ check: 'economy-voice', translated: economyText, error: economyError }));
  if (economyError || !/[가-힣]/.test(economyText)) throw new Error('Expected Korean economy captions');
  const stream = new TranslationStream(process.env.OPENAI_API_KEY, 'ko', e => { if (e.type === 'transcript') original += e.delta; if (e.type === 'translation') translated += e.delta; if (e.type === 'audio') audioBytes += Buffer.from(e.data, 'base64').length; if (e.type === 'error') console.log(JSON.stringify({ streamError: e.message })); });
  await stream.start();
  for (let i = 0; i < pcm.length; i += 4800) { stream.append(pcm.subarray(i, i + 4800)); await new Promise(r => setTimeout(r, 100)); }
  for (let i = 0; i < 12; i++) { stream.append(Buffer.alloc(4800)); await new Promise(r => setTimeout(r, 100)); }
  stream.finish(); const deadline = Date.now() + 14000;
  while (stream.state !== 'closed' && Date.now() < deadline) await new Promise(r => setTimeout(r, 200));
  stream.cancel(); console.log(JSON.stringify({ check: 'live-voice', original, translated, audioBytes }));
  if (!translated || !/[가-힣]/.test(translated) || !audioBytes) throw new Error('Expected translated Korean audio and captions');
}
main().catch(e => { console.error(safeError(e)); process.exitCode = 1; });
