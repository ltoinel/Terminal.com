/**
 * Build-time content loader, shared by `Terminal.astro`, the per-command pages
 * (`[command].astro`) and the sitemap.
 *
 * The fake filesystem is modeled by the on-disk `root/` directory tree: it is
 * the single source of truth for both the browsable filesystem (the whole tree)
 * and the executable commands (everything under `root/bin/`). This module walks
 * `root/` once and derives the nested VFS tree + the command registry from it.
 *
 * NOTE: build-time only (uses `import.meta.glob`); never imported by the client
 * `terminal.ts`, which reads the data back from injected JSON.
 */

import { validateCommands } from './commands.ts';
import type { CmdDef } from './commands.ts';

export type { CmdDef };

/** A node in the virtual filesystem (mirrors the on-disk `root/` tree). */
export type VFile = { type: 'file'; content: string };
export type VDir = { type: 'dir'; children: Record<string, VNode> };
export type VNode = VFile | VDir;

// Walk the whole `root/` tree once. `exhaustive` includes dotfiles (.bashrc, …);
// `?raw` gives each file's text content.
const rawEntries = Object.entries(
  import.meta.glob('../../root/**/*', {
    query: '?raw',
    import: 'default',
    eager: true,
    exhaustive: true,
  }),
  // Strip everything up to the FIRST `root/` (lazy: the project root dir, even when
  // a child is itself named `root`, e.g. `/root/`).
).map(([path, raw]) => [path.replace(/^.*?\/root\//, ''), raw as string] as [string, string]);

/** The whole fake filesystem as a nested tree (injected as `#shell-fs`). */
export const tree: VDir = (() => {
  const root: VDir = { type: 'dir', children: {} };
  for (const [rel, content] of rawEntries) {
    const parts = rel.split('/');
    // Create the intermediate directories.
    let dir = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      const next = dir.children[seg];
      if (next && next.type === 'dir') dir = next;
      else {
        const made: VDir = { type: 'dir', children: {} };
        dir.children[seg] = made;
        dir = made;
      }
    }
    let name = parts[parts.length - 1];
    if (name === '.keep') continue; // placeholder: only materializes its parent dir
    // Commands live in `bin/` as `*.md`; surface them as bare binary names.
    if (parts.length >= 2 && parts[parts.length - 2] === 'bin') name = name.replace(/\.md$/, '');
    dir.children[name] = { type: 'file', content };
  }
  return root;
})();

/** Commands (one per `root/bin/*.md`), parsed and validated at build time. */
export const commandDefs: CmdDef[] = (() => {
  const binEntries: [string, string][] = rawEntries
    .filter(([rel]) => /^bin\/[^/]+\.md$/.test(rel))
    .map(([rel, raw]) => [rel.split('/').pop() as string, raw]);
  const { defs, errors } = validateCommands(binEntries);
  if (errors.length)
    throw new Error(`Invalid command definition(s):\n  - ${errors.join('\n  - ')}`);
  return defs;
})();

/** Home documents (`~`) eligible for a landing page: the `.md` files in HOME. */
const homeDir =
  tree.children.home?.type === 'dir' ? tree.children.home.children.ludovic : undefined;
const homeDocs =
  homeDir?.type === 'dir' ? Object.keys(homeDir.children).filter((n) => n.endsWith('.md')) : [];

/** Commands that don't make good standalone landing pages (control / need args). */
const NO_LINK = new Set([
  'clear',
  'cls',
  'exit',
  'boot',
  'll',
  'echo',
  'cat',
  'cd',
  'su',
  'history',
  'theme',
]);

export interface Route {
  /** URL slug, also the command/document run on load (e.g. `whoami`, `about`). */
  slug: string;
  /** Page `<title>` seed. */
  title: string;
  /** Page meta description. */
  desc: string;
}

/** Deep-linkable routes: content commands + home documents (one page each). */
export const routes: Route[] = [
  ...commandDefs
    .filter((c) => !NO_LINK.has(c.name))
    .map((c) => ({ slug: c.name, title: c.name, desc: c.desc || `commande ${c.name}` })),
  ...homeDocs.map((f) => {
    const slug = f.replace(/\.md$/, '');
    return { slug, title: slug, desc: `document ${f}` };
  }),
];
