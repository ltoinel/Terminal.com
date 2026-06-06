---
name: cat
desc: show a file — e.g. cat about.md
man: |
  # CAT(1)

  ## NAME
  cat — show the contents of a file

  ## SYNOPSIS
  cat <file...>

  ## DESCRIPTION
  Prints the contents of the given files. Markdown documents (.md) are
  rendered; other files are shown verbatim. Several files can be
  concatenated in one call.

  ## EXAMPLES
  cat about.md
  cat contact.md projects.md

  ## SEE ALSO
  ls, find, grep
js: |
  if (!ctx.args.length) { ctx.error('usage: cat <file>'); return; }
  for (const a of ctx.args) {
    const res = ctx.read(a);
    if (res.error) ctx.error(`cat: ${a}: ${res.error}`);
    // Markdown documents are rendered; other files are shown verbatim.
    else if ((res.name || '').endsWith('.md')) ctx.print(res.content);
    else ctx.raw(res.content);
  }
---
