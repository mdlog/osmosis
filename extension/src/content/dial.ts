// The floating "Osmosis dial": one slider that controls how much of the page is in the target language.
// Lives in a shadow root so page CSS cannot touch it.
import LOGO from '../../public/logo.svg';
import type { Settings } from '../shared/store';
import { LANG_NAME } from '../shared/types';

export interface Dial {
  update(s: { shown: number; total: number; translated: number }): void;
  status(kind: 'on-device' | 'cloud' | 'no-ondevice' | 'error', detail?: string): void;
  sync(s: Settings): void;
}

const CSS = `
:host { all: initial; }
.pill { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; display: flex; align-items: center; gap: 12px;
  padding: 10px 14px 10px 12px; border-radius: 999px; background: #10231d; color: #eaf5ef;
  font: 500 13px/1.2 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  box-shadow: 0 10px 30px rgba(6, 20, 15, .28), 0 0 0 1px rgba(255,255,255,.06) inset; user-select: none; }
.mark { width: 24px; height: 24px; flex: none; cursor: pointer; transition: filter .2s; }
.mark svg { display: block; width: 100%; height: 100%; }
.mark svg [stroke] { stroke: #d9f2e3; } /* light outline: the pill is as dark as the drop's base */
.pill.off .mark { filter: grayscale(1) brightness(.7); }
.col { display: flex; flex-direction: column; gap: 6px; min-width: 190px; }
.row { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
.lang { font-weight: 650; letter-spacing: .01em; }
.pct { font-variant-numeric: tabular-nums; color: #9ff0c4; font-weight: 650; }
.meta { font-size: 11px; color: #a9c2b6; font-variant-numeric: tabular-nums; }
.src { font-size: 11px; display: inline-flex; align-items: center; gap: 5px; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: #6b7f76; }
.src.on-device .dot { background: #57e39a; } .src.cloud .dot { background: #7fb2ff; }
.src.no-ondevice .dot, .src.error .dot { background: #ffb15c; }
input[type=range] { -webkit-appearance: none; appearance: none; width: 100%; height: 4px; border-radius: 4px; outline: none;
  background: linear-gradient(90deg, #57e39a var(--p), rgba(255,255,255,.16) var(--p)); }
input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: #fff;
  box-shadow: 0 1px 4px rgba(0,0,0,.4); cursor: grab; }
`;

export function mountDial(initial: Settings, cb: { onDial(d: number): void; onToggle(on: boolean): void }): Dial {
  const host = document.createElement('div');
  host.className = 'osm-root';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>${CSS}</style>
    <div class="pill" role="group" aria-label="Osmosis">
      <div class="mark" title="Turn Osmosis on or off" role="switch" tabindex="0">${LOGO}</div>
      <div class="col">
        <div class="row"><span class="lang"></span><span class="pct"></span></div>
        <input type="range" min="0" max="100" step="1" aria-label="Immersion">
        <div class="row"><span class="meta"></span><span class="src"><span class="dot"></span><span class="srct">starting…</span></span></div>
      </div>
    </div>`;
  const $ = <T extends Element>(s: string) => root.querySelector(s) as T;
  const pill = $<HTMLDivElement>('.pill');
  const range = $<HTMLInputElement>('input');
  const pct = $<HTMLSpanElement>('.pct');
  const lang = $<HTMLSpanElement>('.lang');
  const meta = $<HTMLSpanElement>('.meta');
  const src = $<HTMLSpanElement>('.src');
  const srct = $<HTMLSpanElement>('.srct');
  const mark = $<HTMLDivElement>('.mark');

  let s = { ...initial };
  const paint = () => {
    const p = Math.round(s.dial * 100);
    range.value = String(p);
    range.style.setProperty('--p', `${p}%`);
    pct.textContent = `${p}%`;
    lang.textContent = `${LANG_NAME[s.lang]} · ${s.level}`;
    pill.classList.toggle('off', !s.enabled);
  };
  paint();
  range.addEventListener('input', () => {
    s.dial = Number(range.value) / 100;
    paint();
    cb.onDial(s.dial);
  });
  const toggle = () => {
    s.enabled = !s.enabled;
    paint();
    cb.onToggle(s.enabled);
  };
  mark.addEventListener('click', toggle);
  mark.addEventListener('keydown', e => (e.key === 'Enter' || e.key === ' ') && toggle());
  document.documentElement.appendChild(host);

  return {
    update({ shown, total, translated }) {
      meta.textContent = `${shown} of ${total} sentences${translated < total ? ` · ${translated} ready` : ''}`;
    },
    status(kind, detail) {
      src.className = `src ${kind}`;
      srct.textContent = { 'on-device': 'on this device', cloud: 'in the cloud', 'no-ondevice': 'on-device AI unavailable', error: 'error' }[kind];
      src.title = detail ?? '';
    },
    sync(next) {
      s = { ...next };
      paint();
    },
  };
}
