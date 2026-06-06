---
name: echo
desc: echo the text
man: |
  # ECHO(1)

  ## NAME
  echo — display a line of text

  ## SYNOPSIS
  echo [text...]

  ## DESCRIPTION
  Prints the given arguments, separated by a single space, followed by
  a newline.

  ## EXAMPLES
  echo hello world

  ## SEE ALSO
  cat
js: |
  ctx.line(ctx.args.join(' '));
---
