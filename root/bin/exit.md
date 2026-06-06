---
name: exit
desc: close the session
man: |
  # EXIT(1)

  ## NAME
  exit — close the session

  ## SYNOPSIS
  exit

  ## DESCRIPTION
  Leaves the current shell. After an su, exit returns to the previous
  identity; at the top level, exit closes the terminal window (a
  reconnect button then appears).

  ## EXAMPLES
  exit

  ## SEE ALSO
  su, boot
js: |
  ctx.exit();
---
