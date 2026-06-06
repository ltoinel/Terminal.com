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
    // Commands live in `bin/` as `*.md`; surface them as bare binary names. Their
    // source is NOT embedded in the browsable filesystem — it already ships,
    // parsed, in the command registry (`commandDefs`). Keeping it here too would
    // duplicate ~50 KB of man+js per page, so `/bin` files carry only a tiny stub
    // (enough for a friendly `cat`, while `ls`/`tree`/completion still work).
    const isBin = parts.length >= 2 && parts[parts.length - 2] === 'bin';
    if (isBin) name = name.replace(/\.md$/, '');
    dir.children[name] = {
      type: 'file',
      content: isBin ? `${name} — commande du shell. Voir: man ${name}\n` : content,
    };
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
const homeDocs: { name: string; content: string }[] =
  homeDir?.type === 'dir'
    ? Object.entries(homeDir.children)
        .filter(([n, node]) => n.endsWith('.md') && node.type === 'file')
        .map(([name, node]) => ({ name, content: (node as VFile).content }))
    : [];

/** Longest meta description we emit (search engines truncate well-formed snippets near here). */
const META_DESC_MAX = 155;

/**
 * Derive SEO meta (title + description) from a markdown document: the first ATX
 * heading becomes the title; the text that follows, stripped of markdown and
 * flattened to one line, becomes the description. Falls back to the slug.
 */
function metaFromMarkdown(md: string, slug: string): { title: string; desc: string } {
  const lines = md.split('\n').map((l) => l.trim());
  const heading = lines.find((l) => /^#{1,6}\s+/.test(l));
  const title = heading ? heading.replace(/^#{1,6}\s+/, '').trim() : slug;
  const text = lines
    .filter((l) => l && !/^#{1,6}\s+/.test(l)) // drop blank lines and headings
    .map((l) => l.replace(/^[-*]\s+/, '')) // de-list bullet items
    .join(' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [text](url) -> text
    .replace(/[*_`>#]/g, '') // strip emphasis / code / quote markers
    .replace(/\s+/g, ' ')
    .trim();
  const desc =
    text.length > META_DESC_MAX ? `${text.slice(0, META_DESC_MAX - 1).trimEnd()}…` : text;
  return { title, desc: desc || `document ${slug}` };
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inlineMd = (s: string): string => escapeHtml(s).replace(/`([^`]+)`/g, '<code>$1</code>');

/**
 * Render a command's `man` markdown to semantic HTML for server-side SEO: ATX
 * headings become <h1>/<h2>, and consecutive non-blank lines are joined into a
 * <p>. The terminal still renders the rich, interactive version on the client;
 * this is the crawlable mirror, emitted inside a visually-hidden block.
 */
export function manToHtml(md: string, isLinkable: (name: string) => boolean = () => false): string {
  let html = '';
  let para: string[] = [];
  let inSeeAlso = false;
  const flush = () => {
    if (para.length) {
      const joined = para.join(' ');
      // In "SEE ALSO", turn each command name that owns a page into a link to it.
      const inner = inSeeAlso
        ? escapeHtml(joined).replace(/[\w-]+/g, (tok) =>
            isLinkable(tok) ? `<a href="/${tok}">${tok}</a>` : tok,
          )
        : inlineMd(joined);
      html += `<p>${inner}</p>`;
      para = [];
    }
  };
  for (const line of md.split('\n')) {
    const h2 = line.match(/^##\s+(.*)$/);
    const h1 = line.match(/^#\s+(.*)$/);
    if (h2) {
      flush();
      inSeeAlso = h2[1].trim() === 'SEE ALSO';
      html += `<h2>${inlineMd(h2[1])}</h2>`;
    } else if (h1) {
      flush();
      inSeeAlso = false;
      html += `<h1>${inlineMd(h1[1])}</h1>`;
    } else if (line.trim() === '') {
      flush();
      inSeeAlso = false; // a blank line ends the section
    } else {
      para.push(line.trim());
    }
  }
  flush();
  return html;
}

/** Extract the `## DESCRIPTION` section of a man page as a clamped meta description. */
export function manMetaDescription(md: string): string {
  // Capture from the DESCRIPTION heading up to the next `## ` section or the end.
  // (No `m` flag: with it, `$` would match the first line break and truncate.)
  const m = md.match(/##\s+DESCRIPTION\s*\n([\s\S]*?)(?=\n##\s|$)/);
  if (!m) return '';
  const text = m[1]
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > META_DESC_MAX ? `${text.slice(0, META_DESC_MAX - 1).trimEnd()}…` : text;
}

/**
 * Commands that don't make good standalone landing pages (control / need args).
 * Aliases never produce a route on their own — `routes` is derived from the
 * command definitions, and an alias is just an extra name on an existing one.
 */
const NO_LINK = new Set([
  'clear',
  'exit',
  'boot',
  'll',
  'echo',
  'cat',
  'cd',
  'su',
  'history',
  'theme',
  // Argument-required utilities: a standalone page would only show "usage: …".
  'base64',
  'sha256sum',
  'man',
  'find',
  'grep',
  'touch',
  'mkdir',
  'rm',
  // Side effect (sends an SMS) + needs an argument — never a landing page.
  'msg',
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
  ...homeDocs.map(({ name, content }) => {
    const slug = name.replace(/\.md$/, '');
    return { slug, ...metaFromMarkdown(content, slug) };
  }),
];
