// Firebase AI Logic wiring shared by the extension (offscreen document) and the web demo.
// Every model call in Osmosis goes through here.
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { CustomProvider, initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  ResponseModality,
  type GenerativeModel,
} from 'firebase/ai';
import { ENV } from './env';
import { cleanLemmas, type LexiconRequest } from './lexicon';
import { LEXICON_SCHEMA, lexiconPrompt, REWRITE_SCHEMA, rewritePrompt, rewriteSystem } from './prompts';
import { LANG_NAME, type InferenceSource, type Item, type Lang, type Level } from './types';
import { missing, validateItems } from './validate';

let app: FirebaseApp | null = null;
const DEBUG = false;

/**
 * Initialise Firebase + App Check once. The web demo attests with reCAPTCHA Enterprise
 * (Firebase "Fraud Defense"). The extension has no web origin for reCAPTCHA, so it uses a
 * registered App Check debug token (accepted by the contest). App Check is enforced for
 * Firebase AI Logic on this project, so cloud calls without a valid token are rejected.
 */
export function firebase(kind: 'extension' | 'web'): FirebaseApp {
  if (app) return app;
  app = initializeApp(ENV.firebase);
  if (ENV.appCheckDebugToken) {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN = ENV.appCheckDebugToken;
  }
  const provider =
    kind === 'web' && ENV.recaptchaSiteKey
      ? new ReCaptchaEnterpriseProvider(ENV.recaptchaSiteKey)
      : new CustomProvider({
          getToken: () => Promise.reject(new Error('App Check: extension builds use a debug token')),
        });
  initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true });
  return app;
}

export type RewriteMode = 'only_on_device' | 'prefer_on_device';

/**
 * An on-device prompt that runs this long has gone wrong: the small model occasionally keeps
 * generating inside the JSON schema (one single-sentence prompt took 129 s). Prompts run one at a
 * time, so a runaway one would hold up every paragraph queued behind it. It is aborted instead,
 * and its sentences stay in English. Normal prompts take 3 to 14 s.
 */
const ON_DEVICE_PROMPT_MS = 40_000;

/** Firebase AI Logic keeps this object and hands it to every on-device prompt; `signal` is set per call. */
interface PromptOptions {
  responseConstraint: Record<string, unknown>;
  signal?: AbortSignal;
}

const models = new Map<string, { model: GenerativeModel; promptOptions: PromptOptions }>();

/** The rewrite model for one language/level. Page text uses ONLY_ON_DEVICE unless the user opted in to cloud fallback. */
function rewriteModel(lang: Lang, level: Level, mode: RewriteMode, cloud = ENV.models.text) {
  const key = `${lang}:${level}:${mode}:${cloud}`;
  const have = models.get(key);
  if (have) return have;
  const ai = getAI(app!, { backend: new GoogleAIBackend() });
  const system = rewriteSystem(lang, level);
  const promptOptions: PromptOptions = { responseConstraint: REWRITE_SCHEMA as unknown as Record<string, unknown> };
  const model = getGenerativeModel(ai, {
    mode: mode === 'only_on_device' ? InferenceMode.ONLY_ON_DEVICE : InferenceMode.PREFER_ON_DEVICE,
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: [lang] }],
        initialPrompts: [{ role: 'system', content: [{ type: 'text', value: system }] }],
      },
      promptOptions,
    },
    inCloudParams: {
      model: cloud,
      systemInstruction: system,
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: REWRITE_SCHEMA, temperature: 0.2 },
    },
  });
  const entry = { model, promptOptions };
  models.set(key, entry);
  return entry;
}

export interface RewriteResult {
  items: (Item | null)[];
  source: InferenceSource | 'none';
  /** Characters of page text that left the device (0 for on-device inference). */
  sentUp: number;
}

/**
 * Cloud models sometimes answer 429/5xx ("This model is currently experiencing high demand").
 * Retry only those, with exponential backoff; anything else (bad request, App Check) fails fast.
 */
// Includes a 401 the Google front end sometimes returns under load ("missing required
// authentication credential") for requests that succeed when sent again, and dropped connections.
const TRANSIENT =
  /\[(429|500|502|503|504)\b|high demand|overloaded|RESOURCE_EXHAUSTED|UNAVAILABLE|missing required authentication credential|Failed to fetch|NetworkError|network error/i;
const isTransient = (e: unknown) => TRANSIENT.test(e instanceof Error ? e.message : String(e));

async function retrying<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  for (let k = 0; ; k++) {
    try {
      return await fn();
    } catch (e) {
      if (!isTransient(e) || k >= tries - 1) throw e;
      await new Promise(r => setTimeout(r, 1500 * 2 ** k + Math.random() * 500));
    }
  }
}

/**
 * Cloud text calls: the main model with retries, then the fallback model. Gemini can report
 * "high demand" for one model for minutes at a time while another answers normally.
 */
async function withFallback<T>(call: (model: string) => Promise<T>): Promise<T> {
  try {
    return await retrying(() => call(ENV.models.text), 3);
  } catch (e) {
    const fallback = ENV.models.textFallback;
    if (!fallback || !isTransient(e)) throw e;
    console.warn(`[osmosis] ${ENV.models.text} unavailable, using ${fallback}`);
    return retrying(() => call(fallback), 3);
  }
}

async function once(sentences: string[], lang: Lang, level: Level, mode: RewriteMode) {
  const prompt = rewritePrompt(sentences, lang, level);
  const t0 = performance.now();
  const call = (model: string) => {
    const m = rewriteModel(lang, level, mode, model);
    m.promptOptions.signal = AbortSignal.timeout(ON_DEVICE_PROMPT_MS);
    return m.model.generateContent(prompt);
  };
  // On-device only: no cloud model to fall back to.
  const r = mode === 'only_on_device' ? await retrying(() => call(ENV.models.text)) : await withFallback(call);
  const source = (r.response.inferenceSource ?? 'in_cloud') as InferenceSource;
  const text = r.response.text();
  const items = validateItems(text, sentences);
  if (DEBUG) console.log(`[osmosis] call ${sentences.length}s ${Math.round(performance.now() - t0)}ms ${text.length}ch valid=${items.filter(Boolean).length}`, items.some(x => !x) ? text.replace(/\s+/g, ' ').slice(0, 500) : '');
  return { items, source, sentUp: source === 'in_cloud' ? prompt.length : 0 };
}

const timedOut = (e: unknown) => e instanceof Error && /TimeoutError|AbortError/.test(e.name + ' ' + e.message);

/**
 * Translate one paragraph. One batched call, then one retry per sentence the model
 * skipped or garbled (small on-device models occasionally truncate structured output).
 */
export async function rewrite(sentences: string[], lang: Lang, level: Level, mode: RewriteMode): Promise<RewriteResult> {
  let first: RewriteResult;
  try {
    first = await once(sentences, lang, level, mode);
  } catch (e) {
    if (!timedOut(e)) throw e;
    console.warn(`[osmosis] on-device prompt passed ${ON_DEVICE_PROMPT_MS / 1000} s, abandoned (${sentences.length} sentences)`);
    // A batch that ran away gets the one-sentence retries below; a single sentence stays English.
    first = { items: sentences.map(() => null), source: 'on_device', sentUp: 0 };
    if (sentences.length === 1) return first;
  }
  let { items, source, sentUp } = first;
  for (const k of missing(items)) {
    try {
      const r = await once([sentences[k]], lang, level, mode);
      if (r.items[0]) items[k] = { ...r.items[0], i: k + 1 };
      sentUp += r.sentUp;
      if (r.source === 'in_cloud') source = 'in_cloud';
    } catch {
      /* keep the English sentence */
    }
  }
  return { items, source, sentUp };
}

// ---- Cloud features: only vocabulary lists ever leave the device ------------------------

function cloudModel(json: Record<string, unknown> | null, system?: string, model = ENV.models.text): GenerativeModel {
  const ai = getAI(app!, { backend: new GoogleAIBackend() });
  return getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: {
      model,
      ...(system ? { systemInstruction: system } : {}),
      generationConfig: json ? { responseMimeType: 'application/json', responseJsonSchema: json } : {},
    },
  });
}

export interface LexiconResult {
  words: string[];
  /** Topics that came back; the others are fetched next time. */
  done: string[];
  /** Cloud requests made (for the privacy ledger). */
  calls: number;
}

/**
 * Starting vocabulary for a level, built in the cloud from many small requests (see
 * lexiconPlan), four at a time. A request that still fails after its retries gets one more
 * pass at the end; topics that never came back are simply left for next time.
 * Sends no user data at all: only the language, the level and a topic.
 */
export async function buildLexicon(
  lang: Lang,
  level: Level,
  requests: LexiconRequest[],
  onProgress?: (finished: number, total: number) => void,
): Promise<LexiconResult> {
  const schema = LEXICON_SCHEMA as unknown as Record<string, unknown>;
  const raw: unknown[] = [];
  const done: string[] = [];
  let calls = 0;
  let finished = 0;
  const one = async (q: LexiconRequest) => {
    calls++;
    const r = await withFallback(model => cloudModel(schema, undefined, model).generateContent(lexiconPrompt(lang, level, q.topic, q.n)));
    const lemmas = (JSON.parse(r.response.text()) as { lemmas?: unknown }).lemmas;
    if (!Array.isArray(lemmas) || !lemmas.length) throw new Error('empty list');
    raw.push(...lemmas);
    done.push(q.topic);
  };
  const run = async (queue: LexiconRequest[], failed: LexiconRequest[], report: boolean) => {
    const worker = async () => {
      for (let q = queue.shift(); q; q = queue.shift()) {
        await one(q).catch(e => (failed.push(q!), console.warn('[osmosis] lexicon topic failed:', q!.topic, e)));
        if (report) onProgress?.(++finished, requests.length);
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
  };
  const failed: LexiconRequest[] = [];
  await run([...requests], failed, true);
  if (failed.length) await run(failed.splice(0), [], false);
  return { words: cleanLemmas(lang, raw), done, calls };
}

export interface Episode {
  title: string;
  story: string;
  questions: { q: string; options: string[]; answer: number }[];
  /** Characters of vocabulary sent to the cloud. */
  sentUp: number;
}

const EPISODE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    story: { type: 'string' },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { q: { type: 'string' }, options: { type: 'array', items: { type: 'string' } }, answer: { type: 'integer' } },
        required: ['q', 'options', 'answer'],
      },
    },
  },
  required: ['title', 'story', 'questions'],
};

/** A short story at the learner's level that reuses the words they struggled with this week. */
export async function makeEpisode(words: { lemma: string; en: string }[], lang: Lang, level: Level): Promise<Episode> {
  const L = LANG_NAME[lang];
  const list = words.map(w => `${w.lemma} (${w.en})`).join(', ');
  const system =
    `You write short, warm, slightly funny stories in ${L} for a learner at CEFR ${level}. Use only words a ${level} learner knows, plus the target words. Each target word must appear at least twice. 140-180 words, simple past and present tenses. Then write 3 multiple-choice comprehension questions in ${L} (4 options, answer = 0-based index).`;
  const prompt = `Target words: ${list}`;
  const r = await withFallback(model => cloudModel(EPISODE_SCHEMA, system, model).generateContent(prompt));
  const ep = JSON.parse(r.response.text()) as Omit<Episode, 'sentUp'>;
  return { ...ep, sentUp: list.length };
}

/** Read a story aloud with Gemini TTS through Firebase AI Logic. Returns a WAV blob. */
export async function speak(text: string, lang: Lang): Promise<Blob> {
  const ai = getAI(app!, { backend: new GoogleAIBackend() });
  const m = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: {
      model: ENV.models.tts,
      generationConfig: {
        responseModalities: [ResponseModality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
      },
    },
  });
  const L = LANG_NAME[lang];
  const r = await retrying(() => m.generateContent(`Read this ${L} story slowly and clearly, like a friendly teacher:\n\n${text}`));
  const part = r.response.candidates?.[0]?.content?.parts?.find(p => 'inlineData' in p && p.inlineData);
  const inline = part && 'inlineData' in part ? part.inlineData : undefined;
  if (!inline?.data) throw new Error('No audio returned');
  const rate = Number(/rate=(\d+)/.exec(inline.mimeType ?? '')?.[1] ?? 24000);
  return pcmToWav(Uint8Array.from(atob(inline.data), c => c.charCodeAt(0)), rate);
}

/** Wrap raw 16-bit mono PCM in a WAV header so <audio> can play it. */
export function pcmToWav(pcm: Uint8Array, rate: number): Blob {
  const h = new DataView(new ArrayBuffer(44));
  const w = (o: number, s: string) => [...s].forEach((c, k) => h.setUint8(o + k, c.charCodeAt(0)));
  w(0, 'RIFF'); h.setUint32(4, 36 + pcm.length, true); w(8, 'WAVE'); w(12, 'fmt ');
  h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
  h.setUint32(24, rate, true); h.setUint32(28, rate * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true);
  w(36, 'data'); h.setUint32(40, pcm.length, true);
  return new Blob([h.buffer, new Uint8Array(pcm)], { type: 'audio/wav' });
}

/** Download / warm the on-device model via the SDK (must run after a user gesture). */
export async function prepareOnDevice(lang: Lang, level: Level, onProgress: (p: number) => void): Promise<void> {
  await rewriteModel(lang, level, 'only_on_device').model.initializeDeviceModel(onProgress);
}

