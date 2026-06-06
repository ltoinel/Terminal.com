---
name: neofetch
desc: system info
man: |
  # NEOFETCH(1)

  ## NAME
  neofetch — system information

  ## SYNOPSIS
  neofetch

  ## DESCRIPTION
  Shows a neofetch-style system summary: the Lud'OS CRT logo and real
  browser information (screen resolution, core count, memory, browser,
  language and time zone), followed by a phosphor color palette.

  ## EXAMPLES
  neofetch

  ## SEE ALSO
  uname, date, motd
js: |
  const E = ctx.escape;
  const amber = document.documentElement.classList.contains('amber');

  // --- Real-ish system info, pulled from the browser ----------------------
  const ua = navigator.userAgent || '';
  const browser = /Firefox\//.test(ua) ? 'Firefox'
    : /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'browser';
  const cores = navigator.hardwareConcurrency;
  const mem = navigator.deviceMemory; // Chromium-only; may be undefined
  const dpr = Math.round((window.devicePixelRatio || 1) * 100) / 100;
  const lang = navigator.language || 'en-US';
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* unsupported */ }

  // --- Info column (neofetch-style: title, rule, then key: value) ----------
  const kv = [
    ['os', "Lud'OS phosphor 1.0 x86_64"],
    ['kernel', 'phosphor 1.0-crt'],
    ['shell', 'ltsh 1.0'],
    ['terminal', browser],
    ['resolution', `${screen.width}×${screen.height}${dpr !== 1 ? ` @${dpr}x` : ''}`],
    ['theme', amber ? 'amber' : 'crt-green'],
    ['cpu', cores ? `humanware (${cores} threads)` : 'humanware'],
    ...(mem ? [['memory', `${mem} GiB of coffee ☕`]] : []),
    ['locale', tz ? `${lang} · ${tz}` : lang],
    ['uptime', `${new Date().getFullYear() - 1980} years`],
    ['roles', 'architect · hacker · photographer · drone'],
    ['contact', 'cat contact.md'],
  ];

  const title = `${ctx.cfg.user}@${ctx.cfg.host}`;
  const info = [
    `<span class="accent text-glow">${E(ctx.cfg.user)}</span><span class="out">@</span><span class="accent text-glow">${E(ctx.cfg.host)}</span>`,
    `<span class="comment">${'─'.repeat(title.length)}</span>`,
    ...kv.map(([k, v]) =>
      `<span class="accent">${E(k)}</span><span class="comment">: </span><span class="out">${E(v)}</span>`,
    ),
  ];

  // --- CRT-monitor logo, padded to a fixed width so the columns line up ----
  const logo = [
    '┌─────────────┐',
    '│▒▒▒▒▒▒▒▒▒▒▒▒▒│',
    "│ Lud'OS ~ %  │",
    '│ > phosphor  │',
    '│▒▒▒▒▒▒▒▒▒▒▒▒▒│',
    '└──────┬──────┘',
    '    ╘══╧══╛    ',
  ];
  const W = Math.max(...logo.map((l) => l.length));
  const logoHtml = logo.map(
    (l) => `<span class="accent text-glow">${E(l.padEnd(W))}</span>`,
  );

  // --- Zip logo + info, then a phosphor color palette ----------------------
  const n = Math.max(logoHtml.length, info.length);
  let rows = '';
  for (let i = 0; i < n; i++) {
    const lo = logoHtml[i] ?? `<span>${' '.repeat(W)}</span>`;
    rows += `<div class="ln ascii-art">${lo}   ${info[i] ?? ''}</div>`;
  }
  const swatches = [1, 0.82, 0.66, 0.52, 0.4, 0.3, 0.2, 0.12]
    .map((o) => `<span style="display:inline-block;width:2.5ch;height:1em;vertical-align:middle;background:var(--green);opacity:${o}"></span>`)
    .join('');
  rows += `<div class="ln" style="margin-top:.4em">${' '.repeat(W + 3)}${swatches}</div>`;

  ctx.append(`<div class="ssh-out">${rows}</div>`);
---
