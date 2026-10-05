// Plays the form the way Ptpar + Ppar + Pseq + TempoClock do in the .scd:
// every module starts at its beat and repeats its cell `reps` times, all of
// them in parallel. Notes are sent a little ahead of time as timestamped OSC
// bundles, so timing is sample-accurate even if the page stutters.

import { transposition } from './registers.js';

const LOOKAHEAD = 0.4;   // seconds of notes sent ahead of time
const TICK_MS = 40;

export class Sequencer {
  // getPlan() returns the live per-module settings: [{ instrument, reps, start }]
  constructor(engine, modules, getPlan) {
    this.engine = engine;
    this.modules = modules;
    this.getPlan = getPlan;
    this.tempo = 1;
    this.playing = false;
    this.cursors = [];
    this.anchorBeat = 0;
    this.anchorTime = 0;
    this.horizonBeat = 0;
    this.onNote = null;      // (note) => void, for the visualizer
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

  get beat() {
    return this.playing ? this.beatAt(this.engine.now()) : this.anchorBeat;
  }

  // A new tempo takes over right after the notes already sent ahead, so the
  // change is seamless.
  setTempo(tempo) {
    if (this.playing) {
      const t = Math.max(this.engine.now(), this.horizonTime || 0);
      const beat = this.beatAt(t);
      this.prev = { anchorBeat: this.anchorBeat, anchorTime: this.anchorTime, tempo: this.tempo };
      this.anchorBeat = beat;
      this.anchorTime = t;
    } else {
      this.prev = null;
    }
    this.tempo = tempo;
  }

  play(fromBeat = 0) {
    const plan = this.getPlan();
    this.prev = null;
    this.anchorBeat = fromBeat;
    this.anchorTime = this.engine.now() + 0.1;
    this.horizonTime = this.anchorTime;
    this.horizonBeat = fromBeat;
    this.cursors = this.modules.map((m, i) => seek(m, plan[i], fromBeat));
    this.playing = true;
    this.timer.start();
    this.tick();
  }

  async stop() {
    this.playing = false;
    this.timer.stop();
    await this.engine.stopAll();
  }

  // Call after a module's start or repeat count changes while playing.
  resync(i) {
    if (!this.playing) return;
    this.cursors[i] = seek(this.modules[i], this.getPlan()[i], this.horizonBeat);
  }

  endBeat(plan = this.getPlan()) {
    return Math.max(0, ...this.modules.map((m, i) => plan[i].start + m.cellBeats * plan[i].reps));
  }

  tick() {
    if (!this.playing) return;
    const now = this.engine.now();
    this.horizonTime = now + LOOKAHEAD;
    const horizon = this.beatAt(this.horizonTime);
    const plan = this.getPlan();

    this.modules.forEach((m, i) => {
      const cur = this.cursors[i];
      const p = plan[i];
      while (cur && !cur.done && cur.beat < horizon) {
        const ev = m.cell[cur.idx];
        if (!ev.rest && ev.dur > 0) {
          const time = this.timeAt(cur.beat);
          const shift = transposition(p.instrument, m, p.octave);
          const midinote = Array.isArray(ev.midinote) ? ev.midinote.map(n => n + shift) : ev.midinote + shift;
          this.engine.playNote({
            time,
            instrument: p.instrument,
            midinote,
            dur: ev.dur,
            tempo: this.tempo,
            moduleIndex: i,
            extras: m.extras,
          });
          if (this.onNote) {
            const legato = m.extras.legato ?? 0.8;
            for (const n of [].concat(midinote)) {
              this.onNote({ time, end: time + (ev.dur * legato) / this.tempo, midinote: n, module: i, instrument: p.instrument });
            }
          }
        }
        advance(m, p, cur);
      }
    });
    this.horizonBeat = horizon;

    if (this.cursors.every(c => !c || c.done) && this.beatAt(now) > this.endBeat(plan) + 4 * this.tempo) {
      this.playing = false;
      this.timer.stop();
      if (this.onEnd) this.onEnd();
    }
  }
}

// Where module `m` is at `beat`: which repetition, which event, and that
// event's beat. Before the module's entry it waits at its first note.
export function seek(m, p, beat) {
  const cur = { rep: 0, idx: 0, beat: p.start, done: false };
  if (m.cellBeats <= 0 || p.reps <= 0) return { ...cur, done: true };
  if (beat <= p.start) return cur;
  cur.rep = Math.floor((beat - p.start) / m.cellBeats);
  cur.beat = p.start + cur.rep * m.cellBeats;
  if (cur.rep >= p.reps) return { ...cur, done: true };
  while (!cur.done && cur.beat < beat - 1e-9) advance(m, p, cur);
  return cur;
}

function advance(m, p, cur) {
  cur.beat += m.cell[cur.idx].dur;
  cur.idx++;
  if (cur.idx >= m.cell.length) {
    cur.idx = 0;
    cur.rep++;
    cur.beat = p.start + cur.rep * m.cellBeats;   // avoid float drift
    if (cur.rep >= p.reps) cur.done = true;
  }
}

// setInterval in a Worker keeps ticking when the tab isn't focused (main
// thread timers get throttled to once a second there).
export function makeTicker(fn, ms) {
  let worker = null;
  try {
    const src = `let t=null;onmessage=e=>{clearInterval(t);if(e.data)t=setInterval(()=>postMessage(0),${ms});}`;
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    worker.onmessage = fn;
  } catch {
    worker = null;
  }
  let id = null;
  return {
    start() { worker ? worker.postMessage(1) : (clearInterval(id), (id = setInterval(fn, ms))); },
    stop() { worker ? worker.postMessage(0) : clearInterval(id); },
  };
}
