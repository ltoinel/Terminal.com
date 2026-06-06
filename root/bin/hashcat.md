---
name: hashcat
desc: brute-force an MD5 hash on every CPU core — e.g. hashcat -m 0 -a 3 <md5>
man: |
  # HASHCAT(1)

  ## NAME
  hashcat — multi-core MD5 brute-forcer

  ## SYNOPSIS
  hashcat -m 0 -a 3 <md5hash>
  hashcat -b

  ## DESCRIPTION
  A toy, in-browser take on hashcat. It recovers the plaintext behind an
  MD5 hash by brute force (hashcat mode 0, mask attack -a 3), trying every
  candidate of increasing length over a charset.

  To "use all the CPU", the search is sharded across one Web Worker per
  logical core (navigator.hardwareConcurrency): each worker hashes its own
  slice of the keyspace with a hand-rolled single-block MD5, so every thread
  runs flat out. A live status line reports the combined hash rate.

  The worker is self-contained: its code is embedded in this command and
  spawned from a Blob URL (the site CSP allows worker-src 'blob:').

  With -b it runs a benchmark instead: all cores hash for a few seconds and
  the aggregate speed is reported, with no target to crack.

  Note: the run blocks the terminal until it finds the plaintext, exhausts
  the keyspace, or hits the time limit (raise it with --timeout).

  ## OPTIONS
  -m <num>          hash mode; only 0 (MD5) is supported
  -a <num>          attack mode; only 3 (brute-force / mask) is supported
  -b, --benchmark   measure the aggregate hash rate across all cores
  --max <n>         maximum candidate length, 1..8 (default 6)
  --timeout <s>     give up after <s> seconds, 1..120 (default 30)
  --charset <set>   candidate alphabet (default: a-z and 0-9)

  ## EXAMPLES
  hashcat -m 0 -a 3 5f4dcc3b5aa765d61d8327deb882cf99
  hashcat -m 0 -a 3 900150983cd24fb0d6963f7d28e17f72 --max 4
  hashcat -b

  ## SEE ALSO
  md5, sha256sum, base64
js: |
  const E = ctx.escape;
  const args = ctx.args.slice();

  // ---- option parsing (hashcat-flavoured flags) ----
  let mode = 0;
  let attack = 3;
  let bench = false;
  let maxLen = 6;
  let timeoutS = 30;
  let charset = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-b' || a === '--benchmark') bench = true;
    else if (a === '-m') mode = parseInt(args[++i], 10);
    else if (a === '-a') attack = parseInt(args[++i], 10);
    else if (a === '--max') maxLen = Math.max(1, Math.min(8, parseInt(args[++i], 10) || 6));
    else if (a === '--timeout') timeoutS = Math.max(1, Math.min(120, parseInt(args[++i], 10) || 30));
    else if (a === '--charset') charset = args[++i] || charset;
    else if (!a.startsWith('-')) rest.push(a);
  }

  if (typeof Worker === 'undefined') { ctx.error('hashcat: Web Workers are unavailable in this browser'); return; }
  if (mode !== 0) { ctx.error('hashcat: only -m 0 (MD5) is supported here'); return; }
  if (attack !== 3) { ctx.error('hashcat: only -a 3 (brute-force / mask) is supported here'); return; }
  if (!charset.length) { ctx.error('hashcat: empty charset'); return; }

  // Parse the target hash (crack mode) into 4 little-endian digest words.
  let target = null;
  let hashHex = '';
  if (!bench) {
    hashHex = (rest[0] || '').toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(hashHex)) {
      ctx.error('usage: hashcat -m 0 -a 3 <md5hash>   |   hashcat -b');
      return;
    }
    const word = (o) => {
      const b0 = parseInt(hashHex.substr(o, 2), 16);
      const b1 = parseInt(hashHex.substr(o + 2, 2), 16);
      const b2 = parseInt(hashHex.substr(o + 4, 2), 16);
      const b3 = parseInt(hashHex.substr(o + 6, 2), 16);
      return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) | 0;
    };
    target = [word(0), word(8), word(16), word(24)];
  }

  const cores = Math.max(1, Math.min(32, navigator.hardwareConcurrency || 4));
  const fmtSpeed = (h) =>
    h >= 1e9 ? (h / 1e9).toFixed(2) + ' GH/s'
    : h >= 1e6 ? (h / 1e6).toFixed(2) + ' MH/s'
    : h >= 1e3 ? (h / 1e3).toFixed(2) + ' kH/s'
    : Math.round(h) + ' H/s';
  const num = (x) => x.toLocaleString('en-US');

  // ---- the compute unit, embedded so the whole command lives in one file ----
  // It is stringified and spawned as a Blob worker (one per core). Protocol —
  // main->worker: {init,target,charset,w,W} once, then {run,length} / {stop};
  // worker->main: {progress,n} / {found,plain} / {done,length}.
  const workerMain = () => {
    // MD5 per-round rotates and the sine-derived additive constants.
    const SHIFT = [
      7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
      14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15,
      21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    const K = new Int32Array(64);
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
    // One reusable 512-bit block: candidates are <= 8 bytes, so only M[0..2] and
    // M[14] are ever non-zero — every other word stays zero for the worker's life.
    const M = new Int32Array(16);

    let target = null; // [t0..t3] LE digest words, or null (benchmark)
    let codes = null; // charset bytes
    let charset = '';
    let myW = 0; // this worker's index out of …
    let totW = 1; // … this many workers
    let L = 0; // candidate length
    let idx = null; // odometer digits (charset indices)
    let firstVals = []; // first-position values owned by this worker
    let fi = 0;
    let stopReq = false;

    self.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === 'init') {
        target = m.target;
        charset = m.charset;
        codes = new Int32Array(charset.length);
        for (let i = 0; i < charset.length; i++) codes[i] = charset.charCodeAt(i) & 0xff;
        myW = m.w;
        totW = m.W;
      } else if (m.type === 'run') {
        startRun(m.length);
      } else if (m.type === 'stop') {
        stopReq = true;
      }
    };

    // Own first-position values myW, myW+W, … ; enumerate the rest for each.
    function startRun(length) {
      L = length;
      const c = codes.length;
      firstVals = [];
      for (let v = myW; v < c; v += totW) firstVals.push(v);
      fi = 0;
      idx = new Int32Array(L);
      if (firstVals.length) idx[0] = firstVals[0];
      stopReq = false;
      schedule();
    }

    // Yield between chunks so a 'stop' is delivered; the core runs flat out within.
    function schedule() {
      setTimeout(step, 0);
    }

    function step() {
      if (stopReq) return;
      const c = codes.length;
      const CHUNK = 120000;
      let n = 0;
      while (n < CHUNK) {
        if (fi >= firstVals.length) {
          if (n) self.postMessage({ type: 'progress', n });
          self.postMessage({ type: 'done', length: L });
          return;
        }
        idx[0] = firstVals[fi];

        // --- MD5 of the current candidate (single 512-bit block) ---
        M[0] = 0;
        M[1] = 0;
        M[2] = 0;
        for (let j = 0; j < L; j++) M[j >> 2] |= codes[idx[j]] << ((j & 3) << 3);
        M[L >> 2] |= 0x80 << ((L & 3) << 3);
        M[14] = L << 3;
        let a = 0x67452301;
        let b = 0xefcdab89 | 0;
        let cc = 0x98badcfe | 0;
        let d = 0x10325476;
        for (let i = 0; i < 64; i++) {
          let f, g;
          if (i < 16) {
            f = (b & cc) | (~b & d);
            g = i;
          } else if (i < 32) {
            f = (d & b) | (~d & cc);
            g = (5 * i + 1) & 15;
          } else if (i < 48) {
            f = b ^ cc ^ d;
            g = (3 * i + 5) & 15;
          } else {
            f = cc ^ (b | ~d);
            g = (7 * i) & 15;
          }
          f = (f + a + K[i] + M[g]) | 0;
          a = d;
          d = cc;
          cc = b;
          const s = SHIFT[i];
          b = (b + ((f << s) | (f >>> (32 - s)))) | 0;
        }
        a = (a + 0x67452301) | 0;
        b = (b + (0xefcdab89 | 0)) | 0;
        cc = (cc + (0x98badcfe | 0)) | 0;
        d = (d + 0x10325476) | 0;
        n++;

        if (target && a === target[0] && b === target[1] && cc === target[2] && d === target[3]) {
          let plain = '';
          for (let j = 0; j < L; j++) plain += charset[idx[j]];
          if (n) self.postMessage({ type: 'progress', n });
          self.postMessage({ type: 'found', plain });
          return;
        }

        // Advance the odometer over positions 1..L-1; on overflow move to the
        // next owned first value and reset the rest.
        let p = L - 1;
        while (p >= 1) {
          if (++idx[p] < c) break;
          idx[p] = 0;
          p--;
        }
        if (p < 1) {
          fi++;
          for (let j = 1; j < L; j++) idx[j] = 0;
        }
      }
      self.postMessage({ type: 'progress', n });
      schedule();
    }
  };

  // Spawn one Blob worker per core from the stringified function above.
  let workers;
  let blobUrl;
  try {
    blobUrl = URL.createObjectURL(
      new Blob(['(' + workerMain.toString() + ')()'], { type: 'text/javascript' }),
    );
    workers = Array.from({ length: cores }, () => new Worker(blobUrl));
  } catch (err) {
    ctx.error('hashcat: could not start workers (' + (err.message || err.name) + ')');
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    return;
  }
  const cleanup = () => {
    workers.forEach((w) => w.terminate());
    URL.revokeObjectURL(blobUrl);
  };

  // ---- banner ----
  ctx.append(`<div class="ln"><span class="accent text-glow">hashcat</span><span class="comment"> (web edition) starting${bench ? ' in benchmark mode' : ''}…</span></div>`);
  ctx.line('');
  ctx.line(`Compute.Units....: ${cores} (Web Workers, one per logical core)`);
  if (!bench) {
    ctx.line('Hash.Mode........: 0 (MD5)');
    ctx.line(`Hash.Target......: ${hashHex}`);
    ctx.line(`Charset..........: ${charset} (${charset.length})`);
    ctx.line(`Mask.............: increment, length 1..${maxLen}`);
  }
  ctx.line('');
  const statusEl = ctx.append('<div class="ln comment">initializing…</div>');

  // ---- shared run state ----
  let totalTried = 0;
  let lastTried = 0;
  const startT = performance.now();
  let lastT = startT;
  let curLen = 0;
  let found = null;
  let peakHps = 0;

  const refreshStatus = (state) => {
    const now = performance.now();
    const dt = (now - lastT) / 1000;
    const hps = dt > 0 ? (totalTried - lastTried) / dt : 0;
    if (hps > peakHps) peakHps = hps;
    lastT = now;
    lastTried = totalTried;
    const elapsed = ((now - startT) / 1000).toFixed(1);
    statusEl.innerHTML =
      `<span class="comment">Status: </span><span class="out">${E(state)}</span>` +
      ` <span class="comment">· Speed: </span><span class="accent">${E(fmtSpeed(hps))}</span>` +
      ` <span class="comment">· Tried: </span><span class="out">${E(num(totalTried))}</span>` +
      ` <span class="comment">· Len: </span><span class="out">${curLen || '-'}</span>` +
      ` <span class="comment">· ${elapsed}s</span>`;
  };
  const ticker = setInterval(() => refreshStatus(found ? 'Cracked' : 'Running'), 600);

  // Run one candidate length across all workers; resolves 'found' or 'done'.
  const runLength = (length) =>
    new Promise((resolve) => {
      let done = 0;
      curLen = length;
      workers.forEach((w) => {
        w.onmessage = (ev) => {
          const m = ev.data;
          if (m.type === 'progress') totalTried += m.n;
          else if (m.type === 'found') { found = m.plain; resolve('found'); }
          else if (m.type === 'done') { if (++done === workers.length) resolve('done'); }
        };
        w.postMessage({ type: 'run', length });
      });
    });

  // Initialize every worker once (target + charset + its shard index).
  workers.forEach((w, i) => w.postMessage({ type: 'init', target, charset, w: i, W: workers.length }));

  const limitS = bench ? 6 : timeoutS;
  const timeout = new Promise((res) => setTimeout(() => res('timeout'), limitS * 1000));

  // Benchmark hashes a huge fixed length so it never exhausts within the window;
  // cracking sweeps increasing lengths until a hit or the keyspace is spent.
  const runner = bench
    ? runLength(7)
    : (async () => {
        for (let L = 1; L <= maxLen; L++) {
          if (found) return 'found';
          if ((await runLength(L)) === 'found') return 'found';
        }
        return 'exhausted';
      })();

  // Ctrl+C (ctx.signal) cancels the run too.
  const aborted = new Promise((res) => {
    if (!ctx.signal) return;
    if (ctx.signal.aborted) res('aborted');
    else ctx.signal.addEventListener('abort', () => res('aborted'), { once: true });
  });
  const outcome = await Promise.race([runner, timeout, aborted]);

  // Stop every worker and tear them down (covers the timeout / abort / found paths).
  workers.forEach((w) => w.postMessage({ type: 'stop' }));
  clearInterval(ticker);
  refreshStatus(
    found ? 'Cracked' : bench ? 'Done' : outcome === 'aborted' ? 'Aborted' : outcome === 'timeout' ? 'Aborted' : 'Exhausted',
  );
  cleanup();

  // ---- final report ----
  const secs = (performance.now() - startT) / 1000;
  ctx.line('');
  if (found !== null) {
    ctx.append(`<div class="ln"><span class="accent text-glow">${E(hashHex)}:${E(found)}</span></div>`);
    ctx.line('');
    ctx.line('Status...........: Cracked');
  } else if (bench) {
    ctx.line(`Speed.#*.........: ${fmtSpeed(secs > 0 ? totalTried / secs : 0)} (avg) · ${fmtSpeed(peakHps)} (peak), across ${cores} cores`);
    ctx.line('Status...........: Benchmark done');
  } else if (outcome === 'aborted') {
    ctx.line('Status...........: Aborted (Ctrl+C)');
  } else if (outcome === 'timeout') {
    ctx.line('Status...........: Aborted (timeout) — raise --timeout or shrink the keyspace');
  } else {
    ctx.line(`Status...........: Exhausted — no match for length 1..${maxLen} over the charset`);
  }
  ctx.line(`Time.............: ${secs.toFixed(1)}s · ${num(totalTried)} candidates · avg ${fmtSpeed(secs > 0 ? totalTried / secs : 0)}`);
---
