---
name: man
desc: show a command manual — e.g. man ls
man: |
  # MAN(1)

  ## NAME
  man — show a command's manual

  ## SYNOPSIS
  man <command>

  ## DESCRIPTION
  Displays the manual page for the given command. The command may be
  referred to by its name or by any of its aliases. If it provides no
  detailed manual, a short page is generated from its description.

  ## EXAMPLES
  man ls
  man grep

  ## SEE ALSO
  help
js: |
  const name = ctx.args[0];
  if (!name) { ctx.error('usage: man <command>'); return; }
  // Resolve by canonical name or by any of its aliases (e.g. `man cls` → clear).
  const cmd = ctx.commands.find((c) => c.name === name || (c.alias || []).includes(name));
  if (!cmd) { ctx.error(`man: No manual entry for ${name}`); return; }
  const aliases = cmd.alias || [];
  const footer = '> `help` lists every command · `man <name>` opens this page.';
  // Prefer the manual page authored in the command's `man:` frontmatter; fall
  // back to a lightweight one synthesised from the registered description.
  const body = cmd.man
    ? cmd.man
    : [
        `# ${cmd.name.toUpperCase()}(1)`,
        '',
        '## NAME',
        `${cmd.name} — ${cmd.desc || 'no description'}`,
        '',
        '## SYNOPSIS',
        `${cmd.name} [args]`,
        '',
        '## DESCRIPTION',
        cmd.desc || 'No description available.',
      ].join('\n');
  const page = [
    body,
    ...(aliases.length ? ['', '## ALIASES', aliases.join(', ')] : []),
    '',
    footer,
  ].join('\n');
  // Turn each command name in the "SEE ALSO" section into a link that opens its
  // manual (`[name](command:name)`); only names that resolve to a real command
  // or alias are linked, the rest is left untouched.
  const known = (n) => ctx.commands.some((c) => c.name === n || (c.alias || []).includes(n));
  let inSeeAlso = false;
  const linked = page
    .split('\n')
    .map((line) => {
      if (line.startsWith('## ')) { inSeeAlso = line.slice(3).trim() === 'SEE ALSO'; return line; }
      if (!line.trim()) { inSeeAlso = false; return line; } // a blank line ends the section
      if (inSeeAlso)
        return line.replace(/[\w-]+/g, (tok) => (known(tok) ? `[${tok}](command:${tok})` : tok));
      return line;
    })
    .join('\n');
  ctx.print(linked);
---
