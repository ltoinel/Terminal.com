---
name: webllm
desc: chat with an in-browser LLM (WebGPU, runs locally) — e.g. webllm 1
man: |
  # WEBLLM(1)

  ## NAME
  webllm — chat with a Large Language Model running entirely in your browser

  ## SYNOPSIS
  webllm
  webllm --list
  webllm --list-all
  webllm <number>
  webllm <model-id>
  webllm --unload
  webllm --cache
  webllm --rm <model-id>
  webllm --rm-all

  ## DESCRIPTION
  Runs an open-source LLM (Llama, Qwen, Gemma, Phi, SmolLM…) fully on the
  client with no server: inference is accelerated by WebGPU and the model
  weights are downloaded once, then cached by the browser. Powered by
  WebLLM (@mlc-ai/web-llm): the engine is a self-hosted module
  (/vendor/web-llm-<version>.js), so it loads under the site's own CSP with
  no third-party CDN. The model weights are fetched from HuggingFace.

  With no argument (or --list) it prints a curated list of small,
  browser-friendly models. Pick one by its number (webllm 1) or by id
  (webllm Qwen2.5-1.5B-Instruct-q4f16_1-MLC, a unique substring also works)
  to start a chat. A progress bar tracks the one-time model download; on a
  browser without WebGPU an explanatory error is shown instead.

  Once the chat is ready, type a message and press Enter. The reply streams
  in token by token. The conversation keeps its context until you /reset or
  /exit. Ctrl+C interrupts a running generation and closes the session. The
  loaded model stays in GPU memory for the page session, so re-running
  webllm with the same model resumes instantly; webllm --unload frees it.

  Smaller models start faster and use less memory but are less capable;
  larger ones are smarter but download more and need a stronger GPU.

  Downloaded weights persist in the browser's cache. webllm --cache lists
  the models currently stored, webllm --rm <id> deletes one (id or a unique
  substring), and webllm --rm-all clears them all (after a confirmation).
  These cache operations do not need WebGPU, so they work on any browser.

  Models ship in two builds: q4f16 (16-bit, smaller/faster) requires the
  optional WebGPU shader-f16 feature, while q4f32 (32-bit, larger) runs
  anywhere. webllm probes the GPU and automatically picks the build that
  will run — and transparently swaps a requested q4f16 id to its q4f32
  twin when shader-f16 is missing.

  ## OPTIONS
  --list, -l        list the recommended (small) models
  --list-all        list every model id WebLLM knows about
  --unload, --stop  free the loaded model from GPU memory
  --cache           list the models stored in the browser cache
  --rm <id>         delete a cached model (id or unique substring)
  --rm-all          delete every cached model (asks to confirm)

  ## CHAT COMMANDS
  /exit /quit /bye  close the chat session
  /reset /clear     forget the conversation context (keep the model)
  /model            show the model currently loaded
  /help             list these chat commands

  ## EXAMPLES
  webllm
  webllm 1
  webllm Llama-3.2-1B
  webllm --unload
  webllm --cache
  webllm --rm Qwen2.5-0.5B
  webllm --rm-all

  ## SEE ALSO
  msg, whoami, motd
js: |
  // Everything for this command lives here: a WebGPU capability gate, a lazy
  // import of the self-hosted WebLLM engine, model selection, cache management,
  // a download progress bar, and a streaming chat loop. No bundler/npm
  // dependency — the engine module is loaded at runtime via dynamic import().
  const E = ctx.escape;
  const args = ctx.args.slice();
  const first = args[0];

  // Pin the engine version so model ids stay stable; bump to upgrade (and
  // vendor the matching /public/vendor/web-llm-<version>.js bundle).
  const WEBLLM_VERSION = '0.2.84';
  // Self-hosted single-file ESM bundle (jsDelivr's /+esm of @mlc-ai/web-llm),
  // served from our own origin so `script-src 'self'` in the CSP allows it.
  const WEBLLM_URL = '/vendor/web-llm-' + WEBLLM_VERSION + '.js';

  // Curated, browser-friendly models, smallest first. `base` is the model id up
  // to the quantization suffix; the right build (q4f16 vs q4f32) is chosen at
  // runtime from the GPU's shader-f16 support. `gb16`/`gb32` are rough download
  // sizes for each build (f32 weights are larger). An unresolved base is dropped.
  const RECOMMENDED = [
    { label: 'Qwen2.5 0.5B',  base: 'Qwen2.5-0.5B-Instruct',  gb16: 0.45, gb32: 0.95 },
    { label: 'Llama 3.2 1B',  base: 'Llama-3.2-1B-Instruct',  gb16: 0.7,  gb32: 1.4 },
    { label: 'Qwen2.5 1.5B',  base: 'Qwen2.5-1.5B-Instruct',  gb16: 1.0,  gb32: 1.9 },
    { label: 'SmolLM2 1.7B',  base: 'SmolLM2-1.7B-Instruct',  gb16: 1.1,  gb32: 2.0 },
    { label: 'Gemma 2 2B',    base: 'gemma-2-2b-it',          gb16: 1.5,  gb32: 2.8 },
    { label: 'Llama 3.2 3B',  base: 'Llama-3.2-3B-Instruct',  gb16: 1.8,  gb32: 3.3 },
    { label: 'Phi-3.5 mini',  base: 'Phi-3.5-mini-instruct',  gb16: 2.1,  gb32: 3.7 },
  ];

  // The per-page engine slot: a model stays resident across webllm runs so the
  // same model resumes instantly (browser still re-uses cached weights anyway).
  const slot = (globalThis.__ltshWebLLM = globalThis.__ltshWebLLM || { engine: null, modelId: null });

  // ---- webllm --unload : free the resident model (no import / GPU needed) ----
  if (first === '--unload' || first === '--stop') {
    if (slot.engine) {
      try { await slot.engine.unload(); } catch (e) { /* ignore */ }
      slot.engine = null; slot.modelId = null;
      ctx.line('webllm: model unloaded, GPU memory freed');
    } else {
      ctx.line('webllm: no model loaded');
    }
    return;
  }

  // ---- cache management (no WebGPU needed) ----
  // Models are stored in the browser's Cache Storage after the first download;
  // these ops list and remove them, using WebLLM's own cache helpers so the
  // scope stays correct across versions. Works even on a browser without WebGPU.
  const CACHE_LIST = new Set(['--cache', '--cached', '--ls-cache']);
  const CACHE_RM = new Set(['--rm', '--remove', '--delete']);
  if (CACHE_LIST.has(first) || CACHE_RM.has(first) || first === '--rm-all' || first === '--clear-cache') {
    ctx.line('loading the WebLLM engine…');
    let wl;
    try {
      wl = await import(WEBLLM_URL);
    } catch (e) {
      ctx.error('webllm: could not load the engine — ' + (e.message || e.name));
      ctx.line('Expected the bundle at ' + WEBLLM_URL + ' (served from this site).');
      return;
    }
    const appCfg = wl.prebuiltAppConfig;
    const allIds = (appCfg && appCfg.model_list || []).map((m) => m.model_id);

    // Probe every known model id in parallel; keep the ones present in cache.
    const scanCache = async () => {
      ctx.line('scanning the model cache…');
      const flags = await Promise.all(
        allIds.map(async (id) => {
          try { return (await wl.hasModelInCache(id, appCfg)) ? id : null; } catch (e) { return null; }
        }),
      );
      return flags.filter(Boolean);
    };

    // Free the resident engine if it is the model we are about to delete.
    const freeIfLoaded = async (id) => {
      if (slot.engine && (id === undefined || slot.modelId === id)) {
        try { await slot.engine.unload(); } catch (e) { /* ignore */ }
        slot.engine = null; slot.modelId = null;
      }
    };

    if (CACHE_LIST.has(first)) {
      const cached = await scanCache();
      if (!cached.length) { ctx.line('no models in cache.'); return; }
      ctx.line(cached.length + ' model(s) in cache:');
      cached.forEach((id, i) =>
        ctx.append('<div class="ln out"><span class="accent">' + (i + 1) + ')</span> <span class="cmd">' + E(id) + '</span></div>'),
      );
      ctx.line('');
      ctx.line('Delete one:  webllm --rm <id>      ·  delete all:  webllm --rm-all');
      return;
    }

    if (first === '--rm-all' || first === '--clear-cache') {
      const cached = await scanCache();
      if (!cached.length) { ctx.line('no models in cache.'); return; }
      const ans = ((await ctx.ask('delete ALL ' + cached.length + ' cached model(s)? [y/N]')) || '').trim().toLowerCase();
      if (ans !== 'y' && ans !== 'yes') { ctx.line('cancelled.'); return; }
      await freeIfLoaded();
      let n = 0;
      for (const id of cached) {
        try { await wl.deleteModelAllInfoInCache(id, appCfg); n++; ctx.line('removed ' + id); }
        catch (e) { ctx.error('failed to remove ' + id + ' — ' + (e.message || e.name)); }
      }
      ctx.line('done — freed ' + n + ' model(s) from cache.');
      return;
    }

    // --rm <id|substring>
    const arg = (args[1] || '').trim();
    if (!arg) { ctx.error('usage: webllm --rm <model-id-or-substring>'); return; }
    const cached = await scanCache();
    const pool = cached.length ? cached : allIds; // fall back to all ids if the scan came up empty
    let target = null;
    if (pool.includes(arg)) target = arg;
    else {
      const hits = pool.filter((id) => id.toLowerCase().includes(arg.toLowerCase()));
      if (hits.length === 1) target = hits[0];
      else if (hits.length > 1) {
        ctx.error('webllm: ambiguous — ' + hits.length + ' models match "' + arg + '":');
        hits.slice(0, 8).forEach((h) => ctx.line('  ' + h));
        return;
      }
    }
    if (!target) { ctx.error('webllm: no cached model matches "' + arg + '" — see: webllm --cache'); return; }
    await freeIfLoaded(target);
    try { await wl.deleteModelAllInfoInCache(target, appCfg); ctx.line('removed ' + target + ' from cache.'); }
    catch (e) { ctx.error('webllm: failed to remove — ' + (e.message || e.name)); }
    return;
  }

  // ---- WebGPU capability gate (the incompatible-browser message) ----
  if (!('gpu' in navigator) || !navigator.gpu) {
    ctx.error('webllm: WebGPU is not available in this browser.');
    ctx.line('WebLLM needs WebGPU. Use a recent Chrome/Edge (≥ 113) or Safari 18+, on desktop ideally.');
    ctx.line('On Linux + Chrome you may also need: chrome://flags/#enable-unsafe-webgpu');
    ctx.line('(Cache management still works here: webllm --cache · webllm --rm-all)');
    return;
  }
  let adapter = null;
  try { adapter = await navigator.gpu.requestAdapter(); } catch (e) { /* treated as none */ }
  if (!adapter) {
    ctx.error('webllm: no WebGPU adapter found — the GPU is blocked or unavailable.');
    ctx.line('Your browser exposes WebGPU but returned no usable GPU adapter.');
    return;
  }
  // q4f16 builds need the optional `shader-f16` WebGPU feature; without it their
  // shaders fail to compile (Invalid ShaderModule). Fall back to q4f32 builds.
  const hasF16 = !!(adapter.features && typeof adapter.features.has === 'function' && adapter.features.has('shader-f16'));
  const QUANT = hasF16 ? 'q4f16_1' : 'q4f32_1';

  // A stable handle on the scrollable terminal body, used to keep the streamed
  // reply pinned to the bottom while tokens arrive.
  const anchor = ctx.append('<div class="ln comment">webllm — in-browser LLM (WebGPU) · engine @' + E(WEBLLM_VERSION) + ' · shader-f16: ' + (hasF16 ? 'yes' : 'no') + '</div>');
  const scroller = anchor.closest('.ssh-body');
  const toBottom = () => { if (scroller) scroller.scrollTop = scroller.scrollHeight; };

  // ---- lazily load the self-hosted WebLLM engine module ----
  ctx.line('loading the WebLLM engine…');
  let webllm;
  try {
    webllm = await import(WEBLLM_URL);
  } catch (e) {
    ctx.error('webllm: could not load the engine — ' + (e.message || e.name));
    ctx.line('Expected the bundle at ' + WEBLLM_URL + ' (served from this site).');
    return;
  }

  // The full set of known model ids.
  const ids = (webllm.prebuiltAppConfig && webllm.prebuiltAppConfig.model_list || []).map((m) => m.model_id);
  const idSet = new Set(ids);

  // Resolve a base to the build that will actually run on this GPU: the
  // preferred quant first, and (only when f16 IS supported) the other as a
  // fallback — never fall back to a q4f16 build on a GPU without shader-f16.
  const pickId = (base) => {
    const here = ids.find((id) => id.includes(base + '-' + QUANT));
    if (here) return here;
    if (hasF16) { const alt = ids.find((id) => id.includes(base + '-q4f32_1')); if (alt) return alt; }
    return undefined;
  };
  const recommended = RECOMMENDED
    .map((r) => ({ ...r, id: pickId(r.base), gb: hasF16 ? r.gb16 : r.gb32 }))
    .filter((r) => r.id);

  const printList = () => {
    ctx.line('');
    ctx.line('Recommended models (smallest → largest):');
    if (!hasF16) ctx.line('your GPU has no shader-f16 → showing q4f32 builds (larger, fully compatible)');
    ctx.line('');
    recommended.forEach((r, i) => {
      ctx.append(
        '<div class="ln out"><span class="accent">' + (i + 1) + ')</span> ' +
        '<span class="cmd">' + E(r.label) + '</span> ' +
        '<span class="comment">download ≈ ' + E(r.gb.toFixed(2)) + ' GB</span><br>' +
        '<span class="comment">   ' + E(r.id) + '</span></div>',
      );
    });
    ctx.line('');
    ctx.line('Start a chat:  webllm <number>      e.g. webllm 1');
    ctx.line('Or by id:      webllm <model-id>    (a unique substring works too)');
    ctx.line('All models:    webllm --list-all    (' + ids.length + ' available)');
  };

  // ---- listing modes ----
  if (first === '--list-all') {
    ctx.line(ids.length + ' models available:');
    ids.forEach((id) => ctx.append('<div class="ln comment">  ' + E(id) + '</div>'));
    return;
  }
  if (!first || first === '--list' || first === '-l') {
    printList();
    return;
  }

  // ---- resolve the requested model ----
  let modelId = null;
  if (/^\d+$/.test(first)) {
    const n = parseInt(first, 10);
    if (n >= 1 && n <= recommended.length) modelId = recommended[n - 1].id;
    else { ctx.error('webllm: no recommended model #' + n + ' — see: webllm --list'); return; }
  } else if (idSet.has(first)) {
    modelId = first;
  } else {
    const needle = first.toLowerCase();
    const hits = ids.filter((id) => id.toLowerCase().includes(needle));
    if (hits.length === 1) modelId = hits[0];
    else if (hits.length > 1) {
      ctx.error('webllm: ambiguous — ' + hits.length + ' models match "' + first + '":');
      hits.slice(0, 8).forEach((h) => ctx.line('  ' + h));
      if (hits.length > 8) ctx.line('  …');
      return;
    } else {
      ctx.error('webllm: unknown model "' + first + '" — see: webllm --list');
      return;
    }
  }

  // A q4f16 build on a GPU without shader-f16 would fail at shader compilation;
  // transparently switch to the q4f32 build when one exists, else explain.
  if (!hasF16 && /q4f16/.test(modelId)) {
    const swapped = modelId.replace(/q4f16/g, 'q4f32');
    if (idSet.has(swapped)) {
      ctx.line('note: q4f16 needs the shader-f16 GPU feature (unavailable here) → using ' + swapped);
      modelId = swapped;
    } else {
      ctx.error('webllm: "' + modelId + '" needs the shader-f16 GPU feature, unavailable on this GPU.');
      ctx.line('Pick a q4f32 build instead — see: webllm --list');
      return;
    }
  }

  // ---- load the model (or reuse the resident one), with a progress bar ----
  let engine;
  if (slot.engine && slot.modelId === modelId) {
    engine = slot.engine;
    ctx.line('model "' + modelId + '" already loaded — resuming.');
  } else {
    if (slot.engine) { try { await slot.engine.unload(); } catch (e) { /* ignore */ } slot.engine = null; slot.modelId = null; }

    const BARW = 28;
    const renderBar = (p) => {
      const f = Math.max(0, Math.min(BARW, Math.round((p || 0) * BARW)));
      return '[' + '#'.repeat(f) + '·'.repeat(BARW - f) + '] ' + Math.round((p || 0) * 100) + '%';
    };
    ctx.line('');
    ctx.append('<div class="ln"><span class="accent text-glow">↓ loading</span> <span class="comment">' + E(modelId) + '</span></div>');
    const progEl = ctx.append('<div class="ln comment">preparing…</div>');
    const onProgress = (r) => {
      progEl.innerHTML =
        '<span class="accent">' + E(renderBar(r.progress)) + '</span> ' +
        '<span class="comment">' + E((r.text || '').slice(0, 80)) + '</span>';
      toBottom();
    };

    try {
      engine = await webllm.CreateMLCEngine(modelId, { initProgressCallback: onProgress });
    } catch (e) {
      // Some GPUs advertise shader-f16 but still fail to compile the f16 shaders
      // (Invalid ShaderModule). Whatever the adapter claimed, retry once with the
      // q4f32 build when a q4f16 one failed to initialize.
      const msg = String((e && (e.message || e.name)) || e);
      const shaderIssue = /ShaderModule|shader-f16|f16|compute stage|createShaderModule|previous error/i.test(msg);
      const f32 = modelId.replace(/q4f16/g, 'q4f32');
      if (shaderIssue && /q4f16/.test(modelId) && idSet.has(f32)) {
        ctx.line('shader compile failed (no working shader-f16) → retrying with ' + f32);
        progEl.innerHTML = '<span class="comment">preparing ' + E(f32) + '…</span>';
        try {
          engine = await webllm.CreateMLCEngine(f32, { initProgressCallback: onProgress });
          modelId = f32;
        } catch (e2) {
          ctx.error('webllm: failed to initialize the model — ' + (e2.message || e2.name));
          ctx.line('Even the q4f32 build failed — likely a WebGPU driver issue. See chrome://gpu.');
          return;
        }
      } else {
        ctx.error('webllm: failed to initialize the model — ' + (e.message || e.name));
        ctx.line('First load downloads the weights; check your connection and free disk space.');
        return;
      }
    }
    slot.engine = engine; slot.modelId = modelId;
    progEl.innerHTML = '<span class="accent">' + E(renderBar(1)) + '</span> <span class="comment">ready</span>';
  }

  // ---- chat session ----
  ctx.line('');
  ctx.append('<div class="ln"><span class="accent text-glow">● chat ready</span> <span class="comment">— ' + E(modelId) + '</span></div>');
  ctx.line('Type a message and press Enter. Commands: /exit · /reset · /model · /help');
  ctx.line('');

  const SYSTEM = {
    role: 'system',
    content: 'You are a helpful assistant running fully inside the user\'s web browser via WebLLM, with no server. Be concise and friendly.',
  };
  let messages = [SYSTEM];

  // Ctrl+C (ctx.signal) interrupts a running generation and ends the session.
  let interrupted = false;
  if (ctx.signal) {
    ctx.signal.addEventListener('abort', () => {
      interrupted = true;
      try { engine.interruptGenerate(); } catch (e) { /* ignore */ }
    }, { once: true });
  }

  while (true) {
    if (ctx.signal && ctx.signal.aborted) break;
    const raw = await ctx.ask('you›');
    const q = (raw || '').trim();
    if (!q) continue;

    // Keep the user's line in the visible transcript (ctx.ask does not echo it).
    ctx.append('<div class="ln"><span class="prompt">you›</span> <span class="cmd">' + E(q) + '</span></div>');

    const low = q.toLowerCase();
    if (low === '/exit' || low === '/quit' || low === '/bye') { ctx.line('bye 👋'); break; }
    if (low === '/help') { ctx.line('/exit  quit  ·  /reset  clear context  ·  /model  show model'); continue; }
    if (low === '/model') { ctx.line('model: ' + modelId); continue; }
    if (low === '/reset' || low === '/clear') { messages = [SYSTEM]; ctx.line('context cleared.'); continue; }

    messages.push({ role: 'user', content: q });

    // Stream the reply into a single growing line (textContent — never HTML).
    const row = ctx.append('<div class="ln out" style="white-space:pre-wrap"><span class="accent">ai› </span><span class="reply comment">…</span></div>');
    const replyEl = row.querySelector('.reply');
    let reply = '';
    let usage = null;
    try {
      const stream = await engine.chat.completions.create({
        messages,
        stream: true,
        stream_options: { include_usage: true },
      });
      for await (const chunk of stream) {
        const ch0 = chunk.choices && chunk.choices[0];
        const delta = ch0 && ch0.delta && ch0.delta.content ? ch0.delta.content : '';
        if (delta) {
          reply += delta;
          replyEl.classList.remove('comment');
          replyEl.textContent = reply;
          toBottom();
        }
        if (chunk.usage) usage = chunk.usage;
        if (ctx.signal && ctx.signal.aborted) break;
      }
    } catch (e) {
      if (!(ctx.signal && ctx.signal.aborted)) ctx.error('webllm: generation failed — ' + (e.message || e.name));
    }

    if (!reply) replyEl.textContent = interrupted ? '⏹ interrupted' : '(no output)';
    messages.push({ role: 'assistant', content: reply });

    // Optional decode-speed line, when WebLLM reports it.
    if (usage && usage.extra && typeof usage.extra.decode_tokens_per_s === 'number') {
      ctx.append(
        '<div class="ln comment">' +
        E((usage.completion_tokens || 0) + ' tokens · ' + usage.extra.decode_tokens_per_s.toFixed(1) + ' tok/s') +
        '</div>',
      );
    }

    if (ctx.signal && ctx.signal.aborted) break;
  }

  ctx.line('webllm: session closed (the model stays loaded — webllm --unload to free it).');
---
