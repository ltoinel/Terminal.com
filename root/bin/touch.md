---
name: touch
desc: create an empty file — e.g. touch notes.txt
man: |
  # TOUCH(1)

  ## NAME
  touch — create an empty file

  ## SYNOPSIS
  touch <file...>

  ## DESCRIPTION
  Creates each given file, empty, if it does not already exist; otherwise leaves
  it untouched. Changes are saved in your browser (localStorage), so the files
  persist across visits. The parent directory must already exist.

  ## EXAMPLES
  touch notes.txt
  touch ~/todo.md /tmp/a /tmp/b

  ## SEE ALSO
  mkdir, rm, ls
js: |
  const files = ctx.args.filter((a) => !a.startsWith('-'));
  if (!files.length) { ctx.error('usage: touch <file...>'); return; }
  for (const f of files) {
    const err = ctx.touch(f);
    if (err) ctx.error(`touch: ${err}`);
  }
---
