// Some SynthDefs only sound right in part of the range. A module played on
// one of them is moved by whole octaves, so its melody keeps its shape, until
// its highest note is at most `high`; then back up if that left its lowest
// note under `low` and there's room. This comes after the module's own
// octave setting, so a permutation can't push them out of range either.
//
// The same rule is in the Riley-mode player in Tett_A_In_C_2026.scd; keep the
// two in step if you change it.

export const REGISTERS = {
  bass: { low: 28, high: 52 },   // E1 .. E3
};

// Semitones to add to every note of module `m` played on `instrument`.
export function transposition(instrument, m, octave = 0) {
  let shift = 12 * (octave || 0);
  const r = REGISTERS[instrument];
  if (!r || m.lo == null) return shift;
  while (m.hi + shift > r.high) shift -= 12;
  while (m.lo + shift < r.low && m.hi + shift + 12 <= r.high) shift += 12;
  return shift;
}
