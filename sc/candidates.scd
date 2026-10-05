// SynthDefs to audition next to the ones in Tett_A_In_C_2026.scd. They are
// NOT used by the piece: the page shows each one right after the SynthDef it
// belongs with, in the Audition panel.
//
// Right now: the previous midsine and starlet, so the boosted versions in the
// .scd can be compared with them. Delete this file (or empty its block) once
// you've decided.

(
SynthDef(\midsine_old, { |out, amp=0.1, freq=3136|
	var snd, env;
	snd = SinOsc.ar(freq);
	snd = Clip.ar(snd, -0.9, 0.9);
	env=Env.linen(0.005, 0.050, 0.010);
	snd = snd * EnvGen.ar(env, doneAction: Done.freeSelf);
	snd = snd * amp;
	Out.ar(out, snd!2);
}).add;

SynthDef(\starlet_old, { arg out=0, amp=5.0, gate=1, pan=0, spread=0.8, midinote=30, doneAction=2;
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
	sig = Splay.ar(sig, spread, amp, pan);
	Out.ar(out, sig);
}).add;
)
