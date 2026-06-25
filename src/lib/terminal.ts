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
import { createVfs, vdir, type VDir } from './vfs';
import { raiseZ, nextCascadeOffset, makeWindowChrome, spawnIframe } from './windows';
import { parseCommandLine, type Stage } from './shell-parse';
import {
  ensureModel,
  llmChat,
  getLlmState,
  recommendedModels,
  llmModels,
  cacheList,
  cacheRemove,
  cacheRemoveAll,
  unloadModel,
  interruptLlm,
  type EnsureOptions,
  type ChatRequest,
} from './llm';

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
  initTerminal(document.getElementById('ssh'));
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
  const off = nextCascadeOffset();
  win.style.left = `calc(50% + ${off}px)`;
  win.style.top = `calc(50% + ${off}px)`;
  win.style.zIndex = String(raiseZ());

  document.body.appendChild(win);
  initTerminal(win, false);
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
 * coexist on the page. `allowDeepLink` lets the first window open the URL's
 * command/document on load; spawned windows always play the full boot + motd.
 * No-op (early return) if `win0` (or any required child) is absent.
 */
export function initTerminal(win0: HTMLElement | null, allowDeepLink = true): void {
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
  // (Window chrome — drag, raise-to-front, controls — is wired by the shared
  // `makeWindowChrome` near the end of this function.)

  const cfg = readJSON<Cfg>('shell-cfg', {
    host: 'localhost',
    user: 'user',
    home: '/home/user',
    links: {},
  });

  /** Coarse pointer (touch) — used to skip auto-focus that would pop the keyboard. */
  const isTouch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

  /* --------------------------- virtual fs --------------------------- */

  // The whole fake filesystem mirrors the on-disk `root/` tree, built at compile
  // time and injected as #shell-fs (commands under /bin, documents under HOME).
  // Path resolution, identity (`su` / `exit`) and persisted mutations all live
  // in `vfs` (see ./vfs.ts), which is unit-tested on its own.
  const vfs = createVfs({ root: readJSON<VDir>('shell-fs', vdir()), home: cfg.home });

  /* ----------------------------- prompt ----------------------------- */

  /** Colored HTML prompt for the current user & directory (echo + input line). */
  function promptHtml(): string {
    // Always `user@host` (e.g. `guest@ludovic.toinel.com`); root swaps the name
    // and turns the `$` symbol into a red `#`.
    const user = `${vfs.isRoot() ? 'root' : cfg.user}@${cfg.host}`;
    const sym = vfs.isRoot()
      ? '<span class="prompt" style="color:#ff6b6b">#</span>'
      : '<span class="prompt">$</span>';
    // Trailing space is a non-breaking space: in the flex input line a normal
    // trailing space would be collapsed, leaving no gap after the symbol.
    return `<span class="prompt-user">${escapeHtml(user)}</span><span class="comment">:</span><span class="prompt-path">${escapeHtml(vfs.cwdLabel())}</span>${sym}&nbsp;`;
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

  // When set, stdout is captured into this buffer instead of the screen — used
  // by `>` / `>>` redirection and by `|` pipes (a stage's stdout becomes the
  // next stage's `ctx.stdin`). `error` (stderr) is never captured. The captured
  // text comes from `print` / `raw` / `line` and from any direct `append` (so a
  // command that renders its own HTML, like `grep`, still pipes/redirects as
  // plain text).
  let captureBuf: string[] | null = null;
  // When set, stderr (`printErr`) is recorded here instead of painted — used by
  // the headless `captureLine` (Denree) so an error message is returned, not
  // splashed onto the visible terminal during a programmatic run.
  let errSink: string[] | null = null;
  // Piped input handed to the running command via `ctx.stdin` (empty if none).
  let currentStdin = '';

  /**
   * If stdout is being captured, records `text` (the command's own string, not
   * its rendered HTML) and reports `true` so the caller skips painting it.
   */
  function captured(text: string): boolean {
    if (!captureBuf) return false;
    captureBuf.push(text);
    return true;
  }

  /** Scrolls the terminal to the bottom. */
  const scrollEnd = () => (body.scrollTop = body.scrollHeight);

  /** Creates a `<div>` (with already-safe HTML), appends it and scrolls. */
  function append(html: string, cls = ''): HTMLElement {
    const d = document.createElement('div');
    if (cls) d.className = cls;
    d.innerHTML = html;
    // While capturing (redirect / pipe), keep the node off-screen and record its
    // text so commands that emit HTML directly still produce pipeable stdout.
    if (captureBuf) {
      captureBuf.push(d.textContent || '');
      return d;
    }
    output.appendChild(d);
    scrollEnd();
    return d;
  }

  /** Prints a formatted document (markdown -> HTML) with a fade-in. */
  function printBlock(text: string): void {
    if (captured(text)) return;
    const d = append(format(text), 'ssh-out reveal-line');
    requestAnimationFrame(() => d.classList.add('is-in'));
  }

  /** Prints raw, escaped text (no markdown) preserving whitespace — for plain files. */
  function printRaw(text: string): void {
    if (captured(text)) return;
    const d = append(
      `<div class="ln out">${escapeHtml(text.replace(/\s+$/, ''))}</div>`,
      'ssh-out reveal-line',
    );
    requestAnimationFrame(() => d.classList.add('is-in'));
  }

  /** Prints a single line (inline markup allowed). */
  function printLine(text: string): void {
    if (captured(text)) return;
    append(`<div class="ln out">${inline(text)}</div>`, 'reveal-line is-in');
  }

  /** Prints an error line (red, escaped text), or records it when capturing stderr. */
  function printErr(text: string): void {
    if (errSink) {
      errSink.push(text);
      return;
    }
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
  const fileList = (): string[] => vfs.entryNames('file').sort();

  /** Resolves a name in the current dir: exact, implicit `.md`, or without extension. */
  function resolveFile(name: string): string | undefined {
    const n = vfs.nodeAt(vfs.cwd());
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
      // Text piped in from a previous pipeline stage (`prev | cmd`); '' if none.
      stdin: currentStdin,
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
      cwd: () => vfs.cwd(),
      cwdLabel: () => vfs.cwdLabel(),
      cd: (arg?: string) => vfs.chdir(arg),
      list: (arg?: string) => vfs.listPath(arg),
      read: (arg: string) => vfs.readPath(arg),
      // Mutations (persisted to localStorage): `mkdir` / `touch` / `rm`. Each
      // returns an error string, or null on success.
      mkdir: (path: string, parents = false) => vfs.mutate('mkdir', path, { p: parents }),
      touch: (path: string) => vfs.mutate('touch', path, {}),
      // Writes (or overwrites) a file's full contents — persisted like mkdir/touch.
      write: (path: string, content: string) => vfs.mutate('write', path, { content }),
      rm: (path: string, recursive = false, force = false) =>
        vfs.mutate('rm', path, { r: recursive, f: force }),
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
      // Opens an in-page window framing `url` (the `iframed` command); returns
      // an error string for a bad URL, or null on success.
      iframe: (url: string) => spawnIframe(url),
      // Display themes (CRT phosphor palettes). `theme` applies one (green clears
      // the attribute); `themes`/`currentTheme` let the `theme` command list and cycle.
      theme: (name: string) => applyTheme(name),
      themes: THEMES,
      currentTheme: () => currentTheme(),
      su: (target?: string) => vfs.su(target),
      // Interactive prompt: shows `question`, resolves with the user's typed line.
      // Pass `{ secret: true }` to mask the input (password-style read).
      ask: (question: string, opts?: { secret?: boolean }) =>
        readLine(question, !!(opts && opts.secret)),
      // `exit` from an `su` shell returns to the previous user; at the top level it closes.
      exit: () => {
        if (!vfs.popIdentity()) closeWin();
      },
      // Unconditionally closes this terminal window (used by `shutdown`/`reboot`),
      // regardless of any `su` identity stack.
      close: () => closeWin(),
      exec: (name: string, a: string[] = []) => commands[name]?.run(a),
      // Runs a full command line headlessly and returns its captured stdout/stderr
      // as text — used by the Denree agent to read a command's output as data.
      capture: (line: string) => captureLine(line),
      // The single, central LLM manager (src/lib/llm.ts) wired to this terminal:
      // `ensure` asks for consent in the shell and draws a progress bar; `chat`
      // routes generation through the manager so the top-right widget stays in
      // sync (model + cumulative in/out tokens). No model is loaded by default.
      llm: {
        state: () => getLlmState(),
        models: () => llmModels(),
        recommended: () => recommendedModels(),
        cacheList: () => cacheList(),
        cacheRemove: (id: string) => cacheRemove(id),
        cacheRemoveAll: () => cacheRemoveAll(),
        unload: () => unloadModel(),
        chat: (req: ChatRequest) => llmChat(req),
        interrupt: () => interruptLlm(),
        // Ensures a model is loaded; prompts the user for consent (unless the
        // caller supplies its own `confirm`) and renders a download bar.
        ensure: (opts: EnsureOptions) => {
          const merged: EnsureOptions = { ...opts };
          if (!merged.confirm) {
            merged.confirm = async (info) => {
              const human = info.gb != null ? `${info.label} (~${info.gb} GB)` : info.label;
              const why = info.reason ? ` — ${info.reason}` : '';
              const ans = ((await readLine(`load "${human}"${why}? [Y/n]`)) || '')
                .trim()
                .toLowerCase();
              return ans !== 'n' && ans !== 'no';
            };
          }
          if (!merged.onProgress) {
            let progEl: HTMLElement | null = null;
            const BARW = 28;
            merged.onProgress = (r) => {
              if (!progEl) {
                append(
                  '<div class="ln"><span class="accent text-glow">↓ loading model</span></div>',
                );
                progEl = append('<div class="ln comment">preparing…</div>');
              }
              const f = Math.max(0, Math.min(BARW, Math.round((r.progress || 0) * BARW)));
              const bar = `[${'#'.repeat(f)}${'·'.repeat(BARW - f)}] ${Math.round((r.progress || 0) * 100)}%`;
              progEl.innerHTML = `<span class="accent">${escapeHtml(bar)}</span> <span class="comment">${escapeHtml((r.text || '').slice(0, 70))}</span>`;
              scrollEnd();
            };
          }
          return ensureModel(merged);
        },
      },
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

  /** Runs one pipeline stage; returns its captured stdout, or null when not captured. */
  async function runStage(stage: Stage, capture: boolean): Promise<string[] | null> {
    const cmd = commands[stage.name];
    const buf = capture ? [] : null;
    captureBuf = buf;
    try {
      if (cmd) {
        await cmd.run(stage.args);
      } else {
        // Not a command: try the path as a file (implicit `cat`) in the current dir.
        const res = vfs.readPath(stage.name);
        if (res.error) printErr(`${stage.name}: command not found — type \`help\``);
        else if ((res.name || '').endsWith('.md')) printBlock(res.content as string);
        else printRaw(res.content as string);
      }
    } finally {
      captureBuf = null;
    }
    return buf;
  }

  /** Persists a redirection's captured output to the VFS (`>` / `>>`). */
  function writeRedirect(redirect: { path: string; append: boolean }, lastBuf: string[]): void {
    let content = lastBuf.join('\n');
    if (content && !content.endsWith('\n')) content += '\n';
    if (redirect.append) {
      const prev = vfs.readPath(redirect.path);
      if (!prev.error) content = (prev.content ?? '') + content;
    }
    const err = vfs.mutate('write', redirect.path, { content });
    if (err) printErr(err);
  }

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

    // Parse the line into pipeline stages + an optional trailing redirection
    // (the pure syntax layer lives in ./shell-parse). Each stage's stdout feeds
    // the next stage's `ctx.stdin`; the last stage prints to screen (or to the
    // redirect file). Stderr always shows on screen.
    const { stages, redirect, error } = parseCommandLine(line);
    if (error) {
      printErr(error);
      return;
    }

    // Fresh abort handle per command, exposed to its `js` via `ctx.signal` and
    // triggered by Ctrl+C (see the keydown handler).
    currentAbort = new AbortController();
    let lastBuf: string[] | null = null;
    currentStdin = ''; // first stage has no stdin
    try {
      for (let i = 0; i < stages.length; i++) {
        const isLast = i === stages.length - 1;
        // Capture every non-final stage (its output is piped onward), plus the
        // final stage when its output is redirected to a file.
        lastBuf = await runStage(stages[i], !isLast || !!redirect);
        // The captured stdout becomes the next stage's stdin.
        currentStdin = lastBuf ? lastBuf.join('\n') : '';
      }
    } finally {
      captureBuf = null;
      currentStdin = '';
      currentAbort = null;
    }

    if (redirect && lastBuf) writeRedirect(redirect, lastBuf);
  }

  /**
   * Runs a command line headlessly: every stage is captured (nothing is painted
   * to the screen, stderr included), and the final stdout is returned as text.
   * Powers `ctx.capture` (e.g. the `denree` agent reads a command's output as
   * data). Reuses an outer command's abort signal when present, so Ctrl+C still
   * cancels.
   */
  async function captureLine(
    raw: string,
  ): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    const line = (raw || '').trim();
    if (!line) return { ok: true, stdout: '', stderr: '' };
    const { stages, redirect, error } = parseCommandLine(line);
    if (error) return { ok: false, stdout: '', stderr: error };

    const prevAbort = currentAbort;
    const prevStdin = currentStdin;
    const errBuf: string[] = [];
    errSink = errBuf;
    if (!currentAbort) currentAbort = new AbortController();
    let lastBuf: string[] | null = null;
    currentStdin = '';
    try {
      for (let i = 0; i < stages.length; i++) {
        lastBuf = await runStage(stages[i], true); // capture every stage
        currentStdin = lastBuf ? lastBuf.join('\n') : '';
      }
      if (redirect && lastBuf) writeRedirect(redirect, lastBuf);
    } finally {
      captureBuf = null;
      currentStdin = prevStdin;
      currentAbort = prevAbort;
      errSink = null;
    }
    const stderr = errBuf.join('\n');
    // A redirected line's stdout went to the file, so report it as empty.
    const stdout = redirect ? '' : lastBuf ? lastBuf.join('\n') : '';
    return { ok: !stderr, stdout, stderr };
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
    let pool: string[];
    if (/>>?$/.test(head)) {
      // Completing a redirection target (`… > frag`) — names in the current dir.
      pool = vfs.entryNames('all');
    } else {
      // Scope to the current pipeline/redirection segment: the text after the
      // last `|`, `>` or `>>` operator. Its first token is the command.
      const seg = (head.split(/\||>>?/).pop() ?? '').trim();
      const first = seg.split(/\s+/)[0];
      if (seg === '') pool = [...Object.keys(commands), ...vfs.entryNames('all')];
      else if (first === 'open') pool = Object.keys(cfg.links);
      else if (first === 'cd') pool = vfs.entryNames('dir');
      else if (first === 'cat' || first === 'ls') pool = vfs.entryNames('all');
      else pool = [...Object.keys(commands), ...vfs.entryNames('all'), ...Object.keys(cfg.links)];
    }

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

  /**
   * "Closes" the window: it fades out. The main window (`#ssh`) stays in the DOM
   * (hidden) so the dock's "+ shell" button can still clone it; a spawned window
   * removes itself once the fade is done.
   */
  function closeWin(): void {
    win.classList.add('closed');
    if (win.id !== 'ssh') setTimeout(() => win.remove(), reduce ? 0 : 260);
  }

  // Drag, raise-to-front, minimize / maximize and the title-bar buttons — the
  // single window-chrome mechanism shared with stand-alone windows (`iframed`).
  makeWindowChrome(win, closeWin);

  boot();
}
