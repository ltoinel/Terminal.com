---
name: neofetch
desc: system info
js: |
  const logo = ['█    ████', '█      █ ', '█      █ ', '████   █ '];
  const info = [
    ['user', ctx.cfg.user],
    ['host', ctx.cfg.host],
    ['os', 'LudOs · phosphor'],
    ['shell', 'ltsh 1.0'],
    ['theme', document.documentElement.classList.contains('amber') ? 'amber' : 'crt-green'],
    ['roles', 'architecte · hacker · photographe'],
    ['uptime', `${new Date().getFullYear() - 1980} ans`],
    ['contact', 'cat contact.md'],
  ];
  const rows = logo
    .map((l, i) => {
      const kv = info[i] ? `<span class="accent">${info[i][0]}</span><span class="comment">: </span><span class="out">${ctx.escape(info[i][1])}</span>` : '';
      return `<div class="ln"><span class="accent text-glow">${ctx.escape(l)}</span>   ${kv}</div>`;
    })
    .join('');
  const extra = info
    .slice(logo.length)
    .map(([k, v]) => `<div class="ln"><span class="accent" style="margin-left:12ch">${k}</span><span class="comment">: </span><span class="out">${ctx.escape(v)}</span></div>`)
    .join('');
  ctx.append(`<div class="ssh-out">${rows}${extra}</div>`);
---
