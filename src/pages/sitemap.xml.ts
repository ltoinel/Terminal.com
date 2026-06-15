import type { APIRoute } from 'astro';
import { statSync } from 'node:fs';
import { routes } from '../lib/content';
import { site } from '../site.config.ts';

// Single sitemap.xml: the home page plus one URL per deep-linkable command /
// document. Trailing slashes match the static directory build (no redirects).
const BASE = site.url.replace(/\/$/, '');

// `root/` mirror of the configured HOME (e.g. `/home/guest` -> `root/home/guest`).
const HOME_DIR = `root${site.shell.home.replace(/\/+$/, '')}`;

/**
 * W3C date (YYYY-MM-DD) of a route's source file: commands live in `root/bin/`,
 * home documents in HOME. Returns null if neither exists so the URL is still
 * emitted, just without a `<lastmod>`.
 */
function lastmod(slug: string): string | null {
  for (const path of [`root/bin/${slug}.md`, `${HOME_DIR}/${slug}.md`]) {
    try {
      return statSync(path).mtime.toISOString().slice(0, 10);
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export const GET: APIRoute = () => {
  const entries: { loc: string; lastmod: string | null }[] = [
    // Home: most recent change across all listed pages.
    {
      loc: `${BASE}/`,
      lastmod:
        routes
          .map((r) => lastmod(r.slug))
          .filter((d): d is string => d !== null)
          .sort()
          .pop() ?? null,
    },
    ...routes.map((r) => ({ loc: `${BASE}/${r.slug}/`, lastmod: lastmod(r.slug) })),
  ];
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries
      .map(
        ({ loc, lastmod }) =>
          `  <url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`,
      )
      .join('\n') +
    '\n</urlset>\n';
  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
