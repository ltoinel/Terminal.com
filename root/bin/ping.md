---
name: ping
desc: HTTP ping a host — e.g. ping toinel.com
js: |
  // Browsers can't send ICMP, so this is an "HTTP ping": it measures the
  // round-trip time of opaque (no-cors) fetches to the target URL.
  let count = 4;
  const rest = [];
  for (let i = 0; i < ctx.args.length; i++) {
    if (ctx.args[i] === '-c' && ctx.args[i + 1]) count = Math.max(1, Math.min(20, parseInt(ctx.args[++i], 10) || 4));
    else rest.push(ctx.args[i]);
  }
  const target = rest[0];
  if (!target) { ctx.error('usage: ping [-c count] <host>'); return; }

  // Normalise to an absolute https URL and extract the host for display.
  const url = /^https?:\/\//.test(target) ? target : `https://${target}`;
  let host;
  try { host = new URL(url).host; } catch { ctx.error(`ping: ${target}: invalid host`); return; }

  ctx.line(`PING ${ctx.escape(host)} (HTTP) — ${count} requests`);
  const times = [];
  for (let seq = 1; seq <= count; seq++) {
    const t0 = performance.now();
    try {
      await fetch(url, { mode: 'no-cors', cache: 'no-store', redirect: 'follow' });
      const dt = performance.now() - t0;
      times.push(dt);
      ctx.line(`response from ${ctx.escape(host)}: seq=${seq} time=${dt.toFixed(1)} ms`);
    } catch (e) {
      ctx.error(`request to ${host}: seq=${seq} failed (${e.name || 'error'})`);
    }
    if (seq < count) await ctx.sleep(500);
  }

  ctx.line('');
  const lost = count - times.length;
  ctx.line(`--- ${host} HTTP ping statistics ---`);
  ctx.line(`${count} requests sent, ${times.length} received, ${Math.round((lost / count) * 100)}% loss`);
  if (times.length) {
    const min = Math.min(...times), max = Math.max(...times);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    ctx.line(`rtt min/avg/max = ${min.toFixed(1)}/${avg.toFixed(1)}/${max.toFixed(1)} ms`);
  }
---
