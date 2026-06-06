---
name: sudo
desc: attempt to elevate privileges
man: |
  # SUDO(1)

  ## NAME
  sudo — attempt to elevate privileges

  ## SYNOPSIS
  sudo <command>

  ## DESCRIPTION
  Politely refuses any elevation. To become the superuser on this
  terminal, use su.

  ## EXAMPLES
  sudo rm -rf /

  ## SEE ALSO
  su
js: |
  ctx.error(ctx.body.trim());
---
Permission denied. This incident has been reported to Santa Claus.
