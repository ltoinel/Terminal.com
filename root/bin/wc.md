---
name: wc
desc: count lines, words and bytes — e.g. wc about.md, ls | wc -l
man: |
  # WC(1)

  ## NAME
  wc — count lines, words, characters and bytes

  ## SYNOPSIS
  wc [-l] [-w] [-c] [-m] [-L] <file...>
  wc                        (count piped input)

  ## DESCRIPTION
  Counts newlines, words and bytes in each file, printing one row per file plus a
  `total` row when several are given. With no file (or `-`), wc counts what is
  piped into it — e.g. `ls | wc -l`. With no flag, it prints lines, words and
  bytes (in that order).

  ## OPTIONS
  -l   count lines (newlines)
  -w   count words (whitespace-separated)
  -c   count bytes (UTF-8)
  -m   count characters (code points)
  -L   length of the longest line
  -    count standard input (the piped text)

  Single-letter flags can be combined, e.g. `wc -lw file`.

  ## EXAMPLES
  wc about.md
  wc -l about.md contact.md
  ls | wc -l
  echo "hello world" | wc -w

  ## SEE ALSO
  cat, grep, ls
js: |
  // wc — count lines / words / bytes / chars / longest line of files or piped
  // stdin, with the usual -l/-w/-c/-m/-L flags. Mirrors `cat`'s input handling.
  const args = ctx.args.slice();

  // Parse combinable flags; collect file operands (in order). `--` ends options.
  let doLines = false, doWords = false, doBytes = false, doChars = false, doLong = false;
  const files = [];
  let opts = true;
  for (const a of args) {
    if (opts && a === '--') { opts = false; continue; }
    if (opts && a.length > 1 && a[0] === '-' && a !== '-') {
      let bad = null;
      for (const ch of a.slice(1)) {
        if (ch === 'l') doLines = true;
        else if (ch === 'w') doWords = true;
        else if (ch === 'c') doBytes = true;
        else if (ch === 'm') doChars = true;
        else if (ch === 'L') doLong = true;
        else { bad = ch; break; }
      }
      if (bad) { ctx.error('wc: invalid option -- ' + bad); return; }
      continue;
    }
    files.push(a);
  }

  // Default columns (like real wc): lines, words, bytes.
  if (!doLines && !doWords && !doBytes && !doChars && !doLong) { doLines = doWords = doBytes = true; }

  // Resolve the ordered list of sources.
  const sources = [];
  if (!files.length) {
    if (ctx.stdin) sources.push({ name: '', content: ctx.stdin });
    else { ctx.error('usage: wc [-lwcmL] <file>...'); return; }
  } else {
    for (const f of files) {
      if (f === '-') { sources.push({ name: '-', content: ctx.stdin || '' }); continue; }
      const res = ctx.read(f);
      if (res.error) { ctx.error('wc: ' + f + ': ' + res.error); continue; }
      sources.push({ name: res.name || f, content: res.content });
    }
  }
  if (!sources.length) return;

  // Count one source.
  const count = (s) => {
    const trimmed = s.trim();
    let longest = 0;
    for (const line of s.split('\n')) if (line.length > longest) longest = line.length;
    return {
      lines: (s.match(/\n/g) || []).length,
      words: trimmed ? trimmed.split(/\s+/).length : 0,
      bytes: new TextEncoder().encode(s).length,
      chars: Array.from(s).length,
      longest,
    };
  };

  // Selected columns, in canonical order.
  const cols = [];
  if (doLines) cols.push('lines');
  if (doWords) cols.push('words');
  if (doBytes) cols.push('bytes');
  if (doChars) cols.push('chars');
  if (doLong) cols.push('longest');

  const rows = sources.map((src) => ({ name: src.name, c: count(src.content) }));
  if (rows.length > 1) {
    const tot = { lines: 0, words: 0, bytes: 0, chars: 0, longest: 0 };
    for (const r of rows) {
      for (const k of Object.keys(tot)) tot[k] = k === 'longest' ? Math.max(tot[k], r.c[k]) : tot[k] + r.c[k];
    }
    rows.push({ name: 'total', c: tot });
  }

  // Right-align every count to the widest value, like real wc.
  let width = 1;
  for (const r of rows) for (const k of cols) width = Math.max(width, String(r.c[k]).length);
  for (const r of rows) {
    const nums = cols.map((k) => String(r.c[k]).padStart(width)).join(' ');
    ctx.line(nums + (r.name ? ' ' + r.name : ''));
  }
---
