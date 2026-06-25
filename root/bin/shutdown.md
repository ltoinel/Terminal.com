---
name: shutdown
desc: power off — closes this shell window (alias: reboot)
alias: reboot
man: |
  # SHUTDOWN(1)

  ## NAME
  shutdown — halt the system and close this shell window

  ## SYNOPSIS
  shutdown
  reboot

  ## DESCRIPTION
  Plays a short halt sequence, then closes the terminal window it was run in.
  `reboot` is an alias with the same effect. The main window can be reopened
  from the dock ("+ shell" button); a spawned window is removed for good. Any
  time argument (e.g. `now`) is accepted and ignored.

  ## EXAMPLES
  shutdown
  shutdown now
  reboot

  ## SEE ALSO
  exit, boot
js: |
  // shutdown / reboot — a brief halt sequence, then close THIS terminal window
  // via ctx.close() (which unconditionally closes the window, unlike `exit`).
  const E = ctx.escape;
  const ok = (msg) =>
    ctx.append('<div class="ln"><span class="comment">[</span><span class="accent text-glow"> OK </span><span class="comment">] ' + E(msg) + '</span></div>');

  ctx.line('');
  ctx.append('<div class="ln"><span class="accent text-glow">Broadcast message</span><span class="comment"> — the system is going down NOW!</span></div>');

  const steps = [
    'Stopping user sessions…',
    'Unmounting /home/guest…',
    'Closing the encrypted LTS link…',
    'Powering off the CRT…',
  ];
  for (const s of steps) {
    ok(s);
    await ctx.sleep(180);
  }

  ctx.line('');
  ctx.append('<div class="ln ascii-art"><span class="accent text-glow">— system halted —</span></div>');
  await ctx.sleep(500);

  // Close the window this command runs in.
  ctx.close();
---
