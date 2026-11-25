// Save / restore the isolated profile's Osmosis settings around automated checks, so a person
// using the same Chrome window gets their language, level and dial back.
// Usage: node scripts/settings.cjs save|restore|test
const { chromium } = require('playwright-core');
const fs = require('fs');
const EXT = 'jeeacnodnalnmbkaipineojgflbekmlg';
const FILE = '/var/tmp/osmosis-settings.saved.json';
(async () => {
  const cmd = process.argv[2];
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const p = await b.contexts()[0].newPage();
  await p.goto(`chrome-extension://${EXT}/panel.html`);
  if (cmd === 'save') {
    const s = await p.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
    fs.writeFileSync(FILE, JSON.stringify(s));
    console.log('saved', JSON.stringify(s));
  } else if (cmd === 'restore') {
    const s = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    await p.evaluate(async s => chrome.storage.local.set({ settings: s }), s);
    console.log('restored', JSON.stringify(s));
  } else if (cmd === 'test') {
    await p.evaluate(async () => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, lang: 'es', level: 'A2', dial: 0.35, cloudConsent: false, enabled: true } });
    });
    console.log('test settings: es A2 35%');
  }
  await p.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
