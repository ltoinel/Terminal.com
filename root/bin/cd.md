---
name: cd
desc: change directory — e.g. cd /etc, cd .. or cd ~
js: |
  const err = ctx.cd(ctx.args[0]);
  if (err) ctx.error(err);
  else if (ctx.args[0] === '-') ctx.line(ctx.cwd()); // bash echoes the new dir
---
