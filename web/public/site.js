// Landing page: the hero specimen diffuses into Spanish as the dial moves (pre-written text, no
// model call), a hover card like the extension's, and scroll reveals.
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dial = document.getElementById('dial');
  const pct = document.getElementById('pct');
  const meta = document.getElementById('meta');
  const card = document.getElementById('card');
  const sents = [...document.querySelectorAll('#specimen .s')].map(el => ({
    el,
    order: Number(el.dataset.o),
    en: el.textContent.trim(),
    es: el.dataset.es,
    word: el.dataset.w.split('=')[0],
    gloss: el.dataset.w.split('=')[1],
    on: false,
  }));
  const known = new Set();
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function render(s) {
    if (!s.on) {
      s.el.textContent = s.en;
      s.el.classList.remove('es');
      s.el.removeAttribute('lang');
      return;
    }
    const cls = known.has(s.word) ? 'nw known' : 'nw';
    s.el.innerHTML = esc(s.es).replace(/\{([^}]+)\}/, (_, w) => `<span class="${cls}" data-w="${esc(w)}">${w}</span>`);
    s.el.classList.add('es');
    s.el.lang = 'es';
  }

  // Sentences switch in an order that alternates between the two paragraphs, so the page mixes.
  function setDial(v) {
    const p = Math.round(v);
    dial.value = String(p);
    dial.style.setProperty('--p', `${p}%`);
    pct.textContent = `${p}%`;
    const n = Math.round((p / 100) * sents.length);
    let shown = 0;
    for (const s of sents) {
      const on = s.order < n;
      if (on) shown++;
      if (on !== s.on) {
        s.on = on;
        render(s);
        if (!reduce) {
          s.el.classList.remove('flip');
          void s.el.offsetWidth;
          s.el.classList.add('flip');
        }
      }
    }
    meta.textContent = `${shown} of ${sents.length} sentences`;
  }
  dial.addEventListener('input', () => {
    swept = true;
    setDial(Number(dial.value));
  });

  // Hover card: original sentence + the new word, like the extension.
  document.getElementById('specimen').addEventListener('mousemove', e => {
    const el = e.target.closest('.s.es');
    if (!el) return card.classList.remove('on');
    const s = sents.find(x => x.el === el);
    const fresh = known.has(s.word) ? '' : `<div><b>${esc(s.word)}</b>${esc(s.gloss)}</div>`;
    card.innerHTML = `<div class="orig">${esc(s.en)}</div>${fresh}<div class="hint">Click the word once you know it.</div>`;
    const r = el.getBoundingClientRect();
    const top = r.bottom + 10 + card.offsetHeight > innerHeight ? r.top - card.offsetHeight - 10 : r.bottom + 10;
    card.style.left = `${Math.max(12, Math.min(e.clientX - 40, innerWidth - card.offsetWidth - 12))}px`;
    card.style.top = `${top}px`;
    card.classList.add('on');
  });
  document.getElementById('specimen').addEventListener('mouseleave', () => card.classList.remove('on'));
  document.getElementById('specimen').addEventListener('click', e => {
    const w = e.target.closest('.nw');
    if (!w) return;
    const word = w.dataset.w;
    known.has(word) ? known.delete(word) : known.add(word);
    sents.filter(s => s.on).forEach(render);
    card.classList.remove('on');
  });

  // On load the dial sweeps to 35%, the extension's default.
  let swept = false;
  function sweep() {
    if (swept) return;
    if (reduce) return setDial(35);
    const t0 = performance.now();
    const step = t => {
      if (swept) return;
      const k = Math.min(1, (t - t0) / 1800);
      setDial(35 * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  setDial(0);
  setTimeout(sweep, 900);

  // Scroll reveals.
  const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && (e.target.classList.add('in'), io.unobserve(e.target))), { rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.rise').forEach(el => io.observe(el));
})();
