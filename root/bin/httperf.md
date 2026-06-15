---
name: httperf
desc: HTTP performance benchmark — e.g. httperf -n 20 -c 4 toinel.com
man: |
  # HTTPERF(1)

  ## NAME
  httperf — benchmark a host's HTTP performance

  ## SYNOPSIS
  httperf [-n num] [-c concurrency] <host>

  ## DESCRIPTION
  Fires a batch of HTTP (no-cors) requests at a host and reports the
  latency distribution (min, avg, p50, p90, p95, max) and the achieved
  throughput in requests per second.

  Like ping, it can only time opaque cross-origin fetches end to end —
  the browser cannot expose the TLS / time-to-first-byte phases of a
  third-party host without a Timing-Allow-Origin header. Press Ctrl+C
  to stop early.

  ## OPTIONS
  -n num          total requests (1 to 50, default 10)
  -c concurrency  requests in flight at once (1 to 10, default 1)

  ## EXAMPLES
  httperf toinel.com
  httperf -n 20 -c 4 geeek.org

  ## SEE ALSO
  ping, httpstest
js: |
  // HTTP performance benchmark: send `num` requests (`conc` at a time) and
  // report the latency percentiles and throughput. Only opaque (no-cors) round
  // trips can be timed, exactly like ping.
  let num = 10;
  let conc = 1;
  const rest = [];
  for (let i = 0; i < ctx.args.length; i++) {
    const a = ctx.args[i];
    if (a === '-n' && ctx.args[i + 1])
      num = Math.max(1, Math.min(50, parseInt(ctx.args[++i], 10) || 10));
    else if (a === '-c' && ctx.args[i + 1])
      conc = Math.max(1, Math.min(10, parseInt(ctx.args[++i], 10) || 1));
    else rest.push(a);
  }

  const target = rest[0];
  if (!target) {
    ctx.error('usage: httperf [-n num] [-c concurrency] <host>');
    return;
  }
  const url = /^https?:\/\//.test(target) ? target : `https://${target}`;
  let host;
  try {
    host = new URL(url).host;
  } catch {
    ctx.error(`httperf: ${target}: invalid host`);
    return;
  }

  ctx.line(`httperf ${ctx.escape(host)} — ${num} requests, concurrency ${conc}`);

  const times = [];
  let ok = 0;
  let failed = 0;
  const one = async () => {
    const t0 = performance.now();
    try {
      await fetch(url, { mode: 'no-cors', cache: 'no-store', redirect: 'follow', signal: ctx.signal });
      times.push(performance.now() - t0);
      ok++;
    } catch {
      if (!(ctx.signal && ctx.signal.aborted)) failed++;
    }
  };

  // Worker pool: `conc` workers pull from a shared counter until `num` are sent.
  let started = 0;
  const worker = async () => {
    while (started < num) {
      if (ctx.signal && ctx.signal.aborted) return;
      started++;
      await one();
    }
  };
  const wall0 = performance.now();
  await Promise.all(Array.from({ length: Math.min(conc, num) }, worker));
  const wall = (performance.now() - wall0) / 1000; // seconds

  ctx.line('');
  ctx.line(`--- ${host} httperf statistics ---`);
  ctx.line(`${num} requests, ${ok} ok, ${failed} failed, ${wall.toFixed(2)} s total`);
  if (ok) {
    ctx.line(`throughput: ${(ok / wall).toFixed(1)} req/s`);
    const s = times.slice().sort((a, b) => a - b);
    const pct = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
    const avg = s.reduce((a, b) => a + b, 0) / s.length;
    ctx.line(
      `latency ms: min ${s[0].toFixed(1)}  avg ${avg.toFixed(1)}  ` +
        `p50 ${pct(50).toFixed(1)}  p90 ${pct(90).toFixed(1)}  ` +
        `p95 ${pct(95).toFixed(1)}  max ${s[s.length - 1].toFixed(1)}`,
    );
  }
---
