---
name: llm
desc: manage the central local LLM engine (loaded model, tokens, cache, GPU)
man: |
  # LLM(1)

  ## NAME
  llm — drive the central LLM module: the only thing that loads a model into
  memory and exposes it to the other commands (miaougpt, glaude, denree)

  ## SYNOPSIS
  llm
  llm --list
  llm --list-all
  llm --load <model-id>
  llm --unload
  llm --cache
  llm --rm <model-id>
  llm --rm-all

  ## DESCRIPTION
  Every command that needs a local LLM (miaougpt, glaude, denree) goes through
  a single central manager. `llm` is its console: it shows the currently loaded
  model and the tokens consumed (in / out), lists models, manages the browser
  cache and frees GPU memory. The top-right widget mirrors this state live.

  By default no model is loaded. A model is loaded either on demand by a command
  (which asks you to confirm), or explicitly with `llm --load <id>`. The model
  stays resident for the session and is shared by every command; `llm --unload`
  frees it.

  Models ship in two builds: q4f16 (smaller, needs the GPU shader-f16 feature)
  and q4f32 (larger, universal). The right build is chosen automatically for
  your GPU.

  Cache operations (`--cache`, `--rm`, `--rm-all`) do not need WebGPU and work
  in any browser.

  ## OPTIONS
  (none)            show the loaded model and the in/out tokens
  --list, -l        list the recommended chat models
  --list-all        list every known model id
  --load <id>       load a model (asks for confirmation)
  --unload, --stop  free the loaded model from GPU memory
  --cache           list the models stored in the browser cache
  --rm <id>         delete a model from the cache (id or unique substring)
  --rm-all          clear the model cache (after confirmation)

  ## EXAMPLES
  llm
  llm --list
  llm --load Qwen2.5-1.5B-Instruct
  llm --unload
  llm --cache
  llm --rm-all

  ## SEE ALSO
  miaougpt, glaude, denree
js: |
  // llm — console for the central LLM module (src/lib/llm.ts), exposed via
  // ctx.llm. This command loads nothing itself except --load; it reads state,
  // lists models and manages the cache, all through the single manager.
  const E = ctx.escape;
  const args = ctx.args.slice();
  const first = args[0];
  const L = ctx.llm;

  // ---- status: loaded model + tokens ----
  if (!first) {
    const s = L.state();
    if (s && s.modelId) {
      ctx.append('<div class="ln out"><span class="accent text-glow">●</span> model: <span class="cmd">' + E(s.label || s.modelId) + '</span></div>');
      ctx.append('<div class="ln comment">id: ' + E(s.modelId) + '</div>');
      ctx.append('<div class="ln out">tokens — <span class="cmd">↑ in ' + s.tokensIn + '</span>  ·  <span class="cmd">↓ out ' + s.tokensOut + '</span></div>');
      if (s.loading) ctx.line('loading… ' + Math.round((s.progress || 0) * 100) + '%');
    } else {
      ctx.line('no model loaded. Load one:  llm --load <id>   ·   or run  miaougpt');
    }
    ctx.line('WebLLM engine @' + (L.state().version || '?') + '  ·  see: llm --list · llm --cache');
    return;
  }

  // ---- list recommended models ----
  if (first === '--list' || first === '-l') {
    ctx.line('loading the catalog…');
    let recs;
    try { recs = await L.recommended(); }
    catch (e) { ctx.error('llm: ' + (e.message || e.name)); return; }
    ctx.line('');
    ctx.line('Recommended chat models (smallest to largest):');
    ctx.line('');
    recs.forEach((r, i) => {
      ctx.append(
        '<div class="ln out"><span class="accent">' + (i + 1) + ')</span> ' +
        '<span class="cmd">' + E(r.label) + '</span> ' +
        '<span class="comment">download ≈ ' + E(r.gb.toFixed(2)) + ' GB</span><br>' +
        '<span class="comment">   ' + E(r.id) + '</span></div>',
      );
    });
    ctx.line('');
    ctx.line('Load:  llm --load <id>   ·   all models: llm --list-all');
    return;
  }

  // ---- list every known id ----
  if (first === '--list-all') {
    ctx.line('loading…');
    let ids;
    try { ids = await L.models(); }
    catch (e) { ctx.error('llm: ' + (e.message || e.name)); return; }
    ctx.line(ids.length + ' models available:');
    ids.forEach((id) => ctx.append('<div class="ln comment">  ' + E(id) + '</div>'));
    return;
  }

  // ---- explicit load (with confirmation via ctx.llm.ensure) ----
  if (first === '--load') {
    const id = (args[1] || '').trim();
    if (!id) { ctx.error('usage: llm --load <model-id>'); return; }
    let session;
    try { session = await L.ensure({ base: id, label: id, reason: 'load requested' }); }
    catch (e) { ctx.error('llm: ' + (e.message || e.name)); return; }
    ctx.line(session ? 'model loaded: ' + (session.label || session.modelId) : 'llm: cancelled.');
    return;
  }

  // ---- unload ----
  if (first === '--unload' || first === '--stop') {
    const freed = await L.unload();
    ctx.line(freed ? 'model unloaded, GPU memory freed.' : 'no model loaded.');
    return;
  }

  // ---- cache: list ----
  if (first === '--cache' || first === '--cached') {
    ctx.line('scanning the cache…');
    let cached;
    try { cached = await L.cacheList(); }
    catch (e) { ctx.error('llm: ' + (e.message || e.name)); return; }
    if (!cached.length) { ctx.line('no models in cache.'); return; }
    ctx.line(cached.length + ' model(s) in cache:');
    cached.forEach((id, i) => ctx.append('<div class="ln out"><span class="accent">' + (i + 1) + ')</span> <span class="cmd">' + E(id) + '</span></div>'));
    ctx.line('');
    ctx.line('Delete:  llm --rm <id>   ·   all:  llm --rm-all');
    return;
  }

  // ---- cache: delete one model ----
  if (first === '--rm' || first === '--remove' || first === '--delete') {
    const arg = (args[1] || '').trim();
    if (!arg) { ctx.error('usage: llm --rm <model-id-or-substring>'); return; }
    try { const id = await L.cacheRemove(arg); ctx.line('removed from cache: ' + id); }
    catch (e) { ctx.error('llm: ' + (e.message || e.name)); }
    return;
  }

  // ---- cache: clear all ----
  if (first === '--rm-all' || first === '--clear-cache') {
    ctx.line('scanning the cache…');
    let cached;
    try { cached = await L.cacheList(); }
    catch (e) { ctx.error('llm: ' + (e.message || e.name)); return; }
    if (!cached.length) { ctx.line('no models in cache.'); return; }
    const ans = ((await ctx.ask('delete ALL ' + cached.length + ' cached model(s)? [y/N]')) || '').trim().toLowerCase();
    if (ans !== 'y' && ans !== 'yes') { ctx.line('cancelled.'); return; }
    try { const n = await L.cacheRemoveAll(); ctx.line('done — freed ' + n + ' model(s) from cache.'); }
    catch (e) { ctx.error('llm: ' + (e.message || e.name)); }
    return;
  }

  ctx.error('llm: unknown option "' + first + '" — see: man llm');
---
