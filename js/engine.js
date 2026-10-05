// scsynth in the browser (SuperSonic), plus the bits of sclang's default
// Event that the score relies on: which arguments a note sends, and the
// "gate 0" release that follows a gated note.

const SUPERSONIC_VERSION = '0.88.0';
const CDNS = ['https://cdn.jsdelivr.net/npm/', 'https://unpkg.com/'];

export const MAX_MODULES = 64;     // two inc_strip synths of 32 channels each
const STRIP_SIZE = 32;
const FIRST_BUS = 64;              // module i plays into buses FIRST_BUS + 2i, +1
const MASTER_BUS = 60;             // the strips sum onto this pair
const SYNTH_GROUP = 100;
const MIXER_GROUP = 101;
const STRIP_NODES = [102, 103];
const MASTER_NODE = 104;
const MIXER_DEFS = ['inc_strip', 'inc_master'];

// What a default Pbind event sends when the SynthDef has a control of that name.
const EVENT_DEFAULTS = { amp: 0.1, pan: 0, legato: 0.8 };

export class Engine {
  constructor() {
    this.sonic = null;
    this.osc = null;
    this.defs = {};          // name -> { controls: Set }
    this.onLevels = null;    // (Float32 array of module peaks, [L, R] master) => void
    this.gains = new Array(MAX_MODULES).fill(1);
    this.pans = new Array(MAX_MODULES).fill(0);
    this.levels = new Float32Array(MAX_MODULES + 2);   // modules, then master L, R
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

    // Each strip reports its 32 modules (replyID says which strip); the master
    // reports last, so that's when the whole set goes to the page.
    this.sonic.on('in', msg => {
      if (msg[0] === '/inc/levels') {
        this.levels.set(msg.slice(3, 3 + STRIP_SIZE), msg[2] * STRIP_SIZE);
      } else if (msg[0] === '/inc/master') {
        this.levels[MAX_MODULES] = msg[3];
        this.levels[MAX_MODULES + 1] = msg[4];
        if (this.onLevels) this.onLevels(this.levels);
      }
    });

    onStatus('Loading SynthDefs…');
    const failed = [];
    this.defBytes = {};
    for (const name of [...synthDefNames, ...MIXER_DEFS]) {
      try {
        const res = await fetch(`synthdefs/${name}.scsyndef`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = await res.arrayBuffer();
        this.defs[name] = { controls: new Set(readControlNames(bytes)) };
        this.defBytes[name] = bytes;
      } catch (err) {
        console.warn(`SynthDef ${name} failed to load`, err);
        delete this.defs[name];
        failed.push(name);
      }
    }
    const missing = MIXER_DEFS.filter(n => !this.defs[n]);
    if (missing.length) throw new Error(`The mixer SynthDefs are missing: ${missing.join(', ')} (run sc/build_synthdefs.scd).`);
    await this.buildAndVerify();

    // SuperSonic sometimes restarts its engine by itself (e.g. after the
    // browser interrupted audio). That brings back a bare server: rebuild the
    // groups and the mixer, and restore the levels, or everything goes silent.
    this.sonic.on('reload:complete', ({ success }) => {
      if (success) this.buildAndVerify().catch(err => console.error('Rebuilding after an engine restart failed', err));
    });

    onStatus('');
    return { instruments: Object.keys(this.defs).filter(n => !MIXER_DEFS.includes(n)), failed };
  }

  // Right after boot (and after an engine restart) scsynth can drop commands
  // sent before it's fully up, so build, then ask the server what it actually
  // has, and build again until the SynthDefs and the mixer are really there.
  async buildAndVerify(tries = 8) {
    const wanted = Object.keys(this.defBytes).length;
    for (let i = 0; i < tries; i++) {
      await this.build();
      const s = await this.serverStatus();
      if (s && s.synthDefs >= wanted && s.synths >= STRIP_NODES.length + 1) return;
      await new Promise(r => setTimeout(r, 250 * (i + 1)));
    }
    throw new Error('The audio engine started but did not accept the SynthDefs. Try reloading the page.');
  }

  // { ugens, synths, groups, synthDefs } from /status, or null if no reply.
  serverStatus(timeout = 1000) {
    return new Promise(resolve => {
      const timer = setTimeout(() => { off(); resolve(null); }, timeout);
      const off = this.sonic.on('in', m => {
        if (m[0] !== '/status.reply') return;
        clearTimeout(timer);
        off();
        resolve({ ugens: m[2], synths: m[3], groups: m[4], synthDefs: m[5] });
      });
      this.sonic.send('/status');
    });
  }

  // Loads the SynthDefs and sets up the node tree: synths in one group, the
  // mixer in a group after it, with the current fader, pan and master values.
  async build() {
    this.sonic.send('/g_freeAll', 0);   // start clean if this is a second try
    for (const bytes of Object.values(this.defBytes)) await this.sonic.loadSynthDef(bytes.slice(0));
    this.sonic.send('/notify', 1);   // SendReply (the meters) only reaches registered clients
    this.sonic.send('/g_new', SYNTH_GROUP, 0, 0);
    this.sonic.send('/g_new', MIXER_GROUP, 3, SYNTH_GROUP);
    STRIP_NODES.forEach((id, i) => {
      this.sonic.send('/s_new', 'inc_strip', id, 1, MIXER_GROUP,
        'firstBus', FIRST_BUS + 2 * STRIP_SIZE * i, 'out', MASTER_BUS, 'replyID', i);
    });
    this.sonic.send('/s_new', 'inc_master', MASTER_NODE, 1, MIXER_GROUP, 'in', MASTER_BUS);
    this.setGains(this.gains);
    this.setPans(this.pans);
    if (this.master != null) this.setMaster(this.master);
    if (this.limit != null) this.setLimiter(this.limit);
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
    this.sendToStrips('gains', gains);
  }

  // -1 (left) .. 1 (right), one per module.
  setPans(pans) {
    this.pans = pans;
    this.sendToStrips('pans', pans);
  }

  sendToStrips(control, values) {
    if (!this.sonic) return;
    STRIP_NODES.forEach((id, i) => {
      const part = values.slice(i * STRIP_SIZE, (i + 1) * STRIP_SIZE);
      while (part.length < STRIP_SIZE) part.push(control === 'gains' ? 1 : 0);
      this.sonic.send('/n_setn', id, control, STRIP_SIZE, ...part);
    });
  }

  setMaster(amp) {
    this.master = amp;
    if (this.sonic) this.sonic.send('/n_set', MASTER_NODE, 'master', amp);
  }

  setLimiter(on) {
    this.limit = on;
    if (this.sonic) this.sonic.send('/n_set', MASTER_NODE, 'limit', on ? 1 : 0);
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
