---
name: checkip
desc: show your public IP address
man: |
  # CHECKIP(1)

  ## NAME
  checkip — show your public IP address

  ## SYNOPSIS
  checkip

  ## DESCRIPTION
  Fetches and displays your public IP address along with its
  approximate geolocation (city, country, network operator) via an
  online API. If that fails, a fallback service returns at least the IP
  address.

  ## EXAMPLES
  checkip

  ## SEE ALSO
  httpstest, nslookup, ping
js: |
  const E = ctx.escape;
  const row = (k, v) =>
    ctx.append(
      `<div class="ln"><span class="accent" style="display:inline-block;min-width:8ch">${E(k)}</span><span class="comment">: </span><span class="out">${E(v)}</span></div>`,
    );
  ctx.line('Resolving your public IP…');
  try {
    // ipapi.co: IP + geolocation, CORS-enabled.
    const r = await fetch('https://ipapi.co/json/', { cache: 'no-store', signal: ctx.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    if (d.error) throw new Error(d.reason || 'API error');
    row('IP', d.ip);
    const place = [d.city, d.region].filter(Boolean).join(', ');
    if (place) row('Location', place);
    if (d.country_name) row('Country', `${d.country_name} (${d.country_code})`);
    if (d.org) row('Network', d.org);
  } catch {
    // Fallback: ipify, very reliable, returns only the IP.
    try {
      const r = await fetch('https://api64.ipify.org?format=json', { cache: 'no-store', signal: ctx.signal });
      const d = await r.json();
      row('IP', d.ip);
    } catch {
      ctx.error('checkip: could not fetch the IP (network unavailable?)');
    }
  }
---
