// Audition: one module played by one SynthDef or by each in turn, outside the
// piece, on a mixer channel of its own so its peak level can be measured.

export const AUDITION_SLOT = 63;   // the last mixer channel; the score never uses it
const GAP = 0.8;                   // seconds of silence between SynthDefs

export class Audition {
  constructor(engine) {
    this.engine = engine;
    this.segments = [];   // [{ instrument, t0, t1 }] in engine time
    this.peaks = {};      // instrument -> highest level seen
  }

  get active() {
    const last = this.segments[this.segments.length - 1];
    return !!last && this.engine.now() < last.t1 + 1.5;
  }

  // The SynthDef sounding now (its notes, plus a short tail), or null.
  current() {
    const now = this.engine.now();
    const seg = this.segments.find(s => now >= s.t0 && now <= s.t1 + 0.4);
    return seg ? seg.instrument : null;
  }

  // Schedules everything up front as timestamped bundles.
  play({ module, instruments, passes, octave, tempo }) {
    this.segments = [];
    const shift = 12 * (octave || 0);
    let t = this.engine.now() + 0.15;
    for (const instrument of instruments) {
      this.peaks[instrument] = 0;
      const t0 = t;
      for (let pass = 0; pass < passes; pass++) {
        for (const e of module.cell) {
          if (!e.rest && e.dur > 0) {
            const midinote = Array.isArray(e.midinote) ? e.midinote.map(n => n + shift) : e.midinote + shift;
            this.engine.playNote({ time: t, instrument, midinote, dur: e.dur, tempo, moduleIndex: AUDITION_SLOT, extras: module.extras });
          }
          t += e.dur / tempo;
        }
      }
      this.segments.push({ instrument, t0, t1: t });
      t += GAP;
    }
  }

  // Called with each level reading; credits it to whichever SynthDef is playing.
  measure(level) {
    const inst = this.current();
    if (inst && level > (this.peaks[inst] || 0)) this.peaks[inst] = level;
  }

  async stop() {
    this.segments = [];
    await this.engine.stopAll();
  }
}
