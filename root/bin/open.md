---
name: open
desc: open a link — e.g. open github
man: |
  # OPEN(1)

  ## NAME
  open — open a link

  ## SYNOPSIS
  open [name]

  ## DESCRIPTION
  Opens one of my links (blog, GitHub, LinkedIn, etc.) in a new tab.
  With no argument, lists the available names.

  ## EXAMPLES
  open
  open github

  ## SEE ALSO
  mail, msg
js: |
  const keys = Object.keys(ctx.cfg.links).sort();
  if (!ctx.args.length) {
    ctx.append(`<div class="ln comment"># usage: open &lt;name&gt;</div><div class="ln">${keys.map((k) => `<span class="prompt-path">${k}</span>`).join('  ')}</div>`);
    return;
  }
  const url = ctx.cfg.links[ctx.args[0]];
  if (!url) { ctx.error(`open: ${ctx.args[0]}: unknown link (type \`open\` for the list)`); return; }
  ctx.line(`opening ${url} …`);
  ctx.open(url);
---
