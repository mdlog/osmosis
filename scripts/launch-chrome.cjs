// Launch the isolated Osmosis Chrome profile with a CDP pipe so we can call Extensions.loadUnpacked
// (branded Chrome no longer honours --load-extension). Also exposes :9333 for Playwright connectOverCDP.
// Usage: node launch-chrome.cjs <unpacked-ext-dir> [more dirs...]   (keeps running; holds the pipe)
const { spawn } = require('child_process');

const exts = process.argv.slice(2);
const chrome = spawn('google-chrome', [
  '--user-data-dir=/var/tmp/osmosis-chrome',
  '--remote-debugging-pipe',
  '--enable-unsafe-extension-debugging',
  '--remote-debugging-port=9333',
  '--remote-debugging-address=127.0.0.1',
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank',
], { stdio: ['ignore', 'inherit', 'inherit', 'pipe', 'pipe'], env: { ...process.env, DISPLAY: process.env.DISPLAY || ':1' } });

const toChrome = chrome.stdio[3];
const fromChrome = chrome.stdio[4];
let buf = '';
const pending = new Map();
let nextId = 1;
fromChrome.on('data', d => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\0')) >= 0) {
    const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
});
const send = (method, params = {}) => new Promise(res => {
  const id = nextId++; pending.set(id, res);
  toChrome.write(JSON.stringify({ id, method, params }) + '\0');
});

async function loadAll() {
  for (const path of exts) {
    const r = await send('Extensions.loadUnpacked', { path });
    console.log('[launcher] loadUnpacked', path, '->', JSON.stringify(r.result || r.error));
  }
}
(async () => {
  await new Promise(r => setTimeout(r, 2500));
  await loadAll();
  console.log('[launcher] ready');
})();
// `kill -USR2 <launcher pid>` re-installs the unpacked extensions (= reload after a rebuild).
process.on('SIGUSR2', () => loadAll().then(() => console.log('[launcher] reloaded')));

chrome.on('exit', code => { console.log('[launcher] chrome exited', code); process.exit(0); });
process.on('SIGTERM', () => chrome.kill('SIGTERM'));
