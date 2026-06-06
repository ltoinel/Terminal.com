---
name: help
desc: show this help
man: |
  # HELP(1)

  ## NAME
  help — show help

  ## SYNOPSIS
  help

  ## DESCRIPTION
  Lists every available command with its description, then the files in
  the current directory. For details on a command, use man <command>.

  ## EXAMPLES
  help

  ## SEE ALSO
  man
js: |
  const rows = ctx.commands
    .map((c) => `<div class="ln"><span class="accent" style="display:inline-block;min-width:7.5rem">${c.name}</span><span class="comment">${ctx.escape(c.desc || '')}</span></div>`)
    .join('');
  ctx.append(`<div class="ssh-out"><div class="ln"><span class="prompt-path"># commands</span></div>${rows}</div>`);
  ctx.line('');
  ctx.append(`<div class="ln comment"># files (try <span class="cmd">cat &lt;file&gt;</span> or just the name):</div><div class="ln">${ctx.fileList().map((f) => `<span class="prompt-path">${f}</span>`).join('  ')}</div>`);
  ctx.line('');
  ctx.append('<div class="ln comment"># run <span class="cmd">man &lt;command&gt;</span> for more on a command</div>');
---
