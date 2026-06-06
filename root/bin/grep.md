---
name: grep
desc: search text in files — e.g. grep -rn ssh .
man: |
  # GREP(1)

  ## NAME
  grep — search for text in files

  ## SYNOPSIS
  grep [-i] [-n] [-r] <pattern> <file...>

  ## DESCRIPTION
  Prints the lines matching <pattern> (a regular expression) in the
  given files. Matches are highlighted. With -r, directories are
  searched recursively.

  ## OPTIONS
  -i   ignore case
  -n   prefix each line with its number
  -r   search directories recursively

  ## EXAMPLES
  grep -rn ssh .
  grep -i error bin/boot

  ## SEE ALSO
  find, cat
js: |
  const E = ctx.escape;
  // Parse short flags (bundled like -rn), keep the rest as pattern + targets.
  let ci = false;
  let num = false;
  let rec = false;
  const rest = [];
  for (const a of ctx.args) {
    if (a.length > 1 && a.startsWith('-') && !a.startsWith('--')) {
      for (const ch of a.slice(1)) {
        if (ch === 'i') ci = true;
        else if (ch === 'n') num = true;
        else if (ch === 'r' || ch === 'R') rec = true;
      }
    } else {
      rest.push(a);
    }
  }
  const pattern = rest.shift();
  if (pattern == null) {
    ctx.error('usage: grep [-inr] <pattern> <file...>');
    return;
  }
  let targets = rest;
  if (!targets.length) targets = rec ? ['.'] : null;
  if (!targets) {
    ctx.error('grep: no file given (add -r to search recursively)');
    return;
  }

  // The pattern is a regex; fall back to a literal match if it doesn't compile.
  let re;
  try {
    re = new RegExp(pattern, ci ? 'gi' : 'g');
  } catch {
    re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), ci ? 'gi' : 'g');
  }

  // Resolve targets into a flat list of file paths (expanding dirs under -r).
  const paths = [];
  const walk = (path) => {
    const res = ctx.list(path);
    if (res.error || !res.entries) return;
    for (const e of res.entries) {
      const child = path === '/' ? `/${e.name}` : `${path}/${e.name}`;
      if (e.type === 'dir') {
        if (rec) walk(child);
      } else {
        paths.push(child);
      }
    }
  };
  for (const t of targets) {
    const rd = ctx.read(t);
    if (rd.error === 'Is a directory') {
      if (rec) walk(t);
      else ctx.error(`grep: ${t}: is a directory (add -r)`);
    } else if (rd.error) {
      ctx.error(`grep: ${t}: ${rd.error}`);
    } else {
      paths.push(t);
    }
  }

  const showName = rec || paths.length > 1;
  for (const p of paths) {
    const rd = ctx.read(p);
    if (rd.error) continue;
    rd.content.split('\n').forEach((line, idx) => {
      re.lastIndex = 0;
      if (!re.test(line)) return;
      // Rebuild the line with each match highlighted, escaping the segments.
      let html = '';
      let last = 0;
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(line)) !== null) {
        html += E(line.slice(last, m.index)) + `<span class="accent text-glow">${E(m[0])}</span>`;
        last = m.index + m[0].length;
        if (m.index === re.lastIndex) re.lastIndex++; // avoid looping on empty matches
      }
      html += E(line.slice(last));
      const prefix =
        (showName ? `<span class="prompt-path">${E(p)}</span><span class="comment">:</span>` : '') +
        (num ? `<span class="comment">${idx + 1}:</span>` : '');
      ctx.append(`<div class="ln">${prefix}${html}</div>`);
    });
  }
---
