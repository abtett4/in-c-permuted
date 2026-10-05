// Riley mode: the player logic from Tett_A_In_C_2026.scd, in JavaScript.
//
// Every player starts on module 1 and works through the modules in order.
// On reaching a module a player decides to stay for minStay..maxStay seconds
// (as a number of passes through the cell); before each further pass it keeps
// going if it still has passes left, if it is maxLead or more modules ahead of
// the slowest player, or if it is on the last module and someone hasn't
// arrived yet. The pulse plays until every player has finished.
//
// Notes are scheduled ahead of time like the arranged sequencer, but always in
// strict time order across all players (as SuperCollider's scheduler does), so
// the "who is ahead" checks happen in the same order and a seed reproduces a
// performance exactly.

import { mulberry32 } from './permute.js';
import { makeTicker } from './sequencer.js';

const LOOKAHEAD = 0.4;
const TICK_MS = 40;

export class RileySequencer {
  // modules: [pulse?, module 1, ..., module 53] (rows on the page)
  // getPlan(): per-row settings (octave etc.); getRiley(): { players: [{ instrument }],
  //   minStay, maxStay, maxLead, seed }
  constructor(engine, modules, getPlan, getRiley) {
    this.engine = engine;
    this.modules = modules;
    this.pulseIndex = modules.findIndex(m => m.isPulse);
    this.order = modules.map((m, i) => i).filter(i => !modules[i].isPulse);
    this.getPlan = getPlan;
    this.getRiley = getRiley;
    this.tempo = 1;
    this.playing = false;
    this.voices = [];
    this.positions = [];      // module order index each player is on
    this.finished = 0;
    this.anchorBeat = 0;
    this.anchorTime = 0;
    this.onNote = null;
    this.onEnd = null;
    this.timer = makeTicker(() => this.tick(), TICK_MS);
  }

  beatAt(time) { return this.anchorBeat + (time - this.anchorTime) * this.tempo; }
  timeAt(beat) { return this.anchorTime + (beat - this.anchorBeat) / this.tempo; }
  get beat() { return this.playing ? Math.max(0, this.beatAt(this.engine.now())) : this.anchorBeat; }

  setTempo(tempo) {
    if (this.playing) {
      const now = this.engine.now();
      this.anchorBeat = this.beatAt(now);
      this.anchorTime = now;
    }
    this.tempo = tempo;
  }

  // Which module row each player is on, for the page (null once finished).
  playerRows() {
    return this.voices.filter(v => !v.isPulse).map(v => (v.done ? null : this.order[v.i]));
  }

  // Riley mode always starts from the beginning: where players are depends on
  // everything that happened before.
  play() {
    const r = this.getRiley();
    this.rand = mulberry32(r.seed);
    this.players = r.players.length;
    this.positions = new Array(this.players).fill(0);
    this.finished = 0;
    this.voices = r.players.map((pl, p) => ({ p, i: 0, reps: null, ev: 0, beat: 0, done: false }));
    if (this.pulseIndex >= 0) this.voices.push({ isPulse: true, ev: 0, beat: 0, done: false });
    this.anchorBeat = 0;
    this.anchorTime = this.engine.now() + 0.1;
    this.lastBeat = 0;
    this.playing = true;
    this.timer.start();
    this.tick();
  }

  get paused() { return !this.playing && this.voices.some(v => !v.done); }

  // Pausing drops the notes already sent ahead, so the fraction of a second
  // after Pause is skipped when Play resumes.
  pause() {
    this.anchorBeat = this.beat;
    this.playing = false;
    this.timer.stop();
    return this.engine.stopAll();
  }

  resume() {
    this.anchorTime = this.engine.now() + 0.1;
    this.playing = true;
    this.timer.start();
    this.tick();
  }

  async stop() {
    this.playing = false;
    this.timer.stop();
    this.voices = [];
    this.anchorBeat = 0;
    await this.engine.stopAll();
  }

  resync() {}

  endBeat() { return this.beat; }

  tick() {
    if (!this.playing) return;
    const now = this.engine.now();
    const horizon = this.beatAt(now + LOOKAHEAD);
    const plan = this.getPlan();
    const r = this.getRiley();

    for (;;) {
      // The voice with the earliest next event goes first.
      let next = null;
      for (const v of this.voices) if (!v.done && (!next || v.beat < next.beat)) next = v;
      if (!next || next.beat >= horizon) break;
      this.step(next, plan, r);
    }

    const allDone = this.voices.every(v => v.done);
    if (allDone && this.beatAt(now) > this.lastBeat + 4 * this.tempo) {
      this.playing = false;
      this.timer.stop();
      if (this.onEnd) this.onEnd();
    }
  }

  step(v, plan, r) {
    if (v.isPulse) {
      if (this.finished >= this.players) { v.done = true; return; }
      const m = this.modules[this.pulseIndex];
      this.emit(this.pulseIndex, m.cell[0], v.beat, plan, plan[this.pulseIndex].instrument);
      v.beat += m.cell[0].dur;
      return;
    }

    // At the start of each pass through a cell, decide whether to play it.
    if (v.ev === 0 && !this.startPass(v, r)) return;

    const row = this.order[v.i];
    const m = this.modules[row];
    const e = m.cell[v.ev];
    if (!e.rest && e.dur > 0) this.emit(row, e, v.beat, plan, r.players[v.p].instrument);
    v.beat += e.dur;
    v.ev = (v.ev + 1) % m.cell.length;
  }

  startPass(v, r) {
    const last = this.order.length - 1;
    for (;;) {
      const m = this.modules[this.order[v.i]];
      if (m.cellBeats <= 0) { v.reps = 0; }   // nothing to play: move straight on
      else if (v.reps === null) {
        const seconds = r.minStay + this.rand() * Math.max(0, r.maxStay - r.minStay);
        v.reps = Math.max(1, Math.round((seconds * this.tempo) / m.cellBeats));
        this.positions[v.p] = v.i;
      }
      const slowest = Math.min(...this.positions);
      const keepGoing = m.cellBeats > 0 && (
        v.reps > 0
        || v.i - slowest >= r.maxLead
        || (v.i === last && slowest < v.i));
      if (keepGoing) {
        v.reps--;
        return true;
      }
      v.i++;
      v.reps = null;
      if (v.i > last) {
        v.done = true;
        this.finished++;
        return false;
      }
    }
  }

  emit(row, e, beat, plan, instrument) {
    const p = plan[row];
    const m = this.modules[row];
    const time = this.timeAt(beat);
    const shift = 12 * (p.octave || 0);
    const midinote = Array.isArray(e.midinote) ? e.midinote.map(n => n + shift) : e.midinote + shift;
    this.engine.playNote({ time, instrument, midinote, dur: e.dur, tempo: this.tempo, moduleIndex: row, extras: m.extras });
    this.lastBeat = Math.max(this.lastBeat, beat + e.dur);
    if (this.onNote) {
      const legato = m.extras.legato ?? 0.8;
      for (const n of [].concat(midinote)) {
        this.onNote({ time, end: time + (e.dur * legato) / this.tempo, midinote: n, module: row, instrument });
      }
    }
  }
}

