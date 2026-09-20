'use strict';

// Standard API rates checked against the official model pages on 2026-09-20.
const MODELS = Object.freeze({
  'gpt-5.6-luna': { input: 0.20, cached: 0.02, output: 1.20, reasoning: { effort: 'none' } },
  'gpt-4o-mini': { input: 0.15, cached: 0.075, output: 0.60 },
  'gpt-4.1-mini': { input: 0.40, cached: 0.10, output: 1.60 },
});
const PROFILES = Object.freeze({
  balanced: { text: 'gpt-5.6-luna', screen: 'gpt-5.6-luna' },
  economy: { text: 'gpt-4o-mini', screen: 'gpt-5.6-luna' },
  compatible: { text: 'gpt-4.1-mini', screen: 'gpt-4.1-mini' },
});
function modelFor(profile = 'balanced', kind = 'text') {
  if (!Object.hasOwn(PROFILES, profile)) throw new Error('번역 방식을 다시 선택해 주세요.');
  return PROFILES[profile][kind];
}
function modelOptions(model) {
  if (!Object.hasOwn(MODELS, model)) throw new Error('지원하지 않는 번역 모델이에요.');
  return { model, ...(MODELS[model].reasoning ? { reasoning: MODELS[model].reasoning } : {}) };
}
// Plain mapping entries are filtered in either translation direction. Unstructured
// notes are retained. Never rewrite names or numbers to improve cache hit rates.
function relevantGlossary(glossary, text) {
  const source = text.toLocaleLowerCase();
  return glossary.split(/\r?\n/).filter(line => {
    const parts = line.split(/\s*(?:=|→|↔)\s*/);
    if (parts.length !== 2 || parts.some(p => !p.trim())) return Boolean(line.trim());
    return parts.some(p => {
      const term = p.trim().toLocaleLowerCase();
      if (/^[a-z0-9 _'-]+$/.test(term)) {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'u').test(source);
      }
      return source.includes(term);
    });
  }).join('\n');
}
module.exports = { MODELS, PROFILES, modelFor, modelOptions, relevantGlossary };
