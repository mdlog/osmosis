// Level word lists against the real project, through the side panel:
//  1. each level gets a full list (16 topics) from the cloud,
//  2. switching levels swaps lists instead of stacking them: Spanish A2 → B2 → A2 ends with the
//     same known-word count as before, and the switch back is served from storage (0 cloud calls).
// Restores the profile's settings at the end. Usage: node scripts/lexcheck.cjs
const { chromium } = require('playwright-core');
const EXT = 'jeeacnodnalnmbkaipineojgflbekmlg';
const ok = (c, m) => console.log(c ? 'PASS' : 'FAIL', m);

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const p = await b.contexts()[0].newPage();
  await p.setViewportSize({ width: 420, height: 800 });
  p.on('console', m => /unavailable, using|topic failed/.test(m.text()) && console.log('   ', m.text().slice(0, 110)));
  await p.goto(`chrome-extension://${EXT}/panel.html`);
  const saved = await p.evaluate(async () => (await chrome.storage.local.get('settings')).settings);

  const state = () => p.evaluate(async () => {
    const { settings, ledger } = await chrome.storage.local.get(['settings', 'ledger']);
    const k = `lex_${settings.lang}_${settings.level}`;
    const lex = (await chrome.storage.local.get(k))[k];
    return {
      source: lex?.source, words: lex?.words?.length ?? 0, topics: lex?.topics?.length ?? 0,
      status: document.getElementById('lex-status').textContent, known: Number(document.getElementById('n-known').textContent),
      cloudCalls: ledger?.cloudCalls ?? 0,
    };
  });

  async function level(lang, lvl) {
    await p.evaluate(async ([lang, level]) => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, lang, level } });
    }, [lang, lvl]);
    const before = (await state()).cloudCalls;
    const t0 = Date.now();
    await p.reload();
    let s;
    for (let i = 0; i < 300; i++) {
      await p.waitForTimeout(1000);
      s = await state();
      if (s.source === 'cloud' && (!s.status || /next time/.test(s.status))) break;
    }
    s.seconds = Math.round((Date.now() - t0) / 1000);
    s.calls = s.cloudCalls - before;
    console.log(`${lang} ${lvl}: ${s.words} words from ${s.topics}/16 topics, ${s.known} known, ${s.calls} cloud calls, ${s.seconds} s`);
    return s;
  }

  try {
    const de = await level('de', 'B1');
    ok(de.words >= 900 && de.topics === 16, `German B1 list is full (${de.words} words; was 52)`);
    const a2 = await level('es', 'A2');
    const b2 = await level('es', 'B2');
    const back = await level('es', 'A2');
    ok(b2.known > a2.known, `B2 knows more than A2 (${b2.known} > ${a2.known})`);
    ok(back.known === a2.known, `back to A2: same known count as before (${back.known} = ${a2.known}), nothing stacked`);
    ok(back.calls === 0, `back to A2: served from storage (${back.calls} cloud calls)`);
  } finally {
    await p.evaluate(async s => chrome.storage.local.set({ settings: s }), saved);
    console.log('settings restored:', JSON.stringify(saved));
    await p.close();
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
