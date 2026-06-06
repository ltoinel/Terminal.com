---
name: bell
desc: toggle the Tab-completion bell (on|off)
man: |
  # BELL(1)

  ## NAME
  bell — toggle the terminal completion bell

  ## SYNOPSIS
  bell [on|off]

  ## DESCRIPTION
  Controls the short beep played when Tab completion can't uniquely
  complete — no match, or an ambiguous prefix that can't be extended —
  like a classic Linux shell. A unique completion stays silent.

  With no argument, toggles the bell. The choice is remembered across
  visits (stored locally in the browser).

  ## OPTIONS
  on    enable the bell
  off   mute the bell

  ## EXAMPLES
  bell
  bell off
  bell on

  ## SEE ALSO
  theme, clear
js: |
  const arg = (ctx.args[0] || '').toLowerCase();
  let on;
  if (arg === 'on') on = true;
  else if (arg === 'off') on = false;
  else {
    // Toggle: muted only when explicitly stored as 'off' (default is on).
    let muted = false;
    try { muted = localStorage.getItem('ltsh.bell') === 'off'; } catch { /* ignore */ }
    on = muted; // currently muted → turn on, and vice-versa
  }
  try {
    localStorage.setItem('ltsh.bell', on ? 'on' : 'off');
  } catch {
    ctx.error('bell: cannot save preference (storage unavailable)');
    return;
  }
  ctx.line(`bell: ${on ? 'on' : 'off'}`);
---
