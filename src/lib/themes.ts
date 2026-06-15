/**
 * Display themes (CRT phosphor palettes). Single source of truth shared by the
 * terminal `theme` command (via `ctx`), the corner ThemeToggle button and — by
 * convention — the anti-FOUC inline script in Layout.astro.
 *
 * `green` is the default and carries NO `data-theme` attribute (so the green-only
 * Matrix rain shows); every other theme is applied as `data-theme="<id>"`, with
 * its palette defined in `styles/global.css`.
 *
 * Client-only: these functions touch `document` / `localStorage`.
 */
export const THEMES = ['green', 'amber', 'ice', 'synthwave', 'white', 'red'] as const;
export type Theme = (typeof THEMES)[number];

const isTheme = (s: string | undefined): s is Theme =>
  !!s && (THEMES as readonly string[]).includes(s);

/** The theme currently reflected on `<html>` (defaults to green). */
export function currentTheme(): Theme {
  const t = document.documentElement.dataset.theme;
  return isTheme(t) ? t : 'green';
}

/** Apply a theme: reflect it on `<html>` (green clears the attribute) and persist it. */
export function applyTheme(name: string): Theme {
  const t: Theme = isTheme(name) ? name : 'green';
  const root = document.documentElement;
  if (t === 'green') delete root.dataset.theme;
  else root.dataset.theme = t;
  try {
    localStorage.setItem('theme', t);
  } catch {
    /* storage unavailable (private mode) — the theme still applies for this visit */
  }
  return t;
}
