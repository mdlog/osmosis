// Save / restore the isolated profile's whole chrome.storage.local around a video take, so the
// take can start from a clean learner (no peeks, empty ledger) and the person who uses this
// Chrome gets everything back afterwards.
// Usage: node video/storage.cjs save|restore|keys|reset
const { chromium } = require('playwright-core');
const fs = require('fs');
const EXT = 'jeeacnodnalnmbkaipineojgflbekmlg';
const FILE = '/var/tmp/osmosis-storage.before-video.json';
(async () => {
  const cmd = process.argv[2];
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const p = await b.contexts()[0].newPage();
  await p.goto(`chrome-extension://${EXT}/panel.html`);
  const all = await p.evaluate(async () => chrome.storage.local.get(null));
  if (cmd === 'save') {
    if (fs.existsSync(FILE)) throw new Error(`${FILE} exists: restore or move it first, never overwrite a backup`);
    fs.writeFileSync(FILE, JSON.stringify(all));
    console.log('saved', Object.keys(all).length, 'keys to', FILE);
  } else if (cmd === 'restore') {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    await p.evaluate(async s => { await chrome.storage.local.clear(); await chrome.storage.local.set(s); }, saved);
    fs.renameSync(FILE, FILE.replace('.json', `.restored-${Date.now()}.json`));
    console.log('restored', Object.keys(saved).length, 'keys');
  } else if (cmd === 'keys') {
    const by = {};
    for (const k of Object.keys(all)) { const g = k.replace(/[:_].*/, ''); by[g] = (by[g] || 0) + 1; }
    console.log(JSON.stringify(by), 'settings:', JSON.stringify(all.settings), 'ledger:', JSON.stringify(all.ledger));
  } else if (cmd === 'reset') {
    // Clean learner for the take: keep the level word lists (lex_*) and settings, drop the
    // translation cache, vocabulary (peeks, known clicks) and today's ledger.
    if (!fs.existsSync(FILE)) throw new Error('save first');
    const drop = Object.keys(all).filter(k => k.startsWith('tr:') || k.startsWith('vocab') || k === 'ledger');
    await p.evaluate(async d => chrome.storage.local.remove(d), drop);
    console.log('removed', drop.length, 'keys');
  }
  await p.close();
  process.exit(0);
})().catch(e => { console.error(e.message || e); process.exit(1); });
