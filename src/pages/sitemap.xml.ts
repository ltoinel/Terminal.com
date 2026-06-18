import type { APIRoute } from 'astro';
import { routes, lastmod, latestLastmod } from '../lib/content';
import { site } from '../site.config.ts';

// Single sitemap.xml: the home page plus one URL per deep-linkable command /
// document. Trailing slashes match the static directory build (no redirects).
// `lastmod` / `latestLastmod` are shared with the JSON-LD (see ../lib/content).
const BASE = site.url.replace(/\/$/, '');

export const GET: APIRoute = () => {
  const entries: { loc: string; lastmod: string | null }[] = [
    // Home: most recent change across all listed pages.
    { loc: `${BASE}/`, lastmod: latestLastmod() },
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
