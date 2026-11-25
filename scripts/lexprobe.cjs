// Dev probe: calls Firebase AI Logic (Gemini Developer API) from Node with the App Check debug
// token in .env.local, to measure how the word-list prompts behave. Prints counts, never the token.
// Usage: node scripts/lexprobe.cjs <lang> <level> [single|topics]
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync('firebase.config.json', 'utf8'));
const local = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const { apiKey, projectId, appId } = cfg.firebase;
const MODEL = cfg.models.text;

async function appCheckToken() {
  const r = await fetch(`https://content-firebaseappcheck.googleapis.com/v1/projects/${projectId}/apps/${appId}:exchangeDebugToken?key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ debug_token: local.APPCHECK_DEBUG_TOKEN }),
  });
  if (!r.ok) throw new Error(`App Check exchange ${r.status}`);
  return (await r.json()).token;
}

async function generate(token, text, schema, system) {
  const errs = [];
  for (let k = 0; k < 5; k++) {
    const r = await generateOnce(token, text, schema, system);
    if (!r.error || !/^(429|5\d\d)/.test(r.error)) return r;
    errs.push(r.error.slice(0, 60));
    await new Promise(res => setTimeout(res, 1500 * 2 ** k));
  }
  return { error: 'gave up: ' + [...new Set(errs)].join(' | ') };
}

async function generateOnce(token, text, schema, system) {
  const t0 = Date.now();
  const r = await fetch(`https://firebasevertexai.googleapis.com/v1beta/projects/${projectId}/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey, 'X-Firebase-AppCheck': token },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text }] }],
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema },
    }),
  });
  const body = await r.json();
  if (!r.ok) return { error: `${r.status} ${body.error?.message?.slice(0, 120)}` };
  const c = body.candidates?.[0];
  return { text: c?.content?.parts?.map(p => p.text).join('') ?? '', finish: c?.finishReason, out: body.usageMetadata?.candidatesTokenCount, ms: Date.now() - t0 };
}

module.exports = { appCheckToken, generate };

if (require.main === module) {
  const [lang = 'de', level = 'B1', mode = 'single'] = process.argv.slice(2);
  const L = { es: 'Spanish', fr: 'French', de: 'German', ja: 'Japanese' }[lang];
  const SIZE = { A1: 300, A2: 700, B1: 1400, B2: 2200 }[level];
  const schema = { type: 'object', properties: { lemmas: { type: 'array', items: { type: 'string' } } }, required: ['lemmas'] };
  (async () => {
    const tok = await appCheckToken();
    if (mode === 'topics') {
      // Same plan, prompt and cleanup as the extension (bundled from the TypeScript sources).
      const { buildSync } = require('esbuild');
      const code = buildSync({ stdin: { contents: "export * from './extension/src/shared/lexicon'; export * from './extension/src/shared/prompts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'cjs', write: false, platform: 'node' }).outputFiles[0].text;
      const mod = { exports: {} }; new Function('module', 'exports', 'require', code)(mod, mod.exports, require);
      const { lexiconPlan, cleanLemmas, lexiconPrompt, LEXICON_SCHEMA } = mod.exports;
      const plan = lexiconPlan(level);
      const t0 = Date.now();
      const raw = []; let fails = 0, asked = 0, next = 0;
      async function worker() {
        while (next < plan.length) {
          const q = plan[next++]; asked += q.n;
          const r = await generate(tok, lexiconPrompt(lang, level, q.topic, q.n), LEXICON_SCHEMA);
          let got = 0;
          if (!r.error) try { const l = JSON.parse(r.text).lemmas; raw.push(...l); got = l.length; } catch {}
          if (r.error || !got) fails++;
          console.log(`  ${String(got).padStart(4)}/${q.n}  ${q.topic.slice(0, 50)}${r.error ? '  ' + r.error : ''}`);
        }
      }
      await Promise.all([1, 2, 3, 4].map(worker));
      const clean = cleanLemmas(lang, raw);
      console.log(`topics: asked ${asked}, raw ${raw.length}, unique clean ${clean.length} (target ${SIZE}), failed chunks ${fails}, ${Math.round((Date.now() - t0) / 1000)} s`);
      console.log('  sample:', clean.slice(0, 12).join(', '), '…', clean.slice(-6).join(', '));
    }
    if (mode === 'single') {
      const r = await generate(tok, `List the ${SIZE} most frequent ${L} content-word lemmas (nouns, verbs, adjectives, adverbs) that a learner at CEFR ${level} is expected to know. Lowercase dictionary forms only, no duplicates, no explanations.`, schema);
      if (r.error) return console.log(r.error);
      let n = '?'; try { n = JSON.parse(r.text).lemmas.length; } catch (e) { n = `unparseable (${r.text.length} chars)`; }
      console.log(`single: ${n} lemmas, finish=${r.finish}, out=${r.out} tokens, ${r.ms} ms`);
    }
  })().catch(e => { console.error(e.message); process.exit(1); });
}
