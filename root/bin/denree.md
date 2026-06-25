---
name: denree
desc: autonomous AI agent (local LLM, WebGPU) that drives the terminal — e.g. denree "what's the weather in Rennes?"
alias: agent ?
man: |
  # DENREE(1)

  ## NAME
  denree — an autonomous AI agent that accomplishes a goal by running the
  terminal's commands, reasoned by a local LLM (WebGPU, 100% in-browser)

  ## SYNOPSIS
  denree "<goal in natural language>"
  denree --commands
  denree --model <id> "<goal>"
  denree --steps <n> "<goal>"
  denree --unload

  ## DESCRIPTION
  denree (a nod to "la Denrée", the alien from the film *La Soupe aux Choux*)
  is an autonomous agent: you give it a goal and it asks a language model
  running entirely in your browser (WebGPU, no server) to pick, step by step,
  which shell command to run. It runs the command, reads its output, feeds that
  back to the model, and repeats until it produces a final answer.

  At each turn the model's decision is constrained to JSON by the engine
  (grammar-guided generation), so the agent never goes off the rails: it always
  returns either a command to run or a final answer.

  The agent knows the whole command catalog (`denree --commands`) except the
  ones with side effects or control flow (rm, su, sudo, msg, open, exit, clear,
  miaougpt, llm, glaude, denree…), which are blocked for safety.

  The model is provided by the central LLM module (see `llm` and the widget in
  the top-right corner). By default no model is loaded: denree proposes a
  reasoning model and asks you to confirm its download — unless a model is
  already warm (loaded by `miaougpt`, `glaude` or `llm`), which it reuses
  instantly.

  ## OPTIONS
  --commands, --list   list the commands the agent may use
  --model <id>         pick the reasoning model (default: Qwen2.5-1.5B)
  --steps <n>          cap the number of agent turns (default: 4)
  --unload, --stop     free the loaded model from GPU memory

  ## EXAMPLES
  denree "what is my public IP address and its country?"
  denree "summarize the file about.md in one sentence"
  denree --steps 8 "search for the word 'drone' in my documents"
  denree --model Qwen2.5-3B-Instruct "what's the weather in Rennes?"
  denree --unload

  ## SEE ALSO
  miaougpt, glaude, llm, help, man
js: |
  // denree — an autonomous AI agent reasoned by a local LLM via the central
  // module (ctx.llm). Loop: the model returns a JSON {thought, action,
  // command|answer} constrained by a schema; denree runs the command
  // (ctx.capture, headless), feeds the observation back, and repeats until a
  // final answer. No engine of its own: everything goes through ctx.llm
  // (loading/consent/tokens) and ctx.capture / ctx.commands (the shell catalog).
  const E = ctx.escape;
  const args = ctx.args.slice();

  // Default reasoning model (proposed when nothing is already loaded).
  const DEFAULT = { base: 'Qwen2.5-1.5B-Instruct', label: 'Qwen2.5 1.5B', gb: 1.0 };
  const MAX_STEPS = 4;

  // Commands the agent must never run: mutations, control, side effects, and the
  // LLM/agent commands themselves. Everything else is usable.
  const DENY = new Set([
    'rm', 'su', 'sudo', 'exit', 'clear', 'boot', 'msg', 'open', 'iframed',
    'theme', 'bell', 'miaougpt', 'llm', 'glaude', 'denree', 'shutdown', 'reboot',
  ]);

  // The model only PICKS a command each turn (whether the goal is answered is
  // decided separately, by a reliable synthesis step — see below). A small model
  // handles "pick a command" far better than the run/final decision.
  const STEP_SCHEMA = {
    type: 'object',
    properties: {
      thought: { type: 'string' },
      command: { type: 'string' },
    },
    required: ['thought', 'command'],
  };

  // Tolerant JSON parse: strips ```fences``` and isolates the first object.
  const parseJson = (text) => {
    if (text == null) return null;
    if (typeof text === 'object') return text;
    let s = String(text).trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    try { return JSON.parse(s); } catch (e) { /* continue */ }
    const m = s.match(/[{[][\s\S]*[}\]]/);
    if (m) { try { return JSON.parse(m[0]); } catch (e) { /* give up */ } }
    return null;
  };

  // ---- mini-RAG over the command man pages (lexical BM25-lite) ----
  // A small model guesses command syntax poorly, which causes loops. So we
  // retrieve the man pages most relevant to the goal and inject their
  // SYNOPSIS/OPTIONS into the agent's context — no embeddings, no extra model,
  // pure JS over the ~50 short docs already in ctx.commands. English only: the
  // man pages are English, so tokenization assumes ASCII English text.
  const STOP = new Set('the a an of to in on at by for and or is are be with from as this that it your you my via eg use using into'.split(/\s+/));
  const tokenize = (s) =>
    ((s || '').toLowerCase().match(/[a-z0-9][a-z0-9.+_-]*/g) || []).filter((t) => t.length > 1 && !STOP.has(t));

  // Keep only SYNOPSIS + OPTIONS from a man page (the syntax the agent needs),
  // capped per section so injecting several stays small.
  const manExcerpt = (man) => {
    if (!man) return '';
    const out = [];
    for (const sec of ['SYNOPSIS', 'OPTIONS']) {
      const m = man.match(new RegExp('##\\s+' + sec + '\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)'));
      if (m) out.push(sec + '\n' + m[1].replace(/\s+$/, '').slice(0, 340));
    }
    return out.join('\n') || man.replace(/^#.*$/gm, '').replace(/\s+/g, ' ').trim().slice(0, 340);
  };

  // BM25-lite ranking of the usable commands against the goal text.
  const ragManuals = (query, docs, k) => {
    const qterms = Array.from(new Set(tokenize(query)));
    if (!qterms.length) return [];
    const corpus = docs.map((c) => ({ c, terms: tokenize(c.name + ' ' + c.name + ' ' + (c.desc || '') + ' ' + (c.man || '')) }));
    const N = corpus.length || 1;
    const df = {};
    for (const d of corpus) for (const t of new Set(d.terms)) df[t] = (df[t] || 0) + 1;
    const avgdl = corpus.reduce((s, d) => s + d.terms.length, 0) / N;
    const k1 = 1.5, b = 0.75;
    return corpus
      .map((d) => {
        const tf = {};
        for (const t of d.terms) tf[t] = (tf[t] || 0) + 1;
        let score = 0;
        for (const t of qterms) {
          const f = tf[t] || 0;
          if (!f) continue;
          const idf = Math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5));
          score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.terms.length) / (avgdl || 1)));
        }
        if (qterms.includes(d.c.name.toLowerCase())) score += 5; // exact command-name hit
        return { c: d.c, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b2) => b2.score - a.score)
      .slice(0, k)
      .map((x) => x.c);
  };

  // ---- compact "Denree" banner ----
  ctx.append('<div class="ln ascii-art"><span class="accent text-glow">░▒▓ DENREE ▓▒░</span> <span class="comment">— autonomous AI agent (local LLM, WebGPU)</span></div>');

  const first = args[0];

  // ---- denree --commands: what the agent may use ----
  if (first === '--commands' || first === '--list' || first === '-l') {
    const usable = ctx.commands.filter((c) => !DENY.has(c.name));
    ctx.line(usable.length + ' command(s) usable by the agent (side-effect ones excluded):');
    ctx.line('');
    usable.forEach((c) => {
      ctx.append('<div class="ln out"><span class="cmd">' + E(c.name) + '</span> <span class="comment">— ' + E(c.desc || '') + '</span></div>');
    });
    return;
  }

  // ---- denree --unload: free the resident model ----
  if (first === '--unload' || first === '--stop') {
    const freed = await ctx.llm.unload();
    ctx.line(freed ? 'denree: model unloaded, GPU memory freed.' : 'denree: no model loaded.');
    return;
  }

  // ---- options + goal extraction ----
  let model;
  let maxSteps = MAX_STEPS;
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model' && args[i + 1]) { model = args[++i]; continue; }
    if (args[i] === '--steps' && args[i + 1]) { maxSteps = parseInt(args[++i], 10) || MAX_STEPS; continue; }
    rest.push(args[i]);
  }
  const goal = rest.join(' ').trim();

  if (!goal) {
    ctx.line('Give the agent a goal. Examples:');
    ctx.line('  denree "what is my public IP address and its country?"');
    ctx.line('  denree "summarize about.md in one sentence"');
    ctx.line('');
    ctx.line('See also: denree --commands · man denree');
    return;
  }

  // ---- usable command catalog ----
  const usable = ctx.commands.filter((c) => !DENY.has(c.name));
  const catalog = usable.map((c) => '- ' + c.name + ': ' + (c.desc || '(no description)')).join('\n');

  // Mini-RAG: retrieve the man pages most relevant to the goal, to inject their
  // exact syntax/flags into the agent's context.
  const refs = ragManuals(goal, usable, 4);
  const manContext = refs.length
    ? 'Reference manuals for the commands most relevant to this goal — use the exact syntax and flags shown:\n\n' +
      refs.map((c) => '### ' + c.name + '\n' + manExcerpt(c.man)).join('\n\n') + '\n\n'
    : '';

  // ---- make sure a model is loaded (consent + progress bar via ctx.llm) ----
  let session;
  try {
    const st = ctx.llm.state();
    if (st && st.modelId && !model) {
      session = { modelId: st.modelId, label: st.label };
    } else {
      session = await ctx.llm.ensure({
        base: model || DEFAULT.base,
        label: model || DEFAULT.label,
        gb: model ? undefined : DEFAULT.gb,
        reason: 'Denree agent (reasoning)',
      });
    }
  } catch (e) {
    ctx.error('denree: ' + ((e && (e.message || e.name)) || e));
    ctx.line('The agent needs WebGPU. Try a recent Chrome/Edge (≥ 113) or Safari 18+.');
    return;
  }
  if (!session) { ctx.line('denree: cancelled — no model loaded.'); return; }
  const modelId = session.modelId;

  // Scroll anchor (stay pinned to the bottom while the agent works).
  const anchor = ctx.append('<div class="ln comment">goal: ' + E(goal) + '</div>');
  const scroller = anchor.closest('.ssh-body');
  const toBottom = () => { if (scroller) scroller.scrollTop = scroller.scrollHeight; };
  if (refs.length) ctx.append('<div class="ln comment">📚 reference manuals: ' + E(refs.map((c) => c.name).join(', ')) + '</div>');

  // Ctrl+C interrupts a running generation.
  if (ctx.signal) {
    ctx.signal.addEventListener('abort', () => { ctx.llm.interrupt(); }, { once: true });
  }

  const system =
    'You are Denree, an autonomous agent operating a Unix-like terminal in the ' +
    'user\'s web browser. Your only job is to choose the single shell command whose ' +
    'output will best help answer the user\'s goal. The final answer is extracted ' +
    'automatically from the command outputs — you do NOT write the answer.\n\n' +
    'Available commands (name: description):\n' + catalog + '\n\n' +
    manContext +
    'Rules:\n' +
    '- Respond with a SINGLE JSON object: {"thought": "...", "command": "<one command line>"}.\n' +
    '- Use only the commands listed above, by their plain name (e.g. `cat`, not `/bin/cat`). One command, a single line, no heredocs (<<).\n' +
    '- Run commands directly. There is NO shell: never use `bash -c`, `sh -c`, or `/bin/bash -c`.\n' +
    '- Pick the most direct command whose output contains the needed information.\n' +
    '- To write a file, use: echo "text" > path.\n' +
    '- If no command can help (the goal is purely conversational), return an empty command: {"thought": "...", "command": ""}.';

  const transcript = [
    { role: 'system', content: system },
    { role: 'user', content: 'Goal: ' + goal },
  ];

  // State shared with the synthesis helper.
  const ran = new Set();       // commands already run (repeat = stuck)
  const observations = [];      // { command, observation } gathered so far

  // Try to answer the goal from the observations gathered so far. Returns the
  // answer, or '' when the outputs are not enough yet (the model replies with a
  // NEED_MORE sentinel). Free text — reliable for a small model, unlike forcing
  // a JSON "final" action, which is what made the agent loop instead of answer.
  const synthesize = async (lenient) => {
    if (!observations.length) return '';
    const obsText = observations.map((o) => '$ ' + o.command + '\n' + o.observation).join('\n\n').slice(0, 3000);
    const guard = lenient
      ? 'Base the answer strictly on the outputs. Do NOT invent, guess, convert, or substitute values that are not present (e.g. never present a local time as another timezone). If the outputs do not contain the answer, say — in the question\'s language — that you could not find it with the available commands.'
      : 'Answer only if the outputs clearly and directly contain the answer. Do NOT assume, invent, convert, or substitute values that are not present. If the answer is not in the outputs, reply with exactly: NEED_MORE';
    try {
      const res = await ctx.llm.chat({
        messages: [
          { role: 'system', content: 'You answer the user\'s question using ONLY the literal facts in the provided command outputs. Be concise and reply in the SAME language as the question. ' + guard },
          { role: 'user', content: 'Question: ' + goal + '\n\nCommand outputs:\n' + obsText + '\n\nAnswer:' },
        ],
        temperature: 0, stream: false, signal: ctx.signal,
      });
      const out = ((res && res.content) || '').trim();
      if (!lenient && /^need[_ ]?more/i.test(out)) return '';
      return out;
    } catch (e) {
      return '';
    }
  };

  ctx.line('');
  ctx.append('<div class="ln"><span class="accent text-glow">● Denree is thinking…</span></div>');

  // ---- agent loop: pick a command, run it, then check if we can answer ----
  let answer = '';
  let reason = '';
  let ranCount = 0;
  for (let n = 1; n <= maxSteps; n++) {
    if (ctx.signal && ctx.signal.aborted) { reason = 'aborted'; break; }

    let content = '';
    try {
      const res = await ctx.llm.chat({ messages: transcript, schema: STEP_SCHEMA, temperature: 0, stream: false, signal: ctx.signal });
      content = (res && res.content) || '';
    } catch (e) {
      if (!(ctx.signal && ctx.signal.aborted)) ctx.error('denree: ' + (e.message || e.name));
      reason = 'error';
      break;
    }

    const act = parseJson(content) || {};
    const rawCmd = (act.command || '').trim();

    // Empty command → the model judges no (more) command is needed: go answer.
    if (!rawCmd) {
      if (act.thought) ctx.append('<div class="ln comment">💭 ' + E(act.thought) + '</div>');
      break;
    }

    // Normalize the command line the way the model tends to over-decorate it:
    //  - drop leading `VAR=value` environment assignments (e.g. `TZ=Asia/Tokyo date`),
    //    which the shell does not support anyway;
    //  - strip a path on the command name (`/bin/cat` → `cat`).
    // This is what makes the existence/allow check see the REAL command name.
    let rest = rawCmd;
    let envMatch;
    while ((envMatch = rest.match(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+(\S[\s\S]*)$/))) rest = envMatch[1];
    const head = rest.match(/^(\S+)([\s\S]*)$/);
    const baseName = head ? head[1].replace(/^.*\//, '') : rest;
    const command = head ? baseName + head[2] : rest;

    // Repeat → the model is stuck. Stop and answer from what we already have.
    if (ran.has(command)) {
      ctx.append('<div class="ln comment">↻ already ran `' + E(command) + '` — answering now.</div>');
      reason = 'stuck';
      break;
    }
    ran.add(command); // track every attempt (allowed or not) so repeats are caught

    if (act.thought) ctx.append('<div class="ln comment">💭 ' + E(act.thought) + '</div>');
    ctx.append('<div class="ln"><span class="prompt">▸</span> <span class="cmd">' + E(command) + '</span></div>');

    // Gate before execution: reject shell wrappers, verify the command actually
    // EXISTS in the registry (so a hallucinated command is reported as such), and
    // that it is within the allowed set. Only then do we run it.
    const isShellWrap = /^(?:ba|z)?sh$/.test(baseName) || /(?:^|\s)(?:ba|z)?sh\s+-[a-z]*c\b/.test(command);
    const known = ctx.commands.some((c) => c.name === baseName || (c.alias || []).includes(baseName));
    const allowed = !isShellWrap && usable.some((c) => c.name === baseName || (c.alias || []).includes(baseName));
    let observation;
    if (isShellWrap) {
      observation = 'Do not wrap commands in a shell — there is no bash/sh here. Run the target command directly (e.g. `date`, not `bash -c "date"`).';
    } else if (!known) {
      observation = 'command "' + baseName + '" not found — it is not a real command here. Use only the commands listed in your instructions.';
    } else if (!allowed) {
      observation = 'command "' + baseName + '" exists but is not allowed for the agent.';
    } else {
      ranCount++;
      const ex = await ctx.capture(command);
      observation = (ex.stdout || ex.stderr || '(no output)').slice(0, 1800);
      observations.push({ command, observation });
    }

    const obs = observation.replace(/\s+$/, '');
    const shown = obs.length > 600 ? obs.slice(0, 600) + ' …' : obs;
    if (shown) ctx.append('<div class="ln out" style="white-space:pre-wrap"><span class="comment">' + E(shown) + '</span></div>');
    toBottom();

    // Can we answer now? Usually yes after the first useful command — this is
    // what stops Denree from running extra commands once the answer is in hand.
    if (allowed) {
      const got = await synthesize(false);
      if (got) { answer = got; break; }
    }

    transcript.push({ role: 'assistant', content });
    transcript.push({ role: 'user', content: 'Observation from `' + command + '`:\n' + observation + '\n\nThe outputs so far do not answer the goal. Choose ONE different command whose output would DIRECTLY provide the missing information. Do not pick an unrelated command. If no available command can provide it, return an empty command to stop.' });
  }

  // Still no answer (stuck / budget reached / model declined): lenient synthesis.
  if (!answer && reason !== 'aborted' && reason !== 'error') {
    if (!reason) reason = 'max-steps';
    answer = await synthesize(true);
  }

  // ---- result ----
  ctx.line('');
  if (answer) {
    ctx.append('<div class="ln out" style="white-space:pre-wrap"><span class="accent text-glow">✦ answer › </span><span class="reply">' + E(answer) + '</span></div>');
  } else if (reason === 'aborted') {
    ctx.line('denree: interrupted.');
  } else if (reason === 'error') {
    ctx.line('denree: failed.');
  } else {
    ctx.line('denree: no conclusive answer' + (reason ? ' (' + reason + ')' : '') + '.');
  }
  ctx.append('<div class="ln comment">— ' + ranCount + ' command(s) run · model ' + E(modelId) + ' · the model stays warm (llm --unload to free it).</div>');
---
