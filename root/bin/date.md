---
name: date
desc: date and time
man: |
  # DATE(1)

  ## NAME
  date — show the date and time

  ## SYNOPSIS
  date

  ## DESCRIPTION
  Displays the current date and time in the browser's local time zone.

  ## EXAMPLES
  date

  ## SEE ALSO
  uname, neofetch
js: |
  ctx.line(new Date().toString());
---
