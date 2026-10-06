// Reads the score straight out of the SuperCollider file.
//
// This is not a full sclang interpreter. It understands the subset the piece
// is written in: Pbind / Pseq / Rest / [a, b].choose for the modules, and one
// of two forms for the whole piece:
//
//   arranged:   Ptpar([time, Ppar([songN], n), ...]).play(TempoClock(t))
//   Riley mode: Ppar([pulse] ++ nPlayers.collect { |p| player.(p, [\a, \b].choose) })
//                 .play(TempoClock(t)), with the module order in an array of
//                 the songN Pbinds and the player's rules in its function.
//
// SynthDef names are collected so the page knows which instruments exist.

// The names of the SynthDefs a file defines (ignoring commented-out ones).
export function synthDefNamesIn(src) {
  return namesFromTokens(tokenize(stripComments(src)));
}

// Names starting inc_ are machinery (the per-player panner), not instruments.
function namesFromTokens(tokens) {
  const names = [];
  for (let i = 0; i < tokens.length - 2; i++) {
    if (tokens[i].v === 'SynthDef' && tokens[i + 1].v === '(') {
      const t = tokens[i + 2];
      if ((t.type === 'symbol' || t.type === 'string') && !names.includes(t.v) && !t.v.startsWith('inc_')) names.push(t.v);
    }
  }
  return names;
}

export function parseScd(src) {
  const code = stripComments(src);
  const tokens = tokenize(code);
  const warnings = [];
  const synthDefNames = namesFromTokens(tokens);

  // The score lives in the last top-level ( ... ) block that has Pbinds in it.
  const blocks = topLevelBlocks(tokens);
  const block = [...blocks].reverse().find(b => b.some(t => t.v === 'Pbind'));
  if (!block) throw new Error('Could not find a ( ... ) block of Pbinds in the .scd file.');

  const env = {};
  const plays = [];
  for (const stmt of splitStatements(block)) {
    if (!stmt.length || stmt[0].v === 'arg') continue;
    try {
      if (stmt[0].v === 'var') {
        readVars(stmt, env);
      } else if (stmt.length > 2 && stmt[0].type === 'ident' && stmt[1].v === '=') {
        const p = new ExprParser(stmt, env);
        p.pos = 2;
        const v = p.parseExpr();
        if (v && typeof v === 'object' && !Array.isArray(v)) v.varName ??= stmt[0].v;
        env[stmt[0].v] = v;
      } else {
        const v = new ExprParser(stmt, env).parseExpr();
        if (v && v.type === 'play') plays.push(v);
      }
    } catch (err) {
      // Statements that don't build patterns (pos = 0 ! nPlayers, etc.) are
      // fine to skip; only mention the ones that look like part of the score.
      if (stmt.some(t => ['Pbind', 'Ptpar', 'Ppar'].includes(t.v))) {
        warnings.push(`Skipped a statement I couldn't read: ${err.message}`);
      }
    }
  }

  const play = plays[plays.length - 1];
  if (!play) throw new Error('Found the Pbinds but no Ptpar(...).play or Ppar(...).play that plays them.');
  let tempo = 1;
  const clock = play.args[0];
  if (clock && clock.type === 'TempoClock' && typeof clock.args[0] === 'number') tempo = clock.args[0];

  let arranged = null;
  let riley = null;
  if (play.target && play.target.type === 'Ptpar') arranged = readPtpar(play.target, env, warnings);
  else if (play.target && play.target.type === 'Ppar') riley = readRiley(play.target, env, warnings);
  else throw new Error('The piece should be played with Ptpar([...]) or Ppar([...]).');

  return { tempo, synthDefNames, warnings, arranged, riley };
}

// `var a, b = 12, c = 0.39;`: keep the initial values the score uses.
function readVars(stmt, env) {
  const parts = [[]];
  let depth = 0;
  for (const tok of stmt.slice(1)) {
    if (tok.type === 'op' && '([{'.includes(tok.v)) depth++;
    if (tok.type === 'op' && ')]}'.includes(tok.v)) depth--;
    if (depth === 0 && tok.v === ',') parts.push([]);
    else parts[parts.length - 1].push(tok);
  }
  for (const part of parts) {
    if (part.length > 2 && part[0].type === 'ident' && part[1].v === '=') {
      try {
        const p = new ExprParser(part, env);
        p.pos = 2;
        env[part[0].v] = p.parseExpr();
      } catch { /* not a value we need */ }
    }
  }
}

function labelModules(modules) {
  modules.forEach((m, i) => {
    m.index = i;
    const notes = m.cell.filter(e => !e.rest).flatMap(e => [].concat(e.midinote));
    m.lo = notes.length ? Math.min(...notes) : null;   // the module's range,
    m.hi = notes.length ? Math.max(...notes) : null;   // for registers.js
    const n = /(\d+)$/.exec(m.name);
    m.number = n ? Number(n[1]) : i;
    m.label = m.number === 0 ? 'Pulse' : String(m.number);
  });
  return modules;
}

// ---- Riley mode --------------------------------------------------------------

const RILEY_DEFAULTS = { nPlayers: 8, minStay: 45, maxStay: 90, maxLead: 3 };

function readRiley(ppar, env, warnings) {
  const arg = ppar.args[0];
  let pulsePbind = null;
  let collect = arg;
  if (arg && arg.type === 'binop' && arg.op === '++') {
    pulsePbind = Array.isArray(arg.a) ? arg.a[0] : null;
    collect = arg.b;
  }
  if (!collect || collect.type !== 'method' || collect.name !== 'collect') {
    throw new Error('In Riley mode, Ppar should be given [pulse] ++ nPlayers.collect { ... }.');
  }

  const nPlayers = typeof collect.target === 'number' ? collect.target : RILEY_DEFAULTS.nPlayers;
  const body = collect.args.find(a => a && a.type === 'func');
  const bodyTokens = body ? body.tokens : [];
  const pool = chooseList(bodyTokens);

  // The player's rules live in the function it calls (player.(p, ...)).
  const callee = bodyTokens.find((t, i) => t.type === 'ident' && bodyTokens[i + 1]?.v === '.' && bodyTokens[i + 2]?.v === '(');
  const rules = callee && env[callee.v] && env[callee.v].type === 'func' ? env[callee.v].tokens : [];
  const stay = rrandArgs(rules);
  const lead = leadLimit(rules);

  // The module order: the variable holding the longest array of Pbinds.
  let order = [];
  for (const v of Object.values(env)) {
    const list = Array.isArray(v) ? v : v && v.type === 'method' && Array.isArray(v.target) ? v.target : null;
    if (list && list.length > order.length && list.every(x => x && x.type === 'Pbind')) order = list;
  }
  if (!order.length) throw new Error('Riley mode: could not find the array of module Pbinds (modules = [song1, ...]).');

  const modules = [];
  if (pulsePbind && pulsePbind.type === 'Pbind') {
    const pulse = readPulse(pulsePbind);
    // The pulse's level range in dB (`pulseDb = [lo, hi]`), so it sits under
    // the players. Without it, it varies like any module.
    const db = env.pulseDb;
    if (Array.isArray(db) && db.length === 2 && db.every(x => typeof x === 'number')) pulse.gainRange = [Math.min(...db), Math.max(...db)];
    modules.push(pulse);
  } else {
    warnings.push('Riley mode: no pulse Pbind found before ++; playing without a pulse.');
  }
  for (const pb of order) {
    try {
      modules.push({ name: pb.varName ?? `pattern${modules.length}`, start: 0, pparChoices: [1], ...readPbind(pb) });
    } catch (err) {
      warnings.push(`${pb.varName}: ${err.message}`);
    }
  }

  return {
    nPlayers,
    pool: pool.length ? pool : null,
    minStay: stay ? stay[0] : RILEY_DEFAULTS.minStay,
    maxStay: stay ? stay[1] : RILEY_DEFAULTS.maxStay,
    maxLead: lead ?? RILEY_DEFAULTS.maxLead,
    // Players come in one at a time over this many seconds (`var entrySpread`
    // in the .scd); without it, everyone starts together.
    entrySpread: typeof env.entrySpread === 'number' ? env.entrySpread : 0,
    // Players' octaves (`octaves = \vary` or a number), how far "vary" may go
    // (`octRange`), and how wide the players are spread (`panSpread`).
    octaves: env.octaves && env.octaves.sym === 'vary' ? 'vary' : typeof env.octaves === 'number' ? env.octaves : 0,
    octRange: typeof env.octRange === 'number' ? env.octRange : null,
    panSpread: typeof env.panSpread === 'number' ? env.panSpread : null,
    // Rests between modules: how often (`restChance`) and how long, in
    // seconds (`restRange = [min, max]`). Without them, nobody rests.
    restChance: typeof env.restChance === 'number' ? env.restChance : 0,
    // The ending: everyone plays 53 together for `endHold` seconds, then drops
    // out one at a time over `endSpread` seconds. Without them, everyone stops
    // as soon as the last player arrives and finishes its pass.
    // Joining in step: how often a player arriving where someone is already
    // playing listens and joins them (`joinChance`), and the longest it will
    // listen, in seconds (`joinMax`).
    joinChance: typeof env.joinChance === 'number' ? env.joinChance : 0,
    joinMin: typeof env.joinMin === 'number' ? env.joinMin : 0.5,
    joinMax: typeof env.joinMax === 'number' ? env.joinMax : 8,
    endHold: typeof env.endHold === 'number' ? env.endHold : 0,
    endSpread: typeof env.endSpread === 'number' ? env.endSpread : 0,
    restRange: Array.isArray(env.restRange) && env.restRange.length === 2 && env.restRange.every(x => typeof x === 'number') ? env.restRange : [2, 8],
    hasPulse: !!(pulsePbind && pulsePbind.type === 'Pbind'),
    modules: labelModules(modules),
  };
}

// The pulse: \instrument, \midinote and a \dur that may be wrapped in
// Pwhile({ ... }, Pseq([1/8], 1)) so it stops when the players do.
function readPulse(pbind) {
  const a = pbind.args;
  const get = key => { for (let i = 0; i + 1 < a.length; i += 2) if (a[i] && a[i].sym === key) return a[i + 1]; return undefined; };
  const instrument = get('instrument');
  const midinote = firstNumber(get('midinote')) ?? 60;
  const dur = firstNumber(get('dur')) ?? 1 / 8;
  return {
    name: 'pulse', start: 0, pparChoices: [1], seqChoices: [Infinity], extras: {},
    instrument: instrument ? instrument.sym ?? instrument.str : 'default',
    cell: [{ midinote, dur, rest: false }], cellBeats: dur, isPulse: true,
  };
}

function firstNumber(v) {
  if (typeof v === 'number') return v;
  if (Array.isArray(v)) { for (const x of v) { const n = firstNumber(x); if (n != null) return n; } return null; }
  if (v && Array.isArray(v.args)) { for (const x of v.args) { const n = firstNumber(x); if (n != null) return n; } }
  return null;
}

// [\a, \b, ...].choose inside a function body -> ['a', 'b', ...]
function chooseList(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].v !== ']' || tokens[i + 1]?.v !== '.' || tokens[i + 2]?.v !== 'choose') continue;
    const syms = [];
    for (let j = i - 1; j >= 0 && tokens[j].v !== '['; j--) if (tokens[j].type === 'symbol') syms.unshift(tokens[j].v);
    if (syms.length) return syms;
  }
  return [];
}

// rrand(45, 90) -> [45, 90]
function rrandArgs(tokens) {
  for (let i = 0; i + 5 < tokens.length; i++) {
    const t = tokens.slice(i, i + 6);
    if (t[0].v === 'rrand' && t[1].v === '(' && t[2].type === 'num' && t[3].v === ',' && t[4].type === 'num' && t[5].v === ')') {
      return [t[2].v, t[4].v];
    }
  }
  return null;
}

// ... pos.minItem >= 3 -> 3
function leadLimit(tokens) {
  for (let i = 0; i + 3 < tokens.length; i++) {
    if (tokens[i].v === 'minItem' && tokens[i + 1].v === '>' && tokens[i + 2].v === '=' && tokens[i + 3].type === 'num') return tokens[i + 3].v;
  }
  return null;
}

// ---- Arranged (Ptpar) ----------------------------------------------------------

function readPtpar(ptpar, env, warnings) {
  if (!Array.isArray(ptpar.args[0])) {
    throw new Error('Ptpar should be given an array of [time, pattern, ...] pairs.');
  }
  const list = ptpar.args[0];
  const modules = [];
  for (let i = 0; i + 1 < list.length; i += 2) {
    const start = num(list[i]);
    let pat = list[i + 1];
    let pparChoices = [1];
    let names = [];
    if (pat && pat.type === 'Ppar') {
      pparChoices = repeatChoices(pat.args[1] ?? 1);
      names = Array.isArray(pat.args[0]) ? pat.args[0] : [pat.args[0]];
    } else {
      names = [pat];
    }
    for (const ref of names) {
      const name = ref && (ref.varName ?? (ref.type === 'var' ? ref.name : null));
      const pbind = ref && ref.type === 'var' ? env[ref.name] : ref;
      if (!pbind || pbind.type !== 'Pbind') {
        warnings.push(`Entry at beat ${start} isn't a Pbind I can read; skipped.`);
        continue;
      }
      try {
        modules.push({ name: name ?? `pattern${modules.length}`, start, pparChoices, ...readPbind(pbind) });
      } catch (err) {
        warnings.push(`${name}: ${err.message}`);
      }
    }
  }

  return labelModules(modules);
}

// ---- Pbind -> one module ---------------------------------------------------

function readPbind(pbind) {
  const args = pbind.args;
  let instrument = 'default';
  let seq = null;
  let seqKeys = null;
  const constants = {};

  for (let i = 0; i + 1 < args.length; i += 2) {
    const key = args[i];
    const val = args[i + 1];
    const keys = Array.isArray(key) ? key.map(k => k.sym) : [key && key.sym];
    if (keys.some(k => !k)) throw new Error('Pbind keys should be symbols like \\midinote.');
    if (keys[0] === 'instrument' && keys.length === 1) {
      instrument = val.sym ?? val.str ?? String(val);
    } else if (val && val.type === 'Pseq') {
      if (seq) throw new Error('only one Pseq per Pbind is supported.');
      seq = val;
      seqKeys = keys;
    } else if (keys.length === 1) {
      constants[keys[0]] = val;
    }
  }
  if (!seq) throw new Error('no Pseq found.');

  const items = seq.args[0];
  if (!Array.isArray(items)) throw new Error('Pseq should be given an array.');
  const cell = items.map(item => {
    const vals = seqKeys.length > 1 ? item : [item];
    const ev = { midinote: num(constants.midinote ?? 60), dur: num(constants.dur ?? 1), rest: false };
    seqKeys.forEach((k, j) => {
      let v = vals[j];
      if (v && v.type === 'Rest') { ev.rest = true; v = v.args[0] ?? 1; }
      if (k === 'midinote') ev.midinote = Array.isArray(v) ? v.map(num) : num(v);
      else if (k === 'dur') ev.dur = num(v);
      else ev[k] = num(v);
    });
    return ev;
  });

  const extras = {};
  for (const [k, v] of Object.entries(constants)) {
    if (k !== 'midinote' && k !== 'dur' && typeof v === 'number') extras[k] = v;
  }

  return {
    instrument,
    cell,
    cellBeats: cell.reduce((s, e) => s + e.dur, 0),
    seqChoices: repeatChoices(seq.args[1] ?? 1),
    extras,
  };
}

function repeatChoices(v) {
  if (typeof v === 'number') return [v];
  if (v && v.type === 'choose') return v.options.map(num);
  if (v && v.type === 'var' && v.name === 'inf') return [Infinity];
  throw new Error('repeat counts should be a number or [a, b].choose');
}

function num(v) {
  if (typeof v === 'number') return v;
  throw new Error(`expected a number, got ${describe(v)}`);
}

function describe(v) {
  if (v && v.type === 'var') return v.name;
  if (v && v.type) return v.type;
  return JSON.stringify(v);
}

// ---- Expression parser -----------------------------------------------------
// sclang evaluates binary operators strictly left to right (no precedence),
// and so does this.

const KNOWN_CLASSES = new Set(['Pbind', 'Pseq', 'Rest', 'Ppar', 'Ptpar', 'TempoClock', 'Prand', 'Pxrand', 'Pwhite']);

class ExprParser {
  constructor(tokens, env) {
    this.t = tokens;
    this.pos = 0;
    this.env = env;
  }
  peek(o = 0) { return this.t[this.pos + o]; }
  next() { return this.t[this.pos++]; }
  expect(v) {
    const tok = this.next();
    if (!tok || tok.v !== v) throw new Error(`expected "${v}" near "${tok ? tok.v : 'end'}"`);
  }

  parseExpr() {
    let left = this.parsePostfix();
    for (;;) {
      const tok = this.peek();
      if (!tok || tok.type !== 'op' || !['+', '-', '*', '/', '%', '**', '++'].includes(tok.v)) return left;
      this.next();
      const right = this.parsePostfix();
      left = binop(tok.v, left, right);
    }
  }

  parsePostfix() {
    let v = this.parsePrimary();
    while (this.peek() && this.peek().v === '.') {
      this.next();
      if (this.peek() && this.peek().v === '(') {
        // f.(args): calling a function
        v = { type: 'call', target: v, args: this.parseArgs() };
        continue;
      }
      const name = this.next();
      if (!name || name.type !== 'ident') throw new Error('expected a method name after "."');
      let args = [];
      if (this.peek() && this.peek().v === '(') args = this.parseArgs();
      if (this.peek() && this.peek().v === '{') args.push(this.parseFunc());   // x.collect { ... }
      if (name.v === 'choose' && Array.isArray(v)) v = { type: 'choose', options: v };
      else if (name.v === 'play') v = { type: 'play', target: v, args };
      else v = { type: 'method', name: name.v, target: v, args };
    }
    return v;
  }

  parseArgs() {
    this.expect('(');
    const args = [];
    while (this.peek() && this.peek().v !== ')') {
      if (this.peek().type === 'ident' && this.peek(1) && this.peek(1).v === ':') {
        this.next();
        this.next();
      }
      args.push(this.parseExpr());
      if (this.peek() && this.peek().v === ',') this.next();
    }
    this.expect(')');
    return args;
  }

  // { ... }: not evaluated, but its tokens are kept so the Riley-mode reader
  // can look inside (the instrument list, rrand(45, 90), etc.).
  parseFunc() {
    this.expect('{');
    const start = this.pos;
    let depth = 1;
    while (this.peek() && depth > 0) {
      const t = this.next();
      if (t.type === 'op' && t.v === '{') depth++;
      if (t.type === 'op' && t.v === '}') depth--;
    }
    if (depth > 0) throw new Error('unclosed {');
    return { type: 'func', tokens: this.t.slice(start, this.pos - 1) };
  }

  parsePrimary() {
    if (this.peek() && this.peek().v === '{') return this.parseFunc();
    const tok = this.next();
    if (!tok) throw new Error('unexpected end of expression');
    if (tok.type === 'num') return tok.v;
    if (tok.v === '-' && this.peek() && this.peek().type === 'num') return -this.next().v;
    if (tok.type === 'symbol') return { sym: tok.v };
    if (tok.type === 'string') return { str: tok.v, sym: tok.v };
    if (tok.v === '[') {
      const items = [];
      while (this.peek() && this.peek().v !== ']') {
        items.push(this.parseExpr());
        if (this.peek() && this.peek().v === ',') this.next();
      }
      this.expect(']');
      return items;
    }
    if (tok.v === '(') {
      const v = this.parseExpr();
      this.expect(')');
      return v;
    }
    if (tok.type === 'class') {
      const args = this.peek() && this.peek().v === '(' ? this.parseArgs() : [];
      if (!KNOWN_CLASSES.has(tok.v)) return { type: 'class', name: tok.v, args };
      return { type: tok.v, args };
    }
    if (tok.type === 'ident') {
      if (tok.v === 'inf') return Infinity;
      if (tok.v === 'pi') return Math.PI;
      if (tok.v in this.env) return this.env[tok.v];
      return { type: 'var', name: tok.v };
    }
    throw new Error(`unexpected "${tok.v}"`);
  }
}

function binop(op, a, b) {
  if (op === '++' && Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
  if (typeof a === 'number' && typeof b === 'number') {
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': return a / b;
      case '%': return a % b;
      case '**': return a ** b;
    }
  }
  return { type: 'binop', op, a, b };
}

// ---- Lexing ----------------------------------------------------------------

function stripComments(src) {
  let out = '';
  let depth = 0;
  for (let i = 0; i < src.length;) {
    const c = src[i];
    const n = src[i + 1];
    if (depth === 0 && c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (depth === 0 && c === '$') {
      out += src.slice(i, i + 2);
      i += 2;
    } else if (depth === 0 && c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && n === '*') {
      depth++;
      i += 2;
    } else if (depth > 0 && c === '*' && n === '/') {
      depth--;
      i += 2;
    } else {
      if (depth === 0 || c === '\n') out += c;
      i++;
    }
  }
  return out;
}

function tokenize(code) {
  const tokens = [];
  const re = /\s+|(\d+(?:\.\d+)?(?:e[+-]?\d+)?)(pi)?|([A-Z]\w*)|([a-z_]\w*)|\\(\w+)|'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|\$.|(\*\*|\+\+|[()[\]{},;.=:+\-*/%!<>|&@#^?~`])/y;
  let m;
  re.lastIndex = 0;
  while (re.lastIndex < code.length) {
    const at = re.lastIndex;
    m = re.exec(code);
    if (!m) { re.lastIndex = at + 1; continue; }
    if (m[1] !== undefined) tokens.push({ type: 'num', v: Number(m[1]) * (m[2] ? Math.PI : 1) });
    else if (m[3] !== undefined) tokens.push({ type: 'class', v: m[3] });
    else if (m[4] !== undefined) tokens.push({ type: 'ident', v: m[4] });
    else if (m[5] !== undefined) tokens.push({ type: 'symbol', v: m[5] });
    else if (m[6] !== undefined) tokens.push({ type: 'symbol', v: m[6] });
    else if (m[7] !== undefined) tokens.push({ type: 'string', v: m[7] });
    else if (m[8] !== undefined) tokens.push({ type: 'op', v: m[8] });
  }
  return tokens;
}

// Splits the token stream into its top-level ( ... ) blocks (the chunks you'd
// run with Ctrl+Enter in the IDE), returning the tokens inside each.
function topLevelBlocks(tokens) {
  const blocks = [];
  let depth = 0;
  let startIdx = -1;
  tokens.forEach((tok, i) => {
    if (tok.v === '(' || tok.v === '[' || tok.v === '{') {
      if (depth === 0 && tok.v === '(') startIdx = i;
      depth++;
    } else if (tok.v === ')' || tok.v === ']' || tok.v === '}') {
      depth--;
      if (depth === 0 && startIdx >= 0 && tok.v === ')') {
        blocks.push(tokens.slice(startIdx + 1, i));
        startIdx = -1;
      }
    }
  });
  return blocks;
}

function splitStatements(tokens) {
  const out = [[]];
  let depth = 0;
  for (const tok of tokens) {
    if ('([{'.includes(tok.v) && tok.type === 'op') depth++;
    if (')]}'.includes(tok.v) && tok.type === 'op') depth--;
    if (depth === 0 && tok.v === ';') out.push([]);
    else out[out.length - 1].push(tok);
  }
  return out;
}
