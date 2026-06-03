---
name: ls
desc: list directory contents
js: |
  const flags = ctx.args.filter((a) => a.startsWith('-')).join('');
  const all = /[aA]/.test(flags);   // -a / -A / -la …
  const long = /l/.test(flags);
  const path = ctx.args.find((a) => !a.startsWith('-'));
  const res = ctx.list(path);
  if (res.error) { ctx.error(`ls: ${res.error}`); return; }
  let entries = res.entries;
  if (!all) entries = entries.filter((e) => !e.name.startsWith('.')); // hide dotfiles
  // Directories are highlighted and suffixed with a slash.
  const cell = (e) => e.type === 'dir'
    ? `<span class="accent">${ctx.escape(e.name)}/</span>`
    : `<span class="prompt-path">${ctx.escape(e.name)}</span>`;
  if (long) {
    const d = new Date();
    const stamp = `${d.toLocaleString('fr-FR', { month: 'short' })} ${String(d.getDate()).padStart(2, ' ')}`;
    ctx.append(
      `<div class="ln comment">total ${entries.length}</div>` +
        entries
          .map((e) => {
            const perms = e.type === 'dir' ? 'drwxr-xr-x' : '-rw-r--r--';
            const size = String(e.size).padStart(5, ' ');
            return `<div class="ln"><span class="comment">${perms} 1 ludovic ludovic ${size} ${stamp} </span>${cell(e)}</div>`;
          })
          .join(''),
    );
  } else {
    ctx.append(`<div class="ln">${entries.map(cell).join('  ')}</div>`);
  }
---
