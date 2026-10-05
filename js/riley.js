// Riley mode: the player logic from Tett_A_In_C_2026.scd, in JavaScript.
//
// Players enter one at a time, in random order, spread over the first
// entrySpread seconds and aligned to the eighth-note pulse, so module 1 builds
// up as a canon. Each then works through the modules in order.
// On reaching a module a player decides to stay for minStay..maxStay seconds
// (as a number of passes through the cell); before each further pass it keeps
// going if it still has passes left, if it is maxLead or more modules ahead of
// the slowest player who has come in, or if it is on the last module and
// someone hasn't arrived yet. Between modules a player sometimes rests
// (restChance, for restRange seconds, back in on the pulse) as long as at least
// half the group keeps playing. Once everyone is on 53 they play it together
// for endHold seconds, then drop out one at a time over endSpread seconds. A
// player arriving where someone is already playing sometimes listens for a pass
// or so and joins them in step (joinChance, joinMax). The
// pulse plays until every player has finished.
//
// Notes are scheduled ahead of time like the arranged sequencer, but always in
// strict time order across all players (as SuperCollider's scheduler does), so
// the "who is ahead" checks happen in the same order and a seed reproduces a
// performance exactly (as long as nothing is changed while it plays).
//
// Every setting can change while the piece runs: the number of players,
// their stays, the entries, the lead limit and the tempo.

import { mulberry32, playerOctave } from './permute.js';
import { makeTicker } from './sequencer.js';
import { transposition } from './registers.js';

const LOOKAHEAD = 0.4;
const TICK_MS = 40;

const toEighth = beat => Math.round(beat * 8) / 8;
const nextEighth = beat => Math.ceil(beat * 8 - 1e-9) / 8;

// When each player comes in, in beats: evenly spaced from 0 to `spread`, in a
// random order, rounded to the eighth-note pulse (1/8 in the .scd's units).
// The same rule as the `entries` line in the .scd (the random order differs:
// SuperCollider shuffles with its own generator). Returns each player's slot
// (0 = first in) so entries can be re-spaced later.
export function entrySlots(n, rand) {
  const slots = Array.from({ length: n }, (_, k) => k);
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  return slots;
}

export class RileySequencer {
  // modules: [pulse?, module 1, ..., module 53] (rows on the page)
  // getPlan(): per-row settings (octave etc.); getRiley(): { players: [{ instrument }],
  //   minStay, maxStay, maxLead, entrySpread, seed }
  constructor(engine, modules, getPlan, getRiley) {
    this.engine = engine;
    this.modules = modules;
    this.pulseIndex = modules.findIndex(m => m.isPulse);
    this.order = modules.map((m, i) => i).filter(i => !modules[i].isPulse);
    this.getPlan = getPlan;
    this.getRiley = getRiley;
    this.tempo = 1;
    this.playing = false;
    this.voices = [];         // players, then the pulse
    this.anchorBeat = 0;      // beat <-> time mapping (moves when the tempo changes)
    this.anchorTime = 0;
    this.horizonTime = 0;     // how far ahead notes have been sent
    this.secBase = 0;         // elapsed seconds, independent of tempo changes
    this.secStart = 0;
    this.onNote = null;
    this.onEnd = null;
    this.timer = makeTicker(() => this.tick(), TICK_MS);
  }

  // Until a tempo change takes over (anchorTime), the previous tempo still
  // applies, so the beat never jumps.
  beatAt(time) {
    const a = this.prev && time < this.anchorTime ? this.prev : this;
    return a.anchorBeat + (time - a.anchorTime) * a.tempo;
  }
  timeAt(beat) {
    const a = this.prev && beat < this.anchorBeat ? this.prev : this;
    return a.anchorTime + (beat - a.anchorBeat) / a.tempo;
  }
  get beat() { return this.playing ? Math.max(0, this.beatAt(this.engine.now())) : this.anchorBeat; }

  // Seconds of the performance so far (pauses excluded).
  get seconds() {
    return this.playing ? Math.max(0, this.secBase + this.engine.now() - this.secStart) : this.secBase;
  }

  get players() { return this.voices.filter(v => !v.isPulse); }

  // A new tempo takes over right after the notes already sent ahead, so the
  // change is seamless.
  setTempo(tempo) {
    if (this.playing) {
      const t = Math.max(this.engine.now(), this.horizonTime);
      const beat = this.beatAt(t);
      this.prev = { anchorBeat: this.anchorBeat, anchorTime: this.anchorTime, tempo: this.tempo };
      this.anchorBeat = beat;
      this.anchorTime = t;
    } else {
      this.prev = null;
    }
    this.tempo = tempo;
  }

  // Which module row each player is on, for the page: null once finished,
  // -1 while still waiting to come in.
  playerRows() {
    const beat = this.beat;
    return this.players.map(v => (v.done ? null : v.entry > beat ? -1 : this.order[v.i]));
  }

  // Which players are silent right now: 'resting' between modules, or
  // 'listening' before joining someone in step; null when playing.
  playerIdle() {
    const beat = this.beat;
    return this.players.map(v => (v.done || v.beat <= beat ? null : v.resting ? 'resting' : v.listening ? 'listening' : null));
  }

  // Riley mode always starts from the beginning: where players are depends on
  // everything that happened before.
  play() {
    const r = this.getRiley();
    this.rand = mulberry32(r.seed);
    const slots = entrySlots(r.players.length, this.rand);
    this.voices = r.players.map((pl, p) => this.newVoice(p, 0, 0, slots[p]));
    if (this.pulseIndex >= 0) this.voices.push({ isPulse: true, beat: 0, done: false });
    this.spreadEntries(r);
    this.endAt = null;
    this.dropOrder = null;
    this.prev = null;
    this.anchorBeat = 0;
    this.anchorTime = this.engine.now() + 0.1;
    this.horizonTime = this.anchorTime;
    this.secBase = 0;
    this.secStart = this.anchorTime;
    this.lastBeat = 0;
    this.playing = true;
    this.timer.start();
    this.tick();
  }

  newVoice(p, i, beat, slot) {
    // i: index into the module order; pos: the module it counts as being on
    // for the lead rule (Infinity until it has come in, so players who haven't
    // entered yet don't hold anyone back); passes: how many times it has
    // played this module.
    return { p, i, pos: Infinity, reps: null, passes: 0, ev: 0, beat, entry: beat, slot, done: false };
  }

  // Places the entries of players who haven't come in yet, evenly over
  // entrySpread seconds by their slot (never earlier than now).
  spreadEntries(r) {
    const waiting = this.players.filter(v => v.ev === 0 && v.reps === null && v.i === 0 && !v.started);
    const n = this.players.length;
    const spread = (r.entrySpread || 0) * this.tempo;
    const earliest = this.playing ? nextEighth(this.beatAt(this.horizonTime)) : 0;
    for (const v of waiting) {
      const at = toEighth(n > 1 ? (v.slot * spread) / (n - 1) : 0);
      v.entry = v.beat = Math.max(at, earliest);
    }
  }

  get paused() { return !this.playing && this.voices.some(v => !v.done); }

  // Pausing drops the notes already sent ahead, so the fraction of a second
  // after Pause is skipped when Play resumes.
  pause() {
    // Pausing drops scheduled panner re-routes too; re-route on resume.
    for (const v of this.players) v.routed = null;
    this.secBase = this.seconds;
    this.anchorBeat = this.beat;
    this.playing = false;
    this.timer.stop();
    return this.engine.stopAll();
  }

  resume() {
    this.prev = null;
    this.anchorTime = this.engine.now() + 0.1;
    this.horizonTime = this.anchorTime;
    this.secStart = this.anchorTime;
    this.playing = true;
    this.timer.start();
    this.tick();
  }

  async stop() {
    this.playing = false;
    this.timer.stop();
    this.voices = [];
    this.anchorBeat = 0;
    this.secBase = 0;
    await this.engine.stopAll();
  }

  // ---- Live changes ----------------------------------------------------------

  // The player list in getRiley() grew or shrank. New players join on the
  // slowest player's module at the next eighth note (starting them on module 1
  // would hold everyone else back); removed players simply stop.
  setPlayerCount() {
    if (!this.voices.length) return;
    const r = this.getRiley();
    const n = r.players.length;
    const players = this.players;
    if (n < players.length) {
      const keep = new Set(players.slice(0, n));
      this.voices = this.voices.filter(v => v.isPulse || keep.has(v));
    } else {
      const active = players.filter(v => !v.done && v.pos !== Infinity);
      const slowest = active.length ? Math.min(...active.map(v => v.pos)) : 0;
      const at = this.playing ? nextEighth(this.beatAt(this.horizonTime)) : nextEighth(this.anchorBeat);
      const pulse = this.voices.find(v => v.isPulse);
      const added = [];
      for (let p = players.length; p < n; p++) {
        const v = this.newVoice(p, slowest, at, p);
        v.started = slowest > 0;
        added.push(v);
      }
      this.voices = [...players, ...added, ...(pulse ? [pulse] : [])];
      if (pulse && pulse.done) { pulse.done = false; pulse.beat = at; }
    }
  }

  // Shortest/longest stay changed: players re-roll how long they stay on the
  // module they're on now, counting the passes they've already played.
  restay() {
    const r = this.getRiley();
    for (const v of this.players) {
      if (v.done || v.reps === null) continue;
      const m = this.modules[this.order[v.i]];
      v.reps = Math.max(0, this.passesFor(m, r) - v.passes);
    }
  }

  // Entries changed: re-space the players who haven't come in yet.
  respread() {
    if (this.voices.length) this.spreadEntries(this.getRiley());
  }

  passesFor(m, r) {
    const seconds = r.minStay + this.rand() * Math.max(0, r.maxStay - r.minStay);
    return Math.max(1, Math.round((seconds * this.tempo) / m.cellBeats));
  }

  resync() {}

  endBeat() { return this.beat; }

  // ---- Scheduling --------------------------------------------------------------

  tick() {
    if (!this.playing) return;
    const now = this.engine.now();
    this.horizonTime = now + LOOKAHEAD;
    const horizon = this.beatAt(this.horizonTime);
    const plan = this.getPlan();
    const r = this.getRiley();

    for (;;) {
      // The voice with the earliest next event goes first.
      let next = null;
      for (const v of this.voices) if (!v.done && (!next || v.beat < next.beat)) next = v;
      if (!next || next.beat >= horizon) break;
      this.step(next, plan, r);
    }

    if (this.voices.every(v => v.done) && this.beatAt(now) > this.lastBeat + 4 * this.tempo) {
      this.playing = false;
      this.timer.stop();
      if (this.onEnd) this.onEnd();
    }
  }

  step(v, plan, r) {
    if (v.isPulse) {
      if (this.players.every(p => p.done)) { v.done = true; return; }
      const m = this.modules[this.pulseIndex];
      this.emit(this.pulseIndex, m.cell[0], v.beat, plan, plan[this.pulseIndex].instrument);
      v.beat += m.cell[0].dur;
      return;
    }

    // At the start of each pass through a cell, decide whether to play it.
    if (v.ev === 0 && !this.startPass(v, r)) return;
    v.started = true;

    const row = this.order[v.i];
    const m = this.modules[row];
    const e = m.cell[v.ev];
    const instrument = (r.players[v.p] || r.players[r.players.length - 1]).instrument;
    if (!e.rest && e.dur > 0) this.emit(row, e, v.beat, plan, instrument, v, this.octaveFor(v, row, r));
    v.beat += e.dur;
    v.ev = (v.ev + 1) % m.cell.length;
  }

  startPass(v, r) {
    const last = this.order.length - 1;
    for (;;) {
      const m = this.modules[this.order[v.i]];
      if (m.cellBeats <= 0) { v.reps = 0; }   // nothing to play: move straight on
      else if (v.reps === null && v.i > 0 && !v.restDone) {
        // Between modules, sometimes drop out to listen (still counted on the
        // last module for the lead rule), unless half the group already is.
        v.restDone = true;
        const resting = this.players.filter(p => p.resting && !p.done).length;
        if (this.rand() < (r.restChance ?? 0) && resting < Math.floor(this.players.length / 2)) {
          const [lo, hi] = r.restRange ?? [0, 0];
          const seconds = lo + this.rand() * Math.max(0, hi - lo);
          v.beat = nextEighth(v.beat + seconds * this.tempo);   // back in on the pulse
          v.resting = true;
          return false;
        }
        continue;
      }
      else if (v.reps === null) {
        v.resting = false;
        v.reps = this.passesFor(m, r);
        v.passes = 0;
        v.pos = v.i;
        const join = this.joinBeat(v, m, r);
        if (join != null) {
          v.beat = join;
          v.listening = true;
          return false;
        }
      }
      v.listening = false;
      const slowest = Math.min(...this.players.map(p => p.pos));
      // On 53: wait for everyone, play together, then drop out in turn.
      if (v.i === last && this.endAt == null && slowest === last) this.endAt = v.beat;
      const keepGoing = m.cellBeats > 0 && (v.i < last
        ? v.reps > 0 || v.i - slowest >= r.maxLead
        : this.endAt == null || v.beat < this.dropBeat(v, r));
      if (keepGoing) {
        v.passStart = v.beat;
        v.reps = Math.max(0, v.reps - 1);
        v.passes++;
        return true;
      }
      v.i++;
      v.reps = null;
      v.restDone = false;
      if (v.i > last) {
        v.done = true;
        return false;
      }
    }
  }

  // A player arriving on a module sometimes (joinChance) catches someone
  // already playing it by ear: it listens for at least one full pass, then
  // comes in at the start of that player's next pass, in step with them.
  // Returns that beat, or null to start straight away (nobody to join, the
  // dice said no, or it would take more than joinMax seconds).
  joinBeat(v, m, r) {
    const others = this.players.filter(q => q !== v && !q.done && q.pos === v.i && q.i === v.i
      && !q.resting && !q.listening && q.passStart != null);
    if (!others.length || this.rand() >= (r.joinChance ?? 0)) return null;
    const q = others[Math.floor(this.rand() * others.length)];
    const L = m.cellBeats;
    const join = q.passStart + L * Math.ceil((v.beat + L - q.passStart) / L - 1e-9);
    return join - v.beat <= (r.joinMax ?? 0) * this.tempo ? join : null;
  }

  // When a player stops at the end: endHold seconds after everyone reached 53,
  // plus its turn (in an order shuffled by the seed) spread over endSpread
  // seconds. The order is drawn when the ending starts, from its own generator,
  // so it doesn't disturb the rest of the performance.
  dropBeat(v, r) {
    if (!this.dropOrder || this.dropOrder.length !== this.players.length) {
      this.dropOrder = entrySlots(this.players.length, mulberry32((r.seed ^ 0x5eed) >>> 0));
    }
    const n = this.players.length;
    const turn = this.dropOrder[this.players.indexOf(v)] ?? n - 1;
    const seconds = (r.endHold ?? 0) + (n > 1 ? (turn * (r.endSpread ?? 0)) / (n - 1) : 0);
    return this.endAt + seconds * this.tempo;
  }

  // A player's octave on a module: fixed (-2..2), or "vary" (picked per
  // module by the seed, within the octave range).
  octaveFor(v, row, r) {
    const setting = r.players[v.p]?.oct ?? 0;
    if (setting !== 'vary') return setting;
    return playerOctave(this.modules[row], r.octRange ?? 0, r.seed, v.p, row);
  }

  // `v` is the player (none for the pulse): its notes go through its own
  // panner, which is pointed at this module's channel when it changes module.
  // Players play in their own octave; the pulse uses its row's.
  emit(row, e, beat, plan, instrument, v = null, octave = plan[row].octave) {
    const m = this.modules[row];
    const time = this.timeAt(beat);
    const shift = transposition(instrument, m, octave);
    const midinote = Array.isArray(e.midinote) ? e.midinote.map(n => n + shift) : e.midinote + shift;
    if (v && v.routed !== row) {
      this.engine.routePlayer(v.p, row, time);
      v.routed = row;
    }
    this.engine.playNote({ time, instrument, midinote, dur: e.dur, tempo: this.tempo, moduleIndex: row, extras: m.extras, player: v ? v.p : null });
    this.lastBeat = Math.max(this.lastBeat, beat + e.dur);
    if (this.onNote) {
      const legato = m.extras.legato ?? 0.8;
      for (const n of [].concat(midinote)) {
        this.onNote({ time, end: time + (e.dur * legato) / this.tempo, midinote: n, module: row, instrument });
      }
    }
  }
}
