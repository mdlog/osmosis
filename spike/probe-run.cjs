const { chromium } = require('playwright-core');
const ID = 'plchpbdikagjedmlfbaldnimheijoioc';
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctx = b.contexts()[0];
  const web = await ctx.newPage(); await web.goto('http://localhost:8770/');
  const ext = await ctx.newPage(); await ext.goto(`chrome-extension://${ID}/panel.html`);
  await ext.waitForTimeout(4000);
  console.log('sw:', JSON.stringify(await ext.evaluate(() => chrome.runtime.sendMessage({ type: 'run-sw' }))));
  await ext.evaluate(() => chrome.runtime.sendMessage({ type: 'run-offscreen' }));
  await ext.waitForTimeout(6000);
  const res = await ext.evaluate(() => chrome.storage.local.get('results'));
  for (const [k, v] of Object.entries(res.results || {})) console.log(k, JSON.stringify(v));
  process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
