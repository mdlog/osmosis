// Side panel: language/level, on-device model status, vocabulary, podcast (cloud), privacy ledger.
import { buildLexicon, firebase, makeEpisode, prepareOnDevice, speak } from '../shared/ai';
import { lexiconPlan, starterLexicon } from '../shared/lexicon';
import {
  bumpLedger, getLexicon, getSettings, getVocab, knownWords, lexKey, migrateVocab, setLexicon, setSettings, vocabKey,
  type Ledger, type Lexicon, type Settings, type VocabStore,
} from '../shared/store';
import type { Lang, Level } from '../shared/types';

firebase('extension');

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let settings: Settings;
/** The current level's word list (see ensureLexicon). */
let lexicon: string[] = [];

async function refreshModel() {
  const st: string = await chrome.runtime.sendMessage({ type: 'osm:status', lang: settings.lang });
  const dot = $('model-dot');
  const txt = $('model-text');
  const btn = $<HTMLButtonElement>('model-btn');
  dot.className = 'dot ' + (st === 'available' ? 'ok' : 'warn');
  txt.textContent =
    st === 'available'
      ? 'On-device AI ready. Pages are translated on this computer.'
      : st === 'downloadable' || st === 'downloading'
        ? 'On-device model not downloaded yet.'
        : 'This device can’t run on-device AI.';
  btn.hidden = !(st === 'downloadable' || st === 'downloading');
}

$('model-btn').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('model-btn');
  const bar = $<HTMLProgressElement>('model-progress');
  btn.disabled = true;
  bar.hidden = false;
  try {
    await prepareOnDevice(settings.lang, settings.level, p => (bar.value = p));
  } catch (e) {
    $('model-text').textContent = `Download failed: ${(e as Error).message}`;
  }
  bar.hidden = true;
  btn.disabled = false;
  refreshModel();
});

function renderVocab(v: VocabStore) {
  const known = knownWords(v, lexicon);
  const stats = Object.entries(v.stats).filter(([l]) => !known.has(l));
  $('n-known').textContent = String(known.size);
  $('n-learning').textContent = String(stats.length);
  const struggle = stats.filter(([, s]) => s.peek > 0).sort((a, b) => b[1].peek - a[1].peek);
  $('n-struggle').textContent = String(struggle.length);
  const ol = $('struggle');
  ol.replaceChildren(
    ...struggle.slice(0, 8).map(([lemma, s]) => {
      const li = document.createElement('li');
      const b = document.createElement('b');
      b.textContent = lemma;
      li.append(b, ` — ${s.en} `);
      const m = document.createElement('span');
      m.className = 'muted small';
      m.textContent = `peeked ${s.peek}×`;
      li.append(m);
      return li;
    }),
  );
}

function renderLedger(l: Ledger | undefined) {
  const set = (id: string, n: number, unit = '') => {
    const el = $(id);
    el.textContent = `${n.toLocaleString()}${unit}`;
    el.classList.toggle('zero', n === 0);
  };
  set('l-page', l?.pageCharsUp ?? 0, ' characters');
  set('l-words', l?.wordCharsUp ?? 0, ' characters');
  set('l-ondevice', l?.onDeviceCalls ?? 0);
  set('l-cloud', l?.cloudCalls ?? 0);
}

function lexStatus(text: string) {
  const el = $('lex-status');
  el.textContent = text;
  el.hidden = !text;
}

const building = new Map<string, Promise<void>>();

/**
 * Make sure the level has its word list from the cloud. Each level keeps its own list (switching
 * back costs nothing), and topics that failed last time are fetched now.
 */
function ensureLexicon(lang: Lang, level: Level): Promise<void> {
  const key = lexKey(lang, level);
  let p = building.get(key);
  if (!p) {
    p = buildMissing(lang, level).finally(() => building.delete(key));
    building.set(key, p);
  }
  return p;
}

async function buildMissing(lang: Lang, level: Level) {
  const lex = await getLexicon(lang, level);
  const have = new Set(lex?.source === 'cloud' ? (lex.topics ?? []) : []);
  const todo = lexiconPlan(level).filter(q => !have.has(q.topic));
  if (!todo.length) return;
  const starter = starterLexicon(lang);
  if (!lex && starter.length) await setLexicon(lang, level, { source: 'starter', words: starter, at: Date.now() });
  const verb = have.size ? 'Completing' : 'Building';
  lexStatus(`${verb} your ${level} word list with Gemini…`);
  const r = await buildLexicon(lang, level, todo, (k, n) => lexStatus(`${verb} your ${level} word list with Gemini… ${k}/${n}`));
  if (r.calls) await bumpLedger(l => (l.cloudCalls += r.calls));
  if (!r.words.length) {
    lexStatus('Couldn’t reach Gemini for your word list. It will try again next time.');
    return;
  }
  const prev = lex?.source === 'cloud' ? lex.words : [];
  const next: Lexicon = {
    source: 'cloud',
    words: [...new Set([...prev, ...starter, ...r.words])],
    topics: [...have, ...r.done],
    at: Date.now(),
  };
  await setLexicon(lang, level, next);
  const missing = lexiconPlan(level).length - next.topics!.length;
  lexStatus(missing ? `${next.words.length} words in your ${level} list. ${missing} topics will be added next time.` : '');
}

$('podcast-btn').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('podcast-btn');
  const out = $('podcast');
  btn.disabled = true;
  btn.textContent = 'Writing your episode…';
  try {
    const v = await getVocab(settings.lang);
    const known = knownWords(v, lexicon);
    const words = Object.entries(v.stats)
      .filter(([l, s]) => !known.has(l) && s.peek > 0)
      .sort((a, b) => b[1].peek - a[1].peek)
      .slice(0, 8)
      .map(([lemma, s]) => ({ lemma, en: s.en }));
    if (words.length < 3) throw new Error('Read a little more first: you need at least 3 words you peeked at.');
    const ep = await makeEpisode(words, settings.lang, settings.level);
    await bumpLedger(l => ((l.cloudCalls += 1), (l.wordCharsUp += ep.sentUp)));
    out.hidden = false;
    out.replaceChildren();
    const h = document.createElement('h3');
    h.textContent = ep.title;
    const p = document.createElement('p');
    p.textContent = ep.story;
    out.append(h);
    btn.textContent = 'Recording audio…';
    try {
      const wav = await speak(ep.story, settings.lang);
      await bumpLedger(l => l.cloudCalls++);
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src = URL.createObjectURL(wav);
      out.append(audio);
    } catch (e) {
      console.warn('[osmosis] tts', e);
    }
    out.append(p);
    for (const q of ep.questions) {
      const d = document.createElement('div');
      d.className = 'q';
      d.textContent = `${q.q} — ${q.options.map((o, k) => `${'abcd'[k]}) ${o}`).join('  ')}`;
      out.append(d);
    }
  } catch (e) {
    out.hidden = false;
    out.textContent = (e as Error).message;
  }
  btn.disabled = false;
  btn.textContent = "Make today's episode";
});

async function boot() {
  settings = await getSettings();
  const lang = $<HTMLSelectElement>('lang');
  const level = $<HTMLSelectElement>('level');
  const consent = $<HTMLInputElement>('consent');
  lang.value = settings.lang;
  level.value = settings.level;
  consent.checked = settings.cloudConsent;
  const onChange = async () => {
    settings = await setSettings({ lang: lang.value as Lang, level: level.value as Level, cloudConsent: consent.checked });
    lexicon = (await getLexicon(settings.lang, settings.level))?.words ?? [];
    lexStatus('');
    renderVocab(await getVocab(settings.lang));
    refreshModel();
    ensureLexicon(settings.lang, settings.level);
  };
  lang.addEventListener('change', onChange);
  level.addEventListener('change', onChange);
  consent.addEventListener('change', onChange);
  lexicon = (await getLexicon(settings.lang, settings.level))?.words ?? [];
  renderVocab(await getVocab(settings.lang));
  renderLedger(((await chrome.storage.local.get('ledger')) as { ledger?: Ledger }).ledger);
  chrome.storage.onChanged.addListener(async ch => {
    const lex = ch[lexKey(settings.lang, settings.level)]?.newValue as Lexicon | undefined;
    if (lex) {
      lexicon = lex.words;
      renderVocab(await getVocab(settings.lang));
    }
    if (ch[vocabKey(settings.lang)]) renderVocab(migrateVocab(ch[vocabKey(settings.lang)].newValue));
    if (ch.ledger) renderLedger(ch.ledger.newValue as Ledger);
  });
  refreshModel();
  ensureLexicon(settings.lang, settings.level);
}

boot();
