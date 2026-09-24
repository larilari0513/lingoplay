'use strict';
const { MODELS } = require('./models.cjs');
const AUDIO_PER_MINUTE = Object.freeze({ 'gpt-4o-mini-transcribe': 0.003, 'gpt-live-transcribe': 0.017, 'gpt-realtime-translate': 0.034 });
class UsageMeter {
  constructor(onChange = () => {}) { this.onChange = onChange; this.rows = new Map(); this.cacheHits = 0; this.unpriced = 0; }
  row(kind) { if (!this.rows.has(kind)) this.rows.set(kind, { kind, usd: 0, requests: 0, seconds: 0 }); return this.rows.get(kind); }
  changed() { this.onChange(this.snapshot()); }
  cached() { this.cacheHits++; this.changed(); }
  text(kind, model, usage) {
    const row = this.row(kind); row.requests++;
    const rates = MODELS[model];
    if (!rates || !Number.isFinite(usage?.input_tokens) || !Number.isFinite(usage?.output_tokens)) { this.unpriced++; this.changed(); return; }
    const input = Math.max(0, usage.input_tokens), output = Math.max(0, usage.output_tokens);
    const cached = Math.max(0, Math.min(input, usage.input_tokens_details?.cached_tokens || 0));
    const written = Math.max(0, Math.min(input - cached, usage.input_tokens_details?.cache_write_tokens || 0));
    const long = rates.longContext !== undefined && input > rates.longContext;
    row.usd += ((
      (input - cached - written) * rates.input + cached * rates.cached + written * (rates.cacheWrite ?? rates.input)
    ) * (long ? 2 : 1) + output * rates.output * (long ? 1.5 : 1)) / 1e6;
    this.changed();
  }
  audio(kind, model, seconds, request = true) {
    const row = this.row(kind); if (request) row.requests++;
    seconds = Math.max(0, seconds); row.seconds += seconds;
    if (AUDIO_PER_MINUTE[model] !== undefined) row.usd += seconds / 60 * AUDIO_PER_MINUTE[model];
    else this.unpriced++;
    this.changed();
  }
  uncertain(kind) { this.row(kind).requests++; this.unpriced++; this.changed(); }
  snapshot() { const rows = [...this.rows.values()].map(r => ({ ...r })); return { usd: rows.reduce((n, r) => n + r.usd, 0), rows, cacheHits: this.cacheHits, unpriced: this.unpriced, priceDate: '2026-09-24' }; }
}
module.exports = { UsageMeter, AUDIO_PER_MINUTE };
