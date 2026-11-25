// Live walkthrough of Osmosis in the isolated Chrome (scripts/chrome.sh), paced for a person
// watching the window. Saves a screenshot per step and records the tab contents through the CDP
// screencast (page pixels only, never the desktop), then encodes them to MP4.
// Usage: node scripts/demo.cjs [out dir] [real article URL]
const { chromium } = require('playwright-core');
const { execFileSync } = require('child_process');
const fs = require('fs');

const EXT = 'jeeacnodnalnmbkaipineojgflbekmlg';
const OUT = process.argv[2] || '/var/tmp/osmosis-demo';
const ARTICLE = 'https://osmosis-hybrid.web.app/read/night-train';
const REAL = process.argv[3] || 'https://en.wikipedia.org/wiki/Orient_Express';
const W = 1280, H = 900;
// The dial's slider track inside the pill (bottom-right), for a 1280×900 viewport.
const dialX = p => 1043 + p * 190, DIAL_Y = 847;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(`${OUT}/frames`, { recursive: true });
const frames = [];
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

async function record(page) {
  const cdp = await page.context().newCDPSession(page);
  cdp.on('Page.screencastFrame', async f => {
    const file = `${OUT}/frames/${String(frames.length).padStart(5, '0')}.jpg`;
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
    frames.push({ file, t: Date.now() });
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: W, maxHeight: H });
  return () => cdp.send('Page.stopScreencast').catch(() => {});
}

const shot = (page, name, full = false) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
// Pages may navigate on their own (redirects, reloads); a destroyed context just counts as "not ready".
const count = page => page.evaluate(() => ({
  shown: document.querySelectorAll('.osm-s.osm-on').length,
  tr: document.querySelectorAll('.osm-tr').length,
  pending: document.querySelectorAll('.osm-pending').length,
})).catch(() => ({ shown: 0, tr: 0, pending: 0 }));

async function glide(page, x, y, steps = 25) {
  await page.mouse.move(x, y, { steps });
}

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctx = b.contexts()[0];

  // Known starting point: Spanish A2, dial at 35%, page text never leaves the device.
  const setup = await ctx.newPage();
  await setup.goto(`chrome-extension://${EXT}/panel.html`);
  // Whoever uses this Chrome window gets their own settings back at the end.
  const saved = await setup.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, lang: 'es', level: 'A2', dial: 0.35, cloudConsent: false, enabled: true } });
    return settings;
  });
  await setup.close();

  // Tabs left by an earlier, interrupted run of this script.
  for (const p of ctx.pages()) if (p.url().startsWith('https://en.wikipedia.org/') || p.url().startsWith(ARTICLE)) await p.close();

  // 1. The demo article, with the extension: translated on this computer.
  const page = await ctx.newPage();
  await page.setViewportSize({ width: W, height: H });
  await page.bringToFront();
  // The hosted article's stylesheet may be cached from before the last deploy.
  await (await ctx.newCDPSession(page)).send('Network.clearBrowserCache');
  let stop = await record(page);
  log('1. open demo article', ARTICLE);
  await page.goto(ARTICLE);
  for (let i = 0; i < 90; i++) {
    const c = await count(page);
    if (c.shown > 0 && c.pending === 0) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(2500);
  log('   ', JSON.stringify(await count(page)), 'owner:', await page.evaluate(() => document.documentElement.dataset.osmosis));
  await shot(page, '01-reader');

  // 2. Hover a Spanish sentence: original English + the new word.
  const word = page.locator('.osm-s.osm-on .osm-w.osm-new').first();
  await word.scrollIntoViewIfNeeded();
  const lemma = await word.getAttribute('data-lemma');
  const box = await word.boundingBox();
  log('2. hover new word', lemma);
  await glide(page, box.x + box.width / 2, box.y + box.height / 2, 30);
  await page.waitForTimeout(3000);
  await shot(page, '02-hover');

  // 3. Click the word: "I know this one". It stops being highlighted.
  log('3. mark known:', lemma);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(500);
  await glide(page, 120, 160, 15);
  await page.waitForTimeout(2500);
  await shot(page, '03-known');

  // 4. The dial: more of the page in Spanish, then back.
  log('4. dial 35% → 75%');
  await glide(page, dialX(0.35), DIAL_Y, 20);
  await page.mouse.down();
  await page.mouse.move(dialX(0.75), DIAL_Y, { steps: 40 });
  await page.mouse.up();
  await page.waitForTimeout(3500);
  log('   ', JSON.stringify(await count(page)));
  await shot(page, '04-dial75');
  log('   dial back to 35%');
  await page.mouse.down();
  await page.mouse.move(dialX(0.35), DIAL_Y, { steps: 30 });
  await page.mouse.up();
  await page.waitForTimeout(2000);

  // Undo the "known" click so the demo leaves the word list as it found it.
  const again = page.locator(`.osm-s.osm-on .osm-w[data-lemma="${lemma}"]`).first();
  if (await again.count()) await again.click().catch(() => {});
  await stop();

  // 5. A real article from the web, translated on the fly on this computer.
  log('5. real article', REAL);
  stop = await record(page);
  await page.goto(REAL);
  await page.waitForLoadState('load').catch(() => {});
  page.on('framenavigated', f => f === page.mainFrame() && log('    (page navigated:', f.url().slice(0, 80) + ')'));
  const t0 = Date.now();
  for (let i = 0; i < 150; i++) {
    const c = await count(page);
    if (i % 15 === 0) log('    waiting', JSON.stringify(c));
    if (c.shown >= 3 && c.pending === 0) break;
    await page.waitForTimeout(1000);
  }
  log(`    ready after ${Math.round((Date.now() - t0) / 1000)} s`, JSON.stringify(await count(page)));
  const real = page.locator('.osm-s.osm-on').first();
  if (await real.count()) {
    await real.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -200));
    await page.waitForTimeout(1500);
    await shot(page, '05-real');
    const rb = await real.boundingBox();
    await glide(page, rb.x + Math.min(rb.width / 2, 200), rb.y + 8, 30);
    await page.waitForTimeout(3000);
    await shot(page, '06-real-hover');
  } else {
    await shot(page, '05-real');
  }
  await glide(page, 30, 30, 10);
  await stop();

  // 6. The side panel (opened from the toolbar icon in normal use; here as a tab).
  log('6. side panel');
  const panel = await ctx.newPage();
  await panel.setViewportSize({ width: 420, height: H });
  await panel.bringToFront();
  stop = await record(panel);
  await panel.goto(`chrome-extension://${EXT}/panel.html`);
  await panel.waitForTimeout(3000);
  await shot(panel, '07-panel', true);

  // 7. Podcast: the words you peeked at → a story at your level (Gemini) → audio (Gemini TTS).
  log('7. podcast');
  await panel.locator('#podcast-btn').scrollIntoViewIfNeeded();
  await panel.waitForTimeout(1000);
  await panel.click('#podcast-btn');
  let ep;
  for (let i = 0; i < 120; i++) {
    await panel.waitForTimeout(1000);
    ep = await panel.evaluate(() => ({ audio: !!document.querySelector('#podcast audio[src]'), busy: document.getElementById('podcast-btn').disabled, text: document.getElementById('podcast').innerText.slice(0, 160) }));
    if (ep.audio || (!ep.busy && /[a-z]/i.test(ep.text))) break;
  }
  log('   ', JSON.stringify(ep));
  const audio = panel.locator('#podcast audio');
  if (await audio.count() && !process.env.DEMO_MUTE) {
    await audio.scrollIntoViewIfNeeded();
    const ab = await audio.boundingBox();
    await panel.mouse.click(ab.x + 22, ab.y + ab.height / 2); // the player's play button
    await panel.waitForTimeout(6000);
  }
  await shot(panel, '08-podcast', true);
  await panel.locator('#l-cloud').scrollIntoViewIfNeeded();
  await panel.waitForTimeout(3000);
  log('    ledger:', await panel.evaluate(() => ['l-page', 'l-words', 'l-ondevice', 'l-cloud'].map(id => `${id}=${document.getElementById(id).textContent}`).join(' ')));
  await stop();
  await panel.evaluate(async s => chrome.storage.local.set({ settings: s }), saved);
  log('    settings restored:', JSON.stringify(saved));

  // Encode: each frame lasts until the next one, idle waits capped at 2.5 s.
  const list = frames.map((f, i) => {
    const d = i + 1 < frames.length ? Math.min(2.5, Math.max(0.02, (frames[i + 1].t - f.t) / 1000)) : 2;
    return `file '${f.file}'\nduration ${d.toFixed(3)}`;
  }).join('\n') + `\nfile '${frames.at(-1).file}'\n`;
  fs.writeFileSync(`${OUT}/frames.txt`, list);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${OUT}/frames.txt`,
    '-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0xf3efe6,format=yuv420p`,
    '-r', '30', '-c:v', 'libx264', '-crf', '22', '-movflags', '+faststart', `${OUT}/osmosis-demo.mp4`]);
  log(`video: ${OUT}/osmosis-demo.mp4 (${frames.length} frames)`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
