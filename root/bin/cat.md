---
name: cat
desc: show a file — e.g. cat about.md
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
