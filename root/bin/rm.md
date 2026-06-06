---
name: rm
desc: remove a file or directory — e.g. rm notes.txt, rm -r dir
man: |
  # RM(1)

  ## NAME
  rm — remove files or directories

  ## SYNOPSIS
  rm [-r] [-f] <path...>

  ## DESCRIPTION
  Removes the given files. A directory needs -r to be removed (with all its
  contents). Changes are saved in your browser (localStorage), so removals
  persist across visits — including of bundled files; clearing the site data in
  your browser restores the original tree. The current directory cannot be
  removed.

  ## OPTIONS
  -r, -R   remove directories and their contents recursively
  -f       ignore a missing target, suppress its error

  ## EXAMPLES
  rm notes.txt
  rm -r projects/2026
  rm -f maybe-absent.txt

  ## SEE ALSO
  mkdir, touch, ls
js: |
  const flags = ctx.args.filter((a) => a.startsWith('-')).join('');
  const recursive = /[rR]/.test(flags);
  const force = /f/.test(flags);
  const targets = ctx.args.filter((a) => !a.startsWith('-'));
  if (!targets.length) { if (!force) ctx.error('usage: rm [-r] [-f] <path...>'); return; }
  for (const t of targets) {
    const err = ctx.rm(t, recursive, force);
    if (err) ctx.error(`rm: ${err}`);
  }
---
