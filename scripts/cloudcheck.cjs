// Exercises the cloud features from the side panel: starter lexicon (ONLY_IN_CLOUD) and the
// podcast (Gemini text + Gemini TTS). Prints the privacy ledger afterwards. Needs the real Firebase config.
const { chromium } = require('playwright-core');
const EXT = 'jeeacnodnalnmbkaipineojgflbekmlg';
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctx = b.contexts()[0];
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 400, height: 1300 });
  p.on('console', m => /osmosis|error|warn/i.test(m.text()) && console.log(`[panel ${m.type()}]`, m.text().slice(0, 300)));
  p.on('pageerror', e => console.log('[panel pageerror]', e.message));
  p.on('response', r => /googleapis|firebase/.test(r.url()) && console.log('  net', r.status(), r.url().replace(/\?.*/, '').slice(0, 110)));
  // Pin the test settings first (Spanish A2, no cloud consent), then load the panel fresh.
  await p.goto(`chrome-extension://${EXT}/panel.html`);
  await p.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, lang: 'es', level: 'A2', cloudConsent: false, dial: 0.35, enabled: true } });
  });
  await p.reload();
  const vocab = () => p.evaluate(async () => {
    const g = await chrome.storage.local.get(['vocab_es', 'lex_es_A2']);
    const lex = g.lex_es_A2;
    return { source: lex?.source, words: lex?.words?.length, topics: lex?.topics?.length, status: document.getElementById('lex-status').textContent, peeked: Object.values(g.vocab_es?.stats ?? {}).filter(s => s.peek > 0).length };
  });
  let v;
  const tl = Date.now();
  for (let i = 0; i < 240; i++) { await p.waitForTimeout(1000); v = await vocab(); if (v.source === 'cloud' && !v.status) break; if (v.source === 'cloud' && /next time/.test(v.status)) break; }
  v.seconds = Math.round((Date.now() - tl) / 1000);
  console.log('lexicon:', JSON.stringify(v));
  // Test profile only: earlier UI tests may have marked peeked words as known; the podcast needs
  // at least 3 peeked words that are still unknown.
  console.log('un-known for test:', await p.evaluate(async () => {
    const v = (await chrome.storage.local.get('vocab_es')).vocab_es;
    const peeked = Object.entries(v.stats).filter(([, s]) => s.peek > 0).map(([l]) => l);
    v.known = (v.known ?? []).filter(l => !peeked.includes(l));
    v.forgot = [...new Set([...(v.forgot ?? []), ...peeked])];
    v.v = 2;
    await chrome.storage.local.set({ vocab_es: v });
    return peeked.join(', ');
  }));
  const t0 = Date.now();
  await p.click('#podcast-btn');
  let ep;
  for (let i = 0; i < 90; i++) {
    await p.waitForTimeout(1000);
    ep = await p.evaluate(() => ({ btn: document.getElementById('podcast-btn').textContent, audio: !!document.querySelector('#podcast audio[src]'), text: document.getElementById('podcast').innerText.slice(0, 400) }));
    if (ep.audio || /error|couldn|fail/i.test(ep.text)) break;
  }
  console.log(`podcast after ${Math.round((Date.now() - t0) / 1000)}s:`, JSON.stringify(ep));
  console.log('ledger:', await p.evaluate(() => ['l-page', 'l-words', 'l-ondevice', 'l-cloud'].map(id => `${id}=${document.getElementById(id).textContent}`).join(' ')));
  await p.screenshot({ path: '/var/tmp/osmosis-panel-cloud.png', fullPage: true });
  await p.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
