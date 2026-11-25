// Films the beats in the isolated Chrome (real Gemini Nano, the extension loaded) and, for the
// hybrid beat, in Playwright's Chromium (no on-device model). Run video/prep.cjs and video/tts.py
// first. The narration is the clock: `b.at(phrase)` waits until the voice reaches that phrase
// (ElevenLabs word timings), and every beat is held at least as long as its narration.
//
// Pixels come from the CDP screencast of each page (page content only, never the desktop).
// The screencast delivers CSS-pixel frames, so pages run at 1536×864 (the article, alone) or
// 1152×864 + 384×864 (article + side panel) and build.py scales them by 1.25 to 1920×1080:
// the same picture as a browser at 125% zoom. The pages themselves are not restyled, except that
// Wikipedia's logo, banners and link previews are hidden (contest rule: no third-party logos).
//
// Usage: node video/record.cjs [--only=08-hybrid]   |   node video/record.cjs --reindex
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const { BEATS, RAW_DIR, OUT_DIR, ARTICLE, WEB_DEMO } = require('./script.cjs');

const EXT = 'jeeacnodnalnmbkaipineojgflbekmlg';
const PANEL_URL = `chrome-extension://${EXT}/panel.html`;
const CHROMIUM = `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;
const ONLY = process.argv.find(a => a.startsWith('--only='))?.slice(7);
const FULL = { w: 1536, h: 864 };
const SPLIT = { w: 1152, h: 864 };
const PANEL = { w: 384, h: 864 };
// Windows larger than the emulated viewports: a window smaller than its viewport (or one the
// window manager resizes mid-take) makes Chrome shrink the screencast frames. A real pointer over
// these windows would reach the pages, so nobody touches them during a take.
const WIN = { article: { left: 200, top: 40, width: 2000, height: 1300 }, panel: { left: 2240, top: 40, width: 1000, height: 1300 } };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(`[rec ${new Date().toISOString().slice(11, 19)}]`, ...a);
const audio = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'audio', 'index.json'), 'utf8'));
const take = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'take.json'), 'utf8'));

// ---- page dressing ---------------------------------------------------------------------------
// A visible pointer (the screencast has none). Drawn in the page's top layer, ignores input.
const CURSOR = () => {
  const make = () => {
    if (document.getElementById('__vc')) return;
    const c = document.createElement('div');
    c.id = '__vc';
    c.style.cssText = 'position:fixed;left:-100px;top:-100px;width:22px;height:30px;pointer-events:none;z-index:2147483647;transition:transform .1s ease;transform-origin:2px 2px;';
    c.innerHTML = '<svg width="22" height="30" viewBox="0 0 22 30"><path d="M2 2v22l6-5.6 4.2 9.6 3.6-1.6-4.2-9.4H20Z" fill="#111" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    addEventListener('mousemove', e => { c.style.left = e.clientX - 2 + 'px'; c.style.top = e.clientY - 2 + 'px'; }, true);
    addEventListener('mousedown', () => { c.style.transform = 'scale(.82)'; }, true);
    addEventListener('mouseup', () => { c.style.transform = ''; }, true);
  };
  if (document.documentElement) make(); else document.addEventListener('DOMContentLoaded', make);
};
// Contest rule: no third-party logos. Also no link-preview popups or banners over the text.
const WIKI_DRESS = () => {
  if (location.hostname !== 'en.wikipedia.org') return;
  const add = () => {
    if (document.getElementById('__dress')) return;
    const st = document.createElement('style');
    st.id = '__dress';
    st.textContent = '.mw-logo, .mw-logo-container, #centralNotice, #siteNotice, .cn-fundraising, .frb, .mwe-popups, .mw-dismissable-notice { visibility: hidden !important; }';
    (document.head || document.documentElement).appendChild(st);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add);
  add();
};

// ---- capture ---------------------------------------------------------------------------------
/** Pixel size of a JPEG (its SOF0/SOF2 marker). */
function jpegSize(buf) {
  for (let i = 2; i < buf.length - 9; ) {
    if (buf[i] !== 0xff) return null;
    const m = buf[i + 1];
    if (m === 0xc0 || m === 0xc2) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

class Cam {
  constructor(name, page, cdp) {
    Object.assign(this, { name, page, cdp, on: false });
    cdp.on('Page.screencastFrame', f => {
      if (this.on) {
        const file = `${this.name}-${String(this.frames.length).padStart(5, '0')}.jpg`;
        const buf = Buffer.from(f.data, 'base64');
        const wh = jpegSize(buf);
        if (!wh || wh[0] !== this.w || wh[1] !== this.h) this.badSize.push(wh ? wh.join('x') : '?');
        fs.writeFileSync(path.join(this.dir, file), buf);
        this.frames.push({ t: +(f.metadata.timestamp - this.t0).toFixed(4), f: file });
      }
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
  }
  async size({ w, h }) {
    this.w = w;
    this.h = h;
    await this.cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  }
  async start(dir, t0) {
    Object.assign(this, { dir, t0, frames: [], badSize: [], on: true });
    await this.size(this);
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 94, maxWidth: this.w, maxHeight: this.h, everyNthFrame: 1 });
  }
  async stop() {
    this.on = false;
    await this.cdp.send('Page.stopScreencast').catch(() => {});
    return this.frames;
  }
}

const squash = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
/** Seconds from the start of a beat's narration at which `phrase` is spoken. */
function phraseStart(words, phrase) {
  const want = squash(phrase);
  for (let i = 0; i < words.length; i++) {
    let s = '';
    for (let j = i; j < words.length && s.length < want.length; j++) s += squash(words[j].text);
    if (s.startsWith(want)) return words[i].start;
  }
  throw new Error(`phrase not in narration: "${phrase}"`);
}

const index = [];
async function beat(id, cams, fn) {
  const spec = BEATS.find(x => x.id === id);
  const row = audio.find(a => a.id === id);
  if (!row) throw new Error(`no audio for ${id}: run tts.py`);
  const words = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'audio', row.words), 'utf8'));
  const dir = path.join(RAW_DIR, id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const ev = { overlays: [], routes: [], sounds: [], notes: [] };
  let minEnd = 0;
  const t0 = Date.now();
  const el = () => (Date.now() - t0) / 1000;
  await Promise.all(cams.map(c => c.start(dir, t0 / 1000)));
  log(`▶ ${id} (${spec.layout}, hold ≥ ${row.segmentS}s)`);
  const b = {
    el,
    ev,
    segmentS: row.segmentS,
    phraseAt: phrase => row.delayMs / 1000 + phraseStart(words, phrase),
    async at(phrase, offsetS = 0) {
      const dt = b.phraseAt(phrase) + offsetS - el();
      if (dt > 0) await sleep(dt * 1000);
      else if (dt < -0.4) log(`   "${phrase}" already passed by ${(-dt).toFixed(1)}s`);
    },
    route: label => ev.routes.push({ t: +el().toFixed(2), label }),
    overlay: (name, from, to, fade = 0.4) => ev.overlays.push({ name, from: +from.toFixed(2), to: +to.toFixed(2), fade }),
    note: (k, v) => ev.notes.push({ k, v }),
    /** Keep filming (past the narration if needed) until `ok()` holds, for at most `maxS` beyond the segment. */
    async holdUntil(ok, maxS, label) {
      for (;;) {
        if (await ok()) {
          minEnd = Math.max(minEnd, el() + 1.2);
          return true;
        }
        if (el() > row.segmentS + maxS) {
          log(`   ${label}: not reached within the hold`);
          return false;
        }
        await sleep(400);
      }
    },
  };
  await fn(b);
  const segmentS = +Math.max(row.segmentS, minEnd).toFixed(3);
  if (segmentS + 0.3 > el()) await sleep((segmentS + 0.3 - el()) * 1000);
  const recordedS = el();
  const frames = {};
  for (const c of cams) {
    frames[c.name] = await c.stop();
    if (c.badSize.length > 2) throw new Error(`${id}: ${c.badSize.length} ${c.name} frames were not ${c.w}x${c.h} (e.g. ${c.badSize[0]}): the window was resized`);
  }
  const rec = { id, layout: spec.layout, segmentS, recordedS: +recordedS.toFixed(2), frames, ...ev };
  fs.writeFileSync(path.join(dir, 'beat.json'), JSON.stringify(rec));
  // Keep what this take has shown so far, even if a later beat fails.
  fs.writeFileSync(path.join(OUT_DIR, 'take.json'), JSON.stringify(take, null, 1));
  index.push({ id, layout: spec.layout, segmentS, dir, frames: Object.fromEntries(Object.entries(frames).map(([k, v]) => [k, v.length])), overlays: ev.overlays, routes: ev.routes, sounds: ev.sounds });
  log(`  ${id}: ${segmentS}s segment, ${Object.entries(frames).map(([k, v]) => `${k} ${v.length} frames`).join(', ')}`);
}

// ---- page helpers ----------------------------------------------------------------------------
const counts = page => page.evaluate(() => ({
  shown: document.querySelectorAll('.osm-s.osm-on').length,
  tr: document.querySelectorAll('.osm-tr').length,
  pending: document.querySelectorAll('.osm-pending').length,
})).catch(() => ({ shown: 0, tr: 0, pending: 0 }));

/** Shown sentences on screen, best hover targets first (most new words). */
const sentences = (page, exclude = []) => page.evaluate(exclude => {
  const out = [];
  for (const el of document.querySelectorAll('.osm-s.osm-on')) {
    if (exclude.includes(el.dataset.k)) continue;
    const r = el.getClientRects()[0];
    if (!r || r.top < 90 || r.bottom > innerHeight - 150 || r.width < 120) continue;
    out.push({ key: el.dataset.k, nNew: el.querySelectorAll('.osm-w.osm-new').length, x: r.left + Math.min(r.width * 0.35, 180), y: r.top + r.height / 2 });
  }
  return out.sort((a, b) => b.nNew - a.nNew || a.y - b.y);
}, exclude);

const newWordIn = (page, key) => page.evaluate(key => {
  const w = document.querySelector(`.osm-s[data-k="${key}"] .osm-w.osm-new`);
  if (!w) return null;
  const r = w.getClientRects()[0];
  return { lemma: w.dataset.lemma, x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, key);

/** Boxes inside the Osmosis dial, which lives in a closed shadow root: found through CDP. */
async function dialBoxes(cdp) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const found = {};
  const walk = (n, inShadow) => {
    const attrs = n.attributes || [];
    const cls = attrs[attrs.indexOf('class') + 1];
    if (inShadow && n.nodeName === 'INPUT' && attrs.includes('range')) found.range = n.nodeId;
    if (inShadow && attrs.includes('class') && cls === 'srct') found.src = n.nodeId;
    for (const c of n.children || []) walk(c, inShadow);
    for (const s of n.shadowRoots || []) walk(s, true);
  };
  walk(root, false);
  const box = async id => {
    const { model } = await cdp.send('DOM.getBoxModel', { nodeId: id });
    const q = model.border;
    return { x: q[0], y: q[1], w: q[2] - q[0], h: q[5] - q[1] };
  };
  return { range: found.range && (await box(found.range)), src: found.src && (await box(found.src)) };
}

const glide = (page, x, y, steps = 28) => page.mouse.move(x, y, { steps });
const cursorVisible = (page, on) => page.evaluate(on => { const c = document.getElementById('__vc'); if (c) c.style.display = on ? '' : 'none'; }, on).catch(() => {});
const centre = async (page, sel) => {
  const r = await page.locator(sel).first().boundingBox();
  if (!r) throw new Error(`not on screen: ${sel}`);
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, r };
};
const smoothScroll = (page, sel, block = 'start') => page.evaluate(([sel, block]) => document.querySelector(sel).scrollIntoView({ behavior: 'smooth', block }), [sel, block]);

async function openWindow(b, ctx, bounds) {
  const bs = await b.newBrowserCDPSession();
  const pageP = ctx.waitForEvent('page');
  const { targetId } = await bs.send('Target.createTarget', { url: 'about:blank', newWindow: true });
  const page = await pageP;
  const { windowId } = await bs.send('Browser.getWindowForTarget', { targetId });
  await bs.send('Browser.setWindowBounds', { windowId, bounds });
  return page;
}

// ---- the take --------------------------------------------------------------------------------
async function main() {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const wanted = id => !ONLY || ONLY === id;
  let browser, ctx, main, panel, mainCam, panelCam, mainCdp;

  if (BEATS.some(x => ['full', 'split'].includes(x.layout) && wanted(x.id))) {
    browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
    ctx = browser.contexts()[0];
    // Chrome quits when its last window closes: keep one ordinary tab open whatever happens below.
    const ours = p => p.url().startsWith('https://en.wikipedia.org/') || p.url().startsWith(PANEL_URL);
    if (!ctx.pages().some(p => !ours(p))) await ctx.newPage();
    for (const p of ctx.pages()) if (ours(p)) await p.close();
    // Clean learner, as prep left it: nothing cached, no peeks, empty ledger.
    const check = await ctx.newPage();
    await check.goto(PANEL_URL);
    const st = await check.evaluate(async () => {
      const all = await chrome.storage.local.get(null);
      return { settings: all.settings, dirty: Object.keys(all).filter(k => k.startsWith('tr:') || k.startsWith('vocab') || k === 'ledger') };
    });
    await check.close();
    if (st.dirty.length || st.settings.lang !== 'es' || st.settings.level !== 'A2' || st.settings.cloudConsent) {
      throw new Error(`profile is not a clean learner (${st.dirty.length} keys, ${JSON.stringify(st.settings)}): run node video/prep.cjs --skip-netcheck`);
    }

    panel = await openWindow(browser, ctx, WIN.panel);
    panelCam = new Cam('panel', panel, await ctx.newCDPSession(panel));
    await panelCam.size(PANEL);
    await panel.addInitScript(CURSOR);
    await panel.goto(PANEL_URL);
    // Load Gemini Nano into memory (as after any earlier use of Chrome), outside the extension's
    // pipeline: no cache, vocabulary or ledger entry. The session stays open for the whole take.
    const warm = await panel.evaluate(async () => {
      const t = performance.now();
      window.__warm = await LanguageModel.create({ expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['es'] }] });
      await window.__warm.prompt('Reply with one word: hello in Spanish.');
      return Math.round(performance.now() - t);
    });
    log(`   on-device model warm (${warm} ms)`);

    main = await openWindow(browser, ctx, WIN.article);
    mainCdp = await ctx.newCDPSession(main);
    mainCam = new Cam('main', main, mainCdp);
    await mainCam.size(FULL);
    await main.addInitScript(CURSOR);
    await main.addInitScript(WIKI_DRESS);
    await main.bringToFront();
    await sleep(1500);

    // 1. The live article: translated on this computer while the voice explains.
    await beat('01-intro', [mainCam], async b => {
      b.overlay('title', 0, 3.4, 0.6);
      await main.goto(ARTICLE, { waitUntil: 'load', timeout: 30000 });
      await main.evaluate(() => {
        const h = document.querySelector('#firstHeading');
        scrollTo(0, h.getBoundingClientRect().top + scrollY - 14);
      });
      b.route('en.wikipedia.org/wiki/Coffee');
      await main.mouse.move(1330, 330);
      await b.at('This is a live Wikipedia article');
      await glide(main, 1290, 250, 30);
      await b.at('Gemini Nano runs on this computer');
      const d = await dialBoxes(mainCdp);
      if (d.src) await glide(main, d.src.x + d.src.w / 2, d.src.y + d.src.h / 2, 40);
      await b.at('rewrites a share');
      await glide(main, 1300, 420, 35);
      await b.holdUntil(async () => (await counts(main)).shown >= 3, 15, 'three Spanish sentences');
      b.note('after-intro', await counts(main));
    });

    // 2. Hover: original English + the new words; linger = peek; click = known.
    const hovered = [];
    await beat('02-hover', [mainCam], async b => {
      const list = await sentences(main);
      if (!list.length) throw new Error('no Spanish sentence on screen to hover');
      const A = list[0];
      const B = list.find(s => s.key !== A.key && s.nNew > 0) ?? list.find(s => s.key !== A.key) ?? A;
      await b.at('Hover a green sentence');
      await glide(main, A.x, A.y, 30);
      hovered.push(A.key);
      await b.at('Lingering counts as a peek');
      await glide(main, B.x, B.y, 30);
      hovered.push(B.key);
      await b.at('Once you know a word');
      const w = (await newWordIn(main, B.key)) ?? (await newWordIn(main, A.key));
      if (!w) throw new Error('no new word to click');
      await glide(main, w.x, w.y, 18);
      await b.at('click it');
      await main.mouse.click(w.x, w.y);
      b.note('marked-known', w.lemma);
      await sleep(1400);
      await glide(main, 1330, w.y + 40, 30);
    });

    // 3. The dial: more Spanish; then hover a sentence that just came in.
    await beat('03-dial', [mainCam], async b => {
      const d = await dialBoxes(mainCdp);
      if (!d.range) throw new Error('dial slider not found');
      const thumb = v => d.range.x + 8 + v * (d.range.w - 16);
      const y = d.range.y + d.range.h / 2;
      await b.at('One dial sets');
      await glide(main, thumb(0.35), y, 35);
      await b.at('Turn it up');
      await main.mouse.down();
      await main.mouse.move(thumb(0.75), y, { steps: 45 });
      await main.mouse.up();
      b.note('after-dial', await counts(main));
      // Two sentences that just came in: the learner reads them, and peeks.
      await b.at('The model only translates');
      const fresh = (await sentences(main, hovered)).filter(s => s.nNew > 0);
      if (fresh[0]) {
        await glide(main, fresh[0].x, fresh[0].y, 40);
        hovered.push(fresh[0].key);
      }
      await b.at('which sentences you see');
      const next = (await sentences(main, hovered)).find(s => s.nNew > 0);
      if (next) {
        await glide(main, next.x, next.y, 35);
        hovered.push(next.key);
      }
      await b.at('flips back to English');
      await glide(main, 1330, 300, 30);
    });

    // Off camera: the side panel opens beside the article.
    await cursorVisible(main, false);
    await mainCam.size(SPLIT);
    await sleep(1200);
    // The podcast needs 3 words the learner peeked at and does not know yet. If the filmed hovers
    // fell short, read one or two more sentences off camera (recorded in take.json).
    const peeked = () => panel.evaluate(() => [...document.querySelectorAll('#struggle li b')].map(b => b.textContent));
    let peeks = await peeked();
    take.offCameraPeeks = 0;
    for (let k = 0; peeks.length < 3 && k < 4; k++) {
      const s = (await sentences(main, hovered)).find(x => x.nNew > 0);
      if (!s) break;
      await main.mouse.move(s.x, s.y, { steps: 5 });
      hovered.push(s.key);
      take.offCameraPeeks++;
      await sleep(1600);
      peeks = await peeked();
    }
    await main.mouse.move(1330, 300);
    log('   peeked words (not known):', peeks.join(', '), take.offCameraPeeks ? `(${take.offCameraPeeks} off camera)` : '');
    if (peeks.length < 3) throw new Error('fewer than 3 peeked words: the podcast would refuse');
    take.peeks = peeks;
    await panel.mouse.move(300, 760);

    // 4. Side panel: the words you peeked at → a podcast (Gemini + Gemini TTS, cloud).
    await beat('04-panel', [mainCam, panelCam], async b => {
      await b.at('The side panel keeps your words');
      const n = await centre(panel, '#n-struggle');
      await glide(panel, n.x, n.y, 30);
      await b.at('The ones you peeked at');
      const li = await centre(panel, '#struggle li');
      await glide(panel, li.r.x + 60, li.y, 25);
      await b.at('become a podcast');
      const btn = await centre(panel, '#podcast-btn');
      await glide(panel, btn.x, btn.y, 30);
      await b.at('Gemini in the cloud writes');
      await panel.mouse.click(btn.x, btn.y);
    });

    // Off camera: Gemini writes the episode and Gemini TTS records it.
    log('   waiting for the episode…');
    let ep;
    for (let i = 0; i < 180; i++) {
      await sleep(1000);
      ep = await panel.evaluate(() => ({ audio: !!document.querySelector('#podcast audio[src]'), busy: document.getElementById('podcast-btn').disabled, text: document.getElementById('podcast').innerText.slice(0, 200) }));
      if (ep.audio || !ep.busy) break;
    }
    if (!ep.audio) throw new Error(`no podcast audio: ${JSON.stringify(ep)}`);
    const wav = await panel.evaluate(async () => {
      const a = document.querySelector('#podcast audio');
      const blob = await fetch(a.src).then(r => r.blob());
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { type: blob.type, b64: btoa(s), title: document.querySelector('#podcast h3')?.textContent };
    });
    const podcastFile = path.join(RAW_DIR, 'podcast' + (wav.type.includes('mpeg') ? '.mp3' : '.wav'));
    fs.writeFileSync(podcastFile, Buffer.from(wav.b64, 'base64'));
    take.podcast = { title: wav.title, type: wav.type, file: podcastFile };
    log(`   episode "${wav.title}" (${wav.type}) saved`);
    await panel.evaluate(() => {
      const a = document.querySelector('#podcast audio');
      a.addEventListener('playing', () => { window.__playAt = Date.now(); }, { once: true });
    });

    // 5. Today's episode, played.
    await beat('05-listen', [mainCam, panelCam], async b => {
      await sleep(200);
      await smoothScroll(panel, '#podcast-card', 'start');
      await sleep(900);
      const a = await centre(panel, '#podcast audio');
      await glide(panel, a.r.x + 22, a.y, 25);
      await b.at('episode', 0.7);
      await panel.mouse.click(a.r.x + 22, a.y);
      let at = null;
      for (let i = 0; i < 20 && !at; i++) {
        await sleep(100);
        at = await panel.evaluate(() => window.__playAt ?? null);
      }
      if (!at) throw new Error('the episode did not start playing');
      b.ev.sounds.push({ file: podcastFile, t: +((at - (Date.now() - b.el() * 1000)) / 1000).toFixed(3) });
      await glide(panel, a.r.x + 120, a.y + 120, 30);
    });
    await panel.evaluate(() => document.querySelector('#podcast audio')?.pause());

    // 6. Japanese: same page, on this device; level word lists come from the cloud.
    await beat('06-japanese', [mainCam, panelCam], async b => {
      await sleep(200);
      await panel.evaluate(() => scrollTo({ top: 0, behavior: 'smooth' }));
      await sleep(800);
      await b.at('Switch to Japanese');
      const s = await centre(panel, '#lang');
      await glide(panel, s.x, s.y, 25);
      await sleep(300);
      await panel.selectOption('#lang', 'ja');
      await b.at('Each level has its own word list');
      const lv = await centre(panel, '#level');
      await glide(panel, lv.x, lv.y, 25);
      await b.at('Your browsing never goes with it');
      const k = await centre(panel, '#n-known');
      await glide(panel, k.x, k.y, 25);
      await b.holdUntil(async () => (await counts(main)).shown >= 3, 16, 'three Japanese sentences');
      b.note('japanese', await counts(main));
    });

    // 7. Privacy: the ledger, then the network check's verbatim output.
    const ledger = await panel.evaluate(() => ['l-page', 'l-words', 'l-ondevice', 'l-cloud'].map(id => document.getElementById(id).textContent));
    log('   ledger:', ledger.join(' | '));
    take.ledger = ledger;
    if (ledger[0] !== '0 characters') throw new Error('page text was sent to the cloud: the privacy beat would not be true');
    await beat('07-privacy', [mainCam, panelCam], async b => {
      await sleep(200);
      await smoothScroll(panel, '.ledger', 'center');
      await b.at('The privacy ledger shows');
      const l = await centre(panel, '#l-page');
      await glide(panel, l.x - 40, l.y, 30);
      await b.at('And it is tested');
      b.overlay('terminal', b.el(), b.segmentS - 0.15, 0.35);
    });

    await panelCam.stop();
    await mainCam.stop();
  }

  // 8. No Gemini Nano: the hosted demo article in a browser without an on-device model.
  if (wanted('08-hybrid')) {
    const web = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ['--window-position=200,40', '--window-size=2000,1300'] });
    const wctx = await web.newContext({ viewport: null });
    const wp = await wctx.newPage();
    const wcdp = await wctx.newCDPSession(wp);
    const webCam = new Cam('main', wp, wcdp);
    await webCam.size(FULL);
    await wp.addInitScript(CURSOR);
    await wp.goto('about:blank');
    take.webLanguageModel = await wp.evaluate(() => typeof LanguageModel);
    await beat('08-hybrid', [webCam], async b => {
      await wp.goto(WEB_DEMO, { waitUntil: 'load', timeout: 30000 });
      b.route('osmosis-hybrid.web.app/read/night-train');
      await wp.mouse.move(1200, 400);
      await b.at('On our hosted demo article');
      const note = await centre(wp, '.osm-webnote');
      await glide(wp, note.r.x + note.r.width * 0.55, note.y, 35);
      await b.at('falls back to Gemini in the cloud');
      const d = await dialBoxes(wcdp);
      if (d.src) await glide(wp, d.src.x + d.src.w / 2, d.src.y + d.src.h / 2, 40);
      await b.holdUntil(async () => (await counts(wp)).shown >= 1, 12, 'a cloud-translated sentence');
      await b.at('In the extension');
      await glide(wp, 1150, 520, 40);
      b.note('web', await counts(wp));
    });
    await webCam.stop();
    await web.close();
  }

  // 9. End card: a still, no capture.
  if (wanted('09-end')) {
    const row = audio.find(a => a.id === '09-end');
    const dir = path.join(RAW_DIR, '09-end');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'beat.json'), JSON.stringify({ id: '09-end', layout: 'card', segmentS: row.segmentS, frames: {}, overlays: [], routes: [], sounds: [], notes: [] }));
    index.push({ id: '09-end', layout: 'card', segmentS: row.segmentS, dir });
  }

  if (panel) await panel.close().catch(() => {});
  if (main) await main.close().catch(() => {});
  const idxPath = path.join(OUT_DIR, 'clips.json');
  const prev = ONLY && fs.existsSync(idxPath) ? JSON.parse(fs.readFileSync(idxPath, 'utf8')) : [];
  const merged = [...prev.filter(p => !index.some(n => n.id === p.id)), ...index].sort((a, b) => a.id.localeCompare(b.id));
  fs.writeFileSync(idxPath, JSON.stringify(merged, null, 1));
  take.recordedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT_DIR, 'take.json'), JSON.stringify(take, null, 1));
  log('wrote', idxPath, `(${merged.length} beats, ${merged.reduce((s, x) => s + x.segmentS, 0).toFixed(1)}s)`);
  process.exit(0);
}

/** Rebuild out/clips.json from the beat.json files of every beat filmed so far. */
function reindex() {
  const rows = [];
  for (const b of BEATS) {
    const f = path.join(RAW_DIR, b.id, 'beat.json');
    if (!fs.existsSync(f)) continue;
    const r = JSON.parse(fs.readFileSync(f, 'utf8'));
    rows.push({ id: r.id, layout: r.layout, segmentS: r.segmentS, dir: path.dirname(f), frames: Object.fromEntries(Object.entries(r.frames).map(([k, v]) => [k, v.length])), overlays: r.overlays, routes: r.routes, sounds: r.sounds });
  }
  fs.writeFileSync(path.join(OUT_DIR, 'clips.json'), JSON.stringify(rows, null, 1));
  console.log(`clips.json: ${rows.map(r => r.id).join(', ')} (${rows.reduce((s, r) => s + r.segmentS, 0).toFixed(1)}s)`);
}

if (process.argv.includes('--reindex')) reindex();
else
  main().catch(e => {
    console.error('FAILED:', e.message || e);
    process.exit(1);
  });
