---
name: httpstest
desc: check a host's HTTPS security grade — e.g. httpstest toinel.com
man: |
  # HTTPSTEST(1)

  ## NAME
  httpstest — check a host's HTTPS / TLS security posture

  ## SYNOPSIS
  httpstest [host]

  ## DESCRIPTION
  Assesses the HTTPS security of a host. With no argument, checks the
  current terminal host.

  Two things are measured:

  - a browser-observable check — whether the TLS handshake succeeds over
    HTTPS (a failed handshake or connection rejects the request), with the
    round-trip time;
  - a security grade from the Mozilla HTTP Observatory (A+ … F), which
    grades the HTTP security headers (HSTS, CSP, cookies, …).

  The browser sandbox cannot inspect the negotiated TLS version, cipher
  suites or certificate chain — that needs a server-side scanner. For that
  full audit, httpstest prints an SSL Labs link.

  ## EXAMPLES
  httpstest
  httpstest toinel.com
  httpstest geeek.org

  ## SEE ALSO
  checkip, nslookup, ping
js: |
  const E = ctx.escape;
  // Target: the given host (any pasted URL is reduced to its hostname), or the
  // current terminal host by default.
  let host = (ctx.args.find((a) => !a.startsWith('-')) || ctx.cfg.host || location.hostname || '').trim();
  host = host.replace(/^[a-z]+:\/\//i, '').replace(/[\/?#].*$/, '').replace(/:\d+$/, '');
  if (!host) { ctx.error('usage: httpstest <host>'); return; }

  const row = (k, vHtml) =>
    ctx.append(
      `<div class="ln"><span class="accent" style="display:inline-block;min-width:10ch">${E(k)}</span><span class="comment">: </span>${vHtml}</div>`,
    );
  const out = (s) => `<span class="out">${E(String(s))}</span>`;

  ctx.line(`checking HTTPS for ${E(host)} …`);

  // 1) Browser-observable: does the TLS handshake succeed? `no-cors` means we
  //    cannot read the response, but a failed handshake/connection rejects.
  let reachable = false;
  let rtt = 0;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    if (ctx.signal) ctx.signal.addEventListener('abort', () => ctrl.abort()); // Ctrl+C
    const t0 = performance.now();
    await fetch(`https://${host}/`, { mode: 'no-cors', cache: 'no-store', redirect: 'follow', signal: ctrl.signal });
    clearTimeout(timer);
    rtt = performance.now() - t0;
    reachable = true;
  } catch {
    reachable = false;
  }

  // 2) Security grade via Mozilla HTTP Observatory (CORS-enabled). Grades the
  //    HTTP security headers; a live scan can take a few seconds.
  let data = null;
  let apiErr = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    if (ctx.signal) ctx.signal.addEventListener('abort', () => ctrl.abort()); // Ctrl+C
    const res = await fetch(
      `https://observatory-api.mdn.mozilla.net/api/v2/scan?host=${encodeURIComponent(host)}`,
      { method: 'POST', cache: 'no-store', signal: ctrl.signal },
    );
    clearTimeout(timer);
    data = await res.json().catch(() => null);
    if (data && data.error) apiErr = String(data.error);
    else if (!res.ok) apiErr = 'HTTP ' + res.status;
  } catch (e) {
    apiErr = e.name === 'AbortError' ? 'timed out' : (e.message || 'request failed');
  }

  row('Host', out(host));
  row(
    'HTTPS',
    reachable
      ? `<span class="accent text-glow">reachable</span> <span class="comment">(TLS handshake OK · ${rtt.toFixed(0)} ms)</span>`
      : '<span style="color:#ff6b6b">unreachable over HTTPS</span>',
  );

  if (data && data.grade) {
    const g = String(data.grade);
    const color =
      g[0] === 'A' ? 'class="accent text-glow"'
      : (g[0] === 'B' || g[0] === 'C') ? 'style="color:var(--amber)"'
      : 'style="color:#ff6b6b"';
    row('Grade', `<span ${color}>${E(g)}</span> <span class="comment">(score ${E(String(data.score))})</span>`);
    if (data.tests_quantity != null) {
      const failed = data.tests_failed ? ` · ${data.tests_failed} failed` : '';
      row('Checks', out(`${data.tests_passed}/${data.tests_quantity} passed${failed}`));
    }
    if (data.scanned_at) {
      row('Scanned', out(new Date(data.scanned_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })));
    }
    if (data.details_url) ctx.line(`→ [full header report](${data.details_url})`);
  } else {
    ctx.error(`httpstest: security grade unavailable${apiErr ? ' (' + apiErr + ')' : ''}`);
  }

  ctx.line('');
  ctx.append('<div class="ln comment"># the grade covers HTTP security headers (Mozilla Observatory); the browser</div>');
  ctx.append('<div class="ln comment"># cannot read TLS versions/ciphers. For the full TLS audit:</div>');
  ctx.line(`→ [SSL Labs full TLS audit](https://www.ssllabs.com/ssltest/analyze.html?d=${encodeURIComponent(host)})`);
---
