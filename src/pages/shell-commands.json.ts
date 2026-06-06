import type { APIRoute } from 'astro';
import { commandDefs } from '../lib/content';

export const prerender = true;

// The command registry (desc + alias + man + js per command), served as a
// standalone static file rather than inlined into every page. Fetched once by
// `bootTerminal`, then cached across navigations.
export const GET: APIRoute = () =>
  new Response(JSON.stringify(commandDefs), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
