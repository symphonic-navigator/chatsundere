// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { preprocessMath, stripMathDelimiters } from '../../../src/lib/markdown/preprocess-math.js';

describe('preprocessMath', () => {
  it('converts inline \\( \\) to $ $ and trims inner whitespace', () => {
    expect(preprocessMath(String.raw`a \( x + 1 \) b`)).toBe('a $x + 1$ b');
  });

  it('converts single-line \\[ \\] to compact $$ $$', () => {
    expect(preprocessMath(String.raw`\[ a^2 \]`)).toBe('$$a^2$$');
  });

  it('converts multi-line \\[ \\] to a blank-line-fenced block', () => {
    const src = '\\[\na &= b \\\\\nc &= d\n\\]';
    expect(preprocessMath(src)).toBe('\n\n$$\na &= b \\\\\nc &= d\n$$\n\n');
  });

  it('does not rewrite maths-like text inside an inline code span', () => {
    const src = 'see `\\(E=mc^2\\)` here';
    expect(preprocessMath(src)).toBe('see `\\(E=mc^2\\)` here');
  });

  it('does not rewrite maths inside a fenced code block', () => {
    const src = '```\n\\[E=mc^2\\]\n```';
    expect(preprocessMath(src)).toBe(src);
  });

  it('does not rewrite maths inside an unclosed (streaming) fenced code block', () => {
    const src = '```\n\\[E=mc^2\\]';
    expect(preprocessMath(src)).toBe(src);
  });

  it('does not treat \\\\[5pt] line-break spacing as display math', () => {
    const src = 'a &= b \\\\[5pt]\nc &= d';
    // The \[ rule must not fire on the bracket of \\[5pt].
    expect(preprocessMath(src)).toBe(src);
  });
});

describe('stripMathDelimiters', () => {
  it.each([
    ['$$x$$', 'x'],
    ['\\[x\\]', 'x'],
    ['\\(x\\)', 'x'],
    ['$x$', 'x'],
    ['  x  ', 'x'],
  ])('strips %s to %s', (input, expected) => {
    expect(stripMathDelimiters(input)).toBe(expected);
  });
});
