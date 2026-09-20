'use strict';
// Opt-in paid evaluation. No microphone, Discord, or local screen capture.
// Review notes are a human rubric, not a claimed automatic quality score.
const fs = require('node:fs');
const path = require('node:path');
const { OpenAIService } = require('../src/api.cjs');
const { UsageMeter } = require('../src/usage.cjs');
const { PROFILES, modelFor } = require('../src/models.cjs');
const { language, boundedString, safeError } = require('../src/core.cjs');
async function main() {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--dry-run') options.dry = true;
    else if (['--dataset', '--profiles', '--limit', '--out'].includes(key) && args[i + 1] && !args[i + 1].startsWith('--')) options[key.slice(2)] = args[++i];
    else throw new Error(`Unknown or incomplete option: ${key}`);
  }
  const dataset = path.resolve(options.dataset || path.join(__dirname, '../test/fixtures/translation-eval.json'));
  const cases = JSON.parse(fs.readFileSync(dataset, 'utf8'));
  const limit = Number(options.limit || 10), profiles = (options.profiles || Object.keys(PROFILES).join(',')).split(',');
  if (!Number.isInteger(limit) || limit < 1 || limit > 300) throw new Error('--limit must be an integer from 1 to 300');
  for (const p of profiles) modelFor(p);
  if (!Array.isArray(cases) || !cases.length) throw new Error('The dataset must be a non-empty JSON array');
  const work = [];
  for (const c of cases.slice(0, limit)) {
    if (!c || typeof c.id !== 'string' || !c.id) throw new Error('Every case needs an id');
    language(c.target); boundedString(c.game || '', 120); boundedString(c.glossary || '', 3000); boundedString(c.context || '', 1200);
    const payload = { target: c.target, game: c.game || '', glossary: c.glossary || '' }, kind = c.imagePath ? 'screen' : 'text';
    if (kind === 'screen') {
      const file = path.resolve(path.dirname(dataset), c.imagePath), ext = path.extname(file).toLowerCase();
      if (!['.png', '.jpg', '.jpeg'].includes(ext) || fs.statSync(file).size > 7_000_000) throw new Error(`Invalid image: ${c.id}`);
      payload.image = `data:image/${ext === '.png' ? 'png' : 'jpeg'};base64,${fs.readFileSync(file).toString('base64')}`;
    } else { payload.text = boundedString(c.text, 6000); if (!payload.text.trim()) throw new Error(`Empty text: ${c.id}`); payload.context = c.context || ''; }
    const seen = new Set();
    for (const profile of profiles) {
      const model = modelFor(profile, kind); if (seen.has(model)) continue; seen.add(model);
      work.push({ c, kind, model, profile, payload });
    }
  }
  console.log(JSON.stringify({ cases: Math.min(limit, cases.length), requests: work.length, dryRun: Boolean(options.dry), profiles }));
  if (options.dry) return;
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required. Use --dry-run for validation without API calls.');
  const report = { createdAt: new Date().toISOString(), dataset: path.basename(dataset), note: 'Synthetic or user-supplied examples; quality requires human review. Latency is sequential wall time, not a controlled benchmark.', results: [] };
  const output = path.resolve(options.out || `artifacts/model-eval-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  let failed = 0;
  for (const item of work) {
    const { c, kind, model, profile, payload } = item;
    // Each request gets a fresh cache so repeated examples do not fake savings.
    const meter = new UsageMeter(), api = new OpenAIService(() => process.env.OPENAI_API_KEY, fetch, { meter });
    const start = performance.now(), row = { id: c.id, kind, model, target: c.target, source: c.imagePath || c.text, review: c.review || '', humanScore: null };
    try {
      const result = await api[kind === 'screen' ? 'screen' : 'translate']({ ...payload, profile });
      row.output = result.blocks || result.translated; row.usage = result.usage; row.status = 'ok';
    } catch (e) { row.status = 'error'; row.error = safeError(e); failed++; }
    row.latencyMs = Math.round(performance.now() - start); row.cost = meter.snapshot(); report.results.push(row);
    fs.writeFileSync(output, JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ id: row.id, model, status: row.status, latencyMs: row.latencyMs, estimatedUSD: row.cost.usd, unpriced: row.cost.unpriced }));
  }
  console.log(`Report: ${output}. Review negations, numbers, directions, names, glossary use, and naturalness before choosing a default.`);
  if (failed) process.exitCode = 1;
}
main().catch(e => { console.error(safeError(e)); process.exitCode = 1; });
