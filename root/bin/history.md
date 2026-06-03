---
name: history
desc: previous commands
js: |
  ctx.append(
    ctx.history
      .map((h, i) => `<div class="ln"><span class="comment">${String(i + 1).padStart(3)} </span>${ctx.escape(h)}</div>`)
      .join('') || '<div class="ln comment"># empty</div>',
  );
---
