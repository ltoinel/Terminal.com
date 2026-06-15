---
name: whois
desc: domain registration lookup — e.g. whois toinel.com
man: |
  # WHOIS(1)

  ## NAME
  whois — look up a domain's registration record

  ## SYNOPSIS
  whois <domain>

  ## DESCRIPTION
  Queries a domain's RDAP record — the modern, structured successor to
  legacy WHOIS — over HTTPS via rdap.org (CORS-enabled), and prints the
  registrar, the key dates (registration, expiration, last update), the
  status flags, the name servers and the DNSSEC state.

  ## EXAMPLES
  whois toinel.com
  whois github.com

  ## SEE ALSO
  nslookup, checkip, httpstest
js: |
  const E = ctx.escape;
  const row = (k, v) =>
    ctx.append(
      `<div class="ln"><span class="accent" style="display:inline-block;min-width:12ch">${E(k)}</span><span class="comment">: </span><span class="out">${E(v)}</span></div>`,
    );

  // Normalize: drop any scheme/path, keep the bare hostname.
  const domain = (ctx.args[0] || '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/\/.*$/, '');
  if (!domain) {
    ctx.error('usage: whois <domain>');
    return;
  }

  ctx.line(`Querying RDAP for ${domain}…`);
  try {
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      cache: 'no-store',
      signal: ctx.signal,
    });
    if (res.status === 404) {
      ctx.error(`whois: no record found for ${domain}`);
      return;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    ctx.line('');

    row('Domain', d.ldhName || domain);

    // Registrar: the entity whose roles include "registrar"; its display name
    // lives in the vCard `fn` field.
    const reg = (d.entities || []).find((e) => (e.roles || []).includes('registrar'));
    const fn =
      reg && Array.isArray(reg.vcardArray)
        ? (reg.vcardArray[1].find((f) => f[0] === 'fn') || [])[3]
        : '';
    if (fn) row('Registrar', fn);

    // Standard lifecycle events (ISO dates, clamped to the day).
    const ev = (action) => {
      const e = (d.events || []).find((x) => x.eventAction === action);
      return e ? e.eventDate.slice(0, 10) : '';
    };
    if (ev('registration')) row('Registered', ev('registration'));
    if (ev('expiration')) row('Expires', ev('expiration'));
    if (ev('last changed')) row('Updated', ev('last changed'));

    if (Array.isArray(d.status) && d.status.length) row('Status', d.status.join(', '));

    const ns = (d.nameservers || []).map((n) => n.ldhName).filter(Boolean);
    if (ns.length) row('Nameservers', ns.join(', '));

    if (d.secureDNS) row('DNSSEC', d.secureDNS.delegationSigned ? 'signed' : 'unsigned');
  } catch (e) {
    ctx.error(`whois: ${e.message || 'lookup failed'}`);
  }
---
