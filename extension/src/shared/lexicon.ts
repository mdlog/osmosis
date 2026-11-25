// Offline starter vocabulary (very common Spanish content words, roughly A1).
// Used until the cloud builds a level-specific lexicon, and whenever the device is offline.
import type { Lang, Level } from './types';

const ES_A1 = `
ser estar tener hacer decir ir ver dar saber querer llegar pasar deber poner parecer quedar creer hablar llevar
dejar seguir encontrar llamar venir pensar salir volver tomar conocer vivir sentir mirar contar empezar esperar
buscar entrar trabajar escribir perder pedir recibir recordar terminar comenzar necesitar leer caer cambiar abrir
cerrar comprar caminar dormir beber comer jugar escuchar ayudar gustar usar aprender estudiar viajar pagar
tiempo año día vez cosa hombre mujer vida mundo casa país parte lugar persona trabajo momento ciudad gente
familia agua noche mano hora hijo hija niño niña nombre problema ejemplo historia semana mes libro escuela calle
dinero amigo amiga padre madre palabra puerta comida tren coche música mañana tarde ojo cabeza calle tienda
grande pequeño nuevo viejo bueno malo mejor primero último largo corto alto bajo joven mismo otro mucho poco
todo importante posible difícil fácil feliz rápido lento bonito caro barato
muy bien mal más menos ahora hoy siempre nunca también ya aquí allí después antes luego todavía pronto
`;

const STARTER: Partial<Record<Lang, string>> = { es: ES_A1 };

export function starterLexicon(lang: Lang): string[] {
  return [...new Set((STARTER[lang] ?? '').split(/\s+/).filter(Boolean))];
}

// Grammar words are never "new": glossing them would drown the real vocabulary.
const FUNCTION: Partial<Record<Lang, string>> = {
  es: `el la los las un una uno unos unas lo al del de a en con por para sin sobre entre hasta desde hacia según contra
y o u e ni pero sino que qué quien quién quienes cual cuál cuales cuando cuándo donde dónde como cómo porque si no sí
yo tú él ella ello nosotros nosotras vosotros ellos ellas usted ustedes me te se nos os le les mi mis tu tus su sus
nuestro nuestra nuestros nuestras este esta estos estas ese esa esos esas aquel aquella esto eso hay haber muy tan
tanto cada algo alguien nada nadie ya cuyo mío tuyo suyo ser estar`,
};

export function functionWords(lang: Lang): string[] {
  return (FUNCTION[lang] ?? '').split(/\s+/).filter(Boolean);
}

// ---------------------------------------------------------------------------------------------
// Level word lists built in the cloud.
//
// One request for "the 1,400 most frequent words" is unreliable: the model often stops after
// ~100 words (measured: 113, 118 and 1,755 lemmas for three identical German B1 requests). Many
// small requests, one per topic or part of speech, each ask for a list the model can finish.

export const LEXICON_SIZE: Record<Level, number> = { A1: 300, A2: 700, B1: 1400, B2: 2200 };

const TOPICS: [topic: string, weight: number][] = [
  ['everyday verbs: actions, movement, communication, thinking and feeling', 3],
  ['common adjectives: qualities, sizes, colours, shapes, opinions', 2],
  ['adverbs of time, place, manner and degree', 1],
  ['people, family, relationships and personality', 1],
  ['the body, health and emotions', 1],
  ['home, furniture, household objects and daily routine', 1],
  ['food, drink, cooking and restaurants', 1],
  ['the city, buildings, places and directions', 1],
  ['travel, transport and holidays', 1],
  ['work, jobs, school and studying', 1],
  ['time, the calendar, weather and seasons', 1],
  ['nature, animals, plants and the environment', 1],
  ['shopping, money and clothes', 1],
  ['media, technology and communication', 1],
  ['society, news, politics and culture', 1],
  ['abstract nouns: ideas, opinions, events, quantities and change', 2],
];

export interface LexiconRequest {
  topic: string;
  n: number;
}

/**
 * The requests that together make a level's word list. They ask for about 20% more than
 * LEXICON_SIZE in total, because topics overlap (a German B1 run kept 958 of 1,183 lemmas).
 */
export function lexiconPlan(level: Level): LexiconRequest[] {
  const total = TOPICS.reduce((a, [, w]) => a + w, 0);
  return TOPICS.map(([topic, w]) => ({ topic, n: Math.max(10, Math.round((LEXICON_SIZE[level] * 1.2 * w) / total)) }));
}

const ARTICLE: Partial<Record<Lang, RegExp>> = {
  es: /^(el|la|los|las|un|una)\s+/,
  fr: /^(le|la|les|un|une)\s+|^l['’]/,
  de: /^(der|die|das|ein|eine)\s+/,
};

/**
 * Normalize model output into lemmas: strings only, no articles or notes in brackets, at most
 * three words, deduplicated. Reflexive verbs are kept with and without the pronoun, because
 * the glossary may use either form ("sich freuen" / "freuen", "levantarse" stays as is).
 */
export function cleanLemmas(lang: Lang, raw: unknown[]): string[] {
  const out = new Set<string>();
  for (const x of raw) {
    if (typeof x !== 'string') continue;
    let s = x.normalize('NFC').toLocaleLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').trim();
    s = s.replace(ARTICLE[lang] ?? /^$/, '').replace(/[.,;:!?"“”«»]+$/g, '').trim();
    if (!s || s.split(/\s+/).length > 3 || /\d/.test(s)) continue;
    if (lang === 'ja' && /[a-z]/.test(s)) continue; // romaji never matches the glossary's kanji/kana
    out.add(s);
    if (lang === 'de' && s.startsWith('sich ')) out.add(s.slice(5));
    if (lang === 'fr' && /^(se |s['’])/.test(s)) out.add(s.replace(/^(se |s['’])/, ''));
  }
  return [...out];
}
