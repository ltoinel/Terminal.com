---
name: su
desc: devenir superutilisateur (root)
js: |
  const err = ctx.su(ctx.args[0]);
  if (err) ctx.error(err);
---
