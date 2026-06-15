---
name: theme
desc: change the display theme — e.g. theme synthwave
man: |
  # THEME(1)

  ## NAME
  theme — change the display theme

  ## SYNOPSIS
  theme [name]

  ## DESCRIPTION
  Switches the CRT phosphor palette. With no argument, cycles to the
  next theme; with a name, applies it directly. Run `theme --list` to
  see every available theme. The choice is remembered for future
  visits.

  Green is the default (and the only theme with the Matrix rain
  background). `crt` is accepted as an alias for `green`.

  ## OPTIONS
  -l, --list   list the available themes

  ## THEMES
  green        green phosphor (default)
  amber        amber phosphor
  ice          cyan phosphor
  synthwave    neon magenta / cyan
  white        white phosphor (B&W)
  red          red phosphor

  ## EXAMPLES
  theme
  theme synthwave
  theme --list

  ## SEE ALSO
  motd
js: |
  const list = ctx.themes;
  const arg = (ctx.args[0] || '').toLowerCase();

  if (arg === '-l' || arg === '--list') {
    ctx.line(`available themes: ${list.join(', ')}`);
    return;
  }

  let next;
  if (arg) {
    const name = arg === 'crt' ? 'green' : arg; // `crt` is kept as a green alias
    if (!list.includes(name)) {
      ctx.error(`theme: unknown theme '${arg}' — try one of: ${list.join(', ')}`);
      return;
    }
    next = name;
  } else {
    // No argument: advance to the next theme in the list.
    next = list[(list.indexOf(ctx.currentTheme()) + 1) % list.length];
  }

  ctx.line(`theme: ${ctx.theme(next)}`);
---
