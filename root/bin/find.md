---
name: find
desc: find files by name — e.g. find . -name '*.md'
man: |
  # FIND(1)

  ## NAME
  find — find files by name

  ## SYNOPSIS
  find [path] [-name <pattern>] [-type f|d]

  ## DESCRIPTION
  Recursively walks the tree starting from [path] (the current
  directory by default) and prints the entries it encounters. The /root
  directory stays hidden until you are the superuser (see su).

  ## OPTIONS
  -name <pattern>   keep only names matching the pattern
                    (wildcards * and ? allowed)
  -type f           keep only files
  -type d           keep only directories

  ## EXAMPLES
  find
  find . -name '*.md'
  find / -type d

  ## SEE ALSO
  grep, ls, tree
js: |
  const E = ctx.escape;
  const args = ctx.args;
  let start = '.';
  let namePat = null;
  let typeF = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-name') namePat = args[++i];
    else if (a === '-type') typeF = args[++i];
    else if (!a.startsWith('-')) start = a;
  }
  if (typeF && typeF !== 'f' && typeF !== 'd') {
    ctx.error(`find: '${typeF}': unknown type (use f or d)`);
    return;
  }
  // Translate a shell glob (* and ?) into an anchored regex on the basename.
  const toRe = (p) =>
    new RegExp(
      '^' +
        p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') +
        '$',
    );
  const re = namePat != null ? toRe(namePat) : null;
  const wantType = (type) =>
    !typeF || (typeF === 'f' && type === 'file') || (typeF === 'd' && type === 'dir');

  const probe = ctx.list(start);
  if (probe.error) {
    ctx.error(`find: '${start}': ${probe.error}`);
    return;
  }

  // Depth-first walk; denied/missing paths simply yield nothing (so /root stays
  // hidden until you `su`), matching `tree`'s behaviour.
  const hits = [];
  const walk = (path) => {
    const res = ctx.list(path);
    if (res.error || !res.entries) return;
    for (const e of res.entries) {
      const child = path === '/' ? `/${e.name}` : `${path}/${e.name}`;
      if (wantType(e.type) && (!re || re.test(e.name))) hits.push({ path: child, type: e.type });
      if (e.type === 'dir') walk(child);
    }
  };
  walk(start);

  for (const h of hits) {
    const cell =
      h.type === 'dir'
        ? `<span class="accent">${E(h.path)}/</span>`
        : `<span class="prompt-path">${E(h.path)}</span>`;
    ctx.append(`<div class="ln">${cell}</div>`);
  }
---
