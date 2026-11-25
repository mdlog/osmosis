import type { Item } from './types';
import { norm } from './validate';

/**
 * The learner's vocabulary, keyed by normalized lemma.
 * `known`: the learner already knows it. Everything else counts as new.
 */
export interface Vocab {
  known: Set<string>;
}

export const isKnown = (v: Vocab, lemma: string, surface?: string) =>
  v.known.has(norm(lemma)) || (surface ? v.known.has(norm(surface)) : false);

const fold = (s: string) => norm(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Words spelled the same as a word in the English sentence (names, "wifi", "radio") are free. */
export function transparent(item: Item, source: string): Set<string> {
  const english = new Set((source.match(/\p{L}+/gu) ?? []).map(fold));
  return new Set(item.words.filter(w => english.has(fold(w.w))).map(w => w.lemma));
}

/** Lemmas in this sentence that the learner does not know yet. */
export function newWords(item: Item, v: Vocab, free?: Set<string>): string[] {
  return item.words.filter(w => !free?.has(w.lemma) && !isKnown(v, w.lemma, w.w)).map(w => w.lemma);
}

/**
 * Max new words a shown sentence may carry, by dial position (0..1).
 * 0 = never translate; low = strict i+1; 1 = full immersion (no cap).
 */
export function newWordCap(dial: number): number {
  if (dial <= 0) return -1;
  if (dial >= 1) return Infinity;
  return Math.max(1, Math.ceil(dial * 4)); // (0,.25]→1 (.25,.5]→2 (.5,.75]→3 (.75,1)→4
}

/**
 * Decide which sentences of a page appear in the target language.
 *
 * Comprehensible input: a sentence is eligible only if its new-word count is within the
 * cap; inside a paragraph, i+1 sentences (exactly one new word) win, then zero, then more.
 *
 * Density is set per paragraph, in reading order, by error diffusion: paragraph quotas add up
 * to about dial × sentences, and the fractional rest carries to the next paragraph. A
 * paragraph's quota depends only on the paragraphs before it, so text the learner is already
 * reading does not flip back to English when later paragraphs finish translating.
 * Keys look like "<paragraph>.<n>" (a key without a dot is its own paragraph).
 */
export function chooseShown(
  sentences: { key: string; item: Item | null; free?: Set<string> }[],
  v: Vocab,
  dial: number,
): Set<string> {
  const cap = newWordCap(dial);
  const shown = new Set<string>();
  if (cap < 0 || sentences.length === 0) return shown;
  const paras = new Map<string, { key: string; item: Item | null; free?: Set<string>; order: number }[]>();
  sentences.forEach((s, order) => {
    const para = s.key.includes('.') ? s.key.slice(0, s.key.lastIndexOf('.')) : s.key;
    if (!paras.has(para)) paras.set(para, []);
    paras.get(para)!.push({ ...s, order });
  });
  let acc = 0.5; // start half-way so quotas round rather than floor
  for (const group of paras.values()) {
    const before = Math.floor(acc);
    acc += dial >= 1 ? group.length : dial * group.length;
    const quota = Math.floor(acc) - before;
    if (quota <= 0) continue;
    group
      .map(s => ({ ...s, n: s.item ? newWords(s.item, v, s.free).length : Infinity }))
      .filter(s => s.item && s.n <= cap)
      .sort((a, b) => rank(a.n) - rank(b.n) || a.order - b.order)
      .slice(0, quota)
      .forEach(s => shown.add(s.key));
  }
  return shown;
}

const rank = (n: number) => (n === 1 ? 0 : n === 0 ? 1 : n);
