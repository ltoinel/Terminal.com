import type { APIRoute } from 'astro';
import { tree } from '../lib/content';

export const prerender = true;

// The virtual filesystem, served as a standalone static file rather than inlined
// into every page. The terminal fetches it once (see `bootTerminal`); the browser
// and the service worker then cache it across navigations.
export const GET: APIRoute = () =>
  new Response(JSON.stringify(tree), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
