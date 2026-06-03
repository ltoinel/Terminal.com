import { describe, it, expect } from 'vitest';
import { parseCommand, validateCommands } from '../src/lib/commands.ts';

/** Helper: a minimal valid command file. */
const cmd = (fm: string, body = '') => `---\n${fm}\n---\n${body}`;

describe('parseCommand', () => {
  it('extracts name, desc and a js block', () => {
    const def = parseCommand(cmd("name: hello\ndesc: say hi\njs: |\n  ctx.line('hi');"));
    expect(def.name).toBe('hello');
    expect(def.desc).toBe('say hi');
    expect(def.js).toBe("ctx.line('hi');");
    expect(def.body).toBe('');
  });

  it('keeps the markdown body for a doc-style command (no js)', () => {
    const def = parseCommand(cmd('name: whoami\ndesc: who am I', '# Ludovic\n'));
    expect(def.name).toBe('whoami');
    expect(def.js).toBeUndefined();
    expect(def.body).toBe('# Ludovic\n'); // only leading newlines are stripped
  });

  it('returns an empty name when there is no frontmatter', () => {
    const def = parseCommand('just text, no frontmatter');
    expect(def.name).toBe('');
  });
});

describe('validateCommands', () => {
  it('accepts a set of valid commands', () => {
    const { defs, errors } = validateCommands([
      ['hello.md', cmd("name: hello\njs: |\n  ctx.line('hi');")],
      ['whoami.md', cmd('name: whoami\ndesc: who am I', '# Ludovic')],
    ]);
    expect(errors).toEqual([]);
    expect(defs.map((d) => d.name).sort()).toEqual(['hello', 'whoami']);
  });

  it('flags a missing name', () => {
    const { errors } = validateCommands([['x.md', cmd('desc: no name', 'body')]]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('missing a "name" field');
  });

  it('flags missing/malformed frontmatter', () => {
    const { defs, errors } = validateCommands([['x.md', 'plain text']]);
    expect(defs).toEqual([]);
    expect(errors[0]).toContain('missing or malformed frontmatter');
  });

  it('flags an empty js block', () => {
    const { errors } = validateCommands([['x.md', cmd('name: empty\njs: |')]]);
    expect(errors[0]).toContain('"js: |" block is empty');
  });

  it('flags a JS syntax error without executing the code', () => {
    const { errors } = validateCommands([['bad.md', cmd('name: bad\njs: |\n  const x = (;')]]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('JS syntax error');
  });

  it('flags a duplicate command name across files', () => {
    const { errors } = validateCommands([
      ['a.md', cmd('name: dup')],
      ['b.md', cmd('name: dup')],
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('duplicate command name "dup" (already in a.md)');
  });
});
