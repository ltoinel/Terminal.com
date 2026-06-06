---
name: cd
desc: change directory — e.g. cd /etc, cd .. or cd ~
man: |
  # CD(1)

  ## NAME
  cd — change the current directory

  ## SYNOPSIS
  cd [path]

  ## DESCRIPTION
  Changes the working directory. With no argument, returns to the home
  directory (~). Accepts absolute and relative paths, ~ (home) and -
  (previous directory). The /root directory is reserved for the
  superuser (see su).

  ## EXAMPLES
  cd /etc
  cd ..
  cd ~
  cd -

  ## SEE ALSO
  ls, pwd, tree
js: |
  const err = ctx.cd(ctx.args[0]);
  if (err) ctx.error(err);
  else if (ctx.args[0] === '-') ctx.line(ctx.cwd()); // bash echoes the new dir
---
