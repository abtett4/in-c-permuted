// Semi-random permutations of the score.
//
// "Score" values come from the .scd: the instrument each Pbind names, its
// [a, b].choose repeat counts times its Ppar count, and its Ptpar entry beat.
// A permutation rolls those choices again and, depending on the knobs, also
// spreads the repeat counts, swaps instruments, varies levels and lets
// players drift in early or late, as in Riley's performance directions.

export const DEFAULT_KNOBS = {
  spread: 0.25,     // repeats can move this fraction beyond the score's choices
  shuffle: 0.35,    // chance a module gets a different instrument
  variance: 4,      // ± dB
  drift: 2,         // ± beats on each entry
  octaves: 1,       // how many octaves a module may be transposed
  pan: 0.6,         // how far from centre a module may be panned (0..1)
};

// "It is OK to transpose patterns by an octave, especially to transpose up.
// Transposing down by octaves works best on the patterns containing notes of
// long durations." A module counts as long-noted if it holds a dotted quarter
// (3/8 in the .scd's whole-note units) or longer.
const LONG_NOTE = 3 / 8;
const OCTAVE_WEIGHTS = { stay: 3, up: 2, down: 1 };
const LOWEST = 24;    // C1
const HIGHEST = 108;  // C8

export function canTransposeDown(m) {
  return m.cell.some(e => !e.rest && e.dur >= LONG_NOTE);
}

// The octave shifts allowed for this module, within `range` octaves and
// keeping every note between C1 and C8. Riley's "down only for long notes"
// rule applies unless `rileyRule` is false (the hand-set per-module control).
export function allowedOctaves(m, range, { rileyRule = true } = {}) {
  const notes = m.cell.filter(e => !e.rest).flatMap(e => [].concat(e.midinote));
  const lo = Math.min(...notes);
  const hi = Math.max(...notes);
  const out = [];
  for (let o = -range; o <= range; o++) {
    if (rileyRule && o < 0 && !canTransposeDown(m)) continue;
    if (lo + 12 * o < LOWEST || hi + 12 * o > HIGHEST) continue;
    out.push(o);
  }
  return out.length ? out : [0];
}

export function pickOctave(m, range, rand) {
  const options = allowedOctaves(m, Math.round(range));
  const weights = options.map(o => (o === 0 ? OCTAVE_WEIGHTS.stay : o > 0 ? OCTAVE_WEIGHTS.up : OCTAVE_WEIGHTS.down));
  let r = rand() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < options.length; i++) {
    r -= weights[i];
    if (r < 0) return options[i];
  }
  return 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() {
  return Math.floor(Math.random() * 1e6);
}

const pick = (rand, list) => list[Math.floor(rand() * list.length)];
const finiteOr = (n, fallback) => (Number.isFinite(n) ? n : fallback);   // the Riley pulse repeats forever

// Riley mode: each player's instrument, picked from the .scd's [\a, \b].choose
// list, and a pan. Pans are spread evenly from -spread to +spread and handed
// out in a random order, so players never bunch up in one spot (which is
// what made unisons sound crowded when pan belonged to the module).
export function rileyPlayers(n, pool, seed, spread = DEFAULT_KNOBS.pan) {
  const rand = mulberry32(seed ^ 0x5eed);
  const players = Array.from({ length: n }, () => ({ instrument: pick(rand, pool) }));
  playerPans(n, spread, rand).forEach((pan, i) => { players[i].pan = pan; });
  return players;
}

// Riley mode, a player set to "vary": the octave it plays module `row` in.
// Picked by the same rule as module octaves (up favoured; down only for
// modules with long notes; within `range`), and fixed by the seed, the player
// and the module, so a seed still reproduces a performance.
export function playerOctave(m, range, seed, player, row) {
  const rand = mulberry32((Math.imul(seed, 7919) + Math.imul(player + 1, 104729) + Math.imul(row + 1, 31337)) >>> 0);
  rand(); rand();   // let the generator move off its starting point
  return pickOctave(m, range, rand);
}

export function playerPans(n, spread, rand) {
  const pans = Array.from({ length: n }, (_, k) => (n > 1 ? -spread + (2 * spread * k) / (n - 1) : 0));
  for (let i = pans.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pans[i], pans[j]] = [pans[j], pans[i]];
  }
  return pans.map(p => Math.round(p * 20) / 20);
}

// The piece exactly as written (the .choose calls still roll, seeded).
export function scorePlan(modules, seed) {
  const rand = mulberry32(seed);
  return modules.map(m => ({
    instrument: m.instrument,
    reps: finiteOr(pick(rand, m.seqChoices) * pick(rand, m.pparChoices), 1),
    gainDb: 0,
    start: m.start,
    octave: 0,
    pan: 0,
    mute: false,
    solo: false,
  }));
}

export function permuteModule(m, instruments, knobs, rand) {
  const base = pick(rand, m.seqChoices) * pick(rand, m.pparChoices);
  const factor = 1 + (rand() * 2 - 1) * knobs.spread;
  const instrument = rand() < knobs.shuffle && instruments.length
    ? pick(rand, instruments)
    : m.instrument;
  const gainDb = Math.round((rand() * 2 - 1) * knobs.variance * 2) / 2;
  // The pulse (anything entering on beat 0) keeps its place.
  const start = m.start === 0
    ? 0
    : Math.max(0, Math.round((m.start + (rand() * 2 - 1) * knobs.drift) * 8) / 8);
  const octave = pickOctave(m, knobs.octaves ?? 0, rand);
  // The pulse stays centred. (Not "enters on beat 0": in Riley mode every
  // module does.)
  const isPulse = m.isPulse || m.number === 0;
  const pan = isPulse ? 0 : Math.round((rand() * 2 - 1) * (knobs.pan ?? 0) * 20) / 20;
  return { instrument, reps: Math.max(1, Math.round(finiteOr(base, 1) * factor)), gainDb, start, octave, pan };
}

export function permutePlan(modules, instruments, knobs, seed) {
  const rand = mulberry32(seed);
  return modules.map(m => ({ ...permuteModule(m, instruments, knobs, rand), mute: false, solo: false }));
}

// ---- Sharing: the whole state fits in the URL hash -------------------------

export function encodeState(state) {
  const compact = {
    v: 4,
    mo: state.mode,
    r: state.riley ? [state.riley.minStay, state.riley.maxStay, state.riley.maxLead, state.riley.players.map(p => p.instrument), state.riley.entrySpread, state.riley.players.map(p => p.pan ?? 0), state.riley.players.map(p => p.oct ?? 0), state.riley.restChance, state.riley.restMin, state.riley.restMax] : null,
    s: state.seed,
    k: [state.knobs.spread, state.knobs.shuffle, state.knobs.variance, state.knobs.drift, state.knobs.octaves, state.knobs.pan],
    t: state.tempo,
    g: state.masterDb,
    m: state.plan.map(p => [p.instrument, p.reps, p.gainDb, p.start, (p.mute ? 1 : 0) | (p.solo ? 2 : 0), p.octave, p.pan]),
  };
  return btoa(JSON.stringify(compact)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeState(str, modules) {
  try {
    const json = JSON.parse(atob(str.replace(/-/g, '+').replace(/_/g, '/')));
    // Older links (before octaves, pan and Riley mode) still open: they were
    // all the arranged form, at octave 0 and centred.
    if (![1, 2, 3, 4].includes(json.v) || !Array.isArray(json.m) || json.m.length !== modules.length) return null;
    return {
      mode: json.mo ?? 'arranged',
      riley: json.r ? { minStay: json.r[0], maxStay: json.r[1], maxLead: json.r[2], players: json.r[3].map((instrument, i) => ({ instrument, pan: json.r[5]?.[i], oct: json.r[6]?.[i] ?? 0 })), entrySpread: json.r[4], restChance: json.r[7], restMin: json.r[8], restMax: json.r[9] } : null,
      seed: json.s,
      knobs: {
        spread: json.k[0], shuffle: json.k[1], variance: json.k[2], drift: json.k[3],
        octaves: json.k[4] ?? DEFAULT_KNOBS.octaves, pan: json.k[5] ?? DEFAULT_KNOBS.pan,
      },
      tempo: json.t,
      masterDb: json.g,
      plan: json.m.map(([instrument, reps, gainDb, start, flags, octave = 0, pan = 0]) => ({
        instrument, reps, gainDb, start, octave, pan, mute: !!(flags & 1), solo: !!(flags & 2),
      })),
    };
  } catch {
    return null;
  }
}
