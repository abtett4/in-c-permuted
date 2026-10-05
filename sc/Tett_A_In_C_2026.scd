// Alan Tett, MUSC 4121 Spring 2019, Final Project
// Actually "In C" by Terry Riley (not just inspired by it this time)

s.makeWindow.boot

/*
b = Buffer.read(s, Platform.resourceDir +/+ "sounds/15Step.wav"); // remember to free the buffer later.

c = Buffer.read(s,Platform.resourceDir +/+ "sounds/TheRiver.wav", numFrames: 44100*120); // one second


[b.bufnum, b.numChannels, b.path, b.numFrames].postln;

[c.bufnum, c.numChannels, c.path, c.numFrames].postln;

{PlayBuf.ar(2, 0, 179/189)}.play(s); // Your buffer number may differ

{PlayBuf.ar(2, 3)}.play(s); // one second playback from c*/
// Okay none of the code above works, so I'm scrapping it and updating my "In C" code so that it actually sort of makes sense



// I'll try out some new SynthDefs so it doesn't sound too similar to last time.

( //from 10karplusStrong.scd by John Drumheller
SynthDef("pluck",
    {
        arg out = 0, midinote = 60, amp = 0.9, dur = 1, pan = 0, legato = 0.8,
        delayDecay = 3.0;
        var burstEnv, att = 0, dec = 0.001;
        var signalOut, delayTime;
        delayTime = [midinote, midinote + 12].midicps.reciprocal;
        burstEnv = EnvGen.kr(Env.perc(att, dec));
        signalOut = BrownNoise.ar(burstEnv*0.3)+PinkNoise.ar(burstEnv*0.4);
        signalOut = CombL.ar(signalOut, delayTime, delayTime,
            delayDecay, add: signalOut);
        DetectSilence.ar(signalOut, doneAction:2);
        Out.ar(out, signalOut)
    }
).add;

/*SynthDef(\pluck, {|midinote = 60, dur = 1|
	var freq = midinote.midicps;
	var klang,note;
	dur = dur * 2;
	note = freq.cpsmidi;
	note = note + (LFNoise2.ar(20).range(-1,1) * (1/8));
	klang = SinOsc.ar((note * [1,1.002]).midicps, phase: VarSaw.ar(note.midicps, width: Line.ar(1,0.2,dur))) * 0.3;
	klang = klang * XLine.ar(1,1/10000,dur,doneAction:2);
	Out.ar(0, klang);
}).add;*/

SynthDef(\bass, { |outbus, midinote|
    var freq = midinote.midicps;
    var subfreq = freq / 2;
    var amp = 0.65;
    // Envelopes
    var subenv = EnvGen.kr(Env.perc(0, 1), doneAction:2);
    var env = EnvGen.kr(Env.perc(0, 0.5));
    // Component synthesis
    var pluck = Pluck.ar(PinkNoise.ar, 1, 0.2, subfreq.reciprocal) * subenv * 2;
    var tri = VarSaw.ar(freq) * env;
    var sin = SinOsc.ar(freq) * env;
    var sub = (SinOsc.ar([subfreq, subfreq - 2, subfreq + 2]).sum * subenv).tanh;
    var click = RLPF.ar(Impulse.ar(0), [2000, 8000], 1).sum * 1000;
    // Initial signal
    var sig = pluck + tri + sub + click;
    // Resonant LPFs
    sig = RLPF.ar(sig, XLine.ar(freq * 100, freq * 10, 0.15));
    sig = sig + (MoogFF.ar(sig, freq * 20, 2.5) * 0.1);
    // EQ resulting signal
    sig = BPeakEQ.ar(sig, 400, 0.5, -9);
    sig = BPeakEQ.ar(sig, 2000, 0.5, 6);
    sig = BHiShelf.ar(sig, 8000, 1, 3);
    sig = BPeakEQ.ar(sig, 200, 1, 3);
    // Apply another envelope to dampen a bit more
    sig = sig * XLine.kr(1, 0.6, 0.1);
    // Tanh distortion / limiting
    sig = (sig * 1).tanh;
    // Another round of signal coloring, using another RLPF
    // and sine components
    sig = sig + RLPF.ar(sig, XLine.ar(freq * 100, freq * 10, 0.15)) + sin + sub;
    // Another round of tanh distortion / limiting
    sig = (sig / 2.3).tanh;
    // Another resonant LPF
    sig = MoogFF.ar(sig, XLine.ar(freq*150, freq*30, 0.1), 0.1);
    sig = Pan2.ar(sig, 0, amp);
    Out.ar(outbus, sig);
}).add;

//https://sccode.org/1-522
SynthDef(\star, {
    |
    // standard meanings
    out = 0, freq = 440, gate = 1, pan = 0, amp = 0.85,
    // all of these range from 0 to 1
    vel = 0.8, modIndex = 0.2, mix = 0.2, lfoSpeed = 0.4, lfoDepth = 0.1
    |
    var env1, env2, env3, env4;
    var osc1, osc2, osc3, osc4, snd;

    lfoSpeed = lfoSpeed * 12;

    freq = freq * 2;

    env1 = EnvGen.ar(Env.adsr(0.001, 1.25, 0.0, 0.04, curve: \lin));
    env2 = EnvGen.ar(Env.adsr(0.001, 1.00, 0.0, 0.04, curve: \lin));
    env3 = EnvGen.ar(Env.adsr(0.001, 1.50, 0.0, 0.04, curve: \lin));
    env4 = EnvGen.ar(Env.adsr(0.001, 1.50, 0.0, 0.04, curve: \lin));

    osc4 = SinOsc.ar(freq * 0.5) * 2pi * 2 * 0.535887 * modIndex * env4 * vel;
    osc3 = SinOsc.ar(freq, osc4) * env3 * vel;
    osc2 = SinOsc.ar(freq * 15) * 2pi * 0.108819 * env2 * vel;
    osc1 = SinOsc.ar(freq, osc2) * env1 * vel;
    snd = Mix((osc3 * (1 - mix)) + (osc1 * mix));
    snd = snd * (SinOsc.ar(lfoSpeed) * lfoDepth + 1);

    // using the doneAction: 2 on the other envs can create clicks (bc of the linear curve maybe?)
    snd = snd * EnvGen.ar(Env.asr(0, 1, 0.1), gate, doneAction: 2);
    snd = Pan2.ar(snd, pan, amp);

    Out.ar(out, snd);
}).add;

/*SynthDef(\star, { arg out=0, amp=5.0, gate=1, pan=0, spread=0.8, midinote=30, doneAction=2;
	var sig, sig1, sig2, sig3;
	var env1;
	var fspread;
	var freq = midinote.midicps;
	env1 = EnvGen.kr(Env([1,2,1],[1.7,0.8]), 1);
	fspread = 0.0007 + Rand(0,0.007);
	sig = SinOsc.ar(freq * ((0..7)/7 - 0.5 * fspread + 1));
	sig = sig * ( sig/(sig+1.1)*50 * env1 ).clip(0.5);
	sig1 = sig * (sig.abs > Rand(0.1,0.7));
	sig = SelectX.ar( EnvGen.kr(Env([0,1,0],[0.1+Rand(0,2.0),0.1+Rand(0,2.0)]), 1), [sig, sig1]);
	sig = sig * 2;
	sig = sig * EnvGen.ar(\adsr.kr(Env.adsr(1.01,0.1,1,1.1)),gate,doneAction:doneAction);
	// sig = sig /10;
	sig = Splay.ar(sig, spread, amp, pan);
	Out.ar(out, sig);
}).add;*/

SynthDef(\starlet, { arg out=0, amp=5.0, gate=1, pan=0, spread=0.8, midinote=30, doneAction=2;
    var sig, sig1, sig2, sig3;
    var env1;
    var fspread;
    var freq = midinote.midicps;
    // The detune between the eight voices swells and settles back. It used to
    // swell 20x (to about +/-7%, more than a semitone), a phasing whoosh on long
    // notes; 4x keeps the shimmer without the smear.
    env1 = EnvGen.kr(Env([1,4,1],[1.7,0.8]), 1);
    fspread = 0.0007 + Rand(0,0.007)* env1;
    sig = SinOsc.ar(freq * ((0..7)/7 - 0.5 * fspread + 1) );
    sig1 = sig * ( sig/(sig+1.1)*50 * env1 ).clip(0.5);
    sig = SelectX.ar(\mix.kr(0.5), [sig, sig1]);
    sig = sig * 2;
    // Soft saturation adds harmonics small speakers can play, a 0.15 s fade-in
    // (was 1.01 s) lets short notes reach full level, and a 0.35 s release
    // (was 1.1 s) stops notes trailing into the next module.
    sig = (sig * 4).tanh;
    sig = sig * EnvGen.ar(\adsr.kr(Env.adsr(0.15,0.1,1,0.35)),gate,doneAction:doneAction);
    // sig = sig /10;
    sig = Splay.ar(sig, spread, amp, pan);
    Out.ar(out, sig);
}).add;

SynthDef("harpsichord1", {
    arg out = 0, midinote = 60, amp = 0.1, pan = 0, decay = 1;
    var env, snd, freq;
    freq = midinote.midicps;
    // decay = dur;
    env = Env.perc(releaseTime: decay, level: amp).kr(doneAction: 2);
    snd = Pulse.ar(freq, 0.25, 0.75);
    snd = snd * env;
    Out.ar(out, Pan2.ar(snd, pan));
}).add;

// \ff by eli.fieldsteel, https://sccode.org/1-5eb, reworked for In C by Claude:
// a gate envelope so each note ends; one pluck per note (the original
// re-plucked six times a second, which sounded like a delay pedal); louder,
// with brighter partials; no glide (each note is a new synth); a softer pluck
// (its noise burst was 8x and hit hard on every attack, now 2.5x and low-passed).
// oct = 1 lifts it an octave if it sounds thin on small speakers.
SynthDef(\ff, { |out = 0, freq = 440, amp = 0.5, gate = 1, oct = 0|
	var wn, sig;
	freq = freq * (2 ** oct);
	wn = Pluck.ar(LPF.ar(WhiteNoise.ar(2.5 ! 2), 4000), Impulse.ar(0), 1/10, 1/(freq * 0.6.midiratio), 4, 0.93);
	wn = HPF.ar(wn, 300);
	// Odd partials falling off as 1/n (was 1/n^2.5, almost a pure sine), so
	// there's tone above 400 Hz for small speakers to play.
	sig = (SinOsc.ar(freq * (1, 3..7)) * (1 / (1, 3..7))).sum;
	sig = Pan2.ar(sig, Rand(-0.5, 0.5));
	sig = (sig + wn) * amp * 1.5;
	sig = sig * EnvGen.kr(Env.asr(0.01, 1, 0.3), gate, doneAction: 2);
	Out.ar(out, sig);
}).add;

// \click through \burst after gosub, https://sccode.org/1-5i2, reworked for
// In C by Claude. gosub wrote them as fixed high-pitched sounds (1-12.5 kHz);
// following In C's notes they became pure sines around 175-470 Hz, which
// small speakers barely reproduce. `oct` lifts them by octaves (oct = 2 is
// two octaves up), which Riley's directions allow.

// A pitched click: Ringz rings briefly at the note, like a woodblock. (The
// original was a single-sample impulse, under a millisecond, with no pitch.)
SynthDef(\click, { |out, amp = 0.1, freq = 440, oct = 2|
	var snd = Ringz.ar(Impulse.ar(0), freq * (2 ** oct), 0.06);
	snd = snd * amp;
	DetectSilence.ar(snd, doneAction: Done.freeSelf);
	Out.ar(out, Pan2.ar(snd, Rand(-1, 1)));
}).add;

// A 0.12 s ping two octaves up (the original's 21 ms is about five cycles of a
// low note, which reads as a thump).
SynthDef(\highshort, { |out, amp = 0.1, freq = 440, oct = 2|
	var snd = SinOsc.ar(freq * (2 ** oct));
	snd = snd * EnvGen.ar(Env.perc(0.002, 0.12), doneAction: Done.freeSelf);
	Out.ar(out, (snd * amp) ! 2);
}).add;

// One octave up with a quiet 3rd harmonic; gosub's envelope and reverb;
// 6 dB louder so it isn't buried.
SynthDef(\envsine, { |out, amp = 0.1, freq = 440, oct = 1|
	var f = freq * (2 ** oct);
	var snd = SinOsc.ar(f) + (SinOsc.ar(f * 3) * 0.15);
	snd = snd * EnvGen.ar(Env.linen(0.010, 0.200, 0.500));
	snd = FreeVerb2.ar(snd, snd, mix: 0.5, room: 0.7, damp: 0.2);
	snd = snd * amp * 2;
	DetectSilence.ar(snd, doneAction: Done.freeSelf);
	Out.ar(out, snd);
}).add;

// Two octaves up with a quiet 2nd harmonic, and a 5 ms attack so it starts
// without a click.
SynthDef(\highlong, { |out, amp = 0.1, freq = 440, oct = 2|
	var f = freq * (2 ** oct);
	var snd = SinOsc.ar(f) + (SinOsc.ar(f * 2) * 0.25);
	snd = snd * EnvGen.ar(Env.linen(0.005, 0.400, 0.150), doneAction: Done.freeSelf);
	Out.ar(out, (snd * amp) ! 2);
}).add;

// Driven hard into its clipper (x10; it used to barely touch it), which makes
// it nearly square, adding odd harmonics small speakers can play; a low-pass
// takes off the harshest edge.
SynthDef(\midsine, { |out, amp=0.1, freq=3136|
	var snd, env;
	snd = SinOsc.ar(freq);
	snd = Clip.ar(snd * 10, -0.9, 0.9);
	snd = LPF.ar(snd, (freq * 8).min(16000));
	env=Env.linen(0.005, 0.050, 0.010);
	snd = snd * EnvGen.ar(env, doneAction: Done.freeSelf);
	snd = snd * amp;
	Out.ar(out, snd!2);
}).add;

// Noise tuned to the note, with a 0.25 s decay (the original was plain white
// noise for 0.4 s on every note, whatever the pitch).
SynthDef(\burst, { |out, amp = 0.1, freq = 440, oct = 1|
	var snd = BPF.ar(WhiteNoise.ar, freq * (2 ** oct), 0.05) * 40;   // a narrow band passes little noise, so it needs gain
	snd = snd * EnvGen.ar(Env.perc(0.005, 0.25), doneAction: Done.freeSelf);
	Out.ar(out, (snd * amp) ! 2);
}).add;

)




// Set up the 53 modules each with a bounded-random repeat number and the player variables
(
var song0, song1, song2, song3, song4, song5, song6, song7, song8, song9, song10, song11, song12, song13, song14, song15, song16, song17, song18, song19, song20, song21, song22, song23, song24, song25, song26, song27, song28, song29, song30, song31, song32, song33, song34, song35, song36, song37, song38, song39, song40, song41, song42, song43, song44, song45, song46, song47, song48, song49, song50, song51, song52, song53, offset, modules, nPlayers = 12, pos, tempo = 0.39, player, pulse, finished = 0, entrySpread = 45, entries;

song0 = Pbind(
    \instrument, \harpsichord1,
    [\midinote, \dur],
    Pseq([
        [84, 1/8],
    ],[180,192].choose),
); //this is the metronome, aka 'The Pulse'

song1 = Pbind(
    \instrument, \harpsichord1,
    [\midinote, \dur],
    Pseq([
        [48, 1/64],[52, 15/64],
        [48, 1/64],[52, 15/64],
        [48, 1/64],[52, 15/64],
    ],[16,17].choose),
);

song2 = Pbind(
    \instrument, \pluck,
    [\midinote, \dur],
    Pseq([
        [48, 1/64],[52, 7/64],[53, 1/8],[52, 1/4]
    ],[18,19].choose),
);

song3 = Pbind(
    \instrument, \harpsichord1,
    [\midinote, \dur],
    Pseq([
        [0, Rest(1/8)],[52, 1/8],[53, 1/8],[52, 1/8]
    ],[12,13].choose),
);

song4 = Pbind(
    \instrument, \pluck,
    [\midinote, \dur],
    Pseq([
        [0, Rest(1/8)],[52, 1/8],[53, 1/8],[55, 1/8]
    ],[13,14].choose),
);

song5 = Pbind(
    \instrument, \harpsichord1,
    [\midinote, \dur],
    Pseq([
        [52, 1/8],[53, 1/8],[55, 1/8],[0, Rest(1/8)]
    ],[14,15].choose),
);

song6 = Pbind(
    \instrument, \star,
    [\midinote, \dur],
    Pseq([
        [60, 2]
    ],[2,3].choose),
);

song7 = Pbind(
    \instrument, \bass,
    [\midinote, \dur],
    Pseq([
        [0, Rest(7/8)],[48, 1/16],[48, 1/16],[48, 1/8],[0, Rest(9/8)]
    ],[4,5].choose),
);

song8 = Pbind(
    \instrument, \starlet,
    [\midinote, \dur],
    Pseq([
        [55, 3/2],[53, 2]
    ],[2,3].choose),
);

song9 = Pbind(
    \instrument, \bass,
    [\midinote, \dur],
    Pseq([
        [59, 1/16],[55, 1/16],[0, Rest(7/8)]
    ],[3,4].choose),
);

song10 = Pbind(
    \instrument, \pluck,
    [\midinote, \dur],
    Pseq([
        [59, 1/16],[55, 1/16]
    ],[14,15].choose),
);

song11 = Pbind(
    \instrument, \harpsichord1,
    [\midinote, \dur],
    Pseq([
        [53, 1/16],[55, 1/16],[59, 1/16],[55, 1/16],[59, 1/16],[55, 1/16]
    ],[12,13].choose),
);

song12 = Pbind(
    \instrument, \star,
    [\midinote, \dur],
    Pseq([
        [53, 1/8],[55, 1/8],[59, 1],[60, 1/4]
    ],[3,4].choose),
);

song13 = Pbind(
    \instrument, \harpsichord1,
    [\midinote, \dur],
    Pseq([
        [59, 1/16],[55, 3/16],[55, 1/16],[53, 1/16],[55, 1/8],
        [0, Rest(3/16)],[55, 13/16]
    ],[4,5].choose),
);

song14 = Pbind(
    \instrument, \pluck,
    [\midinote, \dur],
    Pseq([
        [60, 1],[59, 1],[55, 1],[54, 1]
    ],[1,2].choose),
);

song15 = Pbind(
    \instrument, \starlet,
    [\midinote, \dur],
    Pseq([
        [55, 1/16],[0, Rest(15/16)]
    ],[3,4].choose),
);

song16 = Pbind(
    \instrument, \harpsichord1,
    [\midinote, \dur],
    Pseq([
        [55, 1/16],[59, 1/16],[60, 1/16],[59, 1/16]
    ],[8,10].choose),
);

song17 = Pbind(
    \instrument, \pluck,
    [\midinote, \dur],
    Pseq([
        [59, 1/16],[60, 1/16],[59, 1/16],[60, 1/16],[59, 1/16],
        [0, Rest(1/16)]
    ],[3,4].choose),
);

song18 = Pbind(
    \instrument, \star,
    [\midinote, \dur],
    Pseq([
        [52, 1/16],[54, 1/16],[52, 1/16],[54, 1/16],[52, 3/16],[52, 1/16]
    ],[3,4].choose),
);

song19 = Pbind(
    \instrument, \star,
    [\midinote, \dur],
    Pseq([
        [0, Rest(3/8)],[67, 3/8]
    ],[5,6].choose),
);

song20 = Pbind(
    \instrument, \harpsichord1,
    [\midinote, \dur],
    Pseq([
        [52, 1/16],[54, 1/16],[52, 1/16],[54, 1/16],[43, 3/16],[52, 1/16],
        [54, 1/16],[52, 1/16],[54, 1/16],[52, 1/16]
    ],[5,6].choose),
);

song21 = Pbind(
    \instrument, \star,
    [\midinote, \dur],
    Pseq([
        [54, 3/4]
    ],[5,6].choose),
);

song22 = Pbind(
    \instrument, \bass,
    [\midinote, \dur],
    Pseq([
        [40, 3/8],[40, 3/8],[40, 3/8],[40, 3/8],[40, 3/8],
        [42, 3/8],[43, 3/8],[45, 3/8],[47,1/8]
    ],[4,5].choose),
);

song23 = Pbind(
    \instrument, \pluck,
    [\midinote, \dur],
    Pseq([
        [40, 1/8],[42, 3/8],[42, 3/8],[42, 3/8],[42, 3/8],[42, 3/8],
        [43, 3/8],[45, 3/8],[47, 1/4]
    ],[4,5].choose),
);

song24 = Pbind(
    \instrument, \star,
    [\midinote, \dur],
    Pseq([
        [40, 1/8],[42, 1/8],[43, 3/8],[43, 3/8],[43, 3/8],[43, 3/8],[43, 3/8],[45, 3/8],[47, 1/8]
    ],[4,5].choose),
);

song25 = Pbind(
    \instrument, \harpsichord1,
    [\midinote, \dur],
    Pseq([
        [40, 1/8],[42, 1/8],[43, 1/8],[45, 3/8],[45, 3/8],[45, 3/8],[45, 3/8],[45, 3/8],[47, 3/8]
    ],[4,5].choose),
);

song26 = Pbind(
    \instrument, \bass,
    [\midinote, \dur],
    Pseq([
        [40, 1/8],[42, 1/8],[43, 1/8],[45, 1/8],[47, 3/8],[47, 3/8],[47, 3/8],[47, 3/8],[47, 3/8]
    ],[4,5].choose),
);

song27 = Pbind(
    \instrument, \pluck,
    [\midinote, \dur],
    Pseq([
        [40, 1/16],[42, 1/16],[40, 1/16],[42, 1/16],
        [43, 1/8],[40, 1/16],[43, 1/16],
        [42, 1/16],[40, 1/16],[42, 1/16],[40, 1/16]
    ],[6,7].choose),
);

song28 = Pbind(
    \instrument, \pluck,
    [\midinote, \dur],
    Pseq([
        [40, 1/16],[42, 1/16],[40, 1/16],[42, 1/16],
        [40, 3/16],[40, 1/16]
    ],[8,9].choose),
);

song29 = Pbind(
    \instrument, \star,
    [\midinote, \dur],
    Pseq([
        [52, 3/4],[55, 3/4],[60, 3/4]
    ],[5,6].choose),
);

song30 = Pbind(
    \instrument, \starlet,
    [\midinote, \dur],
    Pseq([
        [48, 3/2]
    ],[5,6].choose),
);

song31 = Pbind(
    \instrument, \pluck,
    [\midinote, \dur],
    Pseq([
        [43, 1/16],[41, 1/16],[43, 1/16],
        [47, 1/16],[43, 1/16],[47, 1/16],
    ],[8,9].choose),
);

song32 = Pbind(
    \instrument, \bass,
    [\midinote, \dur],
    Pseq([
        [41, 1/16],[43, 1/16],[41, 1/16],
        [43, 1/16],[47, 1/16],[41, 13/16],[43, 3/8]
    ],[6,7].choose),
);

song33 = Pbind(
    \instrument, \harpsichord1,
    [\midinote, \dur],
    Pseq([
        [43, 1/16],[41, 1/16],[0, Rest(1/8)]
    ],[17,18].choose),
);

song34 = Pbind(
    \instrument, \star,
    [\midinote, \dur],
    Pseq([
        [43, 1/16],[41, 1/16]
    ],[20,21].choose),
);

song35 = Pbind(
    \instrument, \harpsichord1,
    [\midinote, \dur],
    Pseq([
        [53, 1/16],[55, 1/16],[59, 1/16],[55, 1/16],[59, 1/16],[55, 1/16],[59, 1/16],[55, 1/16],[59, 1/16],[55, 1/16],
        [0, Rest(7/8)],
        [58, 1/4],[67, 3/4],[69, 1/8],[67, 1/4],[71, 1/8],[69, 3/8],[67, 1/8],[64, 3/4],[67, 1/8],[66, 7/8],
        [0, Rest(5/8)],
        [64, 5/8],[65, 3/2]
    ],[4,5].choose),
);

/* New for 2026 */

song36 = Pbind(
	\instrument, \ff,
	[\midinote, \dur],
	Pseq([
		[53, 1/16],[55, 1/16],[59, 1/16],[55, 1/16],[59, 1/16],[55, 1/16]
	],[1,2].choose),
);

song37 = Pbind(
	\instrument, \click,
	[\midinote, \dur],
	Pseq([
		[53, 1/16],[55, 1/16]
	],[1,2].choose),
);

song38 = Pbind(
	\instrument, \highlong,
	[\midinote, \dur],
	Pseq([
		[53, 1/16],[55, 1/16],[59, 1/16]
	],[1,2].choose),
);

song39 = Pbind(
	\instrument, \ff,
	[\midinote, \dur],
	Pseq([
        [59, 1/16], [55, 1/16], [53, 1/16], [55, 1/16], [59, 1/16], [60, 1/16]
	],[1,2].choose),
);

song40 = Pbind(
	\instrument, \highshort,
	[\midinote, \dur],
	Pseq([
		[59, 1/16], [53, 1/16]
	],[1,2].choose),
);

song41 = Pbind(
	\instrument, \burst,
	[\midinote, \dur],
	Pseq([
		[59, 1/16], [55, 1/16]
	],[1,2].choose),
);

song42 = Pbind(
	\instrument, \click,
	[\midinote, \dur],
	Pseq([
		[60, 1], [59, 1], [57, 1], [60, 1]
	],[1,2].choose),
);

song43 = Pbind(
	\instrument, \midsine,
	[\midinote, \dur],
	Pseq([
		[65, 1/16], [64, 1/16], [65, 1/16], [64, 1/16], [64, 1/8], [64, 1/8], [64, 1/8], [65, 1/16], [64, 1/16]
	],[1,2].choose),
);

song44 = Pbind(
	\instrument, \highshort,
	[\midinote, \dur],
	Pseq([
		[65, 1/8], [64, 1/4], [64, 1/8], [60, 1/4]
	],[1,2].choose),
);

song45 = Pbind(
	\instrument, \highlong,
	[\midinote, \dur],
	Pseq([
		[62, 1/4], [62, 1/4], [55, 1/4]
	],[1,2].choose),
);
										song46 = Pbind(
	\instrument, \ff,
	[\midinote, \dur],
	Pseq([
		[55, 1/16], [62, 1/16], [64, 1/16], [62, 1/16], [0, Rest(1/8)], [55, 1/8], [0, Rest(1/8)], [55, 1/8], [0, Rest(1/8)], [55, 1/8],[55, 1/16], [62, 1/16], [64, 1/16], [62, 1/16]
	],[1,2].choose),
);

song47 = Pbind(
	\instrument, \highlong,
	[\midinote, \dur],
	Pseq([
		[62, 1/16], [64, 1/16], [62, 1/8]
	],[1,2].choose),
);

song48 = Pbind(
	\instrument, \envsine,
	[\midinote, \dur],
	Pseq([
		[55, 3/2], [55, 1], [53, 5/4]
	],[1,2].choose),
);

song49 = Pbind(
	\instrument, \highshort,
	[\midinote, \dur],
	Pseq([
		[53, 1/16], [55, 1/16], [58, 1/16], [55, 1/16], [58, 1/16], [55, 1/16]
	],[1,2].choose),
);

song50 = Pbind(
	\instrument, \envsine,
	[\midinote, \dur],
	Pseq([
		[53, 1/16], [55, 1/16]
	],[1,2].choose),
);

song51 = Pbind(
	\instrument, \midsine,
	[\midinote, \dur],
	Pseq([
		[53, 1/16], [55, 1/16], [58, 1/16]
	],[1,2].choose),
);

song52 = Pbind(
	\instrument, \ff,
	[\midinote, \dur],
	Pseq([
		[55, 1/16], [58, 1/16]
	],[1,2].choose),
);

song53 = Pbind(
	\instrument, \burst,
	[\midinote, \dur],
	Pseq([
		[58, 1/16], [55, 1/16]
	],[1,2].choose),
);


/*
Ptpar([
0.0, Ppar([[song6,song14].choose, [song8,song29].choose],5),
12.0, Ppar([[song1,song2].choose, [song23,song22].choose],3),
24.0, Ppar([[song6,song14].choose, [song8,song29].choose],4),
36.0, Ppar([[song1,song2].choose, [song23,song22].choose, song35],4)
]).play(TempoClock(0.58))*/

// Commenting out to implement a dynamic player group
// offset = 0.0;
//
// Ptpar([
//     0.0, Ppar([song0],8),
//     3.984375+offset, Ppar([song1],4),
//     5.984375+offset, Ppar([song2],4),
//     10.0+offset, Ppar([song3],4),
//     11.5+offset, Ppar([song4],4),
//     9.0+offset, Ppar([song5],4),
//     12.0+offset, Ppar([song6],4),
//     13.0+offset, Ppar([song7],4),
//     16.0+offset, Ppar([song8],4),
//     17.0+offset, Ppar([song9],4),
//     23.0+offset, Ppar([song10],4),
//     26.5+offset, Ppar([song11],4),
//     30.0+offset, Ppar([song12],4),
//     34.0+offset, Ppar([song13],4),
//     45.0+offset, Ppar([song14],2),
//     47.5+offset, Ppar([song15],4),
//     50.0+offset, Ppar([song16],4),
//     52.0+offset, Ppar([song17],4),
//     55.5+offset, Ppar([song18],4),
//     62.0+offset, Ppar([song19],4),
//     58.0+offset, Ppar([song20],4),
//     64.0+offset, Ppar([song21],4),
//     69.0+offset, Ppar([song22],4),
//     72.0+offset, Ppar([song23],4),
//     75.0+offset, Ppar([song24],4),
//     78.0+offset, Ppar([song25],4),
//     81.0+offset, Ppar([song26],4),
//     92.0+offset, Ppar([song27],4),
//     95.5+offset, Ppar([song28],4),
//     97.0+offset, Ppar([song29],4),
//     99.0+offset, Ppar([song30],4),
//     104.5+offset, Ppar([song31],4),
//     102.0+offset, Ppar([song32],4),
//     107.0+offset, Ppar([song33],4),
//     109.5+offset, Ppar([song34],4),
//     112.0+offset, Ppar([song35],4),
//     114.5+offset, Ppar([song36], 4),
//     115.0+offset, Ppar([song37], 4),
//     115.0+offset, Ppar([song38], 4),
//     117.0+offset, Ppar([song39], 4),
//     116.5+offset, Ppar([song40], 4),
//     118.0+offset, Ppar([song41], 4),
//     121.0+offset, Ppar([song42], 2),
//     123.0+offset, Ppar([song43], 4),
//     127.5+offset, Ppar([song44], 4),
//     128.0+offset, Ppar([song45], 4),
//     131.0+offset, Ppar([song46], 4),
//     132.5+offset, Ppar([song47], 4),
//     129.0+offset, Ppar([song48], 2),
//     134.5+offset, Ppar([song49], 4),
//     135.0+offset, Ppar([song50], 4),
//     136.5+offset, Ppar([song51], 4),
//     137.0+offset, Ppar([song52], 4),
//     139.0+offset, Ppar([song53], 8),
//
//
// ]).play(TempoClock(0.39))
// )

// Claude Code's "Riley Mode" where each player repeats a module for 45-90s, waits if they get 3 modules ahead of the slowest player, and waits at module 53 until everyone has arrived
// Players come in one at a time over the first entrySpread seconds, and \bass is kept in the low register

modules = [song1, song2, song3, song4, song5, song6, song7, song8, song9, song10, song11, song12, song13, song14, song15, song16, song17, song18, song19, song20, song21, song22, song23, song24, song25, song26, song27, song28, song29, song30, song31, song32, song33, song34, song35, song36, song37, song38, song39, song40, song41, song42, song43, song44, song45, song46, song47, song48, song49, song50, song51, song52, song53].collect { |pb| pb.patternpairs[3].list };
pos = 0 ! nPlayers;   // which module each player is on

player = { |p, instrument|
    Prout({ |ev|
        ev = Event.silent(entries[p]).yield;   // wait for this player's entry
        modules.do { |cell, i|
            var beats = cell.sum { |e| e[1].value };
            var reps = (rrand(45, 90) * tempo / beats).round.max(1);  // Riley: 45–90 s
            var notes = cell.reject { |e| e[1].isRest }.collect { |e| e[0] };
            var shift = 0;
            // Keep \bass low (E1-E3, MIDI 28-52) by moving the whole module by
            // octaves, so its melody keeps its shape. Same rule as js/registers.js.
            if (instrument == \bass) {
                while { notes.maxItem - shift > 52 } { shift = shift + 12 };
                while { (notes.minItem - shift < 28) and: { notes.maxItem - shift + 12 <= 52 } } { shift = shift - 12 };
            };
            pos[p] = i;
            while {
                reps > 0
                or: { i - pos.minItem >= 3 }                                   // don't race ahead
                or: { (i == (modules.size - 1)) and: { pos.minItem < i } }     // wait at 53
            } {
                ev = Pbind(\instrument, instrument, [\midinote, \dur], Pseq(cell.collect { |e| [e[0] - shift, e[1]] }, 1)).embedInStream(ev);
                reps = reps - 1;
            };
        };
        finished = finished + 1;
    })
};

// add `finished = 0` to the var list; after each player's modules.do loop: finished = finished + 1;
pulse = Pbind(\instrument, \harpsichord1, \midinote, 84, \dur, Pwhile({ finished < nPlayers }, Pseq([1/8], 1)));  // eighth-note pulse, high C

// Players come in one at a time, in random order, spread over the first
// entrySpread seconds and on the eighth-note pulse, so module 1 builds up as a
// canon. Set entrySpread = 0 to start everyone together.
entries = nPlayers.collect { |k| (k * entrySpread * tempo / (nPlayers - 1).max(1)).round(1/8) }.scramble;

Ppar([pulse] ++ nPlayers.collect { |p| player.(p, [\pluck, \star, \starlet, \harpsichord1, \bass, \ff, \click, \burst, \highlong, \highshort, \envsine, \midsine
].choose) })
    .play(TempoClock(tempo));
)
