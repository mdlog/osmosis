// The judge's case: a browser with no on-device model opens the hosted demo article. The web reader
// must fall back to Gemini in the cloud through Firebase AI Logic, attested by App Check
// (reCAPTCHA Enterprise). Usage: node scripts/webcloud.cjs [url] [chromium executable]
const { chromium } = require('playwright-core');
const URL_ = process.argv[2] || 'http://localhost:8771/read/night-train.html';
const EXE = process.argv[3] || `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;
(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: false, args: ['--window-size=1280,900'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  p.on('console', m => /osmosis|error|App Check/i.test(m.text()) && console.log(`[${m.type()}]`, m.text().slice(0, 220)));
  p.on('response', r => /googleapis|recaptcha/.test(r.url()) && !/\.js$/.test(r.url().split('?')[0]) && console.log('  net', r.status(), r.url().replace(/\?.*/, '').slice(0, 100)));
  await p.goto(URL_);
  console.log('LanguageModel in this browser:', await p.evaluate(() => typeof LanguageModel));
  let st;
  for (let s = 0; s < 60; s++) {
    await p.waitForTimeout(1000);
    st = await p.evaluate(() => ({ owner: document.documentElement.dataset.osmosis, note: document.querySelector('.osm-webnote')?.textContent.slice(0, 60), tr: document.querySelectorAll('.osm-tr').length, on: document.querySelectorAll('.osm-s.osm-on').length }));
    if (st.on > 0 && s > 6) break;
  }
  console.log(JSON.stringify(st));
  await p.screenshot({ path: '/var/tmp/osmosis-webcloud.png' });
  await b.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
