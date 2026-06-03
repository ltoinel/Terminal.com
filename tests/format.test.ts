import { describe, it, expect } from 'vitest';
import { escapeHtml, inline, format } from '../src/lib/terminal.ts';

describe('escapeHtml', () => {
  it('escapes the HTML-sensitive characters', () => {
    expect(escapeHtml('a <b> & "c"')).toBe('a &lt;b&gt; &amp; &quot;c&quot;');
  });
});

describe('inline', () => {
  it('renders an external link in a new tab', () => {
    expect(inline('[geeek](https://geeek.org)')).toBe(
      '<a href="https://geeek.org" target="_blank" rel="noopener" class="tlink">geeek</a>',
    );
  });

  it('renders a mailto link without target', () => {
    expect(inline('[me](mailto:a@b.com)')).toBe('<a href="mailto:a@b.com" class="tlink">me</a>');
  });

  it('renders bold and inline code', () => {
    expect(inline('**bold**')).toBe('<strong class="cmd">bold</strong>');
    expect(inline('`code`')).toBe('<span class="prompt-path">code</span>');
  });

  it('escapes before applying markup (no HTML injection)', () => {
    expect(inline('<script>')).toBe('&lt;script&gt;');
  });
});

describe('format', () => {
  it('renders headings, sub-headings, notes and bullets', () => {
    expect(format('# Title')).toContain('<span class="accent text-glow">Title</span>');
    expect(format('## Sub')).toContain('<span class="prompt-path">Sub</span>');
    expect(format('> note')).toBe('<div class="ln comment">note</div>');
    expect(format('- item')).toContain('<span class="prompt">›</span> item');
  });

  it('renders a blank line as a non-breaking space', () => {
    expect(format('')).toBe('<div class="ln">&nbsp;</div>');
  });

  it('renders plain text as an output line', () => {
    expect(format('hello')).toBe('<div class="ln out">hello</div>');
  });
});
