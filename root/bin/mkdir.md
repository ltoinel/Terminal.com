---
name: mkdir
desc: create a directory — e.g. mkdir -p projets/2026
man: |
  # MKDIR(1)

  ## NAME
  mkdir — create a directory

  ## SYNOPSIS
  mkdir [-p] <dir...>

  ## DESCRIPTION
  Creates each given directory. Without -p, the parent must already exist and the
  target must not. Changes are saved in your browser (localStorage), so the
  directories persist across visits.

  ## OPTIONS
  -p   create parent directories as needed; no error if the target exists

  ## EXAMPLES
  mkdir notes
  mkdir -p projets/2026/photos

  ## SEE ALSO
  touch, rm, ls, cd
js: |
  const parents = ctx.args.some((a) => /^-[a-z]*p/.test(a));
  const dirs = ctx.args.filter((a) => !a.startsWith('-'));
  if (!dirs.length) { ctx.error('usage: mkdir [-p] <dir...>'); return; }
  for (const d of dirs) {
    const err = ctx.mkdir(d, parents);
    if (err) ctx.error(`mkdir: ${err}`);
  }
---
