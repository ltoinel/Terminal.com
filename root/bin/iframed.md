---
name: iframed
desc: open a URL in an in-page window — e.g. iframed https://example.com
man: |
  # IFRAMED(1)

  ## NAME
  iframed — open a URL inside a draggable in-page window (an <iframe>)

  ## SYNOPSIS
  iframed <url>

  ## DESCRIPTION
  Opens a small browser window, embedded in the page, that frames the
  given URL in an <iframe>. The window can be dragged by its title bar,
  minimized, maximized and closed like a shell window. A bare host is
  assumed to be https.

  Many sites refuse to be embedded (they send X-Frame-Options or a
  Content-Security-Policy frame-ancestors directive) and will show up as
  a blank frame — that is the remote site's choice, not a bug. Use the
  "↗ ouvrir" link in the title bar to open such a site in a real tab.

  ## EXAMPLES
  iframed https://example.com
  iframed example.com

  ## SEE ALSO
  open
js: |
  const url = ctx.args[0];
  if (!url) { ctx.error('usage: iframed <url>'); return; }
  const err = ctx.iframe(url);
  if (err) ctx.error(`iframed: ${err}`);
  else ctx.line(`framing ${url} …`);
---
