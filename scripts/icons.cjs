// Renders extension/public/logo.svg into the extension's PNG icons and the site's favicon,
// with the same engine that displays them (headless Chromium). Run after editing the logo.
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const EXE = process.env.CHROMIUM || `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;
const svg = fs.readFileSync('extension/public/logo.svg', 'utf8');
const targets = [
  ...[16, 32, 48, 128].map(s => [s, `extension/public/icon${s}.png`]),
  [128, 'web/public/favicon.png'],
  [180, 'web/public/apple-touch-icon.png', '#f3efe6'],
];
(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  for (const [size, out, bg] of targets) {
    const p = await b.newPage({ viewport: { width: size, height: size } });
    const inner = bg ? Math.round(size * 0.78) : size;
    await p.setContent(`<style>html,body{margin:0;height:100%;background:${bg || 'transparent'};display:grid;place-items:center}svg{display:block;width:${inner}px;height:${inner}px}</style>${svg}`);
    await p.screenshot({ path: out, omitBackground: !bg });
    await p.close();
    console.log(`${out} (${size}px)`);
  }
  fs.copyFileSync('extension/public/logo.svg', 'web/public/logo.svg');
  // Variant for dark surfaces (the landing page's dial pill): light outline.
  fs.writeFileSync('web/public/logo-on-dark.svg', svg.replace('stroke="#10231d"', 'stroke="#d9f2e3"'));
  console.log('web/public/logo.svg, web/public/logo-on-dark.svg');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
