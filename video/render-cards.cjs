// Renders cards.html to out/cards/{title,terminal,end}.png at 1920×1080 with a headless Chromium.
// The terminal card carries the verbatim network-check output from out/take.json.
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const { OUT_DIR } = require('./script.cjs');

const EXE = `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;

(async () => {
  const take = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'take.json'), 'utf8'));
  const dir = path.join(OUT_DIR, 'cards');
  fs.mkdirSync(dir, { recursive: true });
  const b = await chromium.launch({ executablePath: EXE });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await p.goto('file://' + path.join(__dirname, 'cards.html'));
  const nc = take.netcheck;
  const cards = {
    title: { card: 'title' },
    end: { card: 'end' },
    terminal: nc && {
      card: 'terminal',
      terminal: {
        title: 'osmosis — real Chrome, extension loaded, Gemini Nano on this computer',
        command: nc.command,
        lines: nc.lines,
        key: nc.key,
        caption: `Run before this take (${new Date(nc.at).toLocaleDateString('en-CA')}): every request the extension's service worker makes, recorded while it translates the page.`,
      },
    },
  };
  for (const [name, arg] of Object.entries(cards)) {
    if (!arg) continue;
    await p.evaluate(a => window.render(a), arg);
    await p.waitForTimeout(150);
    await p.screenshot({ path: path.join(dir, `${name}.png`), omitBackground: name !== 'end' });
    console.log('card', name);
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
