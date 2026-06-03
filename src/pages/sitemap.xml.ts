import type { APIRoute } from 'astro';
import { routes } from '../lib/content';

// Single sitemap.xml: the home page plus one URL per deep-linkable command /
// document. Trailing slashes match the static directory build (no redirects).
const BASE = 'https://ludovic.toinel.com';

export const GET: APIRoute = () => {
  const locs = [`${BASE}/`, ...routes.map((r) => `${BASE}/${r.slug}/`)];
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    locs.map((loc) => `  <url><loc>${loc}</loc></url>`).join('\n') +
    '\n</urlset>\n';
  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
