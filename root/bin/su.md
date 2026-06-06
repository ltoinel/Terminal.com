---
name: su
desc: devenir superutilisateur (root)
man: |
  # SU(1)

  ## NAME
  su — become the superuser (root)

  ## SYNOPSIS
  su [root]

  ## DESCRIPTION
  Opens a root shell and switches to /root, previously inaccessible.
  Only the root user exists. Return to your previous identity with
  exit.

  ## EXAMPLES
  su
  su root

  ## SEE ALSO
  exit, cd, sudo
js: |
  const err = ctx.su(ctx.args[0]);
  if (err) ctx.error(err);
---
