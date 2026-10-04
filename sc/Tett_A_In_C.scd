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
		arg midinote = 60, amp = 0.9, dur = 1, pan = 0, legato = 0.8,
		delayDecay = 3.0;
		var burstEnv, att = 0, dec = 0.001;
		var signalOut, delayTime;
		delayTime = [midinote, midinote + 12].midicps.reciprocal;
		burstEnv = EnvGen.kr(Env.perc(att, dec));
		signalOut = BrownNoise.ar(burstEnv*0.3)+PinkNoise.ar(burstEnv*0.4);
		signalOut = CombL.ar(signalOut, delayTime, delayTime,
			delayDecay, add: signalOut);
		DetectSilence.ar(signalOut, doneAction:2);
		Out.ar(0, signalOut)
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
	sig = Pan2.ar(sig, 2, amp);
	Out.ar(outbus, sig!2);
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
	env1 = EnvGen.kr(Env([1,20,1],[1.7,0.8]), 1);
	fspread = 0.0007 + Rand(0,0.007)* env1;
	sig = SinOsc.ar(freq * ((0..7)/7 - 0.5 * fspread + 1) );
	sig1 = sig * ( sig/(sig+1.1)*50 * env1 ).clip(0.5);
	sig = SelectX.ar(\mix.kr(0.5), [sig, sig1]);
	sig = sig * 2;
	sig = sig * EnvGen.ar(\adsr.kr(Env.adsr(1.01,0.1,1,1.1)),gate,doneAction:doneAction);
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
)

// All repetition lengths will be edited
// All instrument choices will be edited
(
var song0, song1, song2, song3, song4, song5, song6, song7, song8, song9, song10, song11, song12, song13, song14, song15, song16, song17, song18, song19, song20, song21, song22, song23, song24, song25, song26, song27, song28, song29, song30, song31, song32, song33, song34, song35, offset;

song0 = Pbind(
	\instrument, \harpsichord1,
	[\midinote, \dur],
	Pseq([
		[48, 1/4],
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
		[0, Rest(7/8)],[48, 1/16],[48, 1/16],[48, 1/16],[0, Rest(9/8)]
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
		[55, 1/16],[52, 1/16],[0, Rest(7/8)]
	],[3,4].choose),
);

song10 = Pbind(
	\instrument, \pluck,
	[\midinote, \dur],
	Pseq([
		[55, 1/16],[52, 1/16]
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
		[43, 1/16],[42, 1/16],[43, 1/16],
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
		[53, 1/16],[55, 1/16],[59, 1/16],[55, 1/16],[59, 1/16],[55, 1/16],[59, 1/16],[57, 1/16],[59, 1/16],[55, 1/16],
		[0, Rest(7/8)],
		[58, 1/4],[67, 3/4],[69, 1/8],[67, 1/4],[71, 1/8],[69, 3/8],[67, 1/8],[64, 3/4],[67, 1/8],[66, 7/8],
		[0, Rest(5/8)],
		[64, 5/8],[65, 3/2]
	],[4,5].choose),
);




/*
Ptpar([
0.0, Ppar([[song6,song14].choose, [song8,song29].choose],5),
12.0, Ppar([[song1,song2].choose, [song23,song22].choose],3),
24.0, Ppar([[song6,song14].choose, [song8,song29].choose],4),
36.0, Ppar([[song1,song2].choose, [song23,song22].choose, song35],4)
]).play(TempoClock(0.58))*/

offset = 0.0;

Ptpar([
	0.0-offset, Ppar([song0],4),
	3.984375-offset, Ppar([song1],4),
	5.984375-offset, Ppar([song2],4),
	10.0-offset, Ppar([song3],4),
	11.5-offset, Ppar([song4],4),
	9.0-offset, Ppar([song5],4),
	12.0-offset, Ppar([song6],4),
	13.0-offset, Ppar([song7],4),
	16.0-offset, Ppar([song8],4),
	17.0-offset, Ppar([song9],4),
	23.0-offset, Ppar([song10],4),
	26.5-offset, Ppar([song11],4),
	30.0-offset, Ppar([song12],4),
	34.0-offset, Ppar([song13],4),
	45.0-offset, Ppar([song14],2),
	47.5-offset, Ppar([song15],4),
	50.0-offset, Ppar([song16],4),
	52.0-offset, Ppar([song17],4),
	55.5-offset, Ppar([song18],4),
	62.0-offset, Ppar([song19],4),
	58.0-offset, Ppar([song20],4),
	64.0-offset, Ppar([song21],4),
	69.0-offset, Ppar([song22],4),
	72.0-offset, Ppar([song23],4),
	75.0-offset, Ppar([song24],4),
	78.0-offset, Ppar([song25],4),
	81.0-offset, Ppar([song26],4),
	92.0-offset, Ppar([song27],4),
	95.5-offset, Ppar([song28],4),
	97.0-offset, Ppar([song29],4),
	99.0-offset, Ppar([song30],4),
	104.5-offset, Ppar([song31],4),
	102.0-offset, Ppar([song32],4),
	107.0-offset, Ppar([song33],4),
	109.5-offset, Ppar([song34],4),
	112.0-offset, Ppar([song35],4),


]).play(TempoClock(0.39))
)

