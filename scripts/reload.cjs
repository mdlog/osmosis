// Reload the unpacked Osmosis extension in the isolated Chrome and close stale article tabs.
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctx = b.contexts()[0];
  const keep = await ctx.newPage(); // closing the last tab would quit Chrome
  for (const p of ctx.pages()) if (p !== keep && /localhost:877/.test(p.url())) await p.close();
  const sw = ctx.serviceWorkers().find(w => w.url().includes('/sw.js'));
  if (!sw) { console.log('no sw'); process.exit(1); }
  await sw.evaluate(() => chrome.runtime.reload()).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  console.log('reloaded; sw now', ctx.serviceWorkers().map(w => w.url()).join(','));
  process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
