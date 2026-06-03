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

/** Configuration injected via `#shell-cfg`. */
interface Cfg {
  /** Host shown in prompts and the SSH animation. */
  host: string;
  /** User shown in the prompt (e.g. `ludovic@toinel.com`). */
  user: string;
  /** Absolute home directory (shown as `~`); the shell starts here. */
  home: string;
  /** `key -> URL` registry used by the `open` command. */
  links: Record<string, string>;
}

/** Whether the user prefers reduced motion — disables animations and delays. */
const reduce =
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Resolves after `ms` milliseconds (resolves immediately under reduced motion). */
const sleep = (ms: number): Promise<void> =>
  reduce ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));

/** Reads and parses a `<script type="application/json" id="...">` block. */
function readJSON<T>(id: string, fallback: T): T {
  const elJson = document.getElementById(id);
  if (!elJson || !elJson.textContent) return fallback;
  try {
    return JSON.parse(elJson.textContent) as T;
  } catch {
    return fallback;
  }
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
 * Entry point: wires the terminal window present in the DOM and starts the
 * connection sequence. No-op (early return) if the window is absent.
 */
export function initTerminal(): void {
  const win0 = document.getElementById('ssh');
  const output0 = document.getElementById('ssh-output');
  const inputline0 = document.getElementById('ssh-inputline');
  const input0 = document.getElementById('ssh-input') as HTMLInputElement | null;
  const typed0 = document.getElementById('ssh-typed');
  const prompt0 = document.getElementById('ssh-prompt');
  const body0 = document.getElementById('ssh-body');
  const bar0 = document.getElementById('ssh-bar');
  const reconnect = document.getElementById('ssh-reconnect');
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

  /* ----------------------------- prompt ----------------------------- */

  /** Colored HTML prompt for the current user & directory (echo + input line). */
  function promptHtml(): string {
    // root: shows `root@host` and a red `#`; otherwise the configured user and `$`.
    const user = isRoot ? `root@${cfg.host}` : cfg.user;
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
      commands: cmdDefs.map((d) => ({ name: d.name, desc: d.desc || '' })),
      escape: escapeHtml,
      fileList,
      resolveFile,
      // Virtual filesystem, exposed to the `cd` / `ls` / `cat` / `pwd` commands.
      cwd: () => cwd,
      cwdLabel: () => pathLabel(cwd),
      cd: (arg?: string) => chdir(arg),
      list: (arg?: string) => listPath(arg),
      read: (arg: string) => readPath(arg),
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
      theme: (amber: boolean) => {
        document.documentElement.classList.toggle('amber', amber);
        localStorage.setItem('theme', amber ? 'amber' : 'green');
      },
      su: (target?: string) => su(target),
      // `exit` from an `su` shell returns to the previous user; at the top level it closes.
      exit: () => {
        if (!popIdentity()) closeWin();
      },
      exec: (name: string, a: string[] = []) => commands[name]?.run(a),
    };
  }

  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
    arg: string,
    body: string,
  ) => (ctx: ReturnType<typeof makeCtx>) => Promise<void>;

  for (const def of cmdDefs) {
    if (!def.name) continue;
    const { name, desc = '', js, body } = def;
    commands[name] = {
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
    if (cmd) {
      await cmd.run(args);
    } else {
      // Not a command: try the path as a file (implicit `cat`) in the current dir.
      const res = readPath(name);
      if (res.error) printErr(`${name}: command not found — type \`help\``);
      else if ((res.name || '').endsWith('.md')) printBlock(res.content as string);
      else printRaw(res.content as string);
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
    if (!frag) return;
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
      // Complete up to the longest common prefix; otherwise list the candidates.
      let common = hits[0];
      for (const h of hits) while (!h.startsWith(common)) common = common.slice(0, -1);
      if (common.length > frag.length) input.value = v.slice(0, v.length - frag.length) + common;
      else append(`<div class="ln comment">${hits.join('  ')}</div>`);
    }
    input.setSelectionRange(input.value.length, input.value.length);
    renderInput();
  }

  // Keep the visible line (and caret position) in sync with the hidden input.
  ['input', 'keyup', 'click', 'select'].forEach((ev) => input.addEventListener(ev, renderInput));

  input.addEventListener('keydown', async (e: KeyboardEvent) => {
    if (busy) {
      e.preventDefault();
      return;
    }
    const val = input.value;
    const pos = input.selectionStart ?? val.length;

    if (e.key === 'Enter') {
      input.value = '';
      renderInput();
      busy = true;
      await run(val);
      busy = false;
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

    if (commands['boot']) await commands['boot'].run([]);

    // Deep link: if the URL path names a command (or document), run it on load.
    const slug = location.pathname.replace(/^\/+|\/+$/g, '');
    if (slug && (commands[slug] || resolveFile(slug))) await run(slug);

    await sleep(reduce ? 0 : 150);

    // Interactive prompt. Avoid auto-focus on touch devices, where it would
    // immediately pop up the on-screen keyboard.
    inputline.hidden = false;
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
    if (win.classList.contains('maximized') || !win.style.left) return;
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

  /** "Closes" the window and reveals the reconnect button. */
  function closeWin(): void {
    win.classList.add('closed');
    if (reconnect) reconnect.hidden = false;
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
