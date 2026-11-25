// chrome.storage.local schema shared by the service worker, content script and side panel.
// Only vocabulary and counters are stored: never page text or URLs.
import type { Lang, Level } from './types';
import { norm } from './validate';

export interface Settings {
  enabled: boolean;
  lang: Lang;
  level: Level;
  /** 0..1 — how much of the page turns into the target language. */
  dial: number;
  /** User agreed to send page text to the cloud when on-device AI is unavailable. */
  cloudConsent: boolean;
}

export const DEFAULT_SETTINGS: Settings = { enabled: true, lang: 'es', level: 'A2', dial: 0.35, cloudConsent: false };

export interface WordStat {
  en: string;
  /** Times the word was on screen inside a shown sentence. */
  seen: number;
  /** Times the learner hovered for the original / meaning (a "struggle" signal). */
  peek: number;
  first: number;
  last: number;
}

/**
 * The learner's own marks for one language. The level's word list lives apart from it
 * (`lex_<lang>_<level>`), so changing level swaps that list instead of piling lists on top of
 * each other. Known words = level list + `known` − `forgot`.
 */
export interface VocabStore {
  /** Words the learner marked as known. */
  known: string[];
  /** Words from the level list that the learner marked as not known. */
  forgot: string[];
  stats: Record<string, WordStat>;
  /** Schema version. Version 1 kept the level list inside `known`. */
  v: 2;
}

/** A level's starting vocabulary: the offline starter list, or the list built in the cloud. */
export interface Lexicon {
  source: 'starter' | 'cloud';
  words: string[];
  /** Cloud: the topics fetched so far; missing ones are fetched the next time. */
  topics?: string[];
  at: number;
}

export interface Ledger {
  day: string;
  onDeviceCalls: number;
  cloudCalls: number;
  /** Characters of page text that left the device (should stay 0 unless cloud consent). */
  pageCharsUp: number;
  /** Characters of vocabulary lists sent for cloud features (lexicon, podcast). */
  wordCharsUp: number;
}

export const today = () => new Date().toISOString().slice(0, 10);
export const emptyLedger = (): Ledger => ({ day: today(), onDeviceCalls: 0, cloudCalls: 0, pageCharsUp: 0, wordCharsUp: 0 });

export async function getSettings(): Promise<Settings> {
  const { settings } = (await chrome.storage.local.get('settings')) as { settings?: Partial<Settings> };
  return { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export const vocabKey = (lang: Lang) => `vocab_${lang}`;

export async function getVocab(lang: Lang): Promise<VocabStore> {
  const k = vocabKey(lang);
  const got = await chrome.storage.local.get(k);
  return migrateVocab(got[k]);
}

/**
 * Version 1 stored the level word lists inside `known`, merged with the learner's clicks, so the
 * two cannot be told apart. Start the marks fresh and keep the exposure stats.
 */
export function migrateVocab(raw: unknown): VocabStore {
  const v = (raw ?? {}) as Partial<VocabStore> & { v?: number };
  if (v.v === 2) return { known: v.known ?? [], forgot: v.forgot ?? [], stats: v.stats ?? {}, v: 2 };
  return { known: [], forgot: [], stats: v.stats ?? {}, v: 2 };
}

export const lexKey = (lang: Lang, level: Level) => `lex_${lang}_${level}`;

export async function getLexicon(lang: Lang, level: Level): Promise<Lexicon | undefined> {
  const k = lexKey(lang, level);
  return ((await chrome.storage.local.get(k)) as Record<string, Lexicon | undefined>)[k];
}

export async function setLexicon(lang: Lang, level: Level, lex: Lexicon): Promise<void> {
  await chrome.storage.local.set({ [lexKey(lang, level)]: lex });
}

/** Known words (normalized): the level list plus the learner's marks, minus what they unmarked. */
export function knownWords(v: VocabStore, lexicon: readonly string[] | undefined): Set<string> {
  const set = new Set([...(lexicon ?? []), ...v.known].map(norm));
  for (const w of v.forgot) set.delete(norm(w));
  return set;
}

// Read-modify-write updates are queued so a click, a peek and a "seen" flush that overlap
// cannot overwrite each other (within one page or the panel).
let vocabQueue: Promise<unknown> = Promise.resolve();
export function updateVocab(lang: Lang, fn: (v: VocabStore) => void): Promise<VocabStore> {
  const run = vocabQueue.then(async () => {
    const v = await getVocab(lang);
    fn(v);
    await chrome.storage.local.set({ [vocabKey(lang)]: v });
    return v;
  });
  vocabQueue = run.catch(() => undefined);
  return run;
}

export function markKnown(v: VocabStore, lemma: string, known: boolean) {
  const k = norm(lemma);
  const yes = new Set(v.known);
  const no = new Set(v.forgot);
  if (known) (yes.add(k), no.delete(k));
  else (yes.delete(k), no.add(k));
  v.known = [...yes];
  v.forgot = [...no];
}

export async function bumpLedger(fn: (l: Ledger) => void): Promise<Ledger> {
  const { ledger } = (await chrome.storage.local.get('ledger')) as { ledger?: Ledger };
  const l: Ledger = ledger && ledger.day === today() ? ledger : emptyLedger();
  fn(l);
  await chrome.storage.local.set({ ledger: l });
  return l;
}
