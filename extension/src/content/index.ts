// Content script: finds article sentences, asks the service worker for on-device
// translations, and decides (locally) which sentences to show in the target language.
import { functionWords } from '../shared/lexicon';
import { chooseShown, isKnown, transparent, type Vocab } from '../shared/select';
import { isTranslatable, splitSentences } from '../shared/segment';
import {
  getLexicon, getSettings, getVocab, knownWords, lexKey, markKnown, migrateVocab, setSettings, updateVocab, vocabKey,
  type Lexicon, type Settings, type VocabStore,
} from '../shared/store';
import type { Item, TranslateRequest, TranslateResponse } from '../shared/types';
import { norm } from '../shared/validate';
import { mountDial, type Dial } from './dial';
import { Tooltip } from './tooltip';

interface Sent {
  key: string;
  el: HTMLSpanElement; // .osm-s wrapper
  text: string;
  item: Item | null;
  /** Lemmas readable for free in this sentence (same spelling as in the English). */
  free?: Set<string>;
}

const sents = new Map<string, Sent>();
let settings: Settings;
let vocab: VocabStore;
/** The current level's word list (starter or cloud). */
let lexicon: string[] = [];
let known: Vocab = { known: new Set() };
let dial: Dial;
const tip = new Tooltip();
let pidSeq = 0;

function knownSet(v: VocabStore): Vocab {
  const set = knownWords(v, lexicon);
  for (const w of functionWords(settings.lang)) set.add(norm(w));
  return { known: set };
}

function isEnglishPage(): boolean {
  const l = (document.documentElement.lang || '').toLowerCase();
  return !l || l.startsWith('en');
}

/** Article paragraphs worth reading: inside the main content, long enough, not chrome. */
function candidateParagraphs(): HTMLElement[] {
  const scoped = document.querySelectorAll<HTMLElement>('article p, main p, [role="main"] p, .osm-demo p');
  const list = scoped.length ? [...scoped] : [...document.querySelectorAll<HTMLElement>('p')];
  return list.filter(p => {
    if (p.closest('nav, aside, footer, header, form, figcaption, [contenteditable], .osm-root')) return false;
    if (p.dataset.osm) return false;
    return (p.textContent ?? '').trim().length >= 60;
  });
}

/**
 * Wrap each sentence of a paragraph in <span class="osm-s"><span class="osm-orig">…</span></span>
 * using Ranges over text-node offsets, so links and emphasis inside the original survive.
 */
function wrapSentences(p: HTMLElement, pid: string): Sent[] {
  const text = p.textContent ?? '';
  const spans = splitSentences(text);
  // Map a paragraph-level character offset to (text node, offset).
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; start: number }[] = [];
  let pos = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push({ node: n as Text, start: pos });
    pos += (n as Text).data.length;
  }
  const locate = (off: number): [Text, number] => {
    for (let k = nodes.length - 1; k >= 0; k--) if (off >= nodes[k].start) return [nodes[k].node, off - nodes[k].start];
    return [nodes[0].node, 0];
  };
  // Create ranges first (offsets are only valid before we mutate), then wrap from the end.
  const ranges = spans.map(s => {
    const r = document.createRange();
    const [sn, so] = locate(s.start);
    const [en, eo] = locate(s.end);
    r.setStart(sn, so);
    r.setEnd(en, eo);
    return r;
  });
  const out: Sent[] = [];
  for (let k = spans.length - 1; k >= 0; k--) {
    const outer = document.createElement('span');
    outer.className = 'osm-s';
    const orig = document.createElement('span');
    orig.className = 'osm-orig';
    orig.appendChild(ranges[k].extractContents());
    outer.appendChild(orig);
    ranges[k].insertNode(outer);
    const key = `${pid}.${k}`;
    outer.dataset.k = key;
    out.unshift({ key, el: outer, text: spans[k].text, item: null });
  }
  p.dataset.osm = pid;
  return out;
}

function renderTranslation(s: Sent) {
  if (!s.item) return;
  s.el.querySelector('.osm-tr')?.remove();
  const tr = document.createElement('span');
  tr.className = 'osm-tr';
  tr.lang = settings.lang;
  // Mark glossary words inside the translated text.
  const t = s.item.text;
  const marks: { at: number; len: number; lemma: string }[] = [];
  const lower = t.toLocaleLowerCase();
  for (const w of s.item.words) {
    const at = lower.indexOf(w.w.toLocaleLowerCase());
    if (at >= 0 && !marks.some(m => at < m.at + m.len && m.at < at + w.w.length)) marks.push({ at, len: w.w.length, lemma: w.lemma });
  }
  marks.sort((a, b) => a.at - b.at);
  let cur = 0;
  for (const m of marks) {
    tr.append(t.slice(cur, m.at));
    const ws = document.createElement('span');
    ws.className = 'osm-w';
    ws.dataset.lemma = m.lemma;
    ws.textContent = t.slice(m.at, m.at + m.len);
    tr.append(ws);
    cur = m.at + m.len;
  }
  tr.append(t.slice(cur));
  // Keep a trailing space so the next sentence doesn't glue on.
  tr.append(' ');
  s.el.appendChild(tr);
  paintWords(s);
}

/** New (unknown) words get the highlight; known words stay plain. */
function paintWords(s: Sent) {
  s.el.querySelectorAll<HTMLElement>('.osm-w').forEach(w => {
    const lemma = w.dataset.lemma ?? '';
    w.classList.toggle('osm-new', !s.free?.has(lemma) && !isKnown(known, lemma, w.textContent ?? ''));
  });
}

/** Re-run the i+1 selection over every translated sentence on the page. */
function reselect() {
  const list = [...sents.values()];
  const shown = settings.enabled ? chooseShown(list, known, settings.dial) : new Set<string>();
  for (const s of list) {
    s.el.classList.toggle('osm-on', shown.has(s.key));
    paintWords(s);
  }
  dial?.update({
    shown: shown.size,
    total: list.length,
    translated: list.filter(s => s.item).length,
  });
}

async function translateParagraph(p: HTMLElement) {
  const pid = `p${++pidSeq}`;
  const wrapped = wrapSentences(p, pid);
  wrapped.forEach(s => sents.set(s.key, s));
  const todo = wrapped.filter(s => isTranslatable(s.text));
  if (!todo.length) return;
  p.classList.add('osm-pending');
  // Small chunks: the on-device model answers 3 sentences in a few seconds, so text starts changing quickly.
  for (let c = 0; c < todo.length; c += 3) {
    const chunk = todo.slice(c, c + 3);
    const req: TranslateRequest = { type: 'osm:translate', pid: `${pid}.${c}`, sentences: chunk.map(s => s.text), lang: settings.lang, level: settings.level };
    const res: TranslateResponse = await chrome.runtime.sendMessage(req);
    if (res.error) dial?.status(res.error.includes('on-device') || res.error.includes('unavailable') ? 'no-ondevice' : 'error', res.error);
    else dial?.status(res.source === 'in_cloud' ? 'cloud' : 'on-device');
    res.items.forEach((it, k) => {
      chunk[k].item = it;
      chunk[k].free = it ? transparent(it, chunk[k].text) : undefined;
      renderTranslation(chunk[k]);
    });
    reselect();
  }
  p.classList.remove('osm-pending');
}

// Viewport-first: translate paragraphs as they approach the screen.
const io = new IntersectionObserver(
  entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      queue.push(e.target as HTMLElement);
    }
    pump();
  },
  { rootMargin: '400px 0px' },
);
const queue: HTMLElement[] = [];
let inflight = 0;
function pump() {
  // Two in flight keeps the device busy while the next paragraph is wrapped/rendered.
  // Background tabs wait: the on-device model is shared, and the page you're reading comes first.
  while (inflight < 2 && queue.length && !document.hidden) {
    const p = queue.shift()!;
    inflight++;
    translateParagraph(p)
      .catch(() => {})
      .finally(() => {
        inflight--;
        pump();
      });
  }
}

// ---- Learning signals --------------------------------------------------------
const peekTimers = new WeakMap<Element, number>();
function onHover(ev: MouseEvent) {
  const s = (ev.target as HTMLElement).closest?.('.osm-s.osm-on') as HTMLElement | null;
  if (!s) return tip.hide();
  const sent = sents.get(s.dataset.k ?? '');
  if (!sent?.item) return;
  tip.show(s, sent.text, sent.item.words.filter(w => !sent.free?.has(w.lemma) && !isKnown(known, w.lemma, w.w)));
  if (!peekTimers.has(s)) {
    // Count a "peek" only if the learner lingers: a real struggle signal, not a mouse pass.
    peekTimers.set(s, window.setTimeout(() => recordPeek(sent), 700));
  }
}
function onLeave(ev: MouseEvent) {
  const s = (ev.target as HTMLElement).closest?.('.osm-s') as HTMLElement | null;
  if (s && peekTimers.has(s)) {
    clearTimeout(peekTimers.get(s));
    peekTimers.delete(s);
  }
}
async function recordPeek(s: Sent) {
  const fresh = s.item!.words.filter(w => !s.free?.has(w.lemma) && !isKnown(known, w.lemma, w.w));
  if (!fresh.length) return;
  vocab = await updateVocab(settings.lang, v => {
    const now = Date.now();
    for (const w of fresh) {
      const st = (v.stats[w.lemma] ??= { en: w.en, seen: 0, peek: 0, first: now, last: now });
      st.peek++;
      st.last = now;
    }
  });
}

async function onWordClick(ev: MouseEvent) {
  const w = (ev.target as HTMLElement).closest?.('.osm-w') as HTMLElement | null;
  if (!w || !w.closest('.osm-on')) return;
  ev.preventDefault();
  ev.stopPropagation();
  const lemma = w.dataset.lemma ?? '';
  // Decide inside the storage update, against the stored list, so two quick clicks toggle twice
  // instead of both reading the same stale state.
  vocab = await updateVocab(settings.lang, v => markKnown(v, lemma, !knownWords(v, lexicon).has(norm(lemma))));
  known = knownSet(vocab);
  // Repaint only: re-running the selection here would flip the sentence under the cursor back to
  // English, and the learner could no longer click again to undo. New picks happen on the next
  // dial move or page load.
  sents.forEach(paintWords);
}

/** Words that come on screen in shown sentences count as exposure ("seen"); flushed in batches. */
const seenBuffer = new Map<string, { en: string; n: number }>();
let seenFlush = 0;
const seenObserver = new IntersectionObserver(
  entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const s = sents.get((e.target as HTMLElement).dataset.k ?? '');
      if (!s?.item || !s.el.classList.contains('osm-on')) continue;
      for (const w of s.item.words) {
        const b = seenBuffer.get(w.lemma) ?? { en: w.en, n: 0 };
        b.n++;
        seenBuffer.set(w.lemma, b);
      }
    }
    if (seenBuffer.size && !seenFlush) seenFlush = window.setTimeout(flushSeen, 4000);
  },
  { threshold: 0.9 },
);
async function flushSeen() {
  seenFlush = 0;
  const batch = [...seenBuffer.entries()];
  seenBuffer.clear();
  vocab = await updateVocab(settings.lang, v => {
    const now = Date.now();
    for (const [lemma, b] of batch) {
      const st = (v.stats[lemma] ??= { en: b.en, seen: 0, peek: 0, first: now, last: now });
      st.seen += b.n;
      st.last = now;
    }
  });
}

// ---- Boot ---------------------------------------------------------------------
// The same script runs as the extension's content script and inside the web demo reader.
// Whoever starts first claims the page, so the two never translate it twice.
const HOST = (globalThis as { __OSM_WEB__?: boolean }).__OSM_WEB__ ? 'web' : 'ext';

async function boot() {
  const root = document.documentElement;
  // A page can opt out (our landing page does: its hero is a hand-written Osmosis specimen).
  if (document.querySelector('meta[name="osmosis"][content="off" i]')) return;
  if (root.dataset.osmosis && root.dataset.osmosis !== HOST) return;
  root.dataset.osmosis = HOST;
  if (!isEnglishPage()) return;
  settings = await getSettings();
  vocab = await getVocab(settings.lang);
  lexicon = (await getLexicon(settings.lang, settings.level))?.words ?? [];
  known = knownSet(vocab);
  dial = mountDial(settings, {
    onDial: d => {
      settings.dial = d;
      reselect();
      void setSettings({ dial: d });
    },
    onToggle: on => {
      settings.enabled = on;
      reselect();
      void setSettings({ enabled: on });
    },
  });
  if (!settings.enabled) return;
  for (const p of candidateParagraphs()) io.observe(p);
  document.addEventListener('visibilitychange', pump);
  document.addEventListener('mouseover', onHover);
  document.addEventListener('mouseout', onLeave);
  document.addEventListener('click', onWordClick, true);
  // Track exposure once sentences exist.
  new MutationObserver(() => document.querySelectorAll('.osm-s:not([data-seen])').forEach(el => {
    (el as HTMLElement).dataset.seen = '1';
    seenObserver.observe(el);
  })).observe(document.body, { childList: true, subtree: true });

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.settings?.newValue) {
      const next = ch.settings.newValue as Settings;
      const langChanged = next.lang !== settings.lang || next.level !== settings.level;
      settings = { ...settings, ...next };
      dial.sync(settings);
      if (langChanged) location.reload();
      else reselect();
    }
    if (ch[vocabKey(settings.lang)]?.newValue) {
      // Vocabulary changes all the time (peeks, exposure counts every few seconds, clicks).
      // Repaint highlights only: re-selecting here would swap sentences while they are being read.
      vocab = migrateVocab(ch[vocabKey(settings.lang)].newValue);
      known = knownSet(vocab);
      sents.forEach(paintWords);
    }
    const lex = ch[lexKey(settings.lang, settings.level)]?.newValue as Lexicon | undefined;
    if (lex) {
      // The level's word list arrived or grew: same rule, repaint only.
      lexicon = lex.words;
      known = knownSet(vocab);
      sents.forEach(paintWords);
    }
  });
}

boot();
