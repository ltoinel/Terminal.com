---
name: su
desc: become the superuser (root)
man: |
  # SU(1)

  ## NAME
  su — become the superuser (root)

  ## SYNOPSIS
  su [root]

  ## DESCRIPTION
  Opens a root shell and switches to /root, previously inaccessible.
  Authentication is required: enter the root password when prompted
  (the input is hidden). Only the root user exists. Return to your
  previous identity with exit.

  ## EXAMPLES
  su
  su root

  ## SEE ALSO
  exit, cd, sudo
js: |
  // Authenticate (masked input) before elevating. The password is "password".
  const pw = await ctx.ask('Password:', { secret: true });
  if (pw !== 'password') { ctx.error('su: authentication failure'); return; }
  const err = ctx.su(ctx.args[0]);
  if (err) ctx.error(err);
---
