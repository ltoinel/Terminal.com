---
name: pwd
desc: print working directory
man: |
  # PWD(1)

  ## NAME
  pwd — print the current directory

  ## SYNOPSIS
  pwd

  ## DESCRIPTION
  Prints the absolute path of the current working directory.

  ## EXAMPLES
  pwd

  ## SEE ALSO
  cd, ls
js: |
  ctx.line(ctx.cwd());
---
