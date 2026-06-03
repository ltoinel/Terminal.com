// @ts-check
import { defineConfig } from 'astro/config';
import icon from 'astro-icon';
import tailwindcss from '@tailwindcss/vite';
import { site } from './src/site.config.ts';

// https://astro.build/config
export default defineConfig({
  site: site.url,
  // Directory build (e.g. /whoami/index.html) — trailing slash is the canonical,
  // non-redirecting form on static hosting. The custom sitemap matches it.
  trailingSlash: 'always',
  integrations: [icon()],
  vite: {
    plugins: [tailwindcss()],
  },
});
