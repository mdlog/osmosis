// Off-camera preparation for a take, against the isolated Chrome (scripts/chrome.sh start).
//  1. the on-device model is available, and the profile was saved (node video/storage.cjs save)
//  2. Japanese A2 has its level word list (built in the cloud once, like any learner's first switch)
//  3. `npm run check:net` on a real page; its output is kept verbatim for the privacy beat
//  4. a clean learner: Spanish A2, dial 35%, cloud fallback off; empty translation cache,
//     vocabulary and ledger, so everything the video shows happens during the take
//  5. the cards (title, terminal, end) rendered to PNG
// Writes out/take.json. Usage: node video/prep.cjs [--skip-netcheck]
const { chromium } = require('playwright-core');
const { execFile, execFileSync } = require('child_process');
const execFileP = require('util').promisify(execFile);
const fs = require('fs');
const path = require('path');
const { OUT_DIR, NETCHECK_PAGE } = require('./script.cjs');

const EXT = 'jeeacnodnalnmbkaipineojgflbekmlg';
const BACKUP = '/var/tmp/osmosis-storage.before-video.json';
const ROOT = path.join(__dirname, '..');
const log = (...a) => console.log(`[prep ${new Date().toISOString().slice(11, 19)}]`, ...a);

async function panelPage(ctx) {
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${EXT}/panel.html`);
  await p.waitForTimeout(600);
  return p;
}
const setSettings = (p, patch) => p.evaluate(async patch => {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...settings, ...patch } });
}, patch);

async function ensureLexicon(ctx, lang, level) {
  const p = await panelPage(ctx);
  const key = `lex_${lang}_${level}`;
  const have = await p.evaluate(async k => (await chrome.storage.local.get(k))[k], key);
  if (have?.source === 'cloud' && have.topics?.length === 16) {
    log(`${key}: ${have.words.length} words, complete`);
    await p.close();
    return;
  }
  log(`${key}: building in the cloud…`);
  await setSettings(p, { lang, level });
  await p.reload();
  for (let i = 0; i < 240; i++) {
    await p.waitForTimeout(1000);
    const lex = await p.evaluate(async k => (await chrome.storage.local.get(k))[k], key);
    const status = await p.evaluate(() => document.getElementById('lex-status').textContent);
    if (lex?.source === 'cloud' && (!status || /next time/.test(status))) {
      log(`${key}: ${lex.words.length} words from ${lex.topics.length}/16 topics`);
      break;
    }
  }
  await p.close();
}

async function main() {
  if (!fs.existsSync(BACKUP)) throw new Error(`no backup at ${BACKUP}: run node video/storage.cjs save first`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctx = b.contexts()[0];
  // Chrome quits when its last window closes, and this script opens and closes panel tabs.
  if (!ctx.pages().some(p => !p.url().startsWith('chrome-extension://'))) await ctx.newPage();

  const p = await panelPage(ctx);
  const status = await p.evaluate(() => chrome.runtime.sendMessage({ type: 'osm:status', lang: 'es' }));
  log('on-device model for Spanish:', status);
  if (status !== 'available') throw new Error('on-device model not available: the video would show nothing');
  await setSettings(p, { lang: 'es', level: 'A2', dial: 0.35, cloudConsent: false, enabled: true });
  await p.close();

  await ensureLexicon(ctx, 'ja', 'A2');
  await ensureLexicon(ctx, 'es', 'A2');
  {
    const q = await panelPage(ctx);
    await setSettings(q, { lang: 'es', level: 'A2', dial: 0.35, cloudConsent: false, enabled: true });
    await q.close();
  }

  const take = fs.existsSync(path.join(OUT_DIR, 'take.json')) ? JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'take.json'), 'utf8')) : {};
  if (!process.argv.includes('--skip-netcheck') || !take.netcheck) {
    log('npm run check:net --', NETCHECK_PAGE);
    // Asynchronously: this process holds a CDP connection too, and new tabs wait for every attached
    // client. A blocking exec here would freeze the check's tabs until it timed out.
    const { stdout: out } = await execFileP('npm', ['run', 'check:net', '--', NETCHECK_PAGE], { cwd: ROOT, encoding: 'utf8', timeout: 180000 });
    const lines = out.split('\n').map(l => l.replace(/\s+$/, ''));
    while (lines.length && !lines.at(-1)) lines.pop();
    while (lines.length && !lines[0]) lines.shift();
    const key = lines.find(l => l.startsWith('service-worker network requests during translation:'));
    const control = lines.find(l => l.startsWith('capture working (control seen):'));
    console.log(lines.map(l => '   | ' + l).join('\n'));
    if (key !== 'service-worker network requests during translation: 0' || control !== 'capture working (control seen): true') {
      throw new Error('the network check did not pass; the privacy beat would not be true');
    }
    take.netcheck = { command: `npm run check:net -- ${NETCHECK_PAGE}`, lines, key, at: new Date().toISOString() };
  }

  // Clean learner: the take starts from nothing in the cache, vocabulary or ledger.
  const r = await panelPage(ctx);
  const removed = await r.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    const drop = Object.keys(all).filter(k => k.startsWith('tr:') || k.startsWith('vocab') || k === 'ledger');
    await chrome.storage.local.remove(drop);
    return drop.length;
  });
  const after = await r.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    const lex = (await chrome.storage.local.get('lex_es_A2')).lex_es_A2;
    return { settings, esA2: lex?.words?.length };
  });
  await r.close();
  log(`clean learner: removed ${removed} keys; settings ${JSON.stringify(after.settings)}; es A2 list ${after.esA2} words`);
  take.preparedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT_DIR, 'take.json'), JSON.stringify(take, null, 1));

  execFileSync('node', [path.join(__dirname, 'render-cards.cjs')], { stdio: 'inherit' });
  log('ready: node video/record.cjs');
  process.exit(0);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
