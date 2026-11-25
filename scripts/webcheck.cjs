// A: with the extension the page is claimed by "ext"; B: in a context without extensions the web reader runs it.
const { chromium } = require('playwright-core');
const URL_ = 'http://localhost:8771/read/night-train.html';
async function watch(page, label) {
  const logs = [];
  page.on('console', m => logs.push(m.text()));
  page.on('pageerror', e => logs.push('pageerror ' + e.message));
  await page.goto(URL_);
  let st;
  for (let s = 0; s < 45; s++) {
    await page.waitForTimeout(1000);
    st = await page.evaluate(() => ({ owner: document.documentElement.dataset.osmosis, note: !!document.querySelector('.osm-webnote'), s: document.querySelectorAll('.osm-s').length, tr: document.querySelectorAll('.osm-tr').length, on: document.querySelectorAll('.osm-s.osm-on').length, dials: document.querySelectorAll('.osm-root').length }));
    if (st.on > 0 && s > 4) break;
  }
  console.log(label, JSON.stringify(st));
  logs.filter(l => /osmosis|error/i.test(l)).slice(0, 6).forEach(l => console.log('   ', l.slice(0, 200)));
}
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const p1 = await b.contexts()[0].newPage();
  await p1.setViewportSize({ width: 1280, height: 900 });
  await watch(p1, 'A (extension):');
  await p1.close();
  const ctx2 = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p2 = await ctx2.newPage();
  await watch(p2, 'B (web reader):');
  await p2.screenshot({ path: '/var/tmp/osmosis-web.png' });
  await ctx2.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
