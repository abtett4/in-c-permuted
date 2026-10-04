// scsynth in the browser (SuperSonic), plus the bits of sclang's default
// Event that the score relies on: which arguments a note sends, and the
// "gate 0" release that follows a gated note.

const SUPERSONIC_VERSION = '0.88.0';
const CDNS = ['https://cdn.jsdelivr.net/npm/', 'https://unpkg.com/'];

export const MAX_MODULES = 53;     // inc_mixer has this many stereo inputs
const FIRST_BUS = 64;              // module i plays into buses FIRST_BUS + 2i, +1
const SYNTH_GROUP = 100;
const MIXER_GROUP = 101;
const MIXER_NODE = 102;

// What a default Pbind event sends when the SynthDef has a control of that name.
const EVENT_DEFAULTS = { amp: 0.1, pan: 0, legato: 0.8 };

export class Engine {
  constructor() {
    this.sonic = null;
    this.osc = null;
    this.defs = {};          // name -> { controls: Set }
    this.onLevels = null;    // (Float32 array of module peaks, [L, R] master) => void
    this.gains = new Array(MAX_MODULES).fill(1);
  }

  get ready() { return !!this.sonic; }

  async boot(synthDefNames, onStatus = () => {}) {
    let lastErr;
    for (const cdn of CDNS) {
      try {
        onStatus(`Loading SuperCollider engine (${new URL(cdn).host})…`);
        const { SuperSonic } = await import(`${cdn}supersonic-scsynth@${SUPERSONIC_VERSION}/dist/supersonic.js`);
        const sonic = new SuperSonic({
          mode: 'postMessage',
          baseURL: `${cdn}supersonic-scsynth@${SUPERSONIC_VERSION}/dist/`,
          coreBaseURL: `${cdn}supersonic-scsynth-core@${SUPERSONIC_VERSION}/`,
          wasmBaseURL: `${cdn}supersonic-scsynth-core@${SUPERSONIC_VERSION}/wasm/`,
          scsynthOptions: { maxWireBufs: 512 },
        });
        onStatus('Booting scsynth…');
        await sonic.init();
        this.sonic = sonic;
        this.osc = SuperSonic.osc;
        break;
      } catch (err) {
        console.warn('SuperSonic boot failed via', cdn, err);
        lastErr = err;
      }
    }
    if (!this.sonic) throw new Error(`Couldn't start the audio engine: ${lastErr && lastErr.message}`);

    this.sonic.on('in', msg => {
      if (msg[0] === '/inc/levels' && this.onLevels) this.onLevels(msg.slice(3));
    });

    onStatus('Loading SynthDefs…');
    const failed = [];
    for (const name of [...synthDefNames, 'inc_mixer']) {
      try {
        const res = await fetch(`synthdefs/${name}.scsyndef`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = await res.arrayBuffer();
        this.defs[name] = { controls: new Set(readControlNames(bytes)) };
        await this.sonic.loadSynthDef(bytes);
      } catch (err) {
        console.warn(`SynthDef ${name} failed to load`, err);
        delete this.defs[name];
        failed.push(name);
      }
    }
    if (!this.defs.inc_mixer) throw new Error('The mixer SynthDef (synthdefs/inc_mixer.scsyndef) is missing.');

    this.sonic.send('/notify', 1);   // SendReply (the meters) only reaches registered clients
    this.sonic.send('/g_new', SYNTH_GROUP, 0, 0);
    this.sonic.send('/g_new', MIXER_GROUP, 3, SYNTH_GROUP);
    this.sonic.send('/s_new', 'inc_mixer', MIXER_NODE, 0, MIXER_GROUP, 'firstBus', FIRST_BUS);
    this.setGains(this.gains);
    onStatus('');
    return { instruments: Object.keys(this.defs).filter(n => n !== 'inc_mixer'), failed };
  }

  // Seconds on the engine's own clock (NTP). Use this for scheduling.
  now() {
    return this.sonic ? this.sonic.clock.now() : performance.now() / 1000;
  }

  // One note of one module, sent as timestamped bundles so timing is exact.
  // Mirrors what Pbind's default event does with the same values.
  playNote({ time, instrument, midinote, dur, tempo, moduleIndex, extras = {} }) {
    const def = this.defs[instrument];
    if (!def || !this.sonic) return;
    const c = def.controls;
    const bus = FIRST_BUS + 2 * moduleIndex;
    const values = { ...EVENT_DEFAULTS, ...extras };
    const legato = values.legato;
    const notes = Array.isArray(midinote) ? midinote : [midinote];

    for (const note of notes) {
      const id = this.sonic.nextNodeId();
      const args = ['/s_new', instrument, id, 0, SYNTH_GROUP];
      if (c.has('out')) args.push('out', bus);
      if (c.has('outbus')) args.push('outbus', bus);
      if (c.has('freq')) args.push('freq', midicps(note));
      if (c.has('midinote')) args.push('midinote', note);
      if (c.has('dur')) args.push('dur', dur);
      if (c.has('sustain')) args.push('sustain', dur * legato / tempo);
      for (const [k, v] of Object.entries(values)) {
        if (c.has(k) && k !== 'sustain') args.push(k, v);
      }
      this.sonic.sendOSC(this.osc.encodeBundle(time, [args]));
      if (c.has('gate')) {
        this.sonic.sendOSC(this.osc.encodeBundle(time + (dur * legato) / tempo, [['/n_set', id, 'gate', 0]]));
      }
    }
  }

  setGains(gains) {
    this.gains = gains;
    if (this.sonic) this.sonic.send('/n_setn', MIXER_NODE, 'gains', MAX_MODULES, ...gains);
  }

  setMaster(amp) {
    if (this.sonic) this.sonic.send('/n_set', MIXER_NODE, 'master', amp);
  }

  setLimiter(on) {
    if (this.sonic) this.sonic.send('/n_set', MIXER_NODE, 'limit', on ? 1 : 0);
  }

  // Drop everything that's scheduled and let sounding notes ring out.
  async stopAll() {
    if (!this.sonic) return;
    await this.sonic.purge();
    this.sonic.send('/n_set', SYNTH_GROUP, 'gate', 0);
  }
}

export function midicps(n) {
  return 440 * 2 ** ((n - 69) / 12);
}

// Reads the control (argument) names from a compiled .scsyndef file, so the
// page can send each SynthDef only the arguments it actually has.
export function readControlNames(buffer) {
  const v = new DataView(buffer);
  let p = 0;
  const tag = String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3));
  if (tag !== 'SCgf') throw new Error('not a SynthDef file');
  const version = v.getInt32(4);
  p = 10; // tag, version, numDefs (int16)
  const int = () => {
    if (version >= 2) { const x = v.getInt32(p); p += 4; return x; }
    const x = v.getInt16(p); p += 2; return x;
  };
  const pstring = () => {
    const len = v.getUint8(p++);
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(v.getUint8(p++));
    return s;
  };
  pstring();                     // def name
  const numConsts = int(); p += 4 * numConsts;
  const numParams = int(); p += 4 * numParams;
  const numNames = int();
  const names = [];
  for (let i = 0; i < numNames; i++) { names.push(pstring()); int(); }
  return names;
}
