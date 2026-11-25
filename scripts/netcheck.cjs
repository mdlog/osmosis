// Proves the on-device path is offline: records every network request the extension's
// service worker makes while a fresh (uncached) page is translated. Usage: node scripts/netcheck.cjs [url]
const { chromium } = require('playwright-core');
const URL_ = process.argv[2] || 'http://localhost:8771/read/night-train.html';
const EXT = 'jeeacnodnalnmbkaipineojgflbekmlg';
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctx = b.contexts()[0];
  // wake the SW and clear its translation cache so the model really runs
  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${EXT}/panel.html`);
  await panel.waitForTimeout(800);
  const sw = ctx.serviceWorkers().find(w => w.url().includes('/sw.js'));
  const cleared = await sw.evaluate(async () => { const a = await chrome.storage.local.get(null); const k = Object.keys(a).filter(x => x.startsWith('tr:')); await chrome.storage.local.remove(k); return k.length; });
  const targets = await (await fetch('http://127.0.0.1:9333/json/list')).json();
  const t = targets.find(x => x.type === 'service_worker' && x.url.includes(EXT));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  const reqs = [];
  let id = 0;
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.method === 'Network.requestWillBeSent') reqs.push(m.params.request.method + ' ' + m.params.request.url); };
  await new Promise(r => (ws.onopen = r));
  ws.send(JSON.stringify({ id: ++id, method: 'Network.enable' }));
  await panel.close();
  const page = await ctx.newPage();
  const logs = [];
  sw.on('console', m => logs.push(m.text()));
  await page.goto(URL_);
  for (let s = 0; s < 90; s++) {
    await page.waitForTimeout(1000);
    const st = await page.evaluate(() => ({ tr: document.querySelectorAll('.osm-tr').length, pend: document.querySelectorAll('.osm-pending').length, s: document.querySelectorAll('.osm-s').length }));
    if (st.s && !st.pend && s > 3) { console.log('done', JSON.stringify(st), `${s}s`); break; }
  }
  await page.close();
  // positive control: one deliberate fetch from the SW must show up, or the capture is broken
  await sw.evaluate(() => fetch('http://localhost:8771/netcheck-control').catch(() => 0));
  await new Promise(r => setTimeout(r, 800));
  const control = reqs.filter(r => r.includes('netcheck-control')).length;
  ws.close();
  const sources = logs.filter(l => l.includes('→')).map(l => l.split('→')[1].trim().split(' ')[0]);
  console.log(`cache cleared: ${cleared}; model calls: ${sources.length} (${[...new Set(sources)].join(',')})`);
  const real = reqs.filter(r => !r.includes('netcheck-control'));
  console.log(`capture working (control seen): ${control === 1}`);
  console.log(`service-worker network requests during translation: ${real.length}`);
  real.forEach(r => console.log('  ', r));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
