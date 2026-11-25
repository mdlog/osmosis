// Interaction smoke test with a real mouse: hover → tooltip + peek, click → known, dial drag → more sentences.
const { chromium } = require('playwright-core');
const EXT = 'jeeacnodnalnmbkaipineojgflbekmlg';
const ok = (c, m) => console.log(c ? 'PASS' : 'FAIL', m);
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctx = b.contexts()[0];
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('http://localhost:8771/read/night-train.html');
  const count = () => page.evaluate(() => ({ shown: document.querySelectorAll('.osm-s.osm-on').length, tr: document.querySelectorAll('.osm-tr').length }));
  for (let i = 0; i < 60 && (await count()).shown === 0; i++) await page.waitForTimeout(1000);
  const before = await count();
  ok(before.shown > 0, `sentences shown at start: ${before.shown}`);
  const sw = () => ctx.serviceWorkers().find(w => w.url().includes(EXT));
  const vocab = async () => {
    let w = sw();
    if (!w) { const p = await ctx.newPage(); await p.goto(`chrome-extension://${EXT}/panel.html`); await p.waitForTimeout(600); w = sw(); await p.close(); }
    return w.evaluate(async () => (await chrome.storage.local.get('vocab_es')).vocab_es);
  };

  // 0. stability: with no input, the shown set must not change across a "seen" flush (every 4 s)
  for (let i = 0; i < 30 && (await page.evaluate(() => document.querySelectorAll('.osm-pending').length)); i++) await page.waitForTimeout(1000);
  const keys = () => page.evaluate(() => [...document.querySelectorAll('.osm-s.osm-on')].map(e => e.dataset.k).sort().join());
  const k0 = await keys();
  await page.waitForTimeout(6000);
  ok(k0 === (await keys()), `shown sentences stable for 6 s without input (${k0.split(',').length} shown)`);

  // 1. hover a new word
  const word = page.locator('.osm-s.osm-on .osm-w.osm-new').first();
  const lemma = await word.getAttribute('data-lemma');
  const peek0 = (await vocab())?.stats?.[lemma]?.peek ?? 0;
  await word.scrollIntoViewIfNeeded();
  await word.hover();
  await page.waitForTimeout(1200);
  const tipVisible = await page.evaluate(() => [...document.querySelectorAll('.osm-root')].some(h => getComputedStyle(h).display !== 'none' && h.getBoundingClientRect().width + h.getBoundingClientRect().height >= 0 && h !== document.querySelector('.osm-root')));
  await page.screenshot({ path: '/var/tmp/osmosis-hover.png' });
  const peek1 = (await vocab())?.stats?.[lemma]?.peek ?? 0;
  ok(peek1 === peek0 + 1, `hover on "${lemma}" recorded a peek (${peek0} → ${peek1})`);
  console.log('     tooltip host present:', tipVisible, '(see /var/tmp/osmosis-hover.png)');

  // 2. click marks it known (and again unmarks)
  await word.click();
  await page.waitForTimeout(600);
  const known1 = (await vocab()).known.includes(lemma);
  ok(known1, `click marked "${lemma}" as known`);
  console.log("     candidates:", await page.locator(`.osm-s.osm-on .osm-w[data-lemma="${lemma}"]`).count(), "known now:", (await vocab()).known.includes(lemma));
  await page.locator(`.osm-s.osm-on .osm-w[data-lemma="${lemma}"]`).first().click({ timeout: 5000 }).catch(e => console.log("     click error:", e.message.split("\n")[0]));
  await page.waitForTimeout(600);
  ok(!(await vocab()).known.includes(lemma), `second click unmarked "${lemma}"`);

  // 3. dial: click at 90% of the slider track (bottom-right pill)
  await page.mouse.move(10, 10);
  await page.mouse.click(1043 + 0.9 * 190, 847);
  await page.waitForTimeout(800);
  const after = await count();
  ok(after.shown > before.shown, `dial up: ${before.shown} → ${after.shown} sentences`);
  await page.screenshot({ path: '/var/tmp/osmosis-dial90.png' });
  await page.mouse.click(1043 + 0.35 * 190, 847);
  await page.waitForTimeout(800);
  console.log('     dial back to ~35%:', (await count()).shown);
  await page.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
