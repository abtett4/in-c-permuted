import { parseScd } from './scd.js';
import { Engine, MAX_MODULES } from './engine.js';
import { Sequencer } from './sequencer.js';
import { RileySequencer } from './riley.js';
import {
  DEFAULT_KNOBS, scorePlan, permutePlan, permuteModule, allowedOctaves, rileyPlayers,
  randomSeed, mulberry32, encodeState, decodeState,
} from './permute.js';
import { knob, meter, cellPreview, colorFor, dbamp, el, formatTime } from './ui.js';
import { startViz } from './viz.js';
import { Recorder } from './recorder.js';
import { Audition, AUDITION_SLOT } from './audition.js';

// Two forms of the piece, each read from its own .scd:
//   riley:    players move through all 53 modules (the 2026 file's Riley mode)
//   arranged: the fixed Ptpar timeline of the 2019 arrangement
const FILES = { riley: 'sc/Tett_A_In_C_2026.scd', arranged: 'sc/Tett_A_In_C.scd' };
const SCORE_SEED = 1964;

const $ = id => document.getElementById(id);
const engine = new Engine();
const recorder = new Recorder(engine);
const audition = new Audition(engine);

let mode;             // 'riley' | 'arranged'
let model;            // parsed .scd
let modules;          // the rows: model.arranged or model.riley.modules
let instruments;      // SynthDef names offered in the dropdowns
let state;            // { mode, seed, knobs, tempo, masterDb, plan, riley }
let seq;
let cueBeat = 0;
const rows = [];
const notes = [];     // recent and upcoming notes, for the visualizer
let masterMeters;
let levels = new Float32Array(MAX_MODULES + 2);

init().catch(err => showStatus(err.message, true));

async function init() {
  // Links shared before Riley mode existed have no ?mode= but carry an
  // arranged-form state, so they still open the arranged form.
  const asked = new URLSearchParams(location.search).get('mode') ?? hashMode();
  mode = asked === 'arranged' ? 'arranged' : 'riley';
  $(`mode-${mode}`).setAttribute('aria-current', 'page');

  const res = await fetch(FILES[mode]);
  if (!res.ok) throw new Error(`Couldn't load ${FILES[mode]} (HTTP ${res.status}).`);
  model = parseScd(await res.text());
  model.warnings.forEach(w => console.warn(w));
  if (mode === 'riley' && !model.riley) throw new Error(`${FILES.riley} doesn't end with a Riley-mode Ppar(...).play.`);
  if (mode === 'arranged' && !model.arranged) throw new Error(`${FILES.arranged} doesn't end with a Ptpar(...).play.`);
  modules = mode === 'riley' ? model.riley.modules : model.arranged;
  if (!modules.length) throw new Error(`No modules found in ${FILES[mode]}.`);
  // The last mixer channel is kept for the Audition panel.
  if (modules.length > AUDITION_SLOT) throw new Error(`The mixer has room for ${AUDITION_SLOT} modules but the score has ${modules.length}.`);
  instruments = model.synthDefNames;

  const saved = location.hash.length > 1 ? decodeState(location.hash.slice(1), modules) : null;
  state = saved && saved.mode === mode ? { ...saved, mode } : {
    mode,
    seed: SCORE_SEED,
    knobs: { ...DEFAULT_KNOBS },
    tempo: model.tempo,
    masterDb: -3,
    plan: scorePlan(modules, SCORE_SEED),
    riley: null,
  };
  if (mode === 'riley' && !state.riley) state.riley = scoreRiley(SCORE_SEED);

  seq = mode === 'riley'
    ? new RileySequencer(engine, modules, () => state.plan, () => ({ ...state.riley, seed: state.seed }))
    : new Sequencer(engine, modules, () => state.plan);
  seq.tempo = state.tempo;
  seq.onNote = n => notes.push(n);
  seq.onEnd = () => { setPlaying(false); stopRecording(); };

  document.body.classList.toggle('is-riley', mode === 'riley');
  $('table').classList.toggle('is-riley', mode === 'riley');
  if (mode === 'riley') {
    $('perm-hint').textContent = 'A permutation hands each player a new SynthDef from the .scd’s list, and the knobs vary each module’s level, octave and pan. The seed also decides every player’s choices, so the same seed gives the same performance.';
    $('mod-hint').textContent = 'Dots show which module each player is on. Level, octave, pan, mute and solo apply to a module whoever is playing it.';
  }

  buildHeader();
  if (mode === 'riley') buildPlayers();
  buildAudition();
  buildPermutationPanel();
  buildRows();
  layoutLanes();
  bindTransport();

  const pitches = modules.flatMap(m => m.cell.filter(e => !e.rest).flatMap(e => [].concat(e.midinote)));
  startViz($('viz'), vizFrame, [Math.min(...pitches), Math.max(...pitches)]);

  engine.onLevels = vals => {
    levels = vals;
    audition.measure(vals[AUDITION_SLOT] || 0);
  };
  requestAnimationFrame(frame);

  $('play').disabled = false;
  $('rec').disabled = false;
  new ResizeObserver(layoutLanes).observe($('table'));

  // Handy for poking at things from the browser console.
  window.inC = { engine, seq, recorder, audition, model, modules, get state() { return state; } };
}

function hashMode() {
  try {
    const json = JSON.parse(atob(location.hash.slice(1).replace(/-/g, '+').replace(/_/g, '/')));
    return json.mo ?? 'arranged';
  } catch {
    return null;
  }
}

// Riley mode as the .scd writes it: its player count, stay and lead rules,
// and each player's SynthDef from its [\a, \b].choose list.
function scoreRiley(seed) {
  const r = model.riley;
  const pool = (r.pool || instruments).filter(n => instruments.includes(n));
  return {
    minStay: r.minStay,
    maxStay: r.maxStay,
    maxLead: r.maxLead,
    players: rileyPlayers(r.nPlayers, pool.length ? pool : instruments, seed),
  };
}

function rileyPool() {
  const pool = (model.riley.pool || instruments).filter(n => instruments.includes(n));
  return pool.length ? pool : instruments;
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
  $('rec').addEventListener('click', () => (recorder.recording ? stopRecording() : startRecording()));
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
    if (failed.length) showStatus(`Couldn't load SynthDef${failed.length > 1 ? 's' : ''}: ${failed.join(', ')}. Notes using ${failed.length > 1 ? 'them' : 'it'} will be silent.`, true);
    if (!loaded.length) throw new Error('No SynthDefs loaded.');
    engine.setMaster(dbamp(state.masterDb));
    engine.setLimiter($('limiter').checked);
    pushGains();
    pushPans();
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
  if (audition.active) await audition.stop();
  seq.setTempo(state.tempo);
  if (mode === 'riley') {
    if (seq.paused) seq.resume();
    else seq.play();
  } else {
    seq.play(cueBeat);
  }
  setPlaying(true);
}

// Pause keeps your place; Play carries on from there.
async function pause() {
  if (mode === 'riley') {
    await seq.pause();
  } else {
    cueBeat = snap(seq.beat);
    await seq.stop();
  }
  setPlaying(false);
}

async function stop() {
  await seq.stop();
  cueBeat = 0;
  setPlaying(false);
  if (recorder.recording) setTimeout(stopRecording, 2000);   // let the last notes ring out
}

function setPlaying(on) {
  if (!on) dropUnplayedNotes();
  const b = $('play');
  b.classList.toggle('is-playing', on);
  b.querySelector('span').textContent = on ? 'Pause' : 'Play';
  b.querySelector('svg').innerHTML = on
    ? '<rect x="3.5" y="2.5" width="3.2" height="11" rx="0.8"/><rect x="9.3" y="2.5" width="3.2" height="11" rx="0.8"/>'
    : '<path d="M4 2.5v11l9-5.5z"/>';
  $('stop').disabled = !on && cueBeat === 0 && !(mode === 'riley' && seq.paused);
  $('playhead').hidden = !on;
  if (!on && mode === 'arranged') seq.anchorBeat = cueBeat;
}

async function cueTo(beat) {
  if (mode === 'riley') return;   // where players are depends on everything before
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

// ---- Recording ----------------------------------------------------------------

async function startRecording() {
  if (!(await ensureEngine())) return;
  try {
    await recorder.start();
  } catch (err) {
    showStatus(`Couldn't start recording: ${err.message}`, true);
    return;
  }
  $('rec').classList.add('is-recording');
  if (!seq.playing) play();
}

async function stopRecording() {
  if (!recorder.recording) return;
  const blob = await recorder.stop();
  const b = $('rec');
  b.classList.remove('is-recording');
  b.querySelector('span').textContent = 'Record';
  if (!blob) return;
  const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
  const label = mode === 'riley' ? 'Riley mode' : 'arranged';
  const a = el('a', { href: URL.createObjectURL(blob), download: `In C - ${label} - seed ${state.seed} - ${stamp}.wav` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

// ---- Players (Riley mode) -------------------------------------------------------

const playerChips = [];
const knobsByKey = {};

function buildPlayers() {
  $('players-section').hidden = false;
  const r = state.riley;
  const defs = [
    ['count', 'Players', 1, 24, 1, v => String(v), 'How many players. Takes effect the next time the piece starts from the beginning.'],
    ['minStay', 'Shortest stay', 5, 180, 5, v => `${v} s`, 'The least time a player spends on a module (rrand’s first number in the .scd).'],
    ['maxStay', 'Longest stay', 5, 240, 5, v => `${v} s`, 'The most time a player spends on a module (rrand’s second number).'],
    ['maxLead', 'Max lead', 1, 8, 1, v => `${v} mod`, 'How many modules ahead of the slowest player someone may get before waiting. Riley: “stay within 2 or 3 patterns of each other.”'],
  ];
  for (const [key, label, min, max, step, format, title] of defs) {
    const value = key === 'count' ? r.players.length : r[key];
    const k = knob({
      label, min, max, step, value, format, title: `${title} Drag, scroll or use arrow keys; double-click to reset.`,
      onInput: v => {
        if (key === 'count') setPlayerCount(v);
        else {
          r[key] = v;
          if (key === 'minStay' && r.maxStay < v) { r.maxStay = v; knobsByKey.maxStay.set(v, false); }
          if (key === 'maxStay' && r.minStay > v) { r.minStay = v; knobsByKey.minStay.set(v, false); }
        }
        saveHash();
      },
    });
    knobsByKey[key] = k;
    $('players-knobs').append(k.el);
  }
  renderPlayers();
}

function setPlayerCount(n) {
  const players = state.riley.players;
  if (n < players.length) players.length = n;
  const extra = rileyPlayers(n, rileyPool(), state.seed + n);
  while (players.length < n) players.push(extra[players.length]);
  renderPlayers();
}

function renderPlayers() {
  const grid = $('player-grid');
  grid.replaceChildren();
  playerChips.length = 0;
  state.riley.players.forEach((pl, p) => {
    const select = el('select', { class: 'inst', 'aria-label': `SynthDef for player ${p + 1}` });
    for (const name of instruments) select.append(el('option', { value: name }, name));
    select.value = pl.instrument;
    const where = el('span', { class: 'where' }, '–');
    const chip = el('div', { class: 'player' }, el('b', {}, `P${p + 1}`), select, where);
    chip.style.setProperty('--c', colorFor(pl.instrument));
    select.addEventListener('change', () => {
      pl.instrument = select.value;
      chip.style.setProperty('--c', colorFor(pl.instrument));
      saveHash();
    });
    grid.append(chip);
    playerChips.push({ chip, where, select });
  });
  if (knobsByKey.count) knobsByKey.count.set(state.riley.players.length, false);
}

// ---- Audition -------------------------------------------------------------------

const audCards = {};

function buildAudition() {
  const select = $('aud-module');
  modules.forEach((m, i) => {
    select.append(el('option', { value: i }, m.isPulse || m.number === 0 ? 'Pulse' : `Module ${m.label}`));
  });
  select.value = modules.findIndex(m => !m.isPulse && m.number !== 0);

  for (const name of instruments) {
    const play = el('button', { class: 'mini', type: 'button', 'aria-label': `Audition ${name}`, title: `Play the module with ${name}` });
    play.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg>';
    play.addEventListener('click', () => startAudition([name]));
    const peak = el('span', { class: 'peak' }, '—');
    const tags = el('div', { class: 'tags' });
    const card = el('div', { class: 'aud-card' }, play, el('span', { class: 'name' }, name), peak, tags);
    card.style.setProperty('--c', colorFor(name));
    $('aud-grid').append(card);
    audCards[name] = { card, peak, tags, tagKey: '' };
  }

  $('aud-all').addEventListener('click', () => startAudition(instruments));
  $('aud-stop').addEventListener('click', () => audition.stop());
}

async function startAudition(list) {
  if (!(await ensureEngine())) return;
  if (seq.playing) await pause();
  const i = Number($('aud-module').value);
  await audition.stop();
  audition.play({
    module: modules[i],
    instruments: list,
    passes: Number($('aud-passes').value),
    octave: state.plan[i].octave,
    tempo: state.tempo,
  });
}

// What's worth knowing when deciding whether a SynthDef earns its place:
// who uses it, and whether it ignores pitch or holds notes until released.
function auditionTags(name) {
  const out = [];
  if (mode === 'riley') {
    const who = state.riley.players.map((p, i) => (p.instrument === name ? `P${i + 1}` : null)).filter(Boolean);
    out.push(who.length ? [`players ${who.join(', ')}`] : ['no players', 'warn']);
  } else {
    const used = state.plan.map((p, i) => (p.instrument === name ? modules[i].label : null)).filter(Boolean);
    out.push(used.length ? [`modules ${used.join(', ')}`] : ['unused', 'warn']);
  }
  const def = engine.defs[name];
  if (def) {
    if (!def.controls.has('freq') && !def.controls.has('midinote')) out.push(['ignores pitch', 'warn']);
    if (def.controls.has('gate')) out.push(['held until released']);
  }
  return out;
}

function frameAudition() {
  const playing = audition.current();
  for (const name of instruments) {
    const c = audCards[name];
    c.card.classList.toggle('is-playing', name === playing);
    const amp = audition.peaks[name];
    if (amp != null) {
      const db = amp > 0 ? 20 * Math.log10(amp) : -Infinity;
      c.peak.textContent = db > -90 ? `peak ${db.toFixed(1)} dB` : 'silent';
      c.peak.classList.toggle('hot', db > -1);
    }
    const tags = auditionTags(name);
    const key = JSON.stringify(tags);
    if (key !== c.tagKey) {
      c.tagKey = key;
      c.tags.replaceChildren(...tags.map(([text, cls]) => el('span', cls ? { class: cls } : {}, text)));
    }
  }
  $('aud-stop').disabled = !audition.active;
}

// ---- Permutation panel ------------------------------------------------------

const permKnobs = {};

function buildPermutationPanel() {
  const defs = [
    ['spread', 'Repeat spread', 0, 1, 0.01, v => `±${Math.round(v * 100)}%`, 'How far repeat counts may stray from the score’s [a, b] choices.'],
    ['shuffle', 'Instrument swap', 0, 1, 0.01, v => `${Math.round(v * 100)}%`, 'Chance that a module is handed to a different SynthDef.'],
    ['variance', 'Level variance', 0, 12, 0.5, v => `±${v.toFixed(1)} dB`, 'How much module levels may vary.'],
    ['drift', 'Entry drift', 0, 8, 0.25, v => `±${v.toFixed(2)} b`, 'How many beats early or late a module may enter.'],
    ['octaves', 'Octave range', 0, 2, 1, v => (v === 0 ? 'off' : `±${v} oct`), 'How many octaves a module may be transposed. Following Riley, up is favored, and only modules with long notes (a dotted quarter or longer) may go down.'],
    ['pan', 'Pan spread', 0, 1, 0.05, v => (v === 0 ? 'centre' : `±${Math.round(v * 100)}`), 'How far from centre modules may be panned. The pulse stays centred.'],
  ];
  // Riley mode has no fixed repeat counts, per-module SynthDefs or entry times.
  const rileySkips = ['spread', 'shuffle', 'drift'];
  for (const [key, label, min, max, step, format, title] of defs) {
    if (mode === 'riley' && rileySkips.includes(key)) continue;
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
    applyPermutation(s);
  });
  $('permute').addEventListener('click', () => applyPermutation(randomSeed()));
  $('reset').addEventListener('click', () => {
    applyPlan(SCORE_SEED, scorePlan(modules, SCORE_SEED), mode === 'riley' ? scoreRiley(SCORE_SEED) : null);
  });
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

function applyPermutation(seed) {
  const plan = permutePlan(modules, instruments, state.knobs, seed);
  let riley = null;
  if (mode === 'riley') {
    riley = { ...state.riley, players: rileyPlayers(state.riley.players.length, rileyPool(), seed) };
    // Players bring their own SynthDefs; the rows keep theirs (the pulse's matters).
    plan.forEach((p, i) => { p.instrument = state.plan[i].instrument; });
  }
  applyPlan(seed, plan, riley);
}

function applyPlan(seed, plan, riley) {
  state.seed = seed;
  state.plan = plan;
  if (riley) {
    state.riley = riley;
    renderPlayers();
    for (const key of ['minStay', 'maxStay', 'maxLead']) knobsByKey[key]?.set(riley[key], false);
  }
  seedInput.value = seed;
  rows.forEach((r, i) => { r.refresh(); seq.resync(i); });
  pushGains();
  pushPans();
  layoutLanes();
  saveHash();
}

// ---- Module rows ------------------------------------------------------------

function buildRows() {
  const container = $('rows');
  modules.forEach((m, i) => {
    const p = () => state.plan[i];

    const num = el('div', { class: `num${m.number === 0 ? ' is-pulse' : ''}`, title: `${m.name} in the .scd` }, m.label);
    const cell = cellPreview(m);
    const pick = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    pick.textContent = 'Audition this module with each SynthDef';
    cell.append(pick);
    cell.addEventListener('click', () => {
      $('aud-module').value = i;
      $('aud-module').closest('section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

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

    const panKnob = knob({
      label: `Pan for module ${m.label}`, min: -1, max: 1, step: 0.05, value: 0, mini: true, bipolar: true,
      format: fmtPan,
      onInput: v => { p().pan = v; pushPans(); saveHash(); },
    });

    const mtr = meter({ label: `Module ${m.label} level` });

    const mute = el('button', { class: 'mini m', type: 'button', 'aria-pressed': 'false', title: 'Mute' }, 'M');
    const solo = el('button', { class: 'mini s', type: 'button', 'aria-pressed': 'false', title: 'Solo' }, 'S');
    const dice = el('button', { class: 'mini', type: 'button', title: 'Re-roll just this module' });
    dice.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="5.5" cy="5.5" r="1.2"/><circle cx="10.5" cy="10.5" r="1.2"/><circle cx="8" cy="8" r="1.2"/></svg>';
    dice.setAttribute('aria-label', `Re-roll module ${m.label}`);
    mute.addEventListener('click', () => { p().mute = !p().mute; refresh(); pushGains(); saveHash(); });
    solo.addEventListener('click', () => { p().solo = !p().solo; refresh(); pushGains(); saveHash(); });
    dice.addEventListener('click', () => {
      const rolled = permuteModule(m, instruments, state.knobs, mulberry32(randomSeed()));
      // Riley mode keeps the module's SynthDef (players choose their own).
      if (mode === 'riley') rolled.instrument = p().instrument;
      Object.assign(p(), rolled);
      refresh();
      seq.resync(i);
      pushGains();
      pushPans();
      layoutLanes();
      saveHash();
    });

    const fill = el('div', { class: 'lane-fill' });
    const bar = el('div', { class: 'lane-bar' }, fill);
    const dots = el('div', { class: 'lane-players' });
    const lane = el('div', { class: 'lane', title: mode === 'riley' ? '' : 'Click to start playback here' }, bar, dots);
    lane.addEventListener('click', e => cueTo(beatFromX(e.clientX)));

    const row = el('div', { class: 'row' }, num, cell, select, octSelect, reps, vol, panKnob.el,
      el('div', { class: 'meter-cell' }, mtr.el), el('div', { class: 'btns' }, mute, solo, dice), lane);
    container.append(row);

    function refresh() {
      const q = p();
      if (!instruments.includes(q.instrument)) q.instrument = instruments[0];
      row.style.setProperty('--c', colorFor(q.instrument));
      select.value = q.instrument;
      q.octave ??= 0;
      octSelect.value = q.octave;
      q.pan ??= 0;
      panKnob.set(q.pan, false);
      repsInput.value = q.reps;
      slider.value = q.gainDb;
      out.textContent = fmtDb(q.gainDb);
      mute.setAttribute('aria-pressed', String(q.mute));
      solo.setAttribute('aria-pressed', String(q.solo));
    }
    refresh();
    rows.push({ refresh, meter: mtr, bar, fill, row, dots, dotsKey: '' });
  });

  $('ruler').addEventListener('click', e => cueTo(beatFromX(e.clientX)));
}

const fmtDb = db => `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
const fmtPan = v => (Math.abs(v) < 0.025 ? 'centre' : `${v < 0 ? 'L' : 'R'} ${Math.round(Math.abs(v) * 100)}`);

function pushPans() {
  const pans = new Array(MAX_MODULES).fill(0);
  state.plan.forEach((p, i) => { pans[i] = p.pan || 0; });
  engine.setPans(pans);
}

function moduleGains() {
  const anySolo = state.plan.some(p => p.solo);
  const g = new Array(MAX_MODULES).fill(0);
  state.plan.forEach((p, i) => {
    g[i] = p.mute || (anySolo && !p.solo) ? 0 : dbamp(p.gainDb);
  });
  g[AUDITION_SLOT] = 1;
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
  const ruler = $('ruler');
  ruler.replaceChildren();
  if (mode === 'riley') {
    ruler.append(el('span', { style: 'left:0;transform:none' }, 'Players'));
    return;
  }
  totalBeats = Math.max(1, seq.endBeat());
  state.plan.forEach((p, i) => {
    const m = modules[i];
    rows[i].bar.style.left = `${(p.start / totalBeats) * 100}%`;
    rows[i].bar.style.width = `${Math.max(0.2, ((m.cellBeats * p.reps) / totalBeats) * 100)}%`;
  });

  // Minute marks on the ruler, at the current tempo.
  const secs = totalBeats / state.tempo;
  const px = ruler.getBoundingClientRect().width || 1;
  const step = [15, 30, 60, 120, 300, 600].find(s => (s / secs) * px >= 44) ?? 600;
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

  modules.forEach((m, i) => rows[i].meter.update(levels[i] || 0, now));
  masterMeters[0].update(levels[MAX_MODULES] || 0, now);
  masterMeters[1].update(levels[MAX_MODULES + 1] || 0, now);

  if (recorder.recording) {
    const mb = (recorder.frames * 4) / 1e6;
    $('rec').querySelector('span').textContent = `${formatTime(recorder.seconds)} · ${mb.toFixed(0)} MB`;
  }

  frameAudition();

  if (mode === 'riley') {
    frameRiley(beat);
  } else {
    modules.forEach((m, i) => {
      const p = state.plan[i];
      const span = m.cellBeats * p.reps;
      const f = span > 0 ? Math.min(1, Math.max(0, (beat - p.start) / span)) : 0;
      rows[i].fill.style.width = `${(f * 100).toFixed(2)}%`;
    });
    if (seq.playing) placeLine($('playhead'), beat);
    placeLine($('cue'), cueBeat);
    $('clock-time').textContent = formatTime(beat / state.tempo);
    $('clock-sub').textContent = `of ${formatTime(totalBeats / state.tempo)} · beat ${beat.toFixed(1)}`;
  }

  requestAnimationFrame(frame);
}

// Riley mode: where each player is, as dots on the module rows and in the
// player panel.
function frameRiley(beat) {
  const where = seq.playerRows();
  const byRow = new Map();
  where.forEach((row, p) => {
    if (row == null) return;
    if (!byRow.has(row)) byRow.set(row, []);
    byRow.get(row).push(p);
  });
  rows.forEach((r, i) => {
    const players = byRow.get(i) || [];
    const key = players.map(p => `${p}:${state.riley.players[p]?.instrument}`).join(',');
    if (key === r.dotsKey) return;
    r.dotsKey = key;
    r.dots.replaceChildren(...players.map(p => {
      const inst = state.riley.players[p]?.instrument;
      const dot = el('i', { title: `Player ${p + 1} (${inst})` });
      dot.style.setProperty('--pc', colorFor(inst));
      return dot;
    }));
  });

  playerChips.forEach((c, p) => {
    const row = where[p];
    const started = where.length > 0;
    c.where.textContent = !started ? '–' : row == null ? 'done' : `on ${modules[row].label}`;
    c.chip.classList.toggle('is-done', started && row == null);
  });

  $('clock-time').textContent = formatTime(beat / state.tempo);
  const active = where.filter(r => r != null).map(r => Number(modules[r].label));
  const lo = Math.min(...active);
  const hi = Math.max(...active);
  $('clock-sub').textContent = !where.length ? 'Riley mode'
    : !active.length ? 'all players done'
    : lo === hi ? `everyone on module ${lo}` : `modules ${lo}–${hi}`;
}

function vizFrame() {
  const now = engine.now();
  while (notes.length && notes[0].end < now - 8) notes.shift();
  const shown = mode === 'riley'
    ? [state.plan[modules.findIndex(m => m.isPulse)]?.instrument, ...state.riley.players.map(p => p.instrument)].filter(Boolean)
    : state.plan.map(p => p.instrument);
  return {
    now,
    playing: seq.playing,
    beat: seq.beat,
    tempo: seq.tempo,
    notes,
    gains: moduleGains(),
    instruments: [...new Set(shown)],
    colorFor,
    range: pitchRange(),
  };
}

// Lowest and highest notes the current plan can play, octaves included.
function pitchRange() {
  let lo = Infinity;
  let hi = -Infinity;
  modules.forEach((m, i) => {
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
  const write = () => history.replaceState(null, '', `${location.pathname}?mode=${mode}#${encodeState(state)}`);
  if (now) write();
  else hashTimer = setTimeout(write, 300);
}
