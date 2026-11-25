// Lets the extension's content script run inside an ordinary web page (the Firebase Hosting demo),
// for visitors who have not installed the extension. It provides the two chrome.* surfaces the
// content script uses, backed by localStorage and a direct call into the shared translate pipeline.
import { firebase } from '../../extension/src/shared/ai';
import { getSettings } from '../../extension/src/shared/store';
import { createTranslator, ensureSeeded, onDeviceStatus } from '../../extension/src/shared/translate';

type Change = { oldValue?: unknown; newValue?: unknown };
type Listener = (changes: Record<string, Change>, area: string) => void;

const PREFIX = 'osmosis:';
const listeners: Listener[] = [];
const read = (k: string): unknown => {
  const raw = localStorage.getItem(PREFIX + k);
  return raw == null ? undefined : JSON.parse(raw);
};
const allKeys = () => Object.keys(localStorage).filter(k => k.startsWith(PREFIX)).map(k => k.slice(PREFIX.length));
const emit = (changes: Record<string, Change>) => queueMicrotask(() => listeners.forEach(l => l(changes, 'local')));

const local = {
  async get(keys?: string | string[] | Record<string, unknown> | null) {
    const defaults = keys && typeof keys === 'object' && !Array.isArray(keys) ? keys : {};
    const list = keys == null ? allKeys() : typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
    const out: Record<string, unknown> = {};
    for (const k of list) {
      const v = read(k);
      if (v !== undefined) out[k] = v;
      else if (k in defaults) out[k] = defaults[k];
    }
    return out;
  },
  async set(items: Record<string, unknown>) {
    const changes: Record<string, Change> = {};
    for (const [k, v] of Object.entries(items)) {
      changes[k] = { oldValue: read(k), newValue: v };
      try {
        localStorage.setItem(PREFIX + k, JSON.stringify(v));
      } catch {
        // Quota: drop the translation cache and keep going (it is only a cache).
        allKeys().filter(x => x.startsWith('tr:')).forEach(x => localStorage.removeItem(PREFIX + x));
        localStorage.setItem(PREFIX + k, JSON.stringify(v));
      }
    }
    emit(changes);
  },
  async remove(keys: string | string[]) {
    const changes: Record<string, Change> = {};
    for (const k of typeof keys === 'string' ? [keys] : keys) {
      changes[k] = { oldValue: read(k) };
      localStorage.removeItem(PREFIX + k);
    }
    emit(changes);
  },
};

firebase('web');
// The demo article is ours, so the web reader may fall back to the cloud when this browser has
// no on-device model. The extension never does that without the learner's explicit consent.
const { translate } = createTranslator(() => 'prefer_on_device');

const runtime = {
  async sendMessage(msg: { type?: string; lang?: string }) {
    if (msg?.type === 'osm:translate') return translate(msg as Parameters<typeof translate>[0]);
    if (msg?.type === 'osm:status') return onDeviceStatus(msg.lang ?? 'es');
    return undefined;
  },
};

const g = globalThis as unknown as { chrome?: Record<string, unknown> };
g.chrome ??= {};
Object.defineProperty(g.chrome, 'storage', { value: { local, onChanged: { addListener: (f: Listener) => listeners.push(f) } }, configurable: true });
Object.defineProperty(g.chrome, 'runtime', { value: runtime, configurable: true });

export async function prepare() {
  const s = await getSettings();
  await ensureSeeded(s.lang, s.level);
  return s;
}
