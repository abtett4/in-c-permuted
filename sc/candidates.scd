// Proposed fixes for the 2026 SynthDefs, to audition next to the originals.
// They are NOT used by the piece: the page shows them in the Audition panel
// under "Proposed fixes". If you like one, copy it into Tett_A_In_C_2026.scd
// (renaming it to replace the original) and rebuild.
//
// Why the originals are hard to hear: gosub wrote them as fixed high-pitched
// sounds (1-12.5 kHz). Following In C's notes they play pure sine waves at
// roughly 175-470 Hz, which small speakers barely reproduce; what you do hear
// is mostly the click of their very fast attacks.
//
// `oct` lifts a SynthDef by octaves (oct = 2 is two octaves up, x4), so the
// "high" ones stay high while still playing the module's pitches. Riley's
// directions allow transposing by octaves, especially up.

(
// \highlong: two octaves up, a quiet 2nd harmonic for body, and a 5 ms
// attack instead of 1 ms so it starts without a click.
SynthDef(\highlong_v2, { |out, amp = 0.1, freq = 440, oct = 2|
	var f = freq * (2 ** oct);
	var snd = SinOsc.ar(f) + (SinOsc.ar(f * 2) * 0.25);
	snd = snd * EnvGen.ar(Env.linen(0.005, 0.400, 0.150), doneAction: Done.freeSelf);
	Out.ar(out, (snd * amp) ! 2);
}).add;

// \highshort: two octaves up, and a 0.12 s ping instead of a 21 ms blip
// (21 ms is only about five cycles of a low note, which reads as a thump).
SynthDef(\highshort_v2, { |out, amp = 0.1, freq = 440, oct = 2|
	var snd = SinOsc.ar(freq * (2 ** oct));
	snd = snd * EnvGen.ar(Env.perc(0.002, 0.12), doneAction: Done.freeSelf);
	Out.ar(out, (snd * amp) ! 2);
}).add;

// \envsine: one octave up and a quiet 3rd harmonic, so there is something
// above 400 Hz for small speakers; same envelope and reverb as gosub's.
SynthDef(\envsine_v2, { |out, amp = 0.1, freq = 440, oct = 1|
	var f = freq * (2 ** oct);
	var snd = SinOsc.ar(f) + (SinOsc.ar(f * 3) * 0.15);
	snd = snd * EnvGen.ar(Env.linen(0.010, 0.200, 0.500));
	snd = FreeVerb2.ar(snd, snd, mix: 0.5, room: 0.7, damp: 0.2);
	snd = snd * amp;
	DetectSilence.ar(snd, doneAction: Done.freeSelf);
	Out.ar(out, snd);
}).add;

// \click: a pitched click. The original is a single-sample impulse through a
// low-pass filter, well under a millisecond long, so it has no pitch and very
// little energy. Ringz rings briefly at the note instead, like a woodblock.
SynthDef(\click_v2, { |out, amp = 0.1, freq = 440, oct = 2|
	var snd = Ringz.ar(Impulse.ar(0), freq * (2 ** oct), 0.06);
	snd = snd * amp;
	DetectSilence.ar(snd, doneAction: Done.freeSelf);
	Out.ar(out, Pan2.ar(snd, Rand(-1, 1)));
}).add;

// \burst: noise tuned to the note. The original is plain white noise for
// 0.4 s on every note, whatever the pitch. A narrow band-pass at the note
// gives a breathy, pitched burst, and a shorter decay keeps fast modules clear.
SynthDef(\burst_v2, { |out, amp = 0.1, freq = 440, oct = 1|
	var snd = BPF.ar(WhiteNoise.ar, freq * (2 ** oct), 0.05) * 40;   // a narrow band passes little noise, so it needs gain
	snd = snd * EnvGen.ar(Env.perc(0.005, 0.25), doneAction: Done.freeSelf);
	Out.ar(out, (snd * amp) ! 2);
}).add;

// \ff (Eli Fieldsteel, https://sccode.org/1-5eb): one pluck per note. The
// original re-triggers its Pluck with Impulse.ar(6), six plucks a second,
// which is the delay-pedal echo. It was also the quietest SynthDef (about
// 10 dB under star), so it's about 10 dB louder. The glide (varlag) is gone:
// it only matters when a running synth changes pitch, and each note here is
// a new synth.
// Most of its sound is the fundamental, so on small speakers it stays thin in
// low registers; oct = 1 lifts it an octave.
SynthDef(\ff_v2, { |out = 0, freq = 440, amp = 0.5, gate = 1, oct = 0|
	var wn, sig;
	freq = freq * (2 ** oct);
	wn = Pluck.ar(WhiteNoise.ar(8 ! 2), Impulse.ar(0), 1/10, 1/(freq * 0.6.midiratio), 4, 0.93);
	wn = HPF.ar(wn, 300);
	sig = (SinOsc.ar(freq * (1, 3..7)) * (1 / (1, 3..7)).pow(2.5)).sum;
	sig = Pan2.ar(sig, Rand(-0.5, 0.5));
	sig = (sig + wn) * amp * 0.8;
	sig = sig * EnvGen.kr(Env.asr(0.01, 1, 0.3), gate, doneAction: 2);
	Out.ar(out, sig);
}).add;
)
