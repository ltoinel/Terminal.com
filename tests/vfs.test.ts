import { describe, it, expect, beforeEach } from 'vitest';
import { createVfs, vdir, type VDir, type VNode, type StorageLike } from '../src/lib/vfs.ts';

const file = (content: string): VNode => ({ type: 'file', content });

/** A fresh sample tree mirroring the shell layout (guest home, root home, /bin). */
const makeTree = (): VDir =>
  vdir({
    home: vdir({
      guest: vdir({
        'about.md': file('# About'),
        'notes.txt': file('hello'),
        docs: vdir({ 'cv.md': file('my cv') }),
      }),
    }),
    root: vdir({ 'secret.md': file('top secret') }),
    bin: vdir({ 'ls.md': file('ls source') }),
  });

/** An in-memory StorageLike for journal-persistence tests. */
const memStorage = (): StorageLike & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
};

const HOME = '/home/guest';
const newVfs = (storage: StorageLike | null = null) =>
  createVfs({ root: makeTree(), home: HOME, storage });

describe('resolvePath', () => {
  let vfs: ReturnType<typeof createVfs>;
  beforeEach(() => (vfs = newVfs()));

  it('returns cwd for an empty input', () => {
    expect(vfs.resolvePath('')).toBe(HOME);
  });
  it('resolves ~ and ~/sub against home', () => {
    expect(vfs.resolvePath('~')).toBe(HOME);
    expect(vfs.resolvePath('~/docs')).toBe(`${HOME}/docs`);
  });
  it('resolves relative paths against cwd', () => {
    expect(vfs.resolvePath('docs')).toBe(`${HOME}/docs`);
  });
  it('collapses . and ..', () => {
    expect(vfs.resolvePath('docs/../about.md')).toBe(`${HOME}/about.md`);
    expect(vfs.resolvePath('/a/b/../../c')).toBe('/c');
  });
  it('keeps absolute paths absolute', () => {
    expect(vfs.resolvePath('/bin')).toBe('/bin');
  });
});

describe('readPath', () => {
  let vfs: ReturnType<typeof createVfs>;
  beforeEach(() => (vfs = newVfs()));

  it('reads an exact file', () => {
    expect(vfs.readPath('notes.txt')).toEqual({ content: 'hello', name: 'notes.txt' });
  });
  it('resolves an implicit .md extension', () => {
    expect(vfs.readPath('about')).toEqual({ content: '# About', name: 'about.md' });
  });
  it('errors on a missing file', () => {
    expect(vfs.readPath('nope').error).toBe('No such file or directory');
  });
  it('errors when the target is a directory', () => {
    expect(vfs.readPath('docs').error).toBe('Is a directory');
  });
  it('denies reading the root home as guest', () => {
    expect(vfs.readPath('/root/secret.md').error).toBe('Permission denied');
  });
});

describe('listPath', () => {
  let vfs: ReturnType<typeof createVfs>;
  beforeEach(() => (vfs = newVfs()));

  it('lists a directory sorted, with sizes', () => {
    const { entries } = vfs.listPath('~');
    expect(entries?.map((e) => e.name)).toEqual(['about.md', 'docs', 'notes.txt']);
    const notes = entries?.find((e) => e.name === 'notes.txt');
    expect(notes).toMatchObject({ type: 'file', size: 5 });
    expect(entries?.find((e) => e.name === 'docs')).toMatchObject({ type: 'dir', size: 4096 });
  });
  it('lists a single file when given a file path', () => {
    expect(vfs.listPath('notes.txt').entries).toEqual([
      { name: 'notes.txt', type: 'file', size: 5 },
    ]);
  });
  it('denies listing the root subtree as guest', () => {
    expect(vfs.listPath('/root').error).toContain('Permission denied');
  });
});

describe('chdir', () => {
  let vfs: ReturnType<typeof createVfs>;
  beforeEach(() => (vfs = newVfs()));

  it('changes into a subdirectory', () => {
    expect(vfs.chdir('docs')).toBeNull();
    expect(vfs.cwd()).toBe(`${HOME}/docs`);
  });
  it('cd with no arg returns home; cd - returns to the previous dir', () => {
    vfs.chdir('docs');
    expect(vfs.chdir()).toBeNull();
    expect(vfs.cwd()).toBe(HOME);
    expect(vfs.chdir('-')).toBeNull();
    expect(vfs.cwd()).toBe(`${HOME}/docs`);
  });
  it('errors on a missing dir and on a file target', () => {
    expect(vfs.chdir('nope')).toContain('No such file or directory');
    expect(vfs.chdir('about.md')).toContain('Not a directory');
  });
  it('denies entering the root home as guest', () => {
    expect(vfs.chdir('/root')).toContain('Permission denied');
  });
});

describe('pathLabel', () => {
  it('shows home as ~ and nested paths as ~/sub', () => {
    const vfs = newVfs();
    expect(vfs.pathLabel(HOME)).toBe('~');
    expect(vfs.pathLabel(`${HOME}/docs`)).toBe('~/docs');
    expect(vfs.pathLabel('/bin')).toBe('/bin');
    vfs.chdir('docs');
    expect(vfs.cwdLabel()).toBe('~/docs');
  });
});

describe('identity (su / exit) and permissions', () => {
  let vfs: ReturnType<typeof createVfs>;
  beforeEach(() => (vfs = newVfs()));

  it('guest is confined to its home for writes', () => {
    expect(vfs.canWrite(`${HOME}/x`)).toBe(true);
    expect(vfs.canWrite('/bin/x')).toBe(false);
    expect(vfs.denied('/root/secret.md')).toBe(true);
  });
  it('su root jumps to /root and grants write everywhere', () => {
    expect(vfs.su()).toBeNull();
    expect(vfs.isRoot()).toBe(true);
    expect(vfs.cwd()).toBe('/root');
    expect(vfs.canWrite('/bin/x')).toBe(true);
    expect(vfs.denied('/root/secret.md')).toBe(false);
  });
  it('rejects su for a non-root user', () => {
    expect(vfs.su('alice')).toContain("l'utilisateur");
    expect(vfs.isRoot()).toBe(false);
  });
  it('exit (popIdentity) restores the previous identity', () => {
    vfs.chdir('docs');
    vfs.su();
    expect(vfs.popIdentity()).toBe(true);
    expect(vfs.isRoot()).toBe(false);
    expect(vfs.cwd()).toBe(`${HOME}/docs`);
    expect(vfs.popIdentity()).toBe(false); // nothing left to pop at top level
  });
});

describe('mutate', () => {
  let vfs: ReturnType<typeof createVfs>;
  beforeEach(() => (vfs = newVfs()));

  it('mkdir creates a dir and refuses an existing one without -p', () => {
    expect(vfs.mutate('mkdir', 'sub', {})).toBeNull();
    expect(vfs.listPath('sub').entries).toEqual([]);
    expect(vfs.mutate('mkdir', 'sub', {})).toContain('File exists');
    expect(vfs.mutate('mkdir', 'sub', { p: true })).toBeNull(); // -p tolerates it
  });
  it('mkdir -p creates intermediate directories', () => {
    expect(vfs.mutate('mkdir', 'a/b/c', { p: true })).toBeNull();
    expect(vfs.readPath('a/b/c').error).toBe('Is a directory');
  });
  it('touch creates an empty file and is idempotent', () => {
    expect(vfs.mutate('touch', 'new.txt', {})).toBeNull();
    expect(vfs.readPath('new.txt').content).toBe('');
    expect(vfs.mutate('touch', 'new.txt', {})).toBeNull();
  });
  it('write creates and overwrites file contents', () => {
    expect(vfs.mutate('write', 'out.txt', { content: 'one' })).toBeNull();
    expect(vfs.readPath('out.txt').content).toBe('one');
    expect(vfs.mutate('write', 'out.txt', { content: 'two' })).toBeNull();
    expect(vfs.readPath('out.txt').content).toBe('two');
  });
  it('rm removes files, needs -r for dirs, and -f ignores missing', () => {
    expect(vfs.mutate('rm', 'notes.txt', {})).toBeNull();
    expect(vfs.readPath('notes.txt').error).toBe('No such file or directory');
    expect(vfs.mutate('rm', 'docs', {})).toContain('Is a directory');
    expect(vfs.mutate('rm', 'docs', { r: true })).toBeNull();
    expect(vfs.mutate('rm', 'ghost', {})).toContain('No such file or directory');
    expect(vfs.mutate('rm', 'ghost', { f: true })).toBeNull();
  });
  it('refuses to remove the current directory', () => {
    vfs.chdir('docs');
    expect(vfs.mutate('rm', '~/docs', { r: true })).toContain('directory in use');
  });
  it('denies writing outside the guest home', () => {
    expect(vfs.mutate('write', '/bin/x', { content: 'x' })).toContain('Permission denied');
  });
});

describe('journal persistence', () => {
  it('persists mutations and replays them into a fresh tree', () => {
    const storage = memStorage();
    const a = createVfs({ root: makeTree(), home: HOME, storage });
    a.mutate('write', 'kept.txt', { content: 'data' });
    a.mutate('rm', 'notes.txt', {});
    expect(storage.map.size).toBe(1); // journal stored under one key

    // A brand-new vfs over a fresh tree, same storage, replays the journal.
    const b = createVfs({ root: makeTree(), home: HOME, storage });
    expect(b.readPath('kept.txt').content).toBe('data');
    expect(b.readPath('notes.txt').error).toBe('No such file or directory');
  });
  it('collapses repeated writes to the same path in the journal', () => {
    const storage = memStorage();
    const v = createVfs({ root: makeTree(), home: HOME, storage });
    v.mutate('write', 'f.txt', { content: 'a' });
    v.mutate('write', 'f.txt', { content: 'b' });
    v.mutate('write', 'f.txt', { content: 'c' });
    const journal = JSON.parse(storage.map.get('ltsh.fs') as string);
    expect(journal.filter((o: { path: string }) => o.path === `${HOME}/f.txt`)).toHaveLength(1);
  });
  it('without storage, mutations apply but nothing is persisted', () => {
    const v = newVfs(null);
    expect(v.mutate('write', 'x.txt', { content: 'y' })).toBeNull();
    expect(v.readPath('x.txt').content).toBe('y');
  });
});
