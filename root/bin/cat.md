---
name: cat
desc: show a file — e.g. cat about.md, cat -n notes.txt
man: |
  # CAT(1)

  ## NAME
  cat — concatenate and print files

  ## SYNOPSIS
  cat [-n] [-b] [-E] [-s] <file...>
  cat                       (read piped input)

  ## DESCRIPTION
  Prints the contents of the given files, in order. A single Markdown document
  (.md) is rendered, unless a formatting flag is used; everything else is shown
  verbatim. With no file (or `-`), cat prints what is piped into it, so it works
  in a pipeline — e.g. `ls | cat -n`.

  ## OPTIONS
  -n   number all output lines
  -b   number non-blank output lines (overrides -n)
  -E   show a `$` at the end of each line
  -s   squeeze repeated blank lines into one
  -    read standard input (the piped text)

  Single-letter flags can be combined, e.g. `cat -nE file`.

  ## EXAMPLES
  cat about.md
  cat contact.md projects.md
  cat -n notes.txt
  ls | cat -n
  echo "hello" | cat -E

  ## SEE ALSO
  ls, find, grep
js: |
  // cat — concatenate files (or piped stdin) with the usual -n/-b/-E/-s flags.
  // A lone .md file with no flags is rendered (the portal's nice view); anything
  // else is printed verbatim. Reads ctx.stdin when given no file (or `-`), so it
  // composes in pipelines.
  const args = ctx.args.slice();

  // Parse combinable flags; collect file operands (in order). `--` ends options.
  let number = false, numberNonBlank = false, showEnds = false, squeeze = false;
  const files = [];
  let opts = true;
  for (const a of args) {
    if (opts && a === '--') { opts = false; continue; }
    if (opts && a === '-') { files.push('-'); continue; }
    if (opts && a.length > 1 && a[0] === '-') {
      let bad = null;
      for (const ch of a.slice(1)) {
        if (ch === 'n') number = true;
        else if (ch === 'b') numberNonBlank = true;
        else if (ch === 'E') showEnds = true;
        else if (ch === 's') squeeze = true;
        else { bad = ch; break; }
      }
      if (bad) { ctx.error('cat: invalid option -- ' + bad); return; }
      continue;
    }
    files.push(a);
  }

  // Resolve the ordered list of sources to print.
  const sources = [];
  if (!files.length) {
    if (ctx.stdin) sources.push({ name: '-', content: ctx.stdin });
    else { ctx.error('usage: cat <file>...'); return; }
  } else {
    for (const f of files) {
      if (f === '-') { sources.push({ name: '-', content: ctx.stdin || '' }); continue; }
      const res = ctx.read(f);
      if (res.error) { ctx.error('cat: ' + f + ': ' + res.error); continue; }
      sources.push({ name: res.name || f, content: res.content });
    }
  }

  const flagsActive = number || numberNonBlank || showEnds || squeeze;
  let lineNo = 1; // continuous across files, like real `cat -n`

  // Apply -s/-b/-n/-E to a file's text, returning the transformed string.
  const transform = (text) => {
    let lines = text.replace(/\n$/, '').split('\n');
    if (squeeze) {
      const out = [];
      let prevBlank = false;
      for (const l of lines) {
        const blank = l === '';
        if (blank && prevBlank) continue;
        prevBlank = blank;
        out.push(l);
      }
      lines = out;
    }
    return lines
      .map((l) => {
        let prefix = '';
        if (numberNonBlank) prefix = l === '' ? '' : String(lineNo++).padStart(6) + '\t';
        else if (number) prefix = String(lineNo++).padStart(6) + '\t';
        return prefix + l + (showEnds ? '$' : '');
      })
      .join('\n');
  };

  for (const src of sources) {
    // A lone .md with no flags keeps the rendered view; otherwise print verbatim.
    if (!flagsActive && src.name !== '-' && src.name.endsWith('.md')) {
      ctx.print(src.content);
    } else {
      ctx.raw(transform(src.content));
    }
  }
---
