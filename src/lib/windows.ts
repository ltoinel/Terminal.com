/* ------------------------------------------------------------------------- *
 * In-page window primitives shared by the shell.
 *
 * Generic, DOM-level helpers for the draggable "desktop" windows: z-index
 * stacking, cascade positioning, the title-bar chrome (drag / minimize /
 * maximize / close) and the stand-alone `iframed` browser window. Kept apart
 * from `terminal.ts` (which owns the shell session) so the window mechanics are
 * a single, self-contained concern. No dependency on the shell — the cloned
 * shell window (`spawnTerminal`) lives in `terminal.ts` since it needs the
 * session bootstrap.
 * ------------------------------------------------------------------------- */

/**
 * Highest window z-index handed out so far — bumped to raise a window to front.
 * Capped well under the CRT overlay (`.fx-overlay`, z 9999) and the page chrome,
 * so windows always stay below them however many times one is clicked.
 */
let topZ = 40;
export const raiseZ = (): number => (topZ = Math.min(topZ + 1, 900));

/** How many windows have been spawned — used to cascade their position. */
let spawnCount = 0;
/** Pixel offset for the next spawned window (cascades down-right, wraps at 6). */
export const nextCascadeOffset = (): number => {
  spawnCount += 1;
  return 24 * (((spawnCount - 1) % 6) + 1);
};

/** Whether the user prefers reduced motion (used to skip close animations). */
const reduceMotion = (): boolean => {
  try {
    return (
      typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  } catch {
    return false;
  }
};

/**
 * Wires the standard window chrome onto a freshly-built window: drag by the
 * title bar, raise-to-front on click, the close / minimize / maximize buttons
 * and double-click-to-maximize. Shared by the shell window (`initTerminal`) and
 * stand-alone windows (`spawnIframe`). `onClose` is invoked by the red button.
 */
export function makeWindowChrome(win: HTMLElement, onClose: () => void): void {
  const bar = win.querySelector<HTMLElement>('.ssh-bar');
  if (!bar) return;

  // Switch from centered (transform) positioning to absolute left/top.
  const toLeftTop = (): void => {
    if (win.style.left && win.style.transform === 'none') return;
    const r = win.getBoundingClientRect();
    win.style.left = `${r.left}px`;
    win.style.top = `${r.top}px`;
    win.style.transform = 'none';
    win.style.margin = '0';
  };
  // Clamp (x, y) so a usable part of the title bar stays on screen.
  const clamp = (x: number, y: number): [number, number] => [
    Math.min(Math.max(x, 56 - win.offsetWidth), window.innerWidth - 56),
    Math.min(Math.max(y, 0), window.innerHeight - 40),
  ];

  let drag: { dx: number; dy: number } | null = null;
  bar.addEventListener('pointerdown', (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('.ssh-ctl')) return;
    if (win.classList.contains('maximized')) return;
    toLeftTop();
    const r = win.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    bar.setPointerCapture(e.pointerId);
    bar.classList.add('grabbing');
    // Let the title bar keep the pointer even when it sweeps over an iframe.
    win.classList.add('win-dragging');
  });
  bar.addEventListener('pointermove', (e: PointerEvent) => {
    if (!drag) return;
    const [x, y] = clamp(e.clientX - drag.dx, e.clientY - drag.dy);
    win.style.left = `${x}px`;
    win.style.top = `${y}px`;
  });
  const endDrag = (): void => {
    drag = null;
    bar.classList.remove('grabbing');
    win.classList.remove('win-dragging');
  };
  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', endDrag);

  // Keep a moved window within the viewport when the browser is resized.
  window.addEventListener('resize', () => {
    if (!win.isConnected || win.classList.contains('maximized') || !win.style.left) return;
    const [x, y] = clamp(parseFloat(win.style.left), parseFloat(win.style.top));
    win.style.left = `${x}px`;
    win.style.top = `${y}px`;
  });

  let prevRect = '';
  const maximize = (): void => {
    if (win.classList.contains('maximized')) {
      win.classList.remove('maximized');
      win.setAttribute('style', prevRect);
    } else {
      prevRect = win.getAttribute('style') || '';
      win.removeAttribute('style');
      win.classList.add('maximized');
    }
  };

  bar.querySelectorAll('.ssh-ctl').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const act = (b as HTMLElement).dataset.act;
      if (act === 'close') onClose();
      else if (act === 'min') win.classList.toggle('minimized');
      else if (act === 'max') maximize();
    }),
  );
  bar.addEventListener('dblclick', (e) => {
    if ((e.target as HTMLElement).closest('.ssh-ctl')) return;
    maximize();
  });
  // Clicking anywhere in a window raises it above the others (cascade focus).
  // Capture phase, so it still fires when inner handlers stop propagation.
  win.addEventListener(
    'pointerdown',
    () => {
      win.style.zIndex = String(raiseZ());
    },
    true,
  );
}

/** Cascades a freshly-built window from the centered default and opens it on top. */
function placeAndOpen(win: HTMLElement): void {
  const off = nextCascadeOffset();
  win.style.left = `calc(50% + ${off}px)`;
  win.style.top = `calc(50% + ${off}px)`;
  win.style.zIndex = String(raiseZ());
  document.body.appendChild(win);
}

/**
 * Opens a stand-alone, draggable window framing `rawUrl` in an `<iframe>` — the
 * shell's mini web browser (the `iframed` command). A bare host is assumed to be
 * `https://`. Returns an error string for a bad / non-http(s) URL, else `null`.
 * Note: many sites refuse to be framed (`X-Frame-Options` / CSP `frame-ancestors`)
 * — that is the remote site's choice and shows up as a blank frame.
 */
export function spawnIframe(rawUrl: string): string | null {
  const raw = (rawUrl || '').trim();
  if (!raw) return 'usage: iframed <url>';
  let url: URL;
  try {
    // Accept a bare host (`example.com`) by defaulting the scheme to https.
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return `invalid URL: ${raw}`;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return 'only http(s) URLs are supported';

  const win = document.createElement('section');
  win.className = 'ssh-win iframe-win';
  win.setAttribute('aria-label', `Page web — ${url.hostname}`);
  // The chrome is static, trusted markup; the URL is injected via DOM
  // properties below (never string-interpolated) so it can't break out.
  win.innerHTML = `
    <header class="ssh-bar">
      <span class="ssh-dots">
        <button type="button" class="ssh-ctl" data-act="close" style="background:#ff5f56" aria-label="Fermer"></button>
        <button type="button" class="ssh-ctl" data-act="min" style="background:var(--amber)" aria-label="Réduire"></button>
        <button type="button" class="ssh-ctl" data-act="max" style="background:var(--green)" aria-label="Agrandir / restaurer"></button>
      </span>
      <span class="ssh-title"></span>
      <a class="ssh-status iframe-open" target="_blank" rel="noopener noreferrer">↗ ouvrir</a>
    </header>
    <div class="ssh-body iframe-body">
      <iframe class="iframe-frame" referrerpolicy="no-referrer" loading="lazy"
        sandbox="allow-scripts allow-forms allow-popups allow-same-origin"></iframe>
    </div>
    <span class="ssh-grip" aria-hidden="true"></span>`;

  (win.querySelector('.ssh-title') as HTMLElement).textContent = `🌐 ${url.hostname}`;
  const link = win.querySelector('a.iframe-open') as HTMLAnchorElement;
  link.href = url.href;
  const frame = win.querySelector('iframe.iframe-frame') as HTMLIFrameElement;
  frame.title = url.hostname;
  frame.src = url.href;

  placeAndOpen(win);
  makeWindowChrome(win, () => {
    win.classList.add('closed');
    setTimeout(() => win.remove(), reduceMotion() ? 0 : 260);
  });
  return null;
}
