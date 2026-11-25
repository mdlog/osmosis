// Screenshots of the landing page (desktop full page + mobile). Usage: node scripts/shot-site.cjs
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('pageerror', e.message));
  p.on('console', m => m.type() === 'error' && console.log('console', m.text()));
  await p.goto('http://localhost:8771/');
  await p.waitForTimeout(3200);
  await p.screenshot({ path: '/var/tmp/site-hero.png' });
  // reveal everything, then full page
  await p.evaluate(() => document.querySelectorAll('.rise').forEach(e => e.classList.add('in')));
  await p.waitForTimeout(1200);
  await p.screenshot({ path: '/var/tmp/site-full.png', fullPage: true });
  const s = await p.locator('#specimen .s.es').first();
  await s.hover(); await p.waitForTimeout(400);
  await p.screenshot({ path: '/var/tmp/site-hover.png', clip: { x: 640, y: 120, width: 800, height: 700 } });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(500);
  await p.screenshot({ path: '/var/tmp/site-mobile.png', fullPage: true });
  console.log('fonts', await p.evaluate(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.style).join(', ')));
  await ctx.close();
  process.exit(0);
})();
