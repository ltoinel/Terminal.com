/**
 * Standalone validator for `root/bin/*.md`, run via `npm run check:commands`.
 *
 * Reuses the exact parsing and validation the Astro build relies on (from
 * `src/lib/commands.ts`), but reads the files directly with `node:fs` instead of
 * `import.meta.glob`, so it runs on its own — handy in CI or a pre-commit hook,
 * without paying for a full `astro build`.
 *
 * Exit code: 0 when every command is valid, 1 when any problem is found.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateCommands } from '../src/lib/commands.ts';

const here = dirname(fileURLToPath(import.meta.url));
const commandsDir = join(here, '..', 'root', 'bin');

const entries: [string, string][] = readdirSync(commandsDir)
  .filter((f) => f.endsWith('.md'))
  .sort()
  .map((f) => [f, readFileSync(join(commandsDir, f), 'utf8')]);

const { defs, errors } = validateCommands(entries);

if (errors.length) {
  console.error(`✗ ${errors.length} problem(s) in ${entries.length} command file(s):\n`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`✓ ${defs.length} command(s) valid (${entries.length} file(s) checked).`);
