---
name: theme
desc: toggle the theme (crt|amber)
man: |
  # THEME(1)

  ## NAME
  theme — change the display theme

  ## SYNOPSIS
  theme [crt|amber]

  ## DESCRIPTION
  Toggles between the green phosphor theme (crt) and the amber one
  (amber). With no argument, alternates between the two. The choice is
  remembered for future visits.

  ## OPTIONS
  crt, green   green phosphor
  amber        amber phosphor

  ## EXAMPLES
  theme
  theme amber

  ## SEE ALSO
  neofetch
js: |
  const t = ctx.args[0];
  const amber = t === 'amber' ? true : t === 'crt' || t === 'green' ? false : !document.documentElement.classList.contains('amber');
  ctx.theme(amber);
  ctx.line(`theme: ${amber ? 'amber' : 'crt'}`);
---
