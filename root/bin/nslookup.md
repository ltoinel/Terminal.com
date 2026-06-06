---
name: nslookup
desc: DNS lookup — e.g. nslookup toinel.com
man: |
  # NSLOOKUP(1)

  ## NAME
  nslookup — query the DNS

  ## SYNOPSIS
  nslookup <domain> [type]

  ## DESCRIPTION
  Resolves a domain name over DNS-over-HTTPS (Google Public DNS). The
  record type defaults to A; the A, AAAA, NS, CNAME, MX and TXT types
  are recognized. Each answer shows its value and TTL.

  ## EXAMPLES
  nslookup toinel.com
  nslookup toinel.com MX

  ## SEE ALSO
  ping, checkip
js: |
  // Real DNS is unreachable from the browser, so we resolve over DNS-over-HTTPS
  // (Google Public DNS, https://dns.google/resolve) which is CORS-enabled.
  const name = ctx.args[0];
  if (!name) { ctx.error('usage: nslookup <name> [type]'); return; }
  const type = (ctx.args[1] || 'A').toUpperCase();

  // Numeric RR types -> readable names for the answers we print.
  const TYPES = { 1: 'A', 2: 'NS', 5: 'CNAME', 15: 'MX', 16: 'TXT', 28: 'AAAA' };

  ctx.line('Server:  dns.google (DNS-over-HTTPS)');
  ctx.line('');
  try {
    const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`, { cache: 'no-store' });
    const data = await res.json();
    if (data.Status !== 0 || !data.Answer || !data.Answer.length) {
      ctx.error(`** server can't find ${name}: ${data.Status === 3 ? 'NXDOMAIN' : 'no ' + type + ' record'}`);
      return;
    }
    ctx.line(`Name:    ${name}`);
    for (const ans of data.Answer) {
      const t = TYPES[ans.type] || `type ${ans.type}`;
      // append() takes raw HTML, so the data is escaped and the ttl styled.
      ctx.append(`<div class="ln out">${ctx.escape(t.padEnd(6))}${ctx.escape(ans.data)}  <span class="comment">(ttl ${ans.TTL}s)</span></div>`);
    }
  } catch (e) {
    ctx.error(`nslookup: ${e.message || 'lookup failed'}`);
  }
---
