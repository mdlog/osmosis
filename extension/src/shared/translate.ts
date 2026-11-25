// The translate pipeline shared by the extension service worker and the web demo reader:
// local cache → one serialised model call (Firebase AI Logic) → cache + privacy ledger.
import { rewrite, type RewriteMode } from './ai';
import { starterLexicon } from './lexicon';
import { bumpLedger, getLexicon, getSettings, setLexicon, type Settings } from './store';
import type { Item, Lang, Level, TranslateRequest, TranslateResponse } from './types';

// The on-device model runs one prompt at a time; serialise so viewport order is kept.
let chain: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
};

/** FNV-1a: cache key for a sentence. The cache lives in local storage only. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 0x01000193);
  return (h >>> 0).toString(36) + s.length.toString(36);
}
const cacheKey = (req: TranslateRequest, s: string) => `tr:${req.lang}:${req.level}:${hash(s)}`;

/** Give a level the offline starter list until the cloud list exists (languages that have one). */
export async function ensureSeeded(lang: Lang, level: Level): Promise<void> {
  if (await getLexicon(lang, level)) return;
  const words = starterLexicon(lang);
  if (words.length) await setLexicon(lang, level, { source: 'starter', words, at: Date.now() });
}

/**
 * `modeFor` decides where page text may go. The extension passes ONLY_ON_DEVICE unless the
 * learner opted in to cloud fallback; the web demo (our own article) may prefer on-device and
 * fall back to the cloud.
 */
export function createTranslator(modeFor: (s: Settings) => RewriteMode) {
  async function translate(req: TranslateRequest): Promise<TranslateResponse> {
    const t0 = performance.now();
    const mode = modeFor(await getSettings());
    try {
      const keys = req.sentences.map(x => cacheKey(req, x));
      const cached = (await chrome.storage.local.get(keys)) as Record<string, Item>;
      const todo = req.sentences.map((x, k) => ({ x, k })).filter(({ k }) => !cached[keys[k]]);
      if (!todo.length) {
        return { pid: req.pid, items: keys.map((k, n) => ({ ...cached[k], i: n + 1 })), source: 'on_device', ms: Math.round(performance.now() - t0), cached: true };
      }
      const fresh = await serial(() => rewrite(todo.map(t => t.x), req.lang, req.level, mode));
      const items: (Item | null)[] = keys.map((k, n) => (cached[k] ? { ...cached[k], i: n + 1 } : null));
      const toStore: Record<string, Item> = {};
      todo.forEach(({ k }, n) => {
        const it = fresh.items[n];
        if (!it) return;
        items[k] = { ...it, i: k + 1 };
        toStore[keys[k]] = items[k]!;
      });
      await chrome.storage.local.set(toStore);
      await bumpLedger(l => {
        if (fresh.source === 'on_device') l.onDeviceCalls++;
        if (fresh.source === 'in_cloud') l.cloudCalls++;
        l.pageCharsUp += fresh.sentUp;
      });
      const ms = Math.round(performance.now() - t0);
      console.log(`[osmosis] ${req.pid} ${todo.length}/${req.sentences.length} sentences → ${fresh.source} in ${ms} ms (${items.filter(Boolean).length} ok)`);
      return { pid: req.pid, items, source: fresh.source, ms };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { pid: req.pid, items: req.sentences.map(() => null), source: 'none', ms: Math.round(performance.now() - t0), error: msg };
    }
  }
  return { translate };
}

/** Prompt API availability for English → `lang`, without creating a session. */
export async function onDeviceStatus(lang: string): Promise<string> {
  const LM = (globalThis as { LanguageModel?: { availability(o: unknown): Promise<string> } }).LanguageModel;
  if (!LM) return 'unavailable';
  try {
    return await LM.availability({
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: [lang] }],
    });
  } catch {
    return 'unavailable';
  }
}
