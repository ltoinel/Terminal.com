/**
 * Curated Unsplash wallpapers for the `fond` dock button (background switcher).
 *
 * Each `url` is a *direct* Unsplash CDN link (`images.unsplash.com/photo-…`), so
 * no API key / rate limit is involved — the button just cycles this list. Edit
 * freely: open any photo on unsplash.com, copy its image address, and add an
 * entry with proper attribution (`credit` + `link` to the photo page).
 *
 * IMPORTANT: these are loaded as CSS background images, governed by the CSP
 * `img-src` directive. The server must allow `https://images.unsplash.com`
 * there, otherwise the browser blocks them and the background never changes.
 */
export interface Wallpaper {
  /** Direct Unsplash CDN URL (`images.unsplash.com/photo-…`). */
  url: string;
  /** Credit label shown in the corner while the wallpaper is active. */
  credit: string;
  /** Link target for the credit (the Unsplash photo page). */
  link: string;
}

/** Shared crop/quality params for a full-screen, reasonably light image. */
const Q = '?auto=format&fit=crop&w=2400&q=70';

export const WALLPAPERS: Wallpaper[] = [
  {
    url: `https://images.unsplash.com/photo-1451187580459-43490279c0fa${Q}`,
    credit: 'NASA',
    link: 'https://unsplash.com/photos/Q1p7bh3SHj8',
  },
  {
    url: `https://images.unsplash.com/photo-1419242902214-272b3f66ee7a${Q}`,
    credit: 'Casey Horner',
    link: 'https://unsplash.com/photos/4rDCa5hBlCs',
  },
  {
    url: `https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05${Q}`,
    credit: 'Sergei Akulich',
    link: 'https://unsplash.com/photos/-heLWtuAN3c',
  },
  {
    url: `https://images.unsplash.com/photo-1487058792275-0ad4aaf24ca7${Q}`,
    credit: 'Joshua Sortino',
    link: 'https://unsplash.com/photos/LqKhnDzSF-8',
  },
];
