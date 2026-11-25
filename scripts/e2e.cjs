// Drive the isolated Chrome (port 9333): open a demo article, wait for on-device translations, screenshot.
const { chromium } = require('playwright-core');
const url = process.argv[2] || 'http://localhost:8771/read/night-train.html';
const shot = process.argv[3] || '/var/tmp/osmosis-e2e.png';
const dial = process.argv[4];
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctx = b.contexts()[0];
  const hook = w => { if (w.url().includes('/sw.js')) w.on('console', m => console.log('[sw]', m.text())); };
  ctx.serviceWorkers().forEach(hook);
  ctx.on('serviceworker', hook);
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  page.on('console', m => console.log('[page]', m.type(), m.text()));
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  const t0 = Date.now();
  await page.goto(url);
  for (let k = 0; k < 60; k++) {
    const st = await page.evaluate(() => ({
      wrapped: document.querySelectorAll('.osm-s').length,
      translated: document.querySelectorAll('.osm-tr').length,
      shown: document.querySelectorAll('.osm-s.osm-on').length,
      pending: document.querySelectorAll('.osm-pending').length,
    }));
    if (k % 3 === 0) console.log(Math.round((Date.now() - t0) / 1000) + 's', JSON.stringify(st));
    if (st.wrapped && !st.pending && st.translated) break;
    await page.waitForTimeout(1000);
  }
  if (dial) {
    await page.evaluate(d => chrome?.storage, null).catch(() => {});
  }
  const sample = await page.evaluate(() => [...document.querySelectorAll('.osm-s')].slice(0, 6).map(s => ({
    on: s.classList.contains('osm-on'),
    orig: s.querySelector('.osm-orig')?.textContent?.slice(0, 70),
    tr: s.querySelector('.osm-tr')?.textContent?.slice(0, 90) ?? null,
    newWords: [...s.querySelectorAll('.osm-w.osm-new')].map(w => w.textContent),
  })));
  console.log(JSON.stringify(sample, null, 1));
  await page.screenshot({ path: shot });
  console.log('shot', shot);
  process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
