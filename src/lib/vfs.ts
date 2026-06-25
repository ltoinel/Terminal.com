/* ------------------------------------------------------------------------- *
 * Virtual filesystem for the terminal shell.
 *
 * A fake Linux tree (directories + text files) with path resolution, a tiny
 * identity model (`su` / `exit`), permission checks and mutations persisted as
 * a replayable journal in localStorage. Extracted from `terminal.ts` so the
 * shell's most logic-heavy part can be unit-tested on its own — `createVfs`
 * takes its tree and storage as arguments and touches no DOM.
 * ------------------------------------------------------------------------- */

/** A node in the fake Linux tree: a directory (children) or a text file. */
export type VFile = { type: 'file'; content: string };
export type VDir = { type: 'dir'; children: Record<string, VNode> };
export type VNode = VFile | VDir;

/** Builds a directory node. */
export const vdir = (children: Record<string, VNode> = {}): VDir => ({ type: 'dir', children });

/** The result of a mutation: an error message, or whether the tree changed. */
type MutRes = { error?: string; changed?: boolean };

/** A persisted filesystem operation — the journal replayed on each boot. */
export interface FsOp {
  op: 'mkdir' | 'touch' | 'rm' | 'write';
  path: string; // absolute & normalized, so replay is independent of cwd
  p?: boolean; // mkdir -p
  r?: boolean; // rm -r
  content?: string; // write: the file's full contents
}

/** A directory listing entry (the `ls` backend). */
export interface VfsEntry {
  name: string;
  type: 'dir' | 'file';
  size: number;
}

/** Minimal persistence surface — a subset of the Web Storage API. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface VfsOptions {
  /** The base tree (built at compile time, injected as `#shell-fs`). */
  root: VDir;
  /** The guest's home directory — where the shell starts (`cfg.home`). */
  home: string;
  /** Superuser home, reachable only after `su`. Defaults to `/root`. */
  rootHome?: string;
  /**
   * Where the mutation journal is persisted. Defaults to `localStorage` when
   * available; pass `null` to disable persistence (e.g. in tests).
   */
  storage?: StorageLike | null;
  /** localStorage key for the journal. */
  storageKey?: string;
}

/** The shell's view of its filesystem — queries, identity and mutations. */
export interface Vfs {
  /** Current working directory (absolute, normalized). */
  cwd(): string;
  /** The current user's home (`HOME`, or `/root` once root). */
  home(): string;
  /** Whether the current identity is root. */
  isRoot(): boolean;
  /** Prompt-friendly label: home shows as `~`, paths below it as `~/sub`. */
  pathLabel(path: string): string;
  /** Shorthand for `pathLabel(cwd())`. */
  cwdLabel(): string;
  /** Becomes root (`su` / `su root`); returns an error string for other users. */
  su(target?: string): string | null;
  /** Restores the previous identity (`exit`); false at the top level. */
  popIdentity(): boolean;
  /** Resolves a typed path (relative, absolute, `~`, `.`, `..`) to an absolute one. */
  resolvePath(input: string): string;
  /** Returns the node at an absolute path, or `undefined`. */
  nodeAt(path: string): VNode | undefined;
  /** Names of the entries in the current directory, optionally filtered. */
  entryNames(kind: 'all' | 'dir' | 'file'): string[];
  /** `ls` backend: lists a directory (or a single file), or an error. */
  listPath(arg?: string): { entries?: VfsEntry[]; error?: string };
  /** `cat` backend: reads a file (with implicit `.md`), or an error. */
  readPath(arg: string): { content?: string; name?: string; error?: string };
  /** Changes directory (`-` = previous, empty = home); error string or `null`. */
  chdir(arg?: string): string | null;
  /** Whether the current user is denied access to `path` (root-only subtree). */
  denied(path: string): boolean;
  /** Whether the current user may create / modify / remove at `path`. */
  canWrite(path: string): boolean;
  /** Runs a mutation, journals it on success; returns an error string or `null`. */
  mutate(
    op: FsOp['op'],
    rawPath: string,
    flags: { p?: boolean; r?: boolean; f?: boolean; content?: string },
  ): string | null;
}

/** `localStorage` when reachable, else `null` (SSR / tests / privacy mode). */
function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Creates a virtual filesystem over `opts.root`. Mutations are applied to the
 * in-memory tree and recorded in a journal persisted to `opts.storage`; the
 * journal is replayed onto the base tree here, so a deploy still refreshes
 * `/bin`, documents, etc. *under* the user's local changes.
 */
export function createVfs(opts: VfsOptions): Vfs {
  const root = opts.root;
  /** Absolute path of the visitor's home directory (the shell starts here). */
  const HOME = opts.home;
  /** Superuser home, reachable only after `su` (see the identity state below). */
  const ROOT_HOME = opts.rootHome ?? '/root';
  const FS_KEY = opts.storageKey ?? 'ltsh.fs';
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;

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
    if (name !== 'root') return `su: user "${name}" does not exist`;
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
  function listPath(arg?: string): { entries?: VfsEntry[]; error?: string } {
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
    if (!storage) return;
    try {
      storage.setItem(FS_KEY, JSON.stringify(fsJournal));
    } catch {
      /* storage full / unavailable — the change still applies this session */
    }
  };

  /** Runs a mutation, records it in the journal on success, returns an error or null. */
  function mutate(
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
  if (storage) {
    try {
      const stored: unknown = JSON.parse(storage.getItem(FS_KEY) || '[]');
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
  }

  return {
    cwd: () => cwd,
    home: () => home,
    isRoot: () => isRoot,
    pathLabel,
    cwdLabel: () => pathLabel(cwd),
    su,
    popIdentity,
    resolvePath,
    nodeAt,
    entryNames,
    listPath,
    readPath,
    chdir,
    denied,
    canWrite,
    mutate,
  };
}
