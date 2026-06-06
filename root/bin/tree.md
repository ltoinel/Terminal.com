---
name: tree
desc: list the filesystem as a tree — e.g. tree, tree /
man: |
  # TREE(1)

  ## NAME
  tree — show the filesystem as a tree

  ## SYNOPSIS
  tree [-a] [path]

  ## DESCRIPTION
  Shows the contents of the given directory (the current one by
  default) as a tree, then a count of directories and files. The /root
  directory stays hidden outside a root session (see su).

  ## OPTIONS
  -a   also show hidden files

  ## EXAMPLES
  tree
  tree /

  ## SEE ALSO
  ls, find, cd
js: |
  const root = ctx.args.find((a) => !a.startsWith('-')) || '.';
  const all = ctx.args.some((a) => /^-[a-z]*a/.test(a)); // -a shows dotfiles
  let dirs = 0, files = 0;
  const lines = [];
  // Depth-first walk; `ctx.list` returns an error for missing/denied paths,
  // which we simply skip (so /root stays hidden until you `su`).
  const walk = (path, prefix) => {
    const res = ctx.list(path);
    if (res.error || !res.entries) return;
    let entries = res.entries;
    if (!all) entries = entries.filter((e) => !e.name.startsWith('.'));
    entries.forEach((e, i) => {
      const last = i === entries.length - 1;
      const branch = last ? '└── ' : '├── ';
      const cell = e.type === 'dir'
        ? `<span class="accent">${ctx.escape(e.name)}/</span>`
        : `<span class="prompt-path">${ctx.escape(e.name)}</span>`;
      lines.push(`<div class="ln"><span class="comment">${prefix}${branch}</span>${cell}</div>`);
      if (e.type === 'dir') {
        dirs++;
        walk(`${path}/${e.name}`, prefix + (last ? '    ' : '│   '));
      } else {
        files++;
      }
    });
  };
  walk(root, '');
  ctx.append(
    `<div class="ln"><span class="accent">${ctx.escape(root)}</span></div>` + lines.join(''),
  );
  ctx.append(`<div class="ln comment">${dirs} directories, ${files} files</div>`);
---
