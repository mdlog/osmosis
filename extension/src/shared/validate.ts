import type { Item, Word } from './types';

export const norm = (s: string) => s.normalize('NFC').toLocaleLowerCase().trim();

const strip = (s: string) =>
  norm(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** Does `word` occur as a whole word inside `text`? Accent-insensitive, case-insensitive. */
export function containsWord(text: string, word: string): boolean {
  const t = strip(text);
  const w = strip(word);
  if (!w) return false;
  let from = 0;
  for (;;) {
    const at = t.indexOf(w, from);
    if (at < 0) return false;
    const before = at === 0 ? '' : t[at - 1];
    const after = t[at + w.length] ?? '';
    const isLetter = (c: string) => /\p{L}|\p{N}/u.test(c);
    if (!isLetter(before) && !isLetter(after)) return true;
    from = at + 1;
  }
}

/**
 * Parse and validate the model's JSON for `n` sentences.
 * Returns index-aligned items: a slot is null when the model skipped it, echoed the
 * English source, or returned something unusable. Glossary entries whose word does not
 * actually appear in the translation are dropped (the model sometimes invents forms).
 */
export function validateItems(raw: string, sources: string[]): (Item | null)[] {
  const n = sources.length;
  const out: (Item | null)[] = new Array(n).fill(null);
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return out;
  }
  const items = Array.isArray((data as { items?: unknown })?.items) ? (data as { items: unknown[] }).items : [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    // Field names follow REWRITE_SCHEMA (translation / hard_words / word); the short forms are accepted too.
    const o = it as Record<string, unknown>;
    const i = o.i;
    const text = o.translation ?? o.text;
    const words = o.hard_words ?? o.words;
    if (typeof i !== 'number' || !Number.isInteger(i) || i < 1 || i > n) continue;
    if (typeof text !== 'string' || !text.trim()) continue;
    if (out[i - 1]) continue; // duplicate index: keep the first
    if (norm(text) === norm(sources[i - 1])) continue; // untranslated echo
    const clean: Word[] = [];
    const seen = new Set<string>();
    for (const w of Array.isArray(words) ? words : []) {
      if (!w || typeof w !== 'object') continue;
      const r = w as Record<string, unknown>;
      const surface = r.word ?? r.w;
      const { lemma, en } = r;
      if (typeof surface !== 'string' || typeof en !== 'string') continue;
      if (!containsWord(text, surface)) continue;
      const lem = typeof lemma === 'string' && lemma.trim() ? lemma : surface;
      const key = norm(lem);
      if (seen.has(key)) continue;
      seen.add(key);
      clean.push({ w: surface.trim(), lemma: key, en: en.trim() });
    }
    out[i - 1] = { i, text: text.trim(), words: clean };
  }
  return out;
}

/** Indices (0-based) that still need a translation after validation. */
export function missing(items: (Item | null)[]): number[] {
  return items.flatMap((it, k) => (it ? [] : [k]));
}
