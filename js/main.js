import { parseScd } from './scd.js';
import { Engine, MAX_MODULES } from './engine.js';
import { Sequencer } from './sequencer.js';
import { DEFAULT_KNOBS, scorePlan, permutePlan, permuteModule, allowedOctaves, randomSeed, mulberry32, encodeState, decodeState } from './permute.js';
import { knob, meter, cellPreview, colorFor, dbamp, el, formatTime } from './ui.js';
import { startViz } from './viz.js';

const SCD_PATH = 'sc/Tett_A_In_C.scd';
const SCORE_SEED = 1964;

const $ = id => document.getElementById(id);
const engine = new Engine();

let model;            // parsed .scd: { tempo, modules, synthDefNames }
let instruments;      // SynthDef names offered in the dropdowns
let state;            // { seed, knobs, tempo, masterDb, plan: [...] }
let seq;
let cueBeat = 0;
const rows = [];
const notes = [];     // recent and upcoming notes, for the visualizer
let masterMeters;
let levels = new Float32Array(MAX_MODULES + 2);

init().catch(err => showStatus(err.message, true));

async function init() {
  const res = await fetch(SCD_PATH);
  if (!res.ok) throw new Error(`Couldn't load ${SCD_PATH} (HTTP ${res.status}).`);
  model = parseScd(await res.text());
  if (!model.modules.length) throw new Error(`No modules found in ${SCD_PATH}.`);
  if (model.modules.length > MAX_MODULES) throw new Error(`The mixer has ${MAX_MODULES} channels but the score has ${model.modules.length} modules.`);
  model.warnings.forEach(w => console.warn(w));
  instruments = model.synthDefNames;

  state = (location.hash.length > 1 && decodeState(location.hash.slice(1), model.modules)) || {
    seed: SCORE_SEED,
    knobs: { ...DEFAULT_KNOBS },
    tempo: model.tempo,
    masterDb: -3,
    plan: scorePlan(model.modules, SCORE_SEED),
  };

  seq = new Sequencer(engine, model.modules, () => state.plan);
  seq.tempo = state.tempo;
  seq.onNote = n => notes.push(n);
  seq.onEnd = () => { setPlaying(false); };

  buildHeader();
  buildPermutationPanel();
  buildRows();
  layoutLanes();
  bindTransport();

  const pitches = model.modules.flatMap(m => m.cell.filter(e => !e.rest).flatMap(e => [].concat(e.midinote)));
  startViz($('viz'), vizFrame, [Math.min(...pitches), Math.max(...pitches)]);

  engine.onLevels = vals => { levels = vals; };
  requestAnimationFrame(frame);

  $('play').disabled = false;
  window.addEventListener('resize', layoutLanes);

  // Handy for poking at things from the browser console.
  window.inC = { engine, seq, model, get state() { return state; } };
}

// ---- Header: transport, tempo, master -------------------------------------

let tempoKnob, masterKnob, seedInput;

function buildHeader() {
  tempoKnob = knob({
    label: 'Tempo', min: 0.15, max: 1, step: 0.01, value: state.tempo,
    format: v => `${v.toFixed(2)} b/s`,
    title: `TempoClock tempo, in beats per second (the score says ${model.tempo}). Drag, scroll or use arrow keys; double-click to reset.`,
    onInput: v => { state.tempo = v; seq.setTempo(v); layoutLanes(); saveHash(); },
  });
  $('tempo-knob').replaceWith(tempoKnob.el);

  masterKnob = knob({
    label: 'Master', min: -40, max: 6, step: 0.5, value: state.masterDb,
    format: v => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`,
    onInput: v => { state.masterDb = v; engine.setMaster(dbamp(v)); saveHash(); },
  });
  $('master-knob').replaceWith(masterKnob.el);

  $('limiter').addEventListener('change', e => engine.setLimiter(e.target.checked));

  const l = meter({ vertical: true, label: 'Master left' });
  const r = meter({ vertical: true, label: 'Master right' });
  $('master-meters').append(l.el, r.el);
  masterMeters = [l, r];
}

function bindTransport() {
  $('play').addEventListener('click', () => (seq.playing ? pause() : play()));
  $('stop').addEventListener('click', stop);
  document.addEventListener('keydown', e => {
    if (e.code !== 'Space' || e.target.closest('input, select, textarea, button, [role=slider]')) return;
    e.preventDefault();
    $('play').click();
  });
}

async function ensureEngine() {
  if (engine.ready) return true;
  $('play').disabled = true;
  try {
    const { instruments: loaded, failed } = await engine.boot(instruments, msg => showStatus(msg));
    if (failed.length) showStatus(`Couldn't load SynthDef${failed.length > 1 ? 's' : ''}: ${failed.join(', ')}. Modules using ${failed.length > 1 ? 'them' : 'it'} will be silent.`, true);
    if (!loaded.length) throw new Error('No SynthDefs loaded.');
    engine.setMaster(dbamp(state.masterDb));
    engine.setLimiter($('limiter').checked);
    pushGains();
    engine.sonic.on('audiocontext:suspended', () => showStatus('The browser paused audio.', true, 'Resume', () => engine.sonic.recover()));
    engine.sonic.on('audiocontext:resumed', () => showStatus(''));
    return true;
  } catch (err) {
    showStatus(err.message, true);
    return false;
  } finally {
    $('play').disabled = false;
  }
}

async function play() {
  if (!(await ensureEngine())) return;
  seq.setTempo(state.tempo);
  seq.play(cueBeat);
  setPlaying(true);
}

// Pause keeps your place; Play carries on from there.
async function pause() {
  cueBeat = snap(seq.beat);
  await seq.stop();
  setPlaying(false);
}

async function stop() {
  await seq.stop();
  cueBeat = 0;
  setPlaying(false);
}

function setPlaying(on) {
  if (!on) dropUnplayedNotes();
  const b = $('play');
  b.classList.toggle('is-playing', on);
  b.querySelector('span').textContent = on ? 'Pause' : 'Play';
  b.querySelector('svg').innerHTML = on
    ? '<rect x="3.5" y="2.5" width="3.2" height="11" rx="0.8"/><rect x="9.3" y="2.5" width="3.2" height="11" rx="0.8"/>'
    : '<path d="M4 2.5v11l9-5.5z"/>';
  $('stop').disabled = !on && cueBeat === 0;
  $('playhead').hidden = !on;
  if (!on) seq.anchorBeat = cueBeat;
}

async function cueTo(beat) {
  cueBeat = snap(Math.max(0, beat));
  if (seq.playing) {
    await seq.stop();
    dropUnplayedNotes();
    seq.play(cueBeat);
  } else {
    seq.anchorBeat = cueBeat;
    $('stop').disabled = cueBeat === 0;
  }
}

const snap = b => Math.round(b * 4) / 4;   // to the pulse

// ---- Permutation panel ------------------------------------------------------

const permKnobs = {};

function buildPermutationPanel() {
  const defs = [
    ['spread', 'Repeat spread', 0, 1, 0.01, v => `±${Math.round(v * 100)}%`, 'How far repeat counts may stray from the score’s [a, b] choices.'],
    ['shuffle', 'Instrument swap', 0, 1, 0.01, v => `${Math.round(v * 100)}%`, 'Chance that a module is handed to a different SynthDef.'],
    ['variance', 'Level variance', 0, 12, 0.5, v => `±${v.toFixed(1)} dB`, 'How much module levels may vary.'],
    ['drift', 'Entry drift', 0, 8, 0.25, v => `±${v.toFixed(2)} b`, 'How many beats early or late a module may enter.'],
    ['octaves', 'Octave range', 0, 2, 1, v => (v === 0 ? 'off' : `±${v} oct`), 'How many octaves a module may be transposed. Following Riley, up is favored, and only modules with long notes (a dotted quarter or longer) may go down.'],
  ];
  for (const [key, label, min, max, step, format, title] of defs) {
    state.knobs[key] ??= DEFAULT_KNOBS[key];
    const k = knob({ label, min, max, step, value: state.knobs[key], format, title: `${title} Applies to the next permutation.`,
      onInput: v => { state.knobs[key] = v; saveHash(); } });
    permKnobs[key] = k;
    $('perm-knobs').append(k.el);
  }

  seedInput = $('seed');
  seedInput.value = state.seed;
  seedInput.addEventListener('change', () => {
    const s = Math.max(0, Math.floor(Number(seedInput.value) || 0));
    applyPlan(s, permutePlan(model.modules, instruments, state.knobs, s));
  });
  $('permute').addEventListener('click', () => {
    const s = randomSeed();
    applyPlan(s, permutePlan(model.modules, instruments, state.knobs, s));
  });
  $('reset').addEventListener('click', () => applyPlan(SCORE_SEED, scorePlan(model.modules, SCORE_SEED)));
  $('share').addEventListener('click', async () => {
    saveHash(true);
    const btn = $('share');
    try {
      await navigator.clipboard.writeText(location.href);
      btn.textContent = 'Link copied';
    } catch {
      btn.textContent = 'Copy from the address bar';
    }
    setTimeout(() => { btn.textContent = 'Copy link'; }, 1800);
  });
}

function applyPlan(seed, plan) {
  state.seed = seed;
  state.plan = plan;
  seedInput.value = seed;
  rows.forEach((r, i) => { r.refresh(); seq.resync(i); });
  pushGains();
  layoutLanes();
  saveHash();
}

// ---- Module rows ------------------------------------------------------------

function buildRows() {
  const container = $('rows');
  model.modules.forEach((m, i) => {
    const p = () => state.plan[i];

    const num = el('div', { class: `num${m.number === 0 ? ' is-pulse' : ''}`, title: `${m.name} in the .scd` }, m.label);
    const cell = cellPreview(m);

    const select = el('select', { class: 'inst', 'aria-label': `SynthDef for module ${m.label}` });
    for (const name of instruments) select.append(el('option', { value: name }, name));
    select.addEventListener('change', () => { p().instrument = select.value; refresh(); saveHash(); });

    // Any octave you like by hand (within C1–C8); Riley's up/down rule only
    // governs what the permutation generator picks.
    const octSelect = el('select', { class: 'inst oct', 'aria-label': `Octave for module ${m.label}`, title: 'Octave transposition' });
    for (const o of allowedOctaves(m, 2, { rileyRule: false })) {
      octSelect.append(el('option', { value: o }, o === 0 ? '0' : o > 0 ? `+${o}` : `−${-o}`));
    }
    octSelect.addEventListener('change', () => { p().octave = Number(octSelect.value); saveHash(); });

    const repsInput = el('input', { type: 'number', min: '1', max: '999', 'aria-label': `Repeats for module ${m.label}` });
    const setReps = n => {
      p().reps = Math.max(1, Math.min(999, Math.round(n) || 1));
      repsInput.value = p().reps;
      seq.resync(i);
      layoutLanes();
      saveHash();
    };
    repsInput.addEventListener('change', () => setReps(Number(repsInput.value)));
    const reps = el('div', { class: 'reps' },
      el('button', { type: 'button', 'aria-label': 'Fewer repeats', onclick: () => setReps(p().reps - 1) }, '−'),
      repsInput,
      el('button', { type: 'button', 'aria-label': 'More repeats', onclick: () => setReps(p().reps + 1) }, '+'));

    const slider = el('input', { type: 'range', min: '-40', max: '12', step: '0.5', 'aria-label': `Level for module ${m.label}` });
    const out = el('output');
    slider.addEventListener('input', () => { p().gainDb = Number(slider.value); out.textContent = fmtDb(p().gainDb); pushGains(); });
    slider.addEventListener('change', saveHash);
    slider.addEventListener('dblclick', () => { slider.value = 0; slider.dispatchEvent(new Event('input')); saveHash(); });
    const vol = el('div', { class: 'vol' }, slider, out);

    const mtr = meter({ label: `Module ${m.label} level` });

    const mute = el('button', { class: 'mini m', type: 'button', 'aria-pressed': 'false', title: 'Mute' }, 'M');
    const solo = el('button', { class: 'mini s', type: 'button', 'aria-pressed': 'false', title: 'Solo' }, 'S');
    const dice = el('button', { class: 'mini', type: 'button', title: 'Re-roll just this module' });
    dice.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="5.5" cy="5.5" r="1.2"/><circle cx="10.5" cy="10.5" r="1.2"/><circle cx="8" cy="8" r="1.2"/></svg>';
    dice.setAttribute('aria-label', `Re-roll module ${m.label}`);
    mute.addEventListener('click', () => { p().mute = !p().mute; refresh(); pushGains(); saveHash(); });
    solo.addEventListener('click', () => { p().solo = !p().solo; refresh(); pushGains(); saveHash(); });
    dice.addEventListener('click', () => {
      Object.assign(p(), permuteModule(m, instruments, state.knobs, mulberry32(randomSeed())));
      refresh();
      seq.resync(i);
      pushGains();
      layoutLanes();
      saveHash();
    });

    const fill = el('div', { class: 'lane-fill' });
    const bar = el('div', { class: 'lane-bar' }, fill);
    const lane = el('div', { class: 'lane', title: 'Click to start playback here' }, bar);
    lane.addEventListener('click', e => cueTo(beatFromX(e.clientX)));

    const row = el('div', { class: 'row' }, num, cell, select, octSelect, reps, vol,
      el('div', { class: 'meter-cell' }, mtr.el), el('div', { class: 'btns' }, mute, solo, dice), lane);
    container.append(row);

    function refresh() {
      const q = p();
      if (!instruments.includes(q.instrument)) q.instrument = instruments[0];
      row.style.setProperty('--c', colorFor(q.instrument));
      select.value = q.instrument;
      q.octave ??= 0;
      octSelect.value = q.octave;
      repsInput.value = q.reps;
      slider.value = q.gainDb;
      out.textContent = fmtDb(q.gainDb);
      mute.setAttribute('aria-pressed', String(q.mute));
      solo.setAttribute('aria-pressed', String(q.solo));
    }
    refresh();
    rows.push({ refresh, meter: mtr, bar, fill, row });
  });

  $('ruler').addEventListener('click', e => cueTo(beatFromX(e.clientX)));
}

const fmtDb = db => `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;

function moduleGains() {
  const anySolo = state.plan.some(p => p.solo);
  const g = new Array(MAX_MODULES).fill(0);
  state.plan.forEach((p, i) => {
    g[i] = p.mute || (anySolo && !p.solo) ? 0 : dbamp(p.gainDb);
  });
  return g;
}

function pushGains() {
  const g = moduleGains();
  engine.setGains(g);
  rows.forEach((r, i) => r.row.classList.toggle('is-silent', g[i] === 0));
}

// ---- Timeline lanes -----------------------------------------------------------

let totalBeats = 1;

function layoutLanes() {
  totalBeats = Math.max(1, seq.endBeat());
  state.plan.forEach((p, i) => {
    const m = model.modules[i];
    rows[i].bar.style.left = `${(p.start / totalBeats) * 100}%`;
    rows[i].bar.style.width = `${Math.max(0.2, ((m.cellBeats * p.reps) / totalBeats) * 100)}%`;
  });

  // Minute marks on the ruler, at the current tempo.
  const ruler = $('ruler');
  ruler.replaceChildren();
  const secs = totalBeats / state.tempo;
  const step = secs > 900 ? 120 : secs > 360 ? 60 : 30;
  for (let s = 0; s <= secs; s += step) {
    ruler.append(el('span', { style: `left:${((s * state.tempo) / totalBeats) * 100}%` }, formatTime(s)));
  }
  placeLine($('cue'), cueBeat);
}

function laneBox() {
  return $('ruler').getBoundingClientRect();
}

function beatFromX(clientX) {
  const box = laneBox();
  return ((clientX - box.left) / box.width) * totalBeats;
}

function placeLine(node, beat) {
  const box = laneBox();
  const table = $('table').getBoundingClientRect();
  node.style.left = `${box.left - table.left + (Math.min(beat, totalBeats) / totalBeats) * box.width}px`;
}

// ---- Per-frame updates ----------------------------------------------------------

function frame() {
  const now = performance.now();
  const beat = seq.beat;

  model.modules.forEach((m, i) => {
    rows[i].meter.update(levels[i] || 0, now);
    const p = state.plan[i];
    const span = m.cellBeats * p.reps;
    const f = span > 0 ? Math.min(1, Math.max(0, (beat - p.start) / span)) : 0;
    rows[i].fill.style.width = `${(f * 100).toFixed(2)}%`;
  });
  masterMeters[0].update(levels[MAX_MODULES] || 0, now);
  masterMeters[1].update(levels[MAX_MODULES + 1] || 0, now);

  if (seq.playing) placeLine($('playhead'), beat);
  placeLine($('cue'), cueBeat);

  $('clock-time').textContent = formatTime(beat / state.tempo);
  $('clock-sub').textContent = `of ${formatTime(totalBeats / state.tempo)} · beat ${beat.toFixed(1)}`;

  requestAnimationFrame(frame);
}

function vizFrame() {
  const now = engine.now();
  while (notes.length && notes[0].end < now - 8) notes.shift();
  return {
    now,
    playing: seq.playing,
    beat: seq.beat,
    tempo: seq.tempo,
    notes,
    gains: moduleGains(),
    instruments: [...new Set(state.plan.map(p => p.instrument))],
    colorFor,
    range: pitchRange(),
  };
}

// Lowest and highest notes the current plan can play, octaves included.
function pitchRange() {
  let lo = Infinity;
  let hi = -Infinity;
  model.modules.forEach((m, i) => {
    const shift = 12 * (state.plan[i].octave || 0);
    for (const e of m.cell) {
      if (e.rest) continue;
      for (const n of [].concat(e.midinote)) {
        lo = Math.min(lo, n + shift);
        hi = Math.max(hi, n + shift);
      }
    }
  });
  return [lo, hi];
}

// Notes that were scheduled but got cancelled by Stop/Pause/cue.
function dropUnplayedNotes() {
  const now = engine.now();
  for (let i = notes.length - 1; i >= 0; i--) if (notes[i].time > now) notes.splice(i, 1);
}

// ---- Status + URL -------------------------------------------------------------

function showStatus(msg, isError = false, actionLabel, action) {
  const box = $('status');
  box.hidden = !msg;
  box.classList.toggle('error', isError);
  box.textContent = msg;
  if (actionLabel) box.append(el('button', { class: 'btn', onclick: action }, actionLabel));
}

let hashTimer = null;
function saveHash(now = false) {
  clearTimeout(hashTimer);
  const write = () => history.replaceState(null, '', `#${encodeState(state)}`);
  if (now) write();
  else hashTimer = setTimeout(write, 300);
}
