// Build the extension (and later the web demo) with esbuild.
// Env: firebase.config.json (public web config + reCAPTCHA Enterprise site key, committed) + .env.local (APPCHECK_DEBUG_TOKEN; never committed).
import * as esbuild from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const cfg = JSON.parse(readFileSync('firebase.config.json', 'utf8'));
const local = existsSync('.env.local')
  ? Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
  : {};
const env = {
  firebase: cfg.firebase,
  models: cfg.models,
  appCheckDebugToken: local.APPCHECK_DEBUG_TOKEN || undefined,
  recaptchaSiteKey: local.RECAPTCHA_SITE_KEY || cfg.recaptchaSiteKey || undefined,
};

const out = 'dist/extension';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync('extension/public', out, { recursive: true });

const ctx = await esbuild.context({
  entryPoints: {
    sw: 'extension/src/background/sw.ts',
    content: 'extension/src/content/index.ts',
    panel: 'extension/src/sidepanel/panel.ts',
  },
  outdir: out,
  bundle: true,
  loader: { '.svg': 'text' },
  format: 'iife',
  target: 'chrome139',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  define: { __OSM_ENV__: JSON.stringify(env) },
  logLevel: 'info',
});
// Web demo reader (Firebase Hosting). The App Check debug token is never put in this public bundle.
const webOut = 'web/public/osmosis';
rmSync(webOut, { recursive: true, force: true });
mkdirSync(webOut, { recursive: true });
cpSync('extension/public/content.css', `${webOut}/content.css`);
const webCtx = await esbuild.context({
  entryPoints: { reader: 'web/src/reader.ts' },
  outdir: webOut,
  bundle: true,
  loader: { '.svg': 'text' },
  format: 'esm',
  splitting: true,
  target: 'chrome120',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  define: { __OSM_ENV__: JSON.stringify({ ...env, appCheckDebugToken: undefined }) },
  logLevel: 'info',
});

if (watch) await Promise.all([ctx.watch(), webCtx.watch()]);
else {
  await Promise.all([ctx.rebuild(), webCtx.rebuild()]);
  await Promise.all([ctx.dispose(), webCtx.dispose()]);
}
