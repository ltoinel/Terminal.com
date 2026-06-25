---
name: bc
desc: basic calculator — e.g. bc "2 + 2 * 3", bc "sqrt(2)"
alias: calc
man: |
  # BC(1)

  ## NAME
  bc — evaluate arithmetic expressions

  ## SYNOPSIS
  bc <expression>
  bc
  echo "<expression>" | bc

  ## DESCRIPTION
  A safe arithmetic calculator. Pass an expression as the argument, pipe it in,
  or run `bc` with no argument for an interactive prompt (type `quit` to leave).

  Supported: + - * / % and ^ (power, also **), parentheses, unary minus, and
  decimal/scientific numbers (e.g. 1.5e3). Functions: sqrt, abs, round, floor,
  ceil, ln, log (base 10), exp, sin, cos, tan. Constants: pi, e. Separate
  several expressions with `;` or newlines.

  The expression is parsed and evaluated by a small built-in parser — never by
  eval() — so untrusted input cannot run code.

  ## EXAMPLES
  bc "2 + 2 * 3"
  bc "(1 + 2) ^ 10"
  bc "sqrt(2)"
  bc "sin(pi / 2)"
  echo "21 * 2" | bc

  ## SEE ALSO
  date, uuid
js: |
  // bc — a safe arithmetic evaluator. The user's expression is tokenized and run
  // through a recursive-descent parser (NOT eval), so it cannot execute code.
  // Works from an argument, a pipe (ctx.stdin), or interactively (REPL).
  const E = ctx.escape;

  const FUN = {
    sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor,
    ceil: Math.ceil, ln: Math.log, log: (x) => Math.log(x) / Math.LN10,
    exp: Math.exp, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  };
  const CON = { pi: Math.PI, e: Math.E };

  // Evaluate one expression. Throws on a syntax error.
  const evalExpr = (src) => {
    const toks = (src.match(/[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?|\*\*|[A-Za-z_][A-Za-z0-9_]*|[-+*/%^()]/g) || []);
    let i = 0;
    const peek = () => toks[i];
    const next = () => toks[i++];
    const parseExpr = () => {
      let v = parseTerm();
      while (peek() === '+' || peek() === '-') { const op = next(); const r = parseTerm(); v = op === '+' ? v + r : v - r; }
      return v;
    };
    const parseTerm = () => {
      let v = parseFactor();
      while (peek() === '*' || peek() === '/' || peek() === '%') { const op = next(); const r = parseFactor(); v = op === '*' ? v * r : op === '/' ? v / r : v % r; }
      return v;
    };
    const parseFactor = () => {
      const v = parseUnary();
      if (peek() === '^' || peek() === '**') { next(); return Math.pow(v, parseFactor()); } // right-assoc
      return v;
    };
    const parseUnary = () => {
      if (peek() === '+') { next(); return parseUnary(); }
      if (peek() === '-') { next(); return -parseUnary(); }
      return parseAtom();
    };
    const parseAtom = () => {
      const t = next();
      if (t === undefined) throw new Error('unexpected end of expression');
      if (t === '(') { const v = parseExpr(); if (next() !== ')') throw new Error('missing )'); return v; }
      if (/^[0-9]|^\./.test(t)) return parseFloat(t);
      if (/^[A-Za-z_]/.test(t)) {
        const name = t.toLowerCase();
        if (peek() === '(') {
          next();
          const arg = parseExpr();
          if (next() !== ')') throw new Error('missing )');
          if (!FUN[name]) throw new Error('unknown function "' + t + '"');
          return FUN[name](arg);
        }
        if (name in CON) return CON[name];
        throw new Error('unknown name "' + t + '"');
      }
      throw new Error('unexpected "' + t + '"');
    };
    const v = parseExpr();
    if (i < toks.length) throw new Error('unexpected "' + toks[i] + '"');
    if (typeof v !== 'number' || Number.isNaN(v)) throw new Error('not a number');
    return v;
  };

  // Pretty-print: round off binary-float fuzz, drop trailing zeros.
  const fmt = (n) => {
    if (!isFinite(n)) return String(n);
    return (Math.round(n * 1e10) / 1e10).toString();
  };

  const run1 = (line) => {
    try { ctx.line(fmt(evalExpr(line))); }
    catch (e) { ctx.error('bc: ' + (e.message || 'syntax error')); }
  };

  // Expression from the argument or a pipe → evaluate (supports `;`/newline lists).
  const input = ctx.args.join(' ').trim() || (ctx.stdin || '').trim();
  if (input) {
    input.split(/[;\n]+/).map((s) => s.trim()).filter(Boolean).forEach(run1);
    return;
  }

  // Interactive prompt (REPL).
  ctx.line('bc — basic calculator. Type an expression, or "quit" to exit.');
  while (true) {
    if (ctx.signal && ctx.signal.aborted) break;
    const raw = await ctx.ask('bc›');
    const q = (raw || '').trim();
    if (!q) continue;
    if (/^(quit|exit|q)$/i.test(q)) break;
    ctx.append('<div class="ln"><span class="prompt">bc›</span> <span class="cmd">' + E(q) + '</span></div>');
    run1(q);
  }
---
