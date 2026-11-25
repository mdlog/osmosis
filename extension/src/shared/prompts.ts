import { LANG_NAME, type Lang, type Level } from './types';

/** System instruction for the on-device rewrite. Kept short: the on-device model is small. */
export function rewriteSystem(lang: Lang, level: Level): string {
  const L = LANG_NAME[lang];
  return [
    `You translate English sentences into natural ${L} for a language learner at CEFR ${level}.`,
    `Prefer common words and short structures. Keep names, numbers and brand names unchanged.`,
    `For each sentence, list the 1-3 words in your translation that a ${level} learner is least likely to know:`,
    `the word exactly as written in the translation, its dictionary form (lemma), and a short English meaning.`,
    `Translate every numbered sentence. Return JSON only.`,
  ].join(' ');
}

export function rewritePrompt(sentences: string[], lang: Lang, level: Level): string {
  // Restating the target language in the user turn stops the small model from echoing English.
  return `Translate into ${LANG_NAME[lang]} (CEFR ${level}):\n` + sentences.map((s, k) => `${k + 1}. ${s}`).join('\n');
}

/** JSON Schema shared by the on-device responseConstraint and the cloud responseSchema. */
export const REWRITE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer' },
          translation: { type: 'string' },
          hard_words: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                word: { type: 'string' },
                lemma: { type: 'string' },
                en: { type: 'string' },
              },
              required: ['word', 'lemma', 'en'],
            },
          },
        },
        required: ['i', 'translation', 'hard_words'],
      },
    },
  },
  required: ['items'],
} as const;

/** One slice of a level's word list (see lexiconPlan). Sends no user data. */
export function lexiconPrompt(lang: Lang, level: Level, topic: string, n: number): string {
  const script =
    lang === 'ja'
      ? ' Write every word in Japanese script, the way it is normally written (kanji with kana, or kana alone). Never use romaji or any Latin letters.'
      : '';
  return (
    `List ${n} ${LANG_NAME[lang]} words for this topic: ${topic}. ` +
    `Only words that a learner at CEFR ${level} already knows (levels A1 up to ${level}), most common first. ` +
    `Dictionary form (lemma), without articles. No duplicates, no explanations.${script}`
  );
}

export const LEXICON_SCHEMA = {
  type: 'object',
  properties: { lemmas: { type: 'array', items: { type: 'string' } } },
  required: ['lemmas'],
} as const;
