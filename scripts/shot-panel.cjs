// Screenshot of the side panel UI (opened as a tab at side-panel width). Usage: node scripts/shot-panel.cjs [out.png]
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const p = await b.contexts()[0].newPage();
  await p.setViewportSize({ width: 400, height: 1100 });
  p.on('console', m => m.type() === 'error' && console.log('[panel]', m.text()));
  p.on('pageerror', e => console.log('[panel] pageerror', e.message));
  await p.goto('chrome-extension://jeeacnodnalnmbkaipineojgflbekmlg/panel.html');
  await p.waitForTimeout(2500);
  await p.screenshot({ path: process.argv[2] || '/var/tmp/osmosis-panel.png', fullPage: true });
  console.log('shot');
  await p.close();
  process.exit(0);
})();
