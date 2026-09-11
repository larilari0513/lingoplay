'use strict';
const crypto = require('node:crypto');
const LANGUAGES = Object.freeze({ ko: '한국어', en: 'English', ja: '日本語', zh: '中文', es: 'Español', fr: 'Français', de: 'Deutsch', pt: 'Português', ru: 'Русский' });
const DEFAULTS = Object.freeze({ target: 'ko', outgoing: 'en', game: '', glossary: '', interval: 4000, mic: '', incoming: '', output: '', overlaySize: 22 });
function language(code) { if (!Object.hasOwn(LANGUAGES, code)) throw new Error('지원하는 언어를 선택해 주세요.'); return code; }
function boundedString(value, max, field = '입력') { if (typeof value !== 'string' || value.length > max) throw new Error(`${field} 길이를 확인해 주세요. (최대 ${max}자)`); return value; }
function settings(input = {}) {
  const next = { ...DEFAULTS };
  for (const key of ['target', 'outgoing']) if (input[key] !== undefined) next[key] = language(input[key]);
  for (const [key, max] of Object.entries({ game: 120, glossary: 3000, mic: 500, incoming: 500, output: 500 })) if (input[key] !== undefined) next[key] = boundedString(input[key], max);
  if (input.interval !== undefined) { const n = Number(input.interval); if (![3000, 4000, 6000, 10000].includes(n)) throw new Error('갱신 간격을 확인해 주세요.'); next.interval = n; }
  if (input.overlaySize !== undefined) next.overlaySize = Math.min(36, Math.max(16, Number(input.overlaySize) || 22));
  return next;
}
function normalizeRegion(r) {
  if (!r || !['x', 'y', 'w', 'h'].every(k => Number.isFinite(r[k]))) throw new Error('번역 영역을 다시 선택해 주세요.');
  const x = Math.max(0, Math.min(0.98, r.x)), y = Math.max(0, Math.min(0.98, r.y));
  return { x, y, w: Math.max(0.02, Math.min(1 - x, r.w)), h: Math.max(0.02, Math.min(1 - y, r.h)) };
}
function parseScreenResult(text) {
  let data; try { data = JSON.parse(text); } catch { throw new Error('화면 인식 결과를 읽지 못했어요. 다시 시도해 주세요.'); }
  if (!Array.isArray(data.blocks) || data.blocks.length > 30) throw new Error('화면 인식 형식이 올바르지 않아요.');
  return data.blocks.map(b => ({ original: boundedString(b.original, 3000), translated: boundedString(b.translated, 3000) })).filter(b => b.original.trim() && b.translated.trim());
}
class LruCache {
  constructor(limit = 100) { this.limit = limit; this.map = new Map(); }
  get(key) { if (!this.map.has(key)) return undefined; const v = this.map.get(key); this.map.delete(key); this.map.set(key, v); return v; }
  set(key, value) { this.map.delete(key); this.map.set(key, value); while (this.map.size > this.limit) this.map.delete(this.map.keys().next().value); }
  clear() { this.map.clear(); }
}
function fingerprint(...values) { return crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex'); }
function safeError(error) {
  let message = String(error?.message || error || '알 수 없는 오류');
  message = message.replace(/sk-[A-Za-z0-9_-]+/g, '[API 키]').replace(/Bearer\s+\S+/gi, 'Bearer [API 키]');
  return message.slice(0, 500);
}
module.exports = { LANGUAGES, DEFAULTS, language, boundedString, settings, normalizeRegion, parseScreenResult, LruCache, fingerprint, safeError };
