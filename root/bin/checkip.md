---
name: checkip
desc: affiche votre adresse IP publique
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
  nslookup, ping
js: |
  const E = ctx.escape;
  const row = (k, v) =>
    ctx.append(
      `<div class="ln"><span class="accent" style="display:inline-block;min-width:8ch">${E(k)}</span><span class="comment">: </span><span class="out">${E(v)}</span></div>`,
    );
  ctx.line('Résolution de votre IP publique…');
  try {
    // ipapi.co : IP + géolocalisation, CORS activé.
    const r = await fetch('https://ipapi.co/json/', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    if (d.error) throw new Error(d.reason || 'API error');
    row('IP', d.ip);
    const lieu = [d.city, d.region].filter(Boolean).join(', ');
    if (lieu) row('Lieu', lieu);
    if (d.country_name) row('Pays', `${d.country_name} (${d.country_code})`);
    if (d.org) row('Réseau', d.org);
  } catch {
    // Repli : ipify, très fiable, ne renvoie que l'IP.
    try {
      const r = await fetch('https://api64.ipify.org?format=json', { cache: 'no-store' });
      const d = await r.json();
      row('IP', d.ip);
    } catch {
      ctx.error("checkip: impossible de récupérer l'IP (réseau indisponible ?)");
    }
  }
---
