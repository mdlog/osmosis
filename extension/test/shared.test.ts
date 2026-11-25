import { describe, expect, it } from 'vitest';
import { splitSentences, isTranslatable } from '../src/shared/segment';
import { containsWord, validateItems, missing } from '../src/shared/validate';
import { chooseShown, newWordCap, newWords } from '../src/shared/select';
import type { Item } from '../src/shared/types';
import { cleanLemmas, LEXICON_SIZE, lexiconPlan } from '../src/shared/lexicon';
import { knownWords, markKnown, migrateVocab } from '../src/shared/store';

describe('splitSentences', () => {
  it('keeps offsets that slice back to the sentence', () => {
    const t = '  The council voted on Tuesday.  Work starts in spring! Is it late? ';
    const s = splitSentences(t);
    expect(s.map(x => x.text)).toEqual(['The council voted on Tuesday.', 'Work starts in spring!', 'Is it late?']);
    for (const x of s) expect(t.slice(x.start, x.end)).toBe(x.text);
  });
  it('does not split after common abbreviations', () => {
    const s = splitSentences('Dr. Smith met Mr. Jones today. They talked.');
    expect(s.map(x => x.text)).toEqual(['Dr. Smith met Mr. Jones today.', 'They talked.']);
  });
  it('filters tiny fragments', () => {
    expect(isTranslatable('Read more.')).toBe(false);
    expect(isTranslatable('The library opens at nine every day.')).toBe(true);
  });
});

describe('containsWord', () => {
  it('matches whole words, ignoring case and accents', () => {
    expect(containsWord('La construcción empezará pronto.', 'construccion')).toBe(true);
    expect(containsWord('La construcción empezará pronto.', 'Construcción')).toBe(true);
    expect(containsWord('Los bordes dorados', 'dorado')).toBe(false);
    expect(containsWord('Hornea las galletas', 'horneado(a)')).toBe(false);
  });
});

describe('validateItems', () => {
  const src = ['Mix the flour.', 'Add the milk slowly.', 'Bake for twelve minutes.'];
  it('aligns items by index and drops invented glossary words', () => {
    const raw = JSON.stringify({
      items: [
        { i: 3, text: 'Hornea doce minutos.', words: [{ w: 'Hornea', lemma: 'hornear', en: 'bake' }, { w: 'horneado(a)', lemma: 'hornear', en: 'baked' }] },
        { i: 1, text: 'Mezcla la harina.', words: [{ w: 'harina', lemma: 'harina', en: 'flour' }, { w: 'bowl', en: 'bowl' }] },
      ],
    });
    const out = validateItems(raw, src);
    expect(out[0]?.words.map(w => w.lemma)).toEqual(['harina']);
    expect(out[1]).toBeNull();
    expect(out[2]?.words).toEqual([{ w: 'Hornea', lemma: 'hornear', en: 'bake' }]);
    expect(missing(out)).toEqual([1]);
  });
  it('survives truncated / malformed JSON', () => {
    expect(validateItems('{"items":[{"i":1,"text":"Mez', src)).toEqual([null, null, null]);
    expect(validateItems('{"items":[{"i":1,"text":"Mezcla."}],"required":["i"]}', src)[0]?.text).toBe('Mezcla.');
  });
  it('rejects echoes of the English source and out-of-range indices', () => {
    const raw = JSON.stringify({ items: [{ i: 1, text: 'Mix the flour.', words: [] }, { i: 7, text: 'x', words: [] }] });
    expect(validateItems(raw, src)).toEqual([null, null, null]);
  });
});

describe('selection (comprehensible input)', () => {
  const item = (i: number, lemmas: string[]): Item => ({ i, text: lemmas.join(' '), words: lemmas.map(l => ({ w: l, lemma: l, en: l })) });
  const v = { known: new Set(['el', 'casa', 'grande', 'comer']) };
  const page = [
    { key: 'a', item: item(1, ['casa', 'grande']) }, // 0 new
    { key: 'b', item: item(2, ['casa', 'biblioteca']) }, // 1 new
    { key: 'c', item: item(3, ['biblioteca', 'construcción', 'primavera']) }, // 3 new
    { key: 'd', item: null }, // failed translation
  ];
  it('counts new words by lemma', () => {
    expect(newWords(page[2].item!, v)).toEqual(['biblioteca', 'construcción', 'primavera']);
  });
  it('dial 0 shows nothing, dial 1 shows every translated sentence', () => {
    expect(chooseShown(page, v, 0).size).toBe(0);
    expect([...chooseShown(page, v, 1)].sort()).toEqual(['a', 'b', 'c']);
  });
  it('low dial prefers the i+1 sentence of a paragraph and never exceeds the cap', () => {
    expect(newWordCap(0.2)).toBe(1);
    const para = page.slice(0, 3).map((s, k) => ({ ...s, key: `p1.${k}` }));
    // 3 sentences × 0.35 → quota 1; b (exactly one new word) beats a (none); c (3 new) is over the cap
    expect([...chooseShown(para, v, 0.35)]).toEqual(['p1.1']);
    expect(chooseShown([{ key: 'x', item: page[2].item }], v, 0.5).has('x')).toBe(false); // cap at 0.5 is 2 new words
  });
});

describe('transparent words', () => {
  it('treats words spelled like the English source as free', async () => {
    const { transparent, newWords } = await import('../src/shared/select');
    const it: Item = { i: 1, text: 'No hay wifi a bordo con Marta.', words: [{ w: 'wifi', lemma: 'wifi', en: 'wifi' }, { w: 'Marta', lemma: 'marta', en: 'Marta' }, { w: 'bordo', lemma: 'bordo', en: 'board' }] };
    const free = transparent(it, 'There is no wifi on board, Marta says.');
    expect([...free].sort()).toEqual(['marta', 'wifi']);
    expect(newWords(it, { known: new Set() }, free)).toEqual(['bordo']);
  });
});

describe('schema field names', () => {
  it('reads translation / hard_words / word', () => {
    const raw = JSON.stringify({ items: [{ i: 1, translation: 'Mezcla la harina.', hard_words: [{ word: 'harina', lemma: 'harina', en: 'flour' }] }] });
    expect(validateItems(raw, ['Mix the flour.'])[0]).toEqual({ i: 1, text: 'Mezcla la harina.', words: [{ w: 'harina', lemma: 'harina', en: 'flour' }] });
  });
});

describe('density per paragraph (error diffusion)', () => {
  const one = (i: number): Item => ({ i, text: 'x', words: [{ w: 'nuevo', lemma: 'nuevo', en: 'new' }] });
  const mk = (keys: string[]) => keys.map((key, k) => ({ key, item: one(k + 1) as Item | null }));
  it('spreads picks so no paragraph is all target language at a low dial', () => {
    const page = mk(['p1.0', 'p1.1', 'p1.2', 'p2.0', 'p2.1', 'p2.2', 'p3.0', 'p3.1', 'p3.2']);
    expect([...chooseShown(page, { known: new Set() }, 0.35)].sort()).toEqual(['p1.0', 'p2.0', 'p3.0']);
  });
  it('total stays close to dial × sentences, even with one-sentence paragraphs', () => {
    const page = mk(Array.from({ length: 10 }, (_, k) => `q${k}`));
    expect(chooseShown(page, { known: new Set() }, 0.2).size).toBe(2);
  });
  it('earlier paragraphs keep their picks when later paragraphs finish translating', () => {
    const early = mk(['p1.0', 'p1.1', 'p1.2', 'p2.0', 'p2.1', 'p2.2']).map((s, k) => (k < 3 ? s : { ...s, item: null }));
    const late = mk(['p1.0', 'p1.1', 'p1.2', 'p2.0', 'p2.1', 'p2.2']);
    const a = chooseShown(early, { known: new Set() }, 0.35);
    const b = chooseShown(late, { known: new Set() }, 0.35);
    for (const k of a) expect(b.has(k)).toBe(true);
    expect(a.has('p1.0')).toBe(true);
  });
});

describe('level word lists', () => {
  it('splits a level into small requests that add up to a bit more than its size', () => {
    for (const level of ['A1', 'A2', 'B1', 'B2'] as const) {
      const plan = lexiconPlan(level);
      const total = plan.reduce((a, q) => a + q.n, 0);
      expect(plan.length).toBe(16);
      expect(total).toBeGreaterThanOrEqual(LEXICON_SIZE[level]);
      expect(total).toBeLessThanOrEqual(LEXICON_SIZE[level] * 1.3);
      expect(Math.max(...plan.map(q => q.n))).toBeLessThanOrEqual(400);
    }
  });

  it('cleans model output into lemmas', () => {
    expect(cleanLemmas('de', ['der Tisch', 'Tisch', 'sich freuen', 'gehen (ging)', 42, 'drei Uhr 3', 'eins zwei drei vier', ''])).toEqual(
      ['tisch', 'sich freuen', 'freuen', 'gehen'],
    );
    expect(cleanLemmas('fr', ["l'école", 'se lever', 'la maison.'])).toEqual(['école', 'se lever', 'lever', 'maison']);
    expect(cleanLemmas('es', ['El tren', 'a bordo', 'levantarse'])).toEqual(['tren', 'a bordo', 'levantarse']);
    expect(cleanLemmas('ja', ['電車', 'ima', 'たべる', 'Kyou'])).toEqual(['電車', 'たべる']);
  });
});

describe('known words', () => {
  const fresh = () => migrateVocab(undefined);

  it('is the level list plus the learner marks, minus what they unmarked', () => {
    const v = fresh();
    markKnown(v, 'Vagón', true);
    markKnown(v, 'casa', false);
    const k = knownWords(v, ['casa', 'tren']);
    expect([...k].sort()).toEqual(['tren', 'vagón']);
    markKnown(v, 'casa', true);
    expect(knownWords(v, ['casa', 'tren']).has('casa')).toBe(true);
    expect(v.forgot).toEqual([]);
  });

  it('swaps level lists instead of stacking them (switching B2 → A2)', () => {
    const v = fresh();
    markKnown(v, 'vagón', true);
    const b2 = knownWords(v, ['tren', 'casa', 'propósito', 'billete']);
    const a2 = knownWords(v, ['tren', 'casa']);
    expect(b2.has('propósito')).toBe(true);
    expect([...a2].sort()).toEqual(['casa', 'tren', 'vagón']);
  });

  it('migrates version 1 stores (level lists mixed into `known`) to fresh marks, keeping stats', () => {
    const stats = { tren: { en: 'train', seen: 3, peek: 1, first: 1, last: 2 } };
    const v = migrateVocab({ known: ['a', 'b'], stats, seeded: 'cloud:B2' });
    expect(v).toEqual({ known: [], forgot: [], stats, v: 2 });
    expect(migrateVocab(v)).toEqual(v);
  });
});
