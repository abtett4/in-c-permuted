// Small UI building blocks: knobs, dB meters and the cell previews.

// One color per SynthDef: twelve hues 30° apart in OKLCH, stepped through
// three lightnesses (0.56 / 0.84 / 0.70) so that neighbours on the wheel also
// differ in lightness. Every pair is at least 15.6 apart (OKLab ΔE ×100) under
// normal vision, and every color is at least 3.6:1 against the panels. No set
// of twelve can also stay apart for colour-blind viewers, so colour is never
// the only cue: SynthDef names are always shown beside it.
const KNOWN_COLORS = {
  ff: '#bc4849',            // red         h 23
  click: '#ffb98d',         // peach       h 53
  pluck: '#c89513',         // gold        h 83
  burst: '#767b00',         // olive       h113
  harpsichord1: '#8de388',  // green       h143
  envsine: '#1bb897',       // teal        h173
  midsine: '#02848d',       // deep cyan   h203
  star: '#89d6ff',          // sky         h233
  highshort: '#6c9cfb',     // blue        h263
  bass: '#7a5fc3',          // violet      h293
  highlong: '#f5acfd',      // lilac       h323
  starlet: '#e473a6',       // pink        h353
};
// For SynthDefs added later, until they're given a color above.
const SPARE = ['#d8d4cc', '#a3a8b8', '#c9a88a', '#8fb3a0'];
const assigned = {};

export function colorFor(instrument) {
  if (KNOWN_COLORS[instrument]) return KNOWN_COLORS[instrument];
  if (!assigned[instrument]) assigned[instrument] = SPARE[Object.keys(assigned).length % SPARE.length];
  return assigned[instrument];
}

export const dbamp = db => (db <= -60 ? 0 : 10 ** (db / 20));
export const ampdb = amp => (amp > 0 ? 20 * Math.log10(amp) : -Infinity);

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) node.append(c);
  return node;
}

// ---- Knob ------------------------------------------------------------------
// Drag up/down (Shift for fine), scroll, arrow keys; double-click resets.

const SWEEP = 270;

// `mini` draws a small dial with no label or readout; the value shows in its
// tooltip instead (for the per-module rows).
export function knob({ label, min, max, value, step = 0.01, format = String, onInput, title, mini = false, bipolar = false }) {
  const def = value;
  const dial = el('div', {
    class: 'knob-dial', role: 'slider', tabindex: '0', 'aria-label': label,
    'aria-valuemin': min, 'aria-valuemax': max, title: title ?? `${label}: drag, scroll or use arrow keys. Double-click to reset.`,
  });
  dial.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true">
      <path class="knob-track" d="${arcPath(0, 1)}"/>
      <path class="knob-arc" d=""/>
      <circle class="knob-cap" cx="24" cy="24" r="13"/>
      <line class="knob-ptr" x1="24" y1="24" x2="24" y2="14"/>
    </svg>`;
  const out = el('div', { class: 'knob-val' });
  const root = mini
    ? el('div', { class: 'knob knob-mini' }, dial)
    : el('div', { class: 'knob' }, dial, out, el('div', { class: 'knob-label' }, label));
  const arc = dial.querySelector('.knob-arc');
  const ptr = dial.querySelector('.knob-ptr');

  let v = value;
  const set = (nv, emit = true) => {
    nv = Math.min(max, Math.max(min, +(Math.round(nv / step) * step).toFixed(6)));
    v = nv;
    const f = (v - min) / (max - min);
    const [a0, a1] = bipolar ? [Math.min(0.5, f), Math.max(0.5, f)] : [0, f];
    arc.setAttribute('d', a1 - a0 > 0.001 ? arcPath(a0, a1) : '');
    ptr.setAttribute('transform', `rotate(${-SWEEP / 2 + f * SWEEP} 24 24)`);
    out.textContent = format(v);
    dial.setAttribute('aria-valuenow', v);
    dial.setAttribute('aria-valuetext', format(v));
    if (mini) dial.title = `${label}: ${format(v)}. Drag, scroll or use arrow keys; double-click to reset.`;
    if (emit && onInput) onInput(v);
  };
  set(value, false);

  let drag = null;
  dial.addEventListener('pointerdown', e => {
    dial.setPointerCapture(e.pointerId);
    drag = { y: e.clientY, v };
    dial.focus();
  });
  dial.addEventListener('pointermove', e => {
    if (!drag) return;
    const scale = e.shiftKey ? 0.15 : 1;
    set(drag.v + ((drag.y - e.clientY) / 180) * (max - min) * scale);
  });
  const end = () => { drag = null; };
  dial.addEventListener('pointerup', end);
  dial.addEventListener('pointercancel', end);
  dial.addEventListener('dblclick', () => set(def));
  dial.addEventListener('wheel', e => {
    e.preventDefault();
    set(v - Math.sign(e.deltaY) * (max - min) / 100);
  }, { passive: false });
  dial.addEventListener('keydown', e => {
    const big = (max - min) / 10;
    const small = Math.max(step, (max - min) / 100);
    const moves = { ArrowUp: small, ArrowRight: small, ArrowDown: -small, ArrowLeft: -small, PageUp: big, PageDown: -big };
    if (e.key in moves) set(v + moves[e.key]);
    else if (e.key === 'Home') set(min);
    else if (e.key === 'End') set(max);
    else return;
    e.preventDefault();
  });

  return { el: root, set, get value() { return v; } };
}

function arcPath(f0, f1) {
  const r = 19;
  const a0 = ((-SWEEP / 2 + f0 * SWEEP - 90) * Math.PI) / 180;
  const a1 = ((-SWEEP / 2 + f1 * SWEEP - 90) * Math.PI) / 180;
  const x0 = 24 + r * Math.cos(a0), y0 = 24 + r * Math.sin(a0);
  const x1 = 24 + r * Math.cos(a1), y1 = 24 + r * Math.sin(a1);
  const large = (f1 - f0) * SWEEP > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

// ---- dB meter --------------------------------------------------------------
// -60 dBFS .. +6 dBFS, with a peak-hold tick that falls back after a second.

const FLOOR = -60;
const CEIL = 6;

export function meter({ vertical = false, label } = {}) {
  const fill = el('div', { class: 'meter-fill' });
  const peak = el('div', { class: 'meter-peak' });
  const root = el('div', { class: `meter${vertical ? ' meter-v' : ''}`, role: 'meter', 'aria-label': label ?? 'level', 'aria-valuemin': FLOOR, 'aria-valuemax': CEIL },
    fill, peak);
  let held = FLOOR;
  let heldAt = 0;
  let shown = FLOOR;
  return {
    el: root,
    update(amp, now = performance.now()) {
      const db = Math.max(FLOOR, Math.min(CEIL, ampdb(amp)));
      shown = db > shown ? db : Math.max(db, shown - 1.2);   // fast up, eased down
      if (db >= held) { held = db; heldAt = now; } else if (now - heldAt > 1000) held = Math.max(db, held - 0.8);
      const f = (shown - FLOOR) / (CEIL - FLOOR);
      const pf = (held - FLOOR) / (CEIL - FLOOR);
      if (vertical) {
        fill.style.clipPath = `inset(${((1 - f) * 100).toFixed(1)}% 0 0 0)`;
        peak.style.bottom = `${(pf * 100).toFixed(1)}%`;
      } else {
        fill.style.clipPath = `inset(0 ${((1 - f) * 100).toFixed(1)}% 0 0)`;
        peak.style.left = `${(pf * 100).toFixed(1)}%`;
      }
      peak.classList.toggle('hot', held > -1);
      peak.style.opacity = held > FLOOR + 1 ? 1 : 0;
      root.setAttribute('aria-valuenow', Math.round(shown));
    },
  };
}

// ---- Cell preview ----------------------------------------------------------
// A tiny piano roll of one module's phrase.

export function cellPreview(m) {
  const notes = m.cell.filter(e => !e.rest).flatMap(e => [].concat(e.midinote));
  const lo = Math.min(...notes, 60) - 1;
  const hi = Math.max(...notes, 60) + 1;
  const W = 96, H = 24;
  let x = 0;
  const bars = [];
  for (const e of m.cell) {
    const w = (e.dur / m.cellBeats) * W;
    if (!e.rest) {
      for (const n of [].concat(e.midinote)) {
        const y = H - 2 - ((n - lo) / (hi - lo)) * (H - 5);
        bars.push(`<rect x="${(x + 0.3).toFixed(2)}" y="${(y - 1.5).toFixed(2)}" width="${Math.max(1.2, w - 0.6).toFixed(2)}" height="3" rx="1"/>`);
      }
    }
    x += w;
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'cell');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = bars.join('');
  return svg;
}

export function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
