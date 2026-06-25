/**
 * Ensures `src/site.config.ts` exists before any build/dev/check/test run.
 *
 * `site.config.ts` holds the personal identity and is gitignored, so it is
 * absent on a fresh clone and in CI. Every Astro entry point imports it, so
 * without this bootstrap the build would fail with "module not found".
 *
 * This copies `site.config.example.ts` -> `site.config.ts` ONLY when the real
 * file is missing; an existing personal config is never overwritten.
 *
 * Wired into the npm lifecycle via `prepare` (runs on `npm install` / `npm ci`)
 * and `pre*` hooks, so it runs automatically and needs no manual `cp`.
 */
import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src', 'site.config.example.ts');
const dest = join(here, '..', 'src', 'site.config.ts');

if (existsSync(dest)) {
  // Personal config already present — leave it untouched.
  process.exit(0);
}

copyFileSync(src, dest);
console.log('[ensure-site-config] created src/site.config.ts from example.');
