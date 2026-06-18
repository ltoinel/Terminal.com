import { describe, it, expect } from 'vitest';
import { parseCommandLine } from '../src/lib/shell-parse.ts';

describe('parseCommandLine — stages & tokens', () => {
  it('parses a bare command into one stage', () => {
    const p = parseCommandLine('whoami');
    expect(p.error).toBeUndefined();
    expect(p.redirect).toBeNull();
    expect(p.stages).toEqual([{ name: 'whoami', args: [], raw: 'whoami' }]);
  });
  it('splits a command and its arguments', () => {
    expect(parseCommandLine('echo hello world').stages[0]).toEqual({
      name: 'echo',
      args: ['hello', 'world'],
      raw: 'echo hello world',
    });
  });
  it('collapses runs of whitespace between tokens', () => {
    expect(parseCommandLine('echo   a    b').stages[0]).toMatchObject({
      name: 'echo',
      args: ['a', 'b'],
    });
  });
  it('trims and ignores surrounding whitespace', () => {
    expect(parseCommandLine('   ls   ').stages).toEqual([{ name: 'ls', args: [], raw: 'ls' }]);
  });
  it('returns no stages for an empty line', () => {
    expect(parseCommandLine('   ')).toEqual({ stages: [], redirect: null });
  });
});

describe('parseCommandLine — pipes', () => {
  it('splits a pipeline into stages', () => {
    const p = parseCommandLine('cat about.md | grep ssh | base64');
    expect(p.stages.map((s) => s.name)).toEqual(['cat', 'grep', 'base64']);
    expect(p.stages[1].args).toEqual(['ssh']);
  });
  it('flags an empty trailing stage as a syntax error', () => {
    const p = parseCommandLine('cat foo |');
    expect(p.error).toBe('syntax error near `|`');
    expect(p.stages).toEqual([]);
  });
  it('flags an empty leading stage and a doubled pipe', () => {
    expect(parseCommandLine('| grep x').error).toBe('syntax error near `|`');
    expect(parseCommandLine('a || b').error).toBe('syntax error near `|`');
  });
});

describe('parseCommandLine — redirection', () => {
  it('pulls off a > redirection (truncate)', () => {
    const p = parseCommandLine('echo hi > out.txt');
    expect(p.redirect).toEqual({ path: 'out.txt', append: false });
    expect(p.stages).toEqual([{ name: 'echo', args: ['hi'], raw: 'echo hi' }]);
  });
  it('pulls off a >> redirection (append)', () => {
    expect(parseCommandLine('uuid 3 >> log').redirect).toEqual({ path: 'log', append: true });
  });
  it('handles a redirection with no space before the operator', () => {
    const p = parseCommandLine('ls>files');
    expect(p.redirect).toEqual({ path: 'files', append: false });
    expect(p.stages[0]).toMatchObject({ name: 'ls', args: [] });
  });
  it('keeps the last redirection when several are present', () => {
    expect(parseCommandLine('echo x > a > b').redirect).toEqual({ path: 'b', append: false });
  });
  it('applies the redirection to the final stage of a pipeline', () => {
    const p = parseCommandLine('ls | grep md > out.txt');
    expect(p.stages.map((s) => s.name)).toEqual(['ls', 'grep']);
    expect(p.stages[1].args).toEqual(['md']);
    expect(p.redirect).toEqual({ path: 'out.txt', append: false });
  });
  it('does not treat a leading > (no command) as a redirection', () => {
    const p = parseCommandLine('> file');
    expect(p.redirect).toBeNull();
    expect(p.stages[0].name).toBe('>');
  });
});
