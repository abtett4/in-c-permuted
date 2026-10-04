// Reads the score straight out of the SuperCollider file.
//
// This is not a full sclang interpreter. It understands the subset the piece
// is written in: Pbind / Pseq / Rest / [a, b].choose for the modules, and
// Ptpar([time, Ppar([songN], n), ...]).play(TempoClock(t)) for the form.
// SynthDef names are collected so the page knows which instruments exist.

export function parseScd(src) {
  const code = stripComments(src);
  const tokens = tokenize(code);
  const warnings = [];

  const synthDefNames = [];
  for (let i = 0; i < tokens.length - 2; i++) {
    if (tokens[i].v === 'SynthDef' && tokens[i + 1].v === '(') {
      const t = tokens[i + 2];
      if (t.type === 'symbol' || t.type === 'string') {
        if (!synthDefNames.includes(t.v)) synthDefNames.push(t.v);
      }
    }
  }

  // The score lives in the top-level ( ... ) block that contains Ptpar.
  const blocks = topLevelBlocks(tokens);
  const block = [...blocks].reverse().find(b => b.some(t => t.v === 'Ptpar'));
  if (!block) throw new Error('Could not find a Ptpar([...]).play block in the .scd file.');

  const env = {};
  let form = null;
  for (const stmt of splitStatements(block)) {
    if (!stmt.length || stmt[0].v === 'var' || stmt[0].v === 'arg') continue;
    let p;
    try {
      p = new ExprParser(stmt, env);
      if (stmt.length > 2 && stmt[0].type === 'ident' && stmt[1].v === '=') {
        p.pos = 2;
        const v = p.parseExpr();
        if (v && typeof v === 'object' && !Array.isArray(v)) v.varName ??= stmt[0].v;
        env[stmt[0].v] = v;
      } else {
        const v = p.parseExpr();
        if (v && (v.type === 'play' || v.type === 'Ptpar')) form = v;
      }
    } catch (err) {
      warnings.push(`Skipped a statement I couldn't read: ${err.message}`);
    }
  }
  if (!form) throw new Error('Found the score block but could not read its Ptpar.');

  let tempo = 1;
  let ptpar = form;
  if (form.type === 'play') {
    ptpar = form.target;
    const clock = form.args[0];
    if (clock && clock.type === 'TempoClock' && typeof clock.args[0] === 'number') tempo = clock.args[0];
  }
  if (!ptpar || ptpar.type !== 'Ptpar' || !Array.isArray(ptpar.args[0])) {
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

  modules.forEach((m, i) => {
    m.index = i;
    const n = /(\d+)$/.exec(m.name);
    m.number = n ? Number(n[1]) : i;
    m.label = m.number === 0 ? 'Pulse' : String(m.number);
  });

  return { tempo, modules, synthDefNames, warnings };
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
      if (!tok || tok.type !== 'op' || !['+', '-', '*', '/', '%', '**'].includes(tok.v)) return left;
      this.next();
      const right = this.parsePostfix();
      left = binop(tok.v, left, right);
    }
  }

  parsePostfix() {
    let v = this.parsePrimary();
    while (this.peek() && this.peek().v === '.') {
      this.next();
      const name = this.next();
      if (!name || name.type !== 'ident') throw new Error('expected a method name after "."');
      let args = [];
      if (this.peek() && this.peek().v === '(') args = this.parseArgs();
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

  parsePrimary() {
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
  const re = /\s+|(\d+(?:\.\d+)?(?:e[+-]?\d+)?)(pi)?|([A-Z]\w*)|([a-z_]\w*)|\\(\w+)|'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|\$.|(\*\*|[()[\]{},;.=:+\-*/%!<>|&@#^?~`])/y;
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
