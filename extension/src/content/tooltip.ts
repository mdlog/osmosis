// Hover card: the original English sentence plus the meaning of the new words in it.
import type { Word } from '../shared/types';

const CSS = `
:host { all: initial; }
.card { position: fixed; z-index: 2147483647; max-width: 380px; padding: 10px 12px; border-radius: 10px;
  background: #fffdf7; color: #1d2a24; box-shadow: 0 8px 28px rgba(16,35,29,.22), 0 0 0 1px rgba(16,35,29,.08);
  font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; pointer-events: none;
  opacity: 0; transform: translateY(4px); transition: opacity .12s, transform .12s; }
.card.show { opacity: 1; transform: none; }
.orig { color: #44554d; font-style: italic; }
ul { list-style: none; margin: 8px 0 0; padding: 8px 0 0; border-top: 1px solid #ece6d6; display: grid; gap: 3px; }
li { display: flex; gap: 8px; } b { color: #146346; font-weight: 650; } span { color: #44554d; }
.hint { margin-top: 6px; font-size: 11px; color: #7b8a83; }
`;

export class Tooltip {
  private card: HTMLDivElement;
  constructor() {
    const host = document.createElement('div');
    host.className = 'osm-root';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>${CSS}</style><div class="card" role="tooltip"></div>`;
    this.card = root.querySelector('.card') as HTMLDivElement;
    document.documentElement.appendChild(host);
  }
  show(anchor: Element, original: string, fresh: Word[]) {
    const c = this.card;
    c.replaceChildren();
    const o = document.createElement('div');
    o.className = 'orig';
    o.textContent = original;
    c.append(o);
    if (fresh.length) {
      const ul = document.createElement('ul');
      for (const w of fresh) {
        const li = document.createElement('li');
        const b = document.createElement('b');
        b.textContent = w.w;
        const sp = document.createElement('span');
        sp.textContent = w.en;
        li.append(b, sp);
        ul.append(li);
      }
      c.append(ul);
      const h = document.createElement('div');
      h.className = 'hint';
      h.textContent = 'Click a highlighted word once you know it.';
      c.append(h);
    }
    const r = anchor.getBoundingClientRect();
    const top = r.bottom + 8 + 160 > innerHeight ? Math.max(8, r.top - 8 - c.offsetHeight) : r.bottom + 8;
    c.style.left = `${Math.min(Math.max(8, r.left), innerWidth - 396)}px`;
    c.style.top = `${top}px`;
    c.classList.add('show');
  }
  hide() {
    this.card.classList.remove('show');
  }
}
