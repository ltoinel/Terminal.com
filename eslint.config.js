import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';
import globals from 'globals';

export default [
  { ignores: ['dist/', '.astro/', 'node_modules/', 'root/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  // Browser code: the client shell and Astro components.
  {
    files: ['src/**/*.{ts,astro}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  // Node code: build scripts, config and tests.
  {
    files: ['scripts/**/*.ts', '*.{js,ts,mjs}', 'tests/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
];
