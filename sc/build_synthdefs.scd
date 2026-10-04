// Builds the .scsyndef files the web page loads (../synthdefs/).
// Run this whole file in SuperCollider (Ctrl+Enter inside the parens) whenever
// you change a SynthDef. No server needs to be booted.
//
// The instrument SynthDefs are copied from Tett_A_In_C.scd. The only change
// is that "pluck" now takes an `out` argument instead of writing straight to
// bus 0, so the web mixer can give it its own fader and meter like the others.

(
var dir = PathName(thisProcess.nowExecutingPath).pathOnly +/+ ".." +/+ "synthdefs";
var defs = List.new;

File.mkdir(dir);

//from 10karplusStrong.scd by John Drumheller
defs.add(SynthDef("pluck",
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
));

defs.add(SynthDef(\bass, { |outbus, midinote|
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
}));

//https://sccode.org/1-522
defs.add(SynthDef(\star, {
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
}));

defs.add(SynthDef(\starlet, { arg out=0, amp=5.0, gate=1, pan=0, spread=0.8, midinote=30, doneAction=2;
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
}));

defs.add(SynthDef("harpsichord1", {
	arg out = 0, midinote = 60, amp = 0.1, pan = 0, decay = 1;
	var env, snd, freq;
	freq = midinote.midicps;
	// decay = dur;
	env = Env.perc(releaseTime: decay, level: amp).kr(doneAction: 2);
	snd = Pulse.ar(freq, 0.25, 0.75);
	snd = snd * env;
	Out.ar(out, Pan2.ar(snd, pan));
}));

// ---- Web-only: the mixer -------------------------------------------------
// Every module plays into its own stereo bus (firstBus + 2*index). This synth
// applies each module's fader, sums them, applies the master level and an
// optional safety limiter, and reports peak levels back to the page 20x a
// second for the dB meters. 53 slots, so all of Riley's modules fit.
defs.add(SynthDef(\inc_mixer, { |firstBus = 64, out = 0, master = 0.8, limit = 1|
	var n = 53;
	var gains = \gains.kr(1 ! n, 0.05);
	var chans = n.collect { |i| In.ar(firstBus + (i * 2), 2) * gains[i] };
	var levels = chans.collect { |c| Amplitude.kr(c, 0.002, 0.25).reduce(\max) };
	var mix = chans.sum * master.lag(0.05);
	var sig = Select.ar(limit, [mix, Limiter.ar(mix, 0.95, 0.01)]);
	SendReply.kr(Impulse.kr(20), '/inc/levels', levels ++ Amplitude.kr(sig, 0.002, 0.25));
	Out.ar(out, sig);
}));

defs.do { |def| def.writeDefFile(dir); ("wrote " ++ def.name).postln };
)
