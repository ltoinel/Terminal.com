/**
 * Shared command parsing and validation, used by two consumers:
 *  - `content.ts`            : at Astro build time (via `import.meta.glob`).
 *  - `scripts/check-commands.ts` : standalone, via `node:fs` (the `check:commands` script).
 *
 * Keeping it free of `import.meta.glob` (Vite-only) is what lets the standalone
 * checker reuse the exact same logic the build relies on.
 */

export interface CmdDef {
  name: string;
  desc?: string;
  /** Alternate names that resolve to this same command (e.g. `cls` → `clear`). */
  alias?: string[];
  /** Authored manual page (markdown), shown by `man <name>`. */
  man?: string;
  js?: string;
  body: string;
}

/**
 * Parse a command markdown file: YAML-ish frontmatter (`name`, `desc`, an
 * optional comma/space-separated `alias` list) plus the multi-line `key: |`
 * block scalars `man` and `js`, followed by the body.
 *
 * A `key: |` block runs over the indented (and blank) lines that follow it and
 * ends at the next column-0 key, so `man: |` and `js: |` can coexist in any
 * order (each line is de-indented by two spaces, mirroring YAML).
 */
export function parseCommand(raw: string): CmdDef {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { name: '', body: raw.trim() };
  const [, fm, rawBody] = m;
  const def: CmdDef = { name: '', body: rawBody.replace(/^\n+/, '') };
  const lines = fm.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const block = lines[i].match(/^(\w+):\s*\|\s*$/);
    if (block) {
      const collected: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        // The block continues over blank lines and indented lines; a column-0
        // line is the next key and ends it.
        if (lines[j] === '' || /^\s/.test(lines[j])) collected.push(lines[j].replace(/^ {2}/, ''));
        else break;
      }
      const value = collected.join('\n');
      if (block[1] === 'js') def.js = value.trim();
      else if (block[1] === 'man') def.man = value.replace(/^\n+/, '').replace(/\s+$/, '');
      i = j - 1;
      continue;
    }
    const kv = lines[i].match(/^(\w+):\s*(.*)$/);
    if (kv) {
      if (kv[1] === 'name') def.name = kv[2];
      else if (kv[1] === 'desc') def.desc = kv[2];
      else if (kv[1] === 'alias') {
        const aliases = kv[2].split(/[\s,]+/).filter(Boolean);
        if (aliases.length) def.alias = aliases;
      }
    }
  }
  return def;
}

/**
 * Async function constructor — the same one `terminal.ts` uses at runtime to
 * build each command. Constructing it *parses* the body (throwing on a syntax
 * error) without executing it, which is exactly what we want for a static check.
 */
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => unknown;

/**
 * Validate a single command file. Catches the mistakes that would otherwise
 * only surface in the browser: malformed frontmatter, a missing `name`, an
 * empty `js: |` block, or a JS syntax error. Returns the problems found
 * (empty array = valid).
 */
export function validateCommand(raw: string, def: CmdDef, file: string): string[] {
  const errors: string[] = [];
  // No valid `--- ... ---` frontmatter block at the top of the file.
  if (!/^---\n[\s\S]*?\n---/.test(raw)) {
    errors.push(`${file}: missing or malformed frontmatter (expected a leading "---" block)`);
    return errors; // nothing else is trustworthy without frontmatter
  }
  if (!def.name) errors.push(`${file}: frontmatter is missing a "name" field`);
  if (def.js !== undefined && !def.js.trim()) errors.push(`${file}: "js: |" block is empty`);
  if (def.js) {
    try {
      new AsyncFunction('ctx', def.js); // parse-only: throws SyntaxError on bad JS
    } catch (err) {
      errors.push(`${file}: JS syntax error — ${(err as Error).message}`);
    }
  }
  return errors;
}

/**
 * Parse and validate a set of command files (`[file, raw]` pairs). Aggregates
 * every per-file problem and flags duplicate command names across files.
 * Returns the named definitions plus the full list of errors.
 */
export function validateCommands(entries: [string, string][]): {
  defs: CmdDef[];
  errors: string[];
} {
  const defs: CmdDef[] = [];
  const errors: string[] = [];
  const seen = new Map<string, string>(); // name (or alias) -> first file that declared it
  for (const [file, raw] of entries) {
    const def = parseCommand(raw);
    errors.push(...validateCommand(raw, def, file));
    if (def.name) {
      // A name and each of its aliases share the same namespace, so collisions
      // across either are reported the same way.
      for (const id of [def.name, ...(def.alias ?? [])]) {
        const prev = seen.get(id);
        if (prev) errors.push(`${file}: duplicate command name "${id}" (already in ${prev})`);
        else seen.set(id, file);
      }
      defs.push(def);
    }
  }
  return { defs, errors };
}
