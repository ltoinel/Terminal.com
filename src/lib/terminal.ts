/**
 * Interactive shell for the ludovic.toinel.com portal.
 *
 * Content and configuration are emitted at build time by `Terminal.astro` as
 * `<script type="application/json">` blocks that this module reads at runtime:
 *  - `#shell-fs`       : the whole fake filesystem as a nested tree (mirrors `root/`).
 *  - `#shell-commands` : the command registry (one entry per `root/bin/*.md`).
 *  - `#shell-cfg`      : host, user and the link registry used by `open`.
 *
 * From there it wires up the terminal: command discovery, history, completion,
 * the SSH connection animation, and a draggable / resizable window.
 *
 * Document content (the markdown bodies) stays in French; system/error messages
 * are English. `escapeHtml`, `inline` and `format` are exported so the pure
 * rendering logic can be unit-tested without a DOM.
 */

import { THEMES, applyTheme, currentTheme } from './themes';

/** Configuration injected via `#shell-cfg`. */
interface Cfg {
  /** Host shown in prompts and the SSH animation. */
  host: string;
  /** User name shown in the prompt as `user@host` (e.g. `guest`). */
  user: string;
  /** Absolute home directory (shown as `~`); the shell starts here. */
  home: string;
  /** `key -> URL` registry used by the `open` command. */
  links: Record<string, string>;
  /** Identity surfaced by `whoami`, mirrored from `site.config.ts`. */
  profile?: {
    name: string;
    role: string;
    company: string;
    nationality: string;
    knowsAbout: string[];
    url: string;
  };
}

/** Whether the user prefers reduced motion — disables animations and delays. */
const reduce =
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Resolves after `ms` milliseconds (resolves immediately under reduced motion). */
const sleep = (ms: number): Promise<void> =>
  reduce ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));

/** Shared WebAudio context for the terminal bell (created lazily on first beep). */
let bellCtx: AudioContext | null = null;

/**
 * Rings a short terminal "bell" (à la readline): a brief square-wave beep, like
 * a classic Linux shell when Tab completion can't uniquely complete. Created
 * lazily inside the Tab key handler — a user gesture, so the autoplay policy
 * allows it. A no-op when WebAudio is unavailable or blocked.
 */
function playBell(): void {
  // Muted by the `bell off` command (persisted); default is on.
  try {
    if (localStorage.getItem('ltsh.bell') === 'off') return;
  } catch {
    /* localStorage blocked — fall through and beep */
  }
  try {
    const w = window as typeof window & { webkitAudioContext?: typeof AudioContext };
    const AC = window.AudioContext ?? w.webkitAudioContext;
    if (!AC) return;
    if (!bellCtx) bellCtx = new AC();
    if (bellCtx.state === 'suspended') void bellCtx.resume();
    const t = bellCtx.currentTime;
    const osc = bellCtx.createOscillator();
    const gain = bellCtx.createGain();
    osc.type = 'square'; // PC-speaker-ish timbre
    osc.frequency.value = 760;
    // Short envelope (ramps avoid the click of a hard on/off).
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.06, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    osc.connect(gain).connect(bellCtx.destination);
    osc.start(t);
    osc.stop(t + 0.12);
  } catch {
    /* audio unavailable / blocked — stay silent */
  }
}

/** Shell data fetched by `bootTerminal` (external JSON), keyed by the legacy id. */
const preloaded: Record<string, string | undefined> = {};

/**
 * Highest window z-index handed out so far — bumped to raise a window to front.
 * Capped well under the CRT overlay (`.fx-overlay`, z 9999) and the page chrome,
 * so windows always stay below them however many times one is clicked.
 */
let topZ = 40;
const raiseZ = (): number => (topZ = Math.min(topZ + 1, 900));
/** How many extra shell windows have been spawned — used to cascade their position. */
let spawnCount = 0;

/**
 * Reads and parses shell data by id: a value preloaded from an external JSON
 * file (the large `shell-fs` / `shell-commands`), or, failing that, an inline
 * `<script type="application/json" id="...">` block (the tiny `shell-cfg`).
 */
function readJSON<T>(id: string, fallback: T): T {
  const text = preloaded[id] ?? document.getElementById(id)?.textContent ?? null;
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/**
 * Page entry point: fetch the externalised shell data (filesystem + command
 * registry) — a single cached request shared across navigations — then start the
 * terminal. The tiny `#shell-cfg` stays inlined, so the prompt can render even if
 * a fetch is slow or fails (offline: the terminal boots with an empty fs).
 */
export async function bootTerminal(): Promise<void> {
  const load = async (url: string, id: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.ok) preloaded[id] = await res.text();
    } catch {
      /* offline / blocked — readJSON falls back to its empty default */
    }
  };
  await Promise.all([
    load('/shell-fs.json', 'shell-fs'),
    load('/shell-commands.json', 'shell-commands'),
  ]);
  initTerminal(document.getElementById('ssh'), document.getElementById('ssh-reconnect'));
}

/**
 * Opens an additional, independent shell window by cloning the original one's
 * markup. The clone shares the page's command registry / filesystem but keeps
 * its own session (prompt, working directory, on-screen history). It cascades
 * down-right from the center, opens on top, and removes itself when closed.
 */
export function spawnTerminal(): void {
  const template = document.getElementById('ssh');
  if (!template) return;
  const win = template.cloneNode(true) as HTMLElement;

  // Drop ids (they must stay unique) and any leftover window state from the
  // template; the shell is wired by class, so no id is needed.
  win.removeAttribute('style');
  win.removeAttribute('id');
  win.classList.remove('maximized', 'minimized', 'closed');
  win.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
  const out = win.querySelector<HTMLElement>('.ssh-output');
  if (out) out.innerHTML = '';
  const inputline = win.querySelector<HTMLElement>('.ssh-inputline');
  if (inputline) inputline.hidden = true;

  // Cascade each new window down-right from the centered default, and bring it
  // to the front.
  spawnCount += 1;
  const off = 24 * (((spawnCount - 1) % 6) + 1);
  win.style.left = `calc(50% + ${off}px)`;
  win.style.top = `calc(50% + ${off}px)`;
  win.style.zIndex = String(raiseZ());

  document.body.appendChild(win);
  initTerminal(win, null, false);
}

/** Escapes the HTML-sensitive characters before injecting into the DOM. */
export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );

/**
 * Formats an inline span of text (light markdown -> HTML).
 * Safe: escapes first, then applies links, bold and inline code.
 * Supports http(s) links (new tab) and `mailto:` links (mail client, same context).
 */
export function inline(s: string): string {
  let out = escapeHtml(s);
  out = out.replace(
    /\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)/g,
    (_m, text: string, url: string) => {
      const attrs = url.startsWith('mailto:') ? '' : ' target="_blank" rel="noopener"';
      return `<a href="${url}"${attrs} class="tlink">${text}</a>`;
    },
  );
  // Internal command links — `[ls](command:ls)`, emitted by the man "SEE ALSO"
  // section. Not a navigation: the click/Enter handler in `initTerminal` opens
  // that command's manual in place (matched via the `data-cmd` attribute).
  out = out.replace(
    /\[([^\]]+)\]\(command:([\w-]+)\)/g,
    (_m, text: string, name: string) =>
      `<a class="tlink" role="link" tabindex="0" data-cmd="${name}">${text}</a>`,
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong class="cmd">$1</strong>');
  out = out.replace(/`([^`]+)`/g, '<span class="prompt-path">$1</span>');
  return out;
}

/**
 * Converts a document (light markdown) into terminal HTML, line by line:
 * `# heading`, `## sub-heading`, `> note`, `- bullet`, plus inline markup.
 */
export function format(text: string): string {
  return text
    .replace(/\s+$/, '')
    .split('\n')
    .map((line) => {
      if (line.startsWith('## '))
        return `<div class="ln"><span class="prompt-path">${inline(line.slice(3))}</span></div>`;
      if (line.startsWith('# '))
        return `<div class="ln"><span class="accent text-glow">${inline(line.slice(2))}</span></div>`;
      if (line.startsWith('> ')) return `<div class="ln comment">${inline(line.slice(2))}</div>`;
      if (line.startsWith('- '))
        return `<div class="ln"><span class="prompt">›</span> ${inline(line.slice(2))}</div>`;
      if (line.trim() === '') return `<div class="ln">&nbsp;</div>`;
      return `<div class="ln out">${inline(line)}</div>`;
    })
    .join('');
}

/**
 * Wires a single terminal window and starts its connection sequence. Elements
 * are queried *within* `win0` (by class), so several independent windows can
 * coexist on the page. `reconnect` is the companion "reconnect" button shown
 * when the window is closed; spawned windows pass `null` and are removed from
 * the DOM on close instead. `allowDeepLink` lets the first window open the URL's
 * command/document on load; spawned windows always play the full boot + motd.
 * No-op (early return) if `win0` (or any required child) is absent.
 */
export function initTerminal(
  win0: HTMLElement | null,
  reconnect: HTMLElement | null = null,
  allowDeepLink = true,
): void {
  const output0 = win0?.querySelector<HTMLElement>('.ssh-output') ?? null;
  const inputline0 = win0?.querySelector<HTMLElement>('.ssh-inputline') ?? null;
  const input0 = win0?.querySelector<HTMLInputElement>('.ssh-input') ?? null;
  const typed0 = win0?.querySelector<HTMLElement>('.ssh-typed') ?? null;
  const prompt0 = win0?.querySelector<HTMLElement>('.ssh-prompt') ?? null;
  const body0 = win0?.querySelector<HTMLElement>('.ssh-body') ?? null;
  const bar0 = win0?.querySelector<HTMLElement>('.ssh-bar') ?? null;
  if (!win0 || !output0 || !inputline0 || !input0 || !typed0 || !prompt0 || !body0 || !bar0) return;
  // Reassign to non-null locals: this preserves narrowing inside the closures
  // defined below (TS does not guarantee it on the original variables).
  const win = win0;
  const output = output0;
  const inputline = inputline0;
  const input = input0;
  const typed = typed0;
  const promptEl = prompt0;
  const body = body0;
  const bar = bar0;

  // Clicking anywhere in a window raises it above the others (cascade focus).
  win.addEventListener(
    'pointerdown',
    () => {
      win.style.zIndex = String(raiseZ());
    },
    true,
  );

  const cfg = readJSON<Cfg>('shell-cfg', {
    host: 'localhost',
    user: 'user',
    home: '/home/user',
    links: {},
  });

  /** Coarse pointer (touch) — used to skip auto-focus that would pop the keyboard. */
  const isTouch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

  /* --------------------------- virtual fs --------------------------- */

  /** A node in the fake Linux tree: a directory (children) or a text file. */
  type VFile = { type: 'file'; content: string };
  type VDir = { type: 'dir'; children: Record<string, VNode> };
  type VNode = VFile | VDir;
  const vdir = (children: Record<string, VNode> = {}): VDir => ({ type: 'dir', children });

  /** Absolute path of the visitor's home directory (the shell starts here). */
  const HOME = cfg.home;
  /** Superuser home, reachable only after `su` (see the identity state below). */
  const ROOT_HOME = '/root';

  // The whole fake filesystem mirrors the on-disk `root/` tree, built at compile
  // time and injected as #shell-fs (commands under /bin, documents under HOME).
  const root = readJSON<VDir>('shell-fs', vdir());

  /** Current and previous working directories (absolute, normalized). */
  let cwd = HOME;
  let prevCwd = HOME;

  // Identity: `su` pushes the current identity, becomes root and jumps to /root;
  // `exit` pops back. `home` is the current user's `~` (HOME, or ROOT_HOME as root).
  let isRoot = false;
  let home = HOME;
  const idStack: { isRoot: boolean; home: string; cwd: string; prevCwd: string }[] = [];

  /** Becomes root (`su` / `su root`); other users are rejected. */
  function su(target?: string): string | null {
    const name = (target ?? 'root').trim() || 'root';
    if (name !== 'root') return `su: l'utilisateur « ${name} » n'existe pas`;
    if (isRoot) return null; // already root — no-op
    idStack.push({ isRoot, home, cwd, prevCwd });
    isRoot = true;
    home = ROOT_HOME;
    prevCwd = cwd;
    cwd = ROOT_HOME;
    return null;
  }

  /** Restores the previous identity (used by `exit`); false at the top level. */
  function popIdentity(): boolean {
    const prev = idStack.pop();
    if (!prev) return false;
    ({ isRoot, home, cwd, prevCwd } = prev);
    return true;
  }

  /** A `/root`-subtree path the current user may not access (root-only). */
  function denied(path: string): boolean {
    return !isRoot && (path === ROOT_HOME || path.startsWith(ROOT_HOME + '/'));
  }

  /**
   * Write access (create / modify / remove): root may write anywhere, while the
   * guest is confined to its own home (`/home/guest`) and everything below it.
   */
  function canWrite(path: string): boolean {
    return isRoot || path === HOME || path.startsWith(HOME + '/');
  }

  /** Splits an absolute path into its non-empty segments. */
  const segs = (p: string): string[] => p.split('/').filter(Boolean);

  /** Resolves a typed path (relative, absolute, `~`, `.`, `..`) to an absolute one. */
  function resolvePath(input: string): string {
    let p = (input ?? '').trim();
    if (p === '') return cwd;
    if (p === '~') return home;
    if (p.startsWith('~/')) p = home + p.slice(1);
    const acc = p.startsWith('/') ? [] : segs(cwd);
    for (const s of segs(p)) {
      if (s === '.') continue;
      else if (s === '..') acc.pop();
      else acc.push(s);
    }
    return '/' + acc.join('/');
  }

  /** Returns the node at an absolute path, or `undefined` if it doesn't exist. */
  function nodeAt(path: string): VNode | undefined {
    if (path === '/') return root;
    let cur: VNode = root;
    for (const s of segs(path)) {
      if (cur.type !== 'dir') return undefined;
      const next: VNode | undefined = cur.children[s];
      if (!next) return undefined;
      cur = next;
    }
    return cur;
  }

  /** Prompt-friendly label: the current home shows as `~`, paths below it as `~/sub`. */
  function pathLabel(path: string): string {
    if (path === home) return '~';
    if (path.startsWith(home + '/')) return '~' + path.slice(home.length);
    return path;
  }

  /** Names of the entries in the current directory, optionally filtered by type. */
  function entryNames(kind: 'all' | 'dir' | 'file'): string[] {
    const n = nodeAt(cwd);
    if (n?.type !== 'dir') return [];
    return Object.keys(n.children).filter(
      (name) => kind === 'all' || n.children[name].type === kind,
    );
  }

  /** `ls` backend: lists a directory (or a single file), or returns an error. */
  function listPath(arg?: string): {
    entries?: { name: string; type: 'dir' | 'file'; size: number }[];
    error?: string;
  } {
    const path = resolvePath(arg ?? '');
    if (denied(path)) return { error: `cannot open directory '${arg ?? path}': Permission denied` };
    const n = nodeAt(path);
    if (!n) return { error: `cannot access '${arg}': No such file or directory` };
    if (n.type === 'file')
      return {
        entries: [{ name: path.split('/').pop() || path, type: 'file', size: n.content.length }],
      };
    const entries = Object.keys(n.children)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => {
        const c = n.children[name];
        return { name, type: c.type, size: c.type === 'file' ? c.content.length : 4096 };
      });
    return { entries };
  }

  /** `cat` backend: reads a file (with implicit `.md`), or returns an error. */
  function readPath(arg: string): { content?: string; name?: string; error?: string } {
    let path = resolvePath(arg);
    if (denied(path)) return { error: 'Permission denied' };
    let n = nodeAt(path);
    if (!n) {
      // Retry with implicit `.md`, or a name without its extension, in the parent dir.
      const parent = path.slice(0, path.lastIndexOf('/')) || '/';
      const base = path.split('/').pop() || '';
      const pd = nodeAt(parent);
      if (pd?.type === 'dir') {
        const join = (f: string) => (parent === '/' ? '' : parent) + '/' + f;
        if (pd.children[`${base}.md`]?.type === 'file') {
          path = join(`${base}.md`);
          n = pd.children[`${base}.md`];
        } else {
          const hit = Object.keys(pd.children).find(
            (f) => pd.children[f].type === 'file' && f.replace(/\.[^.]+$/, '') === base,
          );
          if (hit) {
            path = join(hit);
            n = pd.children[hit];
          }
        }
      }
    }
    if (!n) return { error: 'No such file or directory' };
    if (n.type === 'dir') return { error: 'Is a directory' };
    return { content: n.content, name: path.split('/').pop() };
  }

  /** Changes directory (`-` = previous, empty = home); error string or `null`. */
  function chdir(arg?: string): string | null {
    const target =
      arg === undefined || arg === '' ? home : arg === '-' ? prevCwd : resolvePath(arg);
    if (denied(target)) return `cd: ${arg}: Permission denied`;
    const n = nodeAt(target);
    if (!n) return `cd: ${arg}: No such file or directory`;
    if (n.type !== 'dir') return `cd: ${arg}: Not a directory`;
    prevCwd = cwd;
    cwd = target;
    return null;
  }

  /* ----------------------- filesystem mutations --------------------- */
  // `touch` / `mkdir` / `rm` mutate the in-memory tree. Changes are persisted as
  // a journal of operations in localStorage and replayed onto the freshly-loaded
  // base tree at each boot — so a deploy still refreshes /bin, documents, etc.,
  // *under* the user's local changes (rather than freezing a whole stale tree).
  const FS_KEY = 'ltsh.fs';
  interface FsOp {
    op: 'mkdir' | 'touch' | 'rm' | 'write';
    path: string; // absolute & normalized, so replay is independent of cwd
    p?: boolean; // mkdir -p
    r?: boolean; // rm -r
    content?: string; // write: the file's full contents
  }
  type MutRes = { error?: string; changed?: boolean };

  const splitPath = (abs: string): { parent: string; base: string } => ({
    parent: abs.slice(0, abs.lastIndexOf('/')) || '/',
    base: abs.split('/').pop() || '',
  });

  /** Creates a directory (with `-p`, creating intermediate dirs as needed). */
  function vfsMkdir(abs: string, disp: string, parents: boolean): MutRes {
    const parts = segs(abs);
    if (!parts.length) return { error: `cannot create directory '${disp}': File exists` };
    let dir: VNode = root;
    let changed = false;
    for (let i = 0; i < parts.length; i++) {
      if (dir.type !== 'dir')
        return { error: `cannot create directory '${disp}': Not a directory` };
      const seg = parts[i];
      const last = i === parts.length - 1;
      const child: VNode | undefined = dir.children[seg];
      if (child) {
        if (last && !parents) return { error: `cannot create directory '${disp}': File exists` };
        if (child.type !== 'dir')
          return { error: `cannot create directory '${disp}': Not a directory` };
        dir = child;
      } else {
        if (!last && !parents)
          return { error: `cannot create directory '${disp}': No such file or directory` };
        const made: VDir = { type: 'dir', children: {} };
        dir.children[seg] = made;
        dir = made;
        changed = true;
      }
    }
    return { changed };
  }

  /** Creates an empty file; a no-op if the path already exists (like real touch). */
  function vfsTouch(abs: string, disp: string): MutRes {
    if (nodeAt(abs)) return { changed: false };
    const { parent, base } = splitPath(abs);
    const p = nodeAt(parent);
    if (!p || p.type !== 'dir')
      return { error: `cannot touch '${disp}': No such file or directory` };
    p.children[base] = { type: 'file', content: '' };
    return { changed: true };
  }

  /** Writes a file's full contents, creating it or overwriting an existing file
   * (the parent directory must already exist; a directory target is refused). */
  function vfsWrite(abs: string, disp: string, content: string): MutRes {
    const existing = nodeAt(abs);
    if (existing) {
      if (existing.type === 'dir') return { error: `cannot write '${disp}': Is a directory` };
      if (existing.content === content) return { changed: false }; // no-op: identical
      existing.content = content;
      return { changed: true };
    }
    const { parent, base } = splitPath(abs);
    const p = nodeAt(parent);
    if (!p || p.type !== 'dir')
      return { error: `cannot write '${disp}': No such file or directory` };
    p.children[base] = { type: 'file', content };
    return { changed: true };
  }

  /** Removes a file, or a directory with `-r`. `-f` ignores a missing target. */
  function vfsRm(abs: string, disp: string, recursive: boolean, force: boolean): MutRes {
    const node = nodeAt(abs);
    if (!node)
      return force
        ? { changed: false }
        : { error: `cannot remove '${disp}': No such file or directory` };
    if (abs === '/' || cwd === abs || cwd.startsWith(`${abs}/`))
      return { error: `cannot remove '${disp}': directory in use` };
    if (node.type === 'dir' && !recursive)
      return { error: `cannot remove '${disp}': Is a directory` };
    const { parent, base } = splitPath(abs);
    const p = nodeAt(parent);
    if (p?.type !== 'dir') return { error: `cannot remove '${disp}': No such file or directory` };
    delete p.children[base];
    return { changed: true };
  }

  let fsJournal: FsOp[] = [];
  const saveJournal = (): void => {
    try {
      localStorage.setItem(FS_KEY, JSON.stringify(fsJournal));
    } catch {
      /* storage full / unavailable — the change still applies this session */
    }
  };

  /** Runs a mutation, records it in the journal on success, returns an error or null. */
  function fsMutate(
    op: FsOp['op'],
    rawPath: string,
    flags: { p?: boolean; r?: boolean; f?: boolean; content?: string },
  ): string | null {
    if (!rawPath) return 'missing operand';
    const abs = resolvePath(rawPath);
    // Read protection (root home) first, then the write-access policy.
    if (denied(abs) || !canWrite(abs)) return `${rawPath}: Permission denied`;
    const res =
      op === 'mkdir'
        ? vfsMkdir(abs, rawPath, !!flags.p)
        : op === 'touch'
          ? vfsTouch(abs, rawPath)
          : op === 'write'
            ? vfsWrite(abs, rawPath, flags.content ?? '')
            : vfsRm(abs, rawPath, !!flags.r, !!flags.f);
    if (res.error) return res.error;
    if (res.changed) {
      // A fresh write fully defines the file, so older writes to the same path are
      // redundant — drop them so repeated saves don't grow the journal unbounded.
      if (op === 'write')
        fsJournal = fsJournal.filter((o) => !(o.op === 'write' && o.path === abs));
      const entry: FsOp = { op, path: abs };
      if (flags.p) entry.p = true;
      if (flags.r) entry.r = true;
      if (op === 'write') entry.content = flags.content ?? '';
      fsJournal.push(entry);
      saveJournal();
    }
    return null;
  }

  // Replay the persisted journal onto the base tree (rm is forced & idempotent).
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(FS_KEY) || '[]');
    if (Array.isArray(stored)) {
      fsJournal = stored.filter(
        (o): o is FsOp =>
          !!o && ['mkdir', 'touch', 'rm', 'write'].includes(o.op) && typeof o.path === 'string',
      );
      for (const o of fsJournal) {
        if (o.op === 'mkdir') vfsMkdir(o.path, o.path, !!o.p);
        else if (o.op === 'touch') vfsTouch(o.path, o.path);
        else if (o.op === 'write')
          vfsWrite(o.path, o.path, typeof o.content === 'string' ? o.content : '');
        else vfsRm(o.path, o.path, !!o.r, true);
      }
    }
  } catch {
    /* corrupt journal — start from the clean base tree */
  }

  /* ----------------------------- prompt ----------------------------- */

  /** Colored HTML prompt for the current user & directory (echo + input line). */
  function promptHtml(): string {
    // Always `user@host` (e.g. `guest@ludovic.toinel.com`); root swaps the name
    // and turns the `$` symbol into a red `#`.
    const user = `${isRoot ? 'root' : cfg.user}@${cfg.host}`;
    const sym = isRoot
      ? '<span class="prompt" style="color:#ff6b6b">#</span>'
      : '<span class="prompt">$</span>';
    // Trailing space is a non-breaking space: in the flex input line a normal
    // trailing space would be collapsed, leaving no gap after the symbol.
    return `<span class="prompt-user">${escapeHtml(user)}</span><span class="comment">:</span><span class="prompt-path">${escapeHtml(pathLabel(cwd))}</span>${sym}&nbsp;`;
  }
  /** Re-renders the static prompt element to match the current directory. */
  const refreshPrompt = (): void => {
    promptEl.innerHTML = promptHtml();
  };
  refreshPrompt();

  /**
   * Reads one line interactively: shows `question` as the prompt, reveals the
   * input and resolves with what the user types when they press Enter. Used by
   * commands (via `ctx.ask`) — e.g. the `boot` yes/no connection confirmation.
   */
  function readLine(question: string, secret = false): Promise<string> {
    secretRead = secret;
    promptEl.innerHTML = `<span class="out">${escapeHtml(question)}</span>&nbsp;`;
    input.value = '';
    inputline.hidden = false;
    renderInput();
    scrollEnd();
    if (!isTouch) input.focus();
    return new Promise((resolve) => {
      pendingRead = (value) => {
        inputline.hidden = true;
        secretRead = false;
        resolve(value);
      };
    });
  }

  // Command history, persisted across visits in localStorage.
  const HISTORY_KEY = 'ltsh.history';
  const HISTORY_MAX = 100;
  let cmdHistory: string[] = [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) cmdHistory = JSON.parse(raw) as string[];
  } catch {
    /* ignore unreadable / corrupt history */
  }
  let hpos = cmdHistory.length; // history cursor (= length when "at the bottom")
  let busy = false; // blocks input during boot / command execution
  // Aborts the running command when the user presses Ctrl+C. Commands opt in by
  // honoring `ctx.signal` (passing it to fetch, checking it in loops, …).
  let currentAbort: AbortController | null = null;
  // When set, the next Enter resolves an interactive `ctx.ask()` read instead of
  // running a command (used by `boot` for the yes/no connection prompt).
  let pendingRead: ((value: string) => void) | null = null;
  // True while a secret read is in progress (e.g. `su` password): the visible
  // input is rendered as bullets instead of the typed characters.
  let secretRead = false;

  /* ----------------------------- output ----------------------------- */

  /** Scrolls the terminal to the bottom. */
  const scrollEnd = () => (body.scrollTop = body.scrollHeight);

  /** Creates a `<div>` (with already-safe HTML), appends it and scrolls. */
  function append(html: string, cls = ''): HTMLElement {
    const d = document.createElement('div');
    if (cls) d.className = cls;
    d.innerHTML = html;
    output.appendChild(d);
    scrollEnd();
    return d;
  }

  /** Prints a formatted document (markdown -> HTML) with a fade-in. */
  function printBlock(text: string): void {
    const d = append(format(text), 'ssh-out reveal-line');
    requestAnimationFrame(() => d.classList.add('is-in'));
  }

  /** Prints raw, escaped text (no markdown) preserving whitespace — for plain files. */
  function printRaw(text: string): void {
    const d = append(
      `<div class="ln out">${escapeHtml(text.replace(/\s+$/, ''))}</div>`,
      'ssh-out reveal-line',
    );
    requestAnimationFrame(() => d.classList.add('is-in'));
  }

  /** Prints a single line (inline markup allowed). */
  function printLine(text: string): void {
    append(`<div class="ln out">${inline(text)}</div>`, 'reveal-line is-in');
  }

  /** Prints an error line (red, escaped text). */
  function printErr(text: string): void {
    append(`<div class="ln" style="color:#ff6b6b">${escapeHtml(text)}</div>`);
  }

  /** Prints a dim "system" line (escaped, no markdown) — used by the SSH banner. */
  function sysLine(text: string): void {
    append(`<div class="ln comment">${escapeHtml(text)}</div>`, 'reveal-line is-in');
  }

  /** Echoes the prompt followed by the typed command (visual history). */
  function echo(cmd: string): void {
    append(`<div class="ln">${promptHtml()}<span class="cmd">${escapeHtml(cmd)}</span></div>`);
  }

  /** Writes `text` character by character into `target` (typewriter effect). */
  async function typeInto(target: HTMLElement, text: string, cps = 45): Promise<void> {
    for (const ch of text) {
      target.textContent = (target.textContent || '') + ch;
      scrollEnd();
      await sleep(cps);
    }
  }

  /* ------------------------- input rendering ------------------------ */

  /** Re-renders the visible input line with a block caret at the real caret position. */
  function renderInput(): void {
    const val = input.value;
    const pos = input.selectionStart ?? val.length;
    if (secretRead) {
      // Password-style read: render bullets while keeping the caret position.
      typed.innerHTML =
        '•'.repeat(pos) + '<span class="ssh-caret"></span>' + '•'.repeat(val.length - pos);
      return;
    }
    typed.innerHTML =
      escapeHtml(val.slice(0, pos)) +
      '<span class="ssh-caret"></span>' +
      escapeHtml(val.slice(pos));
  }

  /** Sets the input value and places the caret at the end, then re-renders. */
  function setLine(text: string): void {
    input.value = text;
    input.setSelectionRange(text.length, text.length);
    renderInput();
  }

  /* --------------------------- commands ----------------------------- */

  /** A shell command. */
  interface Cmd {
    /** Short description shown by `help`. */
    desc: string;
    /** Runs the command with its arguments (tokens after the name). */
    run: (args: string[]) => void | Promise<void>;
  }

  /** Files (sorted) in the current directory — what `help` and completion show. */
  const fileList = (): string[] => entryNames('file').sort();

  /** Resolves a name in the current dir: exact, implicit `.md`, or without extension. */
  function resolveFile(name: string): string | undefined {
    const n = nodeAt(cwd);
    if (n?.type !== 'dir') return undefined;
    const ch = n.children;
    if (ch[name]?.type === 'file') return name;
    if (ch[`${name}.md`]?.type === 'file') return `${name}.md`;
    return Object.keys(ch).find((f) => ch[f].type === 'file' && f.replace(/\.[^.]+$/, '') === name);
  }

  /** Definition discovered from a `root/bin/*.md` file. */
  interface CmdDef {
    name: string;
    desc?: string;
    /** Alternate names that resolve to this same command (e.g. `cls` → `clear`). */
    alias?: string[];
    /** Authored manual page (markdown), shown by `man <name>`. */
    man?: string;
    js?: string;
    body: string;
  }

  // Commands are parsed at build time and injected as `#shell-commands`.
  const cmdDefs = readJSON<CmdDef[]>('shell-commands', []);

  /** Runtime command registry, keyed by name (populated from the definitions). */
  const commands: Record<string, Cmd> = {};

  /**
   * API object handed to a dynamic command's `js`. Authored content is trusted,
   * so the code runs via `new AsyncFunction` (needs `unsafe-eval` under a CSP).
   */
  function makeCtx(args: string[], body: string) {
    return {
      args,
      body,
      cfg,
      history: cmdHistory,
      commands: cmdDefs.map((d) => ({
        name: d.name,
        desc: d.desc || '',
        alias: d.alias || [],
        man: d.man || '',
      })),
      escape: escapeHtml,
      fileList,
      resolveFile,
      // Virtual filesystem, exposed to the `cd` / `ls` / `cat` / `pwd` commands.
      cwd: () => cwd,
      cwdLabel: () => pathLabel(cwd),
      cd: (arg?: string) => chdir(arg),
      list: (arg?: string) => listPath(arg),
      read: (arg: string) => readPath(arg),
      // Mutations (persisted to localStorage): `mkdir` / `touch` / `rm`. Each
      // returns an error string, or null on success.
      mkdir: (path: string, parents = false) => fsMutate('mkdir', path, { p: parents }),
      touch: (path: string) => fsMutate('touch', path, {}),
      // Writes (or overwrites) a file's full contents — persisted like mkdir/touch.
      write: (path: string, content: string) => fsMutate('write', path, { content }),
      rm: (path: string, recursive = false, force = false) =>
        fsMutate('rm', path, { r: recursive, f: force }),
      print: (md: string) => printBlock(md),
      raw: (text: string) => printRaw(text),
      line: (text: string) => printLine(text),
      error: (text: string) => printErr(text),
      sysLine: (text: string) => sysLine(text),
      append: (html: string) => append(html),
      sleep: (ms: number) => sleep(ms),
      type: (target: HTMLElement, text: string, cps?: number) => typeInto(target, text, cps),
      clear: () => {
        output.innerHTML = '';
      },
      open: (url: string) => window.open(url, '_blank', 'noopener'),
      // Display themes (CRT phosphor palettes). `theme` applies one (green clears
      // the attribute); `themes`/`currentTheme` let the `theme` command list and cycle.
      theme: (name: string) => applyTheme(name),
      themes: THEMES,
      currentTheme: () => currentTheme(),
      su: (target?: string) => su(target),
      // Interactive prompt: shows `question`, resolves with the user's typed line.
      // Pass `{ secret: true }` to mask the input (password-style read).
      ask: (question: string, opts?: { secret?: boolean }) =>
        readLine(question, !!(opts && opts.secret)),
      // `exit` from an `su` shell returns to the previous user; at the top level it closes.
      exit: () => {
        if (!popIdentity()) closeWin();
      },
      exec: (name: string, a: string[] = []) => commands[name]?.run(a),
      // Aborts when the user presses Ctrl+C during a long command (fetch, loops).
      signal: currentAbort ? currentAbort.signal : undefined,
    };
  }

  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
    arg: string,
    body: string,
  ) => (ctx: ReturnType<typeof makeCtx>) => Promise<void>;

  for (const def of cmdDefs) {
    if (!def.name) continue;
    const { name, desc = '', js, body } = def;
    const cmd: Cmd = {
      desc,
      run: js
        ? async (args) => {
            try {
              await new AsyncFunction('ctx', js)(makeCtx(args, body));
            } catch (err) {
              printErr(`${name}: ${(err as Error).message}`);
            }
          }
        : () => printBlock(body),
    };
    commands[name] = cmd;
    // Aliases resolve to the very same command object (e.g. `cls` → `clear`).
    for (const a of def.alias ?? []) commands[a] = cmd;
  }

  /* --------------------------- execution ---------------------------- */

  /**
   * Runs a typed line: echo, history, then dispatch to a command, otherwise to
   * a home document (implicit `cat`), otherwise an error.
   */
  async function run(raw: string): Promise<void> {
    const line = raw.trim();
    echo(line);
    if (!line) return;

    cmdHistory.push(line);
    if (cmdHistory.length > HISTORY_MAX) cmdHistory = cmdHistory.slice(-HISTORY_MAX);
    hpos = cmdHistory.length;
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(cmdHistory));
    } catch {
      /* storage full / unavailable — keep going */
    }

    const parts = line.split(/\s+/);
    const name = parts[0];
    const args = parts.slice(1);
    const cmd = commands[name];
    // Fresh abort handle per command, exposed to its `js` via `ctx.signal` and
    // triggered by Ctrl+C (see the keydown handler).
    currentAbort = new AbortController();
    try {
      if (cmd) {
        await cmd.run(args);
      } else {
        // Not a command: try the path as a file (implicit `cat`) in the current dir.
        const res = readPath(name);
        if (res.error) printErr(`${name}: command not found — type \`help\``);
        else if ((res.name || '').endsWith('.md')) printBlock(res.content as string);
        else printRaw(res.content as string);
      }
    } finally {
      currentAbort = null;
    }
  }

  /* ------------------------- user input ----------------------------- */

  /**
   * Tab completion on the token before the caret. The candidate pool is
   * contextual and scoped to the current directory: first token -> commands +
   * entries, after `cd` -> directories, after `cat`/`ls` -> entries, after
   * `open` -> link keys, otherwise everything.
   */
  function complete(): void {
    const v = input.value;
    const m = v.match(/(\S*)$/);
    const frag = m ? m[1] : '';
    if (!frag) {
      playBell(); // nothing to complete — ring the bell
      return;
    }
    const head = v.slice(0, v.length - frag.length).trim();
    const first = head.split(/\s+/)[0];
    let pool: string[];
    if (head === '') pool = [...Object.keys(commands), ...entryNames('all')];
    else if (first === 'open') pool = Object.keys(cfg.links);
    else if (first === 'cd') pool = entryNames('dir');
    else if (first === 'cat' || first === 'ls') pool = entryNames('all');
    else pool = [...Object.keys(commands), ...entryNames('all'), ...Object.keys(cfg.links)];

    const hits = [...new Set(pool)].filter((c) => c.startsWith(frag)).sort();
    if (hits.length === 1) {
      input.value = v.slice(0, v.length - frag.length) + hits[0] + ' ';
    } else if (hits.length > 1) {
      // Complete up to the longest common prefix; otherwise list the candidates
      // and ring the bell — ambiguous and can't extend, like readline.
      let common = hits[0];
      for (const h of hits) while (!h.startsWith(common)) common = common.slice(0, -1);
      if (common.length > frag.length) input.value = v.slice(0, v.length - frag.length) + common;
      else {
        append(`<div class="ln comment">${hits.join('  ')}</div>`);
        playBell();
      }
    } else {
      playBell(); // no match — ring the bell
    }
    input.setSelectionRange(input.value.length, input.value.length);
    renderInput();
  }

  // Keep the visible line (and caret position) in sync with the hidden input.
  ['input', 'keyup', 'click', 'select'].forEach((ev) => input.addEventListener(ev, renderInput));

  input.addEventListener('keydown', async (e: KeyboardEvent) => {
    // An interactive `ctx.ask()` read accepts input even while `busy` (boot).
    if (pendingRead) {
      if (e.key === 'Enter') {
        e.preventDefault();
        const value = input.value;
        input.value = '';
        renderInput();
        const done = pendingRead;
        pendingRead = null;
        done(value);
      }
      return; // ignore history/completion/shortcuts while reading a line
    }
    if (busy) {
      // Ctrl+C interrupts the running command — it aborts `ctx.signal`, which
      // commands honor (fetch, loops, hashcat workers). Sync code can't be
      // pre-empted, so a command that ignores the signal simply runs on.
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'c') {
        append('<div class="ln out">^C</div>');
        currentAbort?.abort();
      }
      e.preventDefault();
      return;
    }
    const val = input.value;
    const pos = input.selectionStart ?? val.length;

    if (e.key === 'Enter') {
      input.value = '';
      renderInput();
      busy = true;
      // Hide the prompt while the command runs, so a long-running command (e.g.
      // webllm loading a model, hashcat cracking) doesn't leave a stray, inert
      // prompt on screen that looks ready for input. An interactive command
      // re-shows the line itself via `ctx.ask` (readLine), and it is restored
      // here once the command finishes.
      inputline.hidden = true;
      await run(val);
      busy = false;
      inputline.hidden = false;
      refreshPrompt(); // the command may have changed the working directory
      input.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (hpos > 0) setLine(cmdHistory[--hpos] ?? '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (hpos < cmdHistory.length) setLine(cmdHistory[++hpos] ?? '');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      complete();
    } else if (e.ctrlKey && !e.altKey && !e.shiftKey) {
      // Emacs-style line editing shortcuts.
      const k = e.key.toLowerCase();
      if (k === 'l') {
        e.preventDefault();
        output.innerHTML = '';
      } else if (k === 'c') {
        e.preventDefault();
        echo(`${val}^C`);
        setLine('');
      } else if (k === 'a') {
        e.preventDefault();
        input.setSelectionRange(0, 0);
        renderInput();
      } else if (k === 'e') {
        e.preventDefault();
        input.setSelectionRange(val.length, val.length);
        renderInput();
      } else if (k === 'u') {
        e.preventDefault(); // delete from start to caret
        input.value = val.slice(pos);
        input.setSelectionRange(0, 0);
        renderInput();
      } else if (k === 'k') {
        e.preventDefault(); // delete from caret to end
        input.value = val.slice(0, pos);
        input.setSelectionRange(pos, pos);
        renderInput();
      } else if (k === 'w') {
        e.preventDefault(); // delete the word before the caret
        const left = val.slice(0, pos).replace(/\s*\S+\s*$/, '');
        input.value = left + val.slice(pos);
        input.setSelectionRange(left.length, left.length);
        renderInput();
      }
    }
  });

  // Click inside the terminal -> focus the input (except on a link or while selecting).
  body.addEventListener('click', (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('a')) return;
    if ((window.getSelection()?.toString() || '').length) return;
    if (!inputline.hidden) input.focus();
  });

  // A man "SEE ALSO" link (`a[data-cmd]`) opens that command's manual in place
  // rather than navigating away. Returns true when it handled the event.
  const openManLink = (el: HTMLElement): boolean => {
    const a = el.closest('a[data-cmd]') as HTMLElement | null;
    if (!a || busy || pendingRead) return false;
    const name = a.dataset.cmd;
    if (!name) return false;
    busy = true;
    void run(`man ${name}`).then(() => {
      busy = false;
      refreshPrompt();
      if (!isTouch) input.focus();
    });
    return true;
  };
  output.addEventListener('click', (e: MouseEvent) => {
    if (openManLink(e.target as HTMLElement)) e.preventDefault();
  });
  output.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (openManLink(e.target as HTMLElement)) e.preventDefault();
  });

  /* ------------------------- connection ----------------------------- */

  /**
   * Resets the screen, runs the `boot` command (the SSH connection animation,
   * authored in `root/bin/boot.md`), then — for a deep link such as
   * `/whoami` — runs the command named in the URL path. Finally hands control
   * back to the visitor.
   */
  async function boot(): Promise<void> {
    busy = true;
    inputline.hidden = true;
    output.innerHTML = '';
    if (reconnect) reconnect.hidden = true;
    win.classList.remove('closed');

    // A deep link (e.g. /whoami, reached from the sitemap or a search result)
    // skips the SSH boot animation. A command page opens its manual (`man
    // <command>`) instead of executing the command, so the visitor sees what it
    // does before running it; a document deep link still renders the file
    // directly. The home page (no slug) — and every spawned window — plays the
    // full connection sequence + motd.
    const slug = allowDeepLink ? location.pathname.replace(/^\/+|\/+$/g, '') : '';
    const isCommand = Boolean(slug && commands[slug]);
    const isDeepLink = isCommand || Boolean(slug && resolveFile(slug));
    if (isCommand) await run(`man ${slug}`);
    else if (isDeepLink) await run(slug);
    else if (commands['boot']) await commands['boot'].run([]);

    await sleep(reduce ? 0 : 150);

    // Interactive prompt. Avoid auto-focus on touch devices, where it would
    // immediately pop up the on-screen keyboard.
    inputline.hidden = false;
    refreshPrompt(); // restore the user prompt (boot's `ask` repurposed it)
    renderInput();
    busy = false;
    if (!isTouch) input.focus();
  }

  /* ------------------- window: drag, resize & controls -------------- */

  /** Switches from centered (transform) positioning to absolute left/top. */
  function toLeftTop(): void {
    if (win.style.left && win.style.transform === 'none') return;
    const r = win.getBoundingClientRect();
    win.style.left = `${r.left}px`;
    win.style.top = `${r.top}px`;
    win.style.transform = 'none';
    win.style.margin = '0';
  }

  /** Clamps (x, y) so a usable part of the title bar stays on screen. */
  function clampToViewport(x: number, y: number): [number, number] {
    return [
      Math.min(Math.max(x, 56 - win.offsetWidth), window.innerWidth - 56),
      Math.min(Math.max(y, 0), window.innerHeight - 40),
    ];
  }

  // Drag the window by grabbing the title bar.
  let drag: { dx: number; dy: number } | null = null;
  bar.addEventListener('pointerdown', (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('.ssh-ctl')) return;
    if (win.classList.contains('maximized')) return;
    toLeftTop();
    const r = win.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    bar.setPointerCapture(e.pointerId);
    bar.classList.add('grabbing');
  });
  bar.addEventListener('pointermove', (e: PointerEvent) => {
    if (!drag) return;
    const [x, y] = clampToViewport(e.clientX - drag.dx, e.clientY - drag.dy);
    win.style.left = `${x}px`;
    win.style.top = `${y}px`;
  });
  const endDrag = () => {
    drag = null;
    bar.classList.remove('grabbing');
  };
  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', endDrag);

  // Keep a moved window within the viewport when the browser is resized.
  window.addEventListener('resize', () => {
    if (!win.isConnected || win.classList.contains('maximized') || !win.style.left) return;
    const [x, y] = clampToViewport(parseFloat(win.style.left), parseFloat(win.style.top));
    win.style.left = `${x}px`;
    win.style.top = `${y}px`;
  });

  /** Inline style saved before maximizing, for restoration. */
  let prevRect = '';

  /** Maximizes the window (full frame) or restores its previous position/size. */
  function maximize(): void {
    if (win.classList.contains('maximized')) {
      win.classList.remove('maximized');
      win.setAttribute('style', prevRect);
    } else {
      prevRect = win.getAttribute('style') || '';
      win.removeAttribute('style'); // let the .maximized class control everything
      win.classList.add('maximized');
    }
  }

  /**
   * "Closes" the window: the first window fades out and reveals its reconnect
   * button; a spawned window (no reconnect) fades out and removes itself.
   */
  function closeWin(): void {
    win.classList.add('closed');
    if (reconnect) reconnect.hidden = false;
    else setTimeout(() => win.remove(), reduce ? 0 : 260);
  }

  // Title-bar buttons: close / minimize / maximize.
  bar.querySelectorAll('.ssh-ctl').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const act = (b as HTMLElement).dataset.act;
      if (act === 'close') closeWin();
      else if (act === 'min') win.classList.toggle('minimized');
      else if (act === 'max') maximize();
    }),
  );

  if (reconnect)
    reconnect.addEventListener('click', () => {
      win.classList.remove('minimized');
      boot();
    });

  // Double-click the bar = maximize / restore.
  bar.addEventListener('dblclick', (e) => {
    if ((e.target as HTMLElement).closest('.ssh-ctl')) return;
    maximize();
  });

  boot();
}
