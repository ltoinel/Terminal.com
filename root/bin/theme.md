---
name: theme
desc: toggle the theme (crt|amber)
js: |
  const t = ctx.args[0];
  const amber = t === 'amber' ? true : t === 'crt' || t === 'green' ? false : !document.documentElement.classList.contains('amber');
  ctx.theme(amber);
  ctx.line(`theme: ${amber ? 'amber' : 'crt'}`);
---
