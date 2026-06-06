---
name: history
desc: previous commands
man: |
  # HISTORY(1)

  ## NAME
  history — show the command history

  ## SYNOPSIS
  history

  ## DESCRIPTION
  Lists, numbered, the commands typed during the session. The history
  persists across visits (stored locally in the browser). The ↑ and ↓
  arrows browse it at the prompt.

  ## EXAMPLES
  history

  ## SEE ALSO
  clear
js: |
  ctx.append(
    ctx.history
      .map((h, i) => `<div class="ln"><span class="comment">${String(i + 1).padStart(3)} </span>${ctx.escape(h)}</div>`)
      .join('') || '<div class="ln comment"># empty</div>',
  );
---
