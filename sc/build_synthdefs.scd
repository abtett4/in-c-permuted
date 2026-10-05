// Builds the .scsyndef files the web page loads (../synthdefs/).
//
// The instruments come straight from the SynthDef block of Tett_A_In_C_2026.scd
// (the first ( ... ) block containing a SynthDef), so that file is the only
// place they're written. Edit them there, then run this whole file in
// SuperCollider (Ctrl+Enter inside the outer parens). No server is needed.
//
// One rule for the web version: write to `out`, not to bus 0
// (Out.ar(out, sig), with an `out` argument), so each module can have its own
// fader, pan and meter. This script warns about any SynthDef that doesn't.

(
var here = PathName(thisProcess.nowExecutingPath).pathOnly;
var dir = here +/+ ".." +/+ "synthdefs";
var block, strip, master, buildFile;

// The first top-level ( ... ) block that contains a SynthDef, skipping
// comments, strings and character literals.
var findSynthDefBlock = { |s|
	var depth = 0, start, i = 0, result, c, inLine = false, inBlock = 0, inStr = false;
	while { i < s.size and: { result.isNil } } {
		c = s[i];
		case
		{ inLine } { if (c == $\n) { inLine = false } }
		{ inBlock > 0 } {
			if (c == $* and: { s[i + 1] == $/ }) { inBlock = inBlock - 1; i = i + 1 } {
				if (c == $/ and: { s[i + 1] == $* }) { inBlock = inBlock + 1; i = i + 1 }
			}
		}
		{ inStr } { if (c == $\\) { i = i + 1 } { if (c == $") { inStr = false } } }
		{ c == $/ and: { s[i + 1] == $/ } } { inLine = true }
		{ c == $/ and: { s[i + 1] == $* } } { inBlock = 1; i = i + 1 }
		{ c == $" } { inStr = true }
		{ c == $$ } { i = i + 1 }
		{ c == $( } { if (depth == 0) { start = i }; depth = depth + 1 }
		{ c == $) } {
			depth = depth - 1;
			if (depth == 0 and: { s.copyRange(start, i).find("SynthDef(").notNil }) {
				result = s.copyRange(start + 1, i - 1);
			};
		};
		i = i + 1;
	};
	result
};

// Runs a file's SynthDef block (its .add calls register each SynthDef
// locally) and writes whatever it defined.
buildFile = { |name|
	var src = File.readAllString(here +/+ name);
	var block = findSynthDefBlock.(src);
	var before, added;
	if (block.isNil) { Error("No SynthDef block found in " ++ name).throw };
	before = SynthDescLib.global.synthDescs.copy;
	block.interpret;
	added = SynthDescLib.global.synthDescs.select { |desc, key| before[key] !== desc };
	added.do { |desc|
		var toZero = desc.def.children.any { |u| u.class.name == \Out and: { u.inputs[0] == 0 } };
		if (toZero) {
			("WARNING: " ++ desc.name ++ " writes to bus 0. Change it to Out.ar(out, ...) with an `out` argument, "
				++ "or the web mixer can't give it a fader, pan or meter.").postln;
		};
		desc.def.writeDefFile(dir);
		("wrote " ++ desc.name).postln;
	};
};

File.mkdir(dir);
buildFile.("Tett_A_In_C_2026.scd");
// Proposed replacements, auditioned on the page but not used by the piece.
if (File.exists(here +/+ "candidates.scd")) { buildFile.("candidates.scd") };

// ---- Web-only: the mixer -------------------------------------------------
// Every module plays into its own stereo bus (firstBus + 2*index). The page
// runs two inc_strip synths (modules 0-31 and 32-63), each applying its
// modules' faders and pans and summing them onto a master bus, then one
// inc_master for the master level, the safety limiter and the master meter.
// (One 64-channel synth would be over the 64 KB a single message to the
// browser's scsynth can carry.) Peak levels go back to the page 20x a second
// for the dB meters.
//
// The pan keeps a SynthDef's own stereo image when centred (left stays left,
// right stays right) and folds both channels toward a side as it turns, so it
// works the same on every SynthDef, whatever it does with its own `pan` arg.
// Folding a centred (mono) sound to one side adds its two channels together,
// so the level is trimmed by up to 3 dB as the pan moves out, keeping its
// loudness steady.
//
// The meters are true peak: PeakFollower watches every sample (so even a
// one-sample click registers) and falls back about 40 dB a second.
strip = SynthDef(\inc_strip, { |firstBus = 64, out = 60|
	var n = 32;
	var gains = \gains.kr(1 ! n, 0.05);
	var pans = \pans.kr(0 ! n, 0.05);
	var chans = n.collect { |i|
		var c = In.ar(firstBus + (i * 2), 2) * gains[i];
		var width = 1 - pans[i].abs;
		var trim = 1 - (0.2929 * pans[i].abs);
		(Pan2.ar(c[0], (pans[i] - width).clip(-1, 1)) + Pan2.ar(c[1], (pans[i] + width).clip(-1, 1))) * trim
	};
	var levels = chans.collect { |c| A2K.kr(PeakFollower.ar(max(c[0].abs, c[1].abs), 0.9999)) };
	SendReply.kr(Impulse.kr(20), '/inc/levels', levels, \replyID.kr(0));
	Out.ar(out, chans.sum);
});
strip.writeDefFile(dir);
"wrote inc_strip".postln;

master = SynthDef(\inc_master, { |in = 60, out = 0, master = 0.8, limit = 1|
	var mix = In.ar(in, 2) * master.lag(0.05);
	var sig = Select.ar(limit, [mix, Limiter.ar(mix, 0.95, 0.01)]);
	SendReply.kr(Impulse.kr(20), '/inc/master', sig.collect { |x| A2K.kr(PeakFollower.ar(x.abs, 0.9999)) });
	Out.ar(out, sig);
});
master.writeDefFile(dir);
"wrote inc_master".postln;
)
