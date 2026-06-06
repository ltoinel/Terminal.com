---
name: ll
desc: detailed list (ls -la)
man: |
  # LL(1)

  ## NAME
  ll — detailed listing (ls -la)

  ## SYNOPSIS
  ll [path]

  ## DESCRIPTION
  Shortcut for "ls -la": shows the directory contents in long format
  (permissions, owner, size, date), including hidden files.

  ## EXAMPLES
  ll
  ll /etc

  ## SEE ALSO
  ls, tree
js: |
  ctx.exec('ls', ['-la']);
---
