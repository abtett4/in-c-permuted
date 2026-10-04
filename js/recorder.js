// Records the master output (after the mixer, master level and limiter) to a
// 16-bit stereo WAV. A small AudioWorklet taps scsynth's output, converts it
// to 16-bit as it goes and hands it over in one-second chunks; nothing is
// re-encoded, so the file is exactly what you heard.

const WORKLET = `
class IncRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = false;
    this.buf = [];
    this.n = 0;
    this.port.onmessage = e => {
      if (e.data === 'start') this.on = true;
      else if (e.data === 'stop') { this.on = false; this.flush(); this.port.postMessage('done'); }
    };
  }
  process(inputs) {
    const x = inputs[0];
    if (this.on && x && x.length) {
      const L = x[0], R = x[1] || x[0];
      const out = new Int16Array(L.length * 2);
      for (let i = 0; i < L.length; i++) {
        out[2 * i] = Math.max(-1, Math.min(1, L[i])) * 32767;
        out[2 * i + 1] = Math.max(-1, Math.min(1, R[i])) * 32767;
      }
      this.buf.push(out);
      this.n += L.length;
      if (this.n >= sampleRate) this.flush();
    }
    return true;
  }
  flush() {
    if (!this.buf.length) return;
    this.port.postMessage(this.buf, this.buf.map(b => b.buffer));
    this.buf = [];
    this.n = 0;
  }
}
registerProcessor('inc-recorder', IncRecorder);
`;

export class Recorder {
  constructor(engine) {
    this.engine = engine;
    this.node = null;
    this.chunks = [];
    this.frames = 0;
    this.sampleRate = 48000;
    this.recording = false;
    this.onDone = null;
  }

  get seconds() {
    return this.frames / this.sampleRate;
  }

  async start() {
    const ctx = this.engine.sonic.audioContext;
    if (!this.node) {
      await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })));
      this.node = new AudioWorkletNode(ctx, 'inc-recorder', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        channelCount: 2, channelCountMode: 'explicit',
      });
      this.node.port.onmessage = e => {
        if (e.data === 'done') return this.finish();
        for (const c of e.data) {
          this.chunks.push(c);
          this.frames += c.length / 2;
        }
      };
      this.engine.sonic.node.connect(this.node);
      // A worklet only runs while something pulls on it, so route it to the
      // speakers through a muted gain.
      const mute = ctx.createGain();
      mute.gain.value = 0;
      this.node.connect(mute).connect(ctx.destination);
    }
    this.sampleRate = ctx.sampleRate;
    this.chunks = [];
    this.frames = 0;
    this.recording = true;
    this.node.port.postMessage('start');
  }

  // Resolves with the WAV as a Blob.
  stop() {
    if (!this.recording) return Promise.resolve(null);
    return new Promise(resolve => {
      this.onDone = resolve;
      this.node.port.postMessage('stop');
    });
  }

  finish() {
    this.recording = false;
    const blob = wavBlob(this.chunks, this.sampleRate);
    this.chunks = [];
    if (this.onDone) this.onDone(blob);
    this.onDone = null;
  }
}

function wavBlob(chunks, sampleRate) {
  const dataBytes = chunks.reduce((n, c) => n + c.byteLength, 0);
  const h = new DataView(new ArrayBuffer(44));
  const str = (o, s) => [...s].forEach((ch, i) => h.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  h.setUint32(4, 36 + dataBytes, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  h.setUint32(16, 16, true);        // fmt chunk size
  h.setUint16(20, 1, true);         // PCM
  h.setUint16(22, 2, true);         // stereo
  h.setUint32(24, sampleRate, true);
  h.setUint32(28, sampleRate * 4, true);
  h.setUint16(32, 4, true);         // bytes per frame
  h.setUint16(34, 16, true);        // bits per sample
  str(36, 'data');
  h.setUint32(40, dataBytes, true);
  return new Blob([h.buffer, ...chunks], { type: 'audio/wav' });
}
