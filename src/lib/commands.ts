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
  js?: string;
  body: string;
}

/**
 * Parse a command markdown file: YAML-ish frontmatter (`name`, `desc`, and an
 * optional `js: |` block scalar that must come last) followed by the body.
 */
export function parseCommand(raw: string): CmdDef {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { name: '', body: raw.trim() };
  const [, fm, rawBody] = m;
  const def: CmdDef = { name: '', body: rawBody.replace(/^\n+/, '') };
  const lines = fm.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/^js:\s*\|\s*$/.test(lines[i])) {
      def.js = lines
        .slice(i + 1)
        .map((l) => l.replace(/^ {2}/, ''))
        .join('\n')
        .trim();
      break;
    }
    const kv = lines[i].match(/^(\w+):\s*(.*)$/);
    if (kv) {
      if (kv[1] === 'name') def.name = kv[2];
      else if (kv[1] === 'desc') def.desc = kv[2];
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
  const seen = new Map<string, string>(); // name -> first file that declared it
  for (const [file, raw] of entries) {
    const def = parseCommand(raw);
    errors.push(...validateCommand(raw, def, file));
    if (def.name) {
      const prev = seen.get(def.name);
      if (prev) errors.push(`${file}: duplicate command name "${def.name}" (already in ${prev})`);
      else seen.set(def.name, file);
      defs.push(def);
    }
  }
  return { defs, errors };
}
