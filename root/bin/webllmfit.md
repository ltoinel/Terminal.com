---
name: webllmfit
desc: which in-browser LLMs fit your machine? (à la llmfit.org)
man: |
  # WEBLLMFIT(1)

  ## NAME
  webllmfit — estimate which WebLLM models can run on this machine

  ## SYNOPSIS
  webllmfit
  webllmfit --all

  ## DESCRIPTION
  Inspired by llmfit.org, but wired to the real WebLLM catalogue. It probes
  this machine's WebGPU capabilities (adapter, shader-f16 support, max
  buffer / storage-buffer sizes) and approximate system memory, then
  cross-references every model's own vram_required_MB and required_features
  to label each one FIT, TIGHT or NO.

  For each model it keeps the build that best matches the GPU (q4f16 when
  shader-f16 is available, otherwise q4f32) and de-duplicates the rest. The
  list is sorted so the largest model you can run comes first.

  Verdicts:
    FIT    comfortably within the estimated memory budget
    TIGHT  fits, but close to the budget — may be slow or fail under load
    NO     too large, or needs a GPU feature you don't have

  The memory budget is an ESTIMATE: browsers don't expose total VRAM, so it
  is derived from navigator.deviceMemory (capped, approximate) with headroom.
  Real-world fit also depends on free VRAM and other GPU load.

  ## OPTIONS
  --all, -a   also list the models that do NOT fit

  ## EXAMPLES
  webllmfit
  webllmfit --all

  ## SEE ALSO
  miaougpt, llm, hashcat
js: |
  // Self-contained "does it fit?" report. Reads the WebLLM model catalogue
  // (each record carries vram_required_MB + required_features) and weighs it
  // against this machine's WebGPU limits and approximate RAM. Estimate only —
  // browsers do not expose total VRAM.
  const E = ctx.escape;
  const WEBLLM_VERSION = '0.2.84';
  const WEBLLM_URL = '/vendor/web-llm-' + WEBLLM_VERSION + '.js';
  const showAll = ctx.args.includes('--all') || ctx.args.includes('-a');

  // ---- machine probe (the parts available without WebGPU) ----
  const ramGB = (navigator && typeof navigator.deviceMemory === 'number') ? navigator.deviceMemory : null;
  const threads = navigator.hardwareConcurrency || null;

  ctx.append('<div class="ln"><span class="accent text-glow">webllmfit</span><span class="comment"> — can your machine run these models?</span></div>');
  ctx.line('');

  // ---- WebGPU gate ----
  if (!('gpu' in navigator) || !navigator.gpu) {
    ctx.line('Hardware');
    ctx.line('  WebGPU.........: NOT available');
    ctx.line('  System RAM.....: ' + (ramGB ? '~' + ramGB + ' GB (approx)' : 'unknown'));
    ctx.line('  CPU threads....: ' + (threads || '?'));
    ctx.line('');
    ctx.error('No WebGPU → no in-browser LLM can run in this browser.');
    ctx.line('Use a recent Chrome/Edge (≥ 113) or Safari 18+ (chrome://flags/#enable-unsafe-webgpu on Linux).');
    return;
  }
  let adapter = null;
  try { adapter = await navigator.gpu.requestAdapter(); } catch (e) { /* none */ }
  if (!adapter) {
    ctx.line('Hardware');
    ctx.line('  WebGPU.........: present, but no usable GPU adapter');
    ctx.line('  System RAM.....: ' + (ramGB ? '~' + ramGB + ' GB (approx)' : 'unknown'));
    ctx.line('  CPU threads....: ' + (threads || '?'));
    ctx.line('');
    ctx.error('No WebGPU adapter → no in-browser LLM can run here.');
    return;
  }

  const hasF16 = !!(adapter.features && typeof adapter.features.has === 'function' && adapter.features.has('shader-f16'));
  const lim = adapter.limits || {};
  const maxBufMB = lim.maxBufferSize ? lim.maxBufferSize / 1048576 : 0;
  const maxStorMB = lim.maxStorageBufferBindingSize ? lim.maxStorageBufferBindingSize / 1048576 : 0;
  let info = {};
  try {
    info = adapter.info || (typeof adapter.requestAdapterInfo === 'function' ? await adapter.requestAdapterInfo() : {}) || {};
  } catch (e) { /* adapter info is best-effort */ }

  // Estimated memory budget for the model (weights + KV cache). Browsers don't
  // expose total VRAM; derive it from system RAM with headroom, falling back to
  // a loose GPU proxy. Deliberately conservative — better to under-promise.
  const budgetMB = ramGB ? Math.round(ramGB * 1024 * 0.6) : Math.round(Math.max(maxBufMB, 2048));

  // ---- load the catalogue ----
  ctx.line('loading the model catalogue…');
  let wl;
  try {
    wl = await import(WEBLLM_URL);
  } catch (e) {
    ctx.error('webllmfit: could not load the engine — ' + (e.message || e.name));
    ctx.line('Expected the bundle at ' + WEBLLM_URL + ' (served from this site).');
    return;
  }
  const records = (wl.prebuiltAppConfig && wl.prebuiltAppConfig.model_list) || [];

  // ---- de-duplicate quant variants, keep the build best suited to this GPU ----
  const baseKey = (id) => id.replace(/-q\d+f\d+(_\d+)?/i, '##');
  const groups = new Map();
  for (const r of records) {
    const k = baseKey(r.model_id);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const wantQ = hasF16 ? 'q4f16' : 'q4f32';
  const chosen = [];
  for (const members of groups.values()) {
    const runnable = members.filter((m) => !(m.required_features || []).includes('shader-f16') || hasF16);
    const pool = runnable.length ? runnable : members;
    const pick =
      pool.find((m) => m.model_id.includes(wantQ)) ||
      pool.slice().sort((a, b) => (a.vram_required_MB || 0) - (b.vram_required_MB || 0))[0];
    if (pick) chosen.push(pick);
  }

  // ---- verdict per model ----
  const verdictOf = (m) => {
    if ((m.required_features || []).includes('shader-f16') && !hasF16) return { v: 'NO', why: 'needs shader-f16' };
    if (m.buffer_size_required_bytes && maxStorMB && m.buffer_size_required_bytes / 1048576 > maxStorMB)
      return { v: 'NO', why: 'buffer > GPU max' };
    const need = m.vram_required_MB || 0;
    if (!need) return { v: '?', why: 'unknown size' };
    if (need <= budgetMB * 0.8) return { v: 'FIT', why: '' };
    if (need <= budgetMB) return { v: 'TIGHT', why: '' };
    return { v: 'NO', why: 'not enough memory' };
  };
  const rows = chosen
    .map((m) => Object.assign({ m: m }, verdictOf(m)))
    .sort((a, b) => (a.m.vram_required_MB || 0) - (b.m.vram_required_MB || 0));

  // ---- hardware report ----
  const gpuDesc = [info.vendor, info.architecture, info.description].filter(Boolean).join(' / ') || 'unknown';
  ctx.line('Hardware');
  ctx.line('  GPU............: ' + gpuDesc);
  ctx.line('  shader-f16.....: ' + (hasF16 ? 'yes (q4f16 builds)' : 'no (q4f32 builds)'));
  ctx.line('  Max buffer.....: ' + Math.round(maxBufMB) + ' MB');
  ctx.line('  Max storage buf: ' + Math.round(maxStorMB) + ' MB');
  ctx.line('  System RAM.....: ' + (ramGB ? '~' + ramGB + ' GB (approx)' : 'unknown'));
  ctx.line('  CPU threads....: ' + (threads || '?'));
  ctx.line('  Est. budget....: ~' + budgetMB + ' MB ' + (ramGB ? '(60% of RAM)' : '(GPU proxy)') + '  [estimate]');
  ctx.line('');

  // ---- models report ----
  const pad5 = (v) => (v + '     ').slice(0, 5);
  const tag = (v) => {
    const p = E(pad5(v));
    if (v === 'FIT') return '<span class="accent text-glow">' + p + '</span>';
    if (v === 'TIGHT') return '<span style="color:#e0b341">' + p + '</span>';
    if (v === 'NO') return '<span style="color:#ff6b6b">' + p + '</span>';
    return '<span class="comment">' + p + '</span>';
  };
  const gb = (mb) => (mb ? (mb / 1024).toFixed(1) + ' GB' : '?');
  const printRow = (r) =>
    ctx.append(
      '<div class="ln out">' + tag(r.v) +
      ' <span class="comment">need ~' + E(gb(r.m.vram_required_MB)) + '</span>  ' +
      '<span class="cmd">' + E(r.m.model_id) + '</span>' +
      (r.why ? ' <span class="comment">(' + E(r.why) + ')</span>' : '') +
      '</div>',
    );

  const fitRows = rows.filter((r) => r.v === 'FIT');
  const tightRows = rows.filter((r) => r.v === 'TIGHT');
  const noRows = rows.filter((r) => r.v === 'NO' || r.v === '?');

  ctx.line('Models  (best build for your GPU: ' + (hasF16 ? 'q4f16' : 'q4f32') + ', ' + rows.length + ' distinct)');
  ctx.line('');
  // Largest runnable first, so the most capable model you can use is on top.
  fitRows.slice().reverse().forEach(printRow);
  tightRows.slice().reverse().forEach(printRow);
  if (showAll) noRows.slice().reverse().forEach(printRow);
  ctx.line('');

  // ---- summary ----
  const runnable = fitRows.concat(tightRows);
  if (runnable.length) {
    const biggest = runnable.reduce((a, b) => ((b.m.vram_required_MB || 0) > (a.m.vram_required_MB || 0) ? b : a));
    ctx.append('<div class="ln"><span class="accent text-glow">✓ ' + runnable.length + ' model(s) can run</span><span class="comment"> — biggest: ' + E(biggest.m.model_id) + '</span></div>');
    ctx.line('Start one:  llm --load ' + biggest.m.model_id);
  } else {
    ctx.error('No model fits the estimated budget on this machine.');
  }
  if (!showAll && noRows.length) ctx.line(noRows.length + ' model(s) do not fit — show them with: webllmfit --all');
  ctx.line('');
  ctx.line('Estimates only — actual fit depends on free VRAM and other GPU load.');
---
