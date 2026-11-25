// Spike: download Gemini Nano (Gemma 4) in an isolated Chrome profile, then benchmark graded rewriting.
const { chromium } = require('playwright-core');
const fs = require('fs');

const PARAS = [
  [
    'The city council voted on Tuesday to turn the old train station into a public library.',
    'Construction will start next spring and is expected to take two years.',
    'Local residents have asked for more quiet places to study and work for a long time.',
  ],
  [
    'Scientists found that people who walk for twenty minutes a day sleep better at night.',
    'The study followed three thousand adults in five countries for a full year.',
    'Researchers say even a short walk after dinner can make a real difference.',
  ],
  [
    'Mix the flour and the sugar in a large bowl before you add the eggs.',
    'If the dough feels too dry, add a little milk, one spoon at a time.',
    'Bake the cookies for twelve minutes, or until the edges turn golden brown.',
  ],
];

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer' },
          text: { type: 'string' },
          words: { type: 'array', items: { type: 'object', properties: { w: { type: 'string' }, en: { type: 'string' } }, required: ['w', 'en'] } },
        },
        required: ['i', 'text', 'words'],
      },
    },
  },
  required: ['items'],
};

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes('8770')) || (await ctx.newPage());
  if (!page.url().includes('8770')) await page.goto('http://localhost:8770/');
  page.on('console', m => process.stdout.write('[page] ' + m.text() + '\n'));

  const chromeVer = await page.evaluate(() => navigator.userAgent);
  console.log('UA', chromeVer);
  for (const l of [['es'], ['ja'], ['en'], ['fr'], ['de'], ['id']]) {
    console.log('availability en->' + l, await page.evaluate(x => window.availability(x), l));
  }

  console.log('clicking download button (user activation)');
  await page.click('#dl');
  const t0 = Date.now();
  while (true) {
    const st = await page.evaluate(() => window.spike);
    if (st.ready || st.error) { console.log('state', JSON.stringify(st), 'after', Math.round((Date.now() - t0) / 1000), 's'); break; }
    if (Date.now() - t0 > 40 * 60 * 1000) { console.log('timeout waiting for model'); process.exit(2); }
    await new Promise(r => setTimeout(r, 5000));
  }
  const st = await page.evaluate(() => window.spike);
  if (st.error) process.exit(3);

  const results = [];
  for (const [lang, level] of [['Spanish', 'A2'], ['Spanish', 'B1']]) {
    for (let k = 0; k < PARAS.length; k++) {
      for (const schema of [null, SCHEMA]) {
        const r = await page.evaluate(a => window.rewrite(a), { lang, level, sentences: PARAS[k], schema });
        const row = { lang, level, para: k, json: !!schema, ...r };
        results.push(row);
        console.log(`\n== ${lang} ${level} para${k} json=${!!schema} create=${r.tCreate}ms ttft=${r.ttft}ms total=${r.total}ms chars=${r.chars} (${Math.round(r.chars / (r.total / 1000))} ch/s)`);
        console.log(r.out);
      }
    }
  }
  fs.writeFileSync(__dirname + '/results.json', JSON.stringify(results, null, 2));
  console.log('\nDONE');
  process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
