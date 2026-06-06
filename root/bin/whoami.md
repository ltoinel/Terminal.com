---
name: whoami
desc: who am I
man: |
  # WHOAMI(1)

  ## NAME
  whoami — who am I

  ## SYNOPSIS
  whoami

  ## DESCRIPTION
  Prints a short introduction to the owner of this terminal, built from
  the site identity (name, role, company, interests) declared in the
  configuration — a single source of truth shared with the page metadata.

  ## EXAMPLES
  whoami

  ## SEE ALSO
  neofetch, open
js: |
  // Identity comes from site.config.ts, injected into the shell cfg as `profile`.
  const p = ctx.cfg.profile;
  if (!p) { ctx.error('whoami: identity unavailable'); return; }
  const lines = [
    `# ${p.name}`,
    `## ${p.role}${p.company ? ` @ ${p.company}` : ''}`,
    '',
  ];
  if (p.knowsAbout && p.knowsAbout.length) lines.push(`> ${p.knowsAbout.join(' · ')}`);
  const home = [p.nationality ? `Based in ${p.nationality}` : '', p.url ? `[${ctx.cfg.host}](${p.url})` : '']
    .filter(Boolean)
    .join(' · ');
  if (home) lines.push(`> ${home}`);
  ctx.print(lines.join('\n'));
---
