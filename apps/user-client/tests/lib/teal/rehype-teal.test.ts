// SPDX-License-Identifier: AGPL-3.0-only
import rehypeStringify from 'rehype-stringify';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';
import { preprocessTeal } from '../../../src/lib/teal/preprocess-teal.js';
import { rehypeTeal } from '../../../src/lib/teal/rehype-teal.js';

function render(md: string): string {
  return unified()
    .use(remarkParse)
    .use(remarkRehype)
    .use(rehypeTeal)
    .use(rehypeStringify)
    .processSync(preprocessTeal(md))
    .toString();
}

describe('rehypeTeal', () => {
  it('wraps whisper ranges in a classed span', () => {
    expect(render('a <whisper>secret</whisper> b')).toBe(
      '<p>a <span class="teal-whisper">secret</span> b</p>',
    );
  });

  it('nests wraps as combined classes on the inner text', () => {
    // No empty spans for the zero-length outer segments; the wrapped text
    // carries BOTH classes.
    expect(render('<soft><emphasis>word</emphasis></soft>')).toBe(
      '<p><span class="teal-italic teal-bold">word</span></p>',
    );
  });

  it('styles across element boundaries and to the end when unclosed', () => {
    const html = render('<whisper>one\n\ntwo');
    expect(html).toContain('<p><span class="teal-whisper">one</span></p>');
    expect(html).toContain('<p><span class="teal-whisper">two</span></p>');
  });

  it('does not touch code blocks', () => {
    const html = render('```\n<whisper>x</whisper>\n```');
    expect(html).toContain('&#x3C;whisper>x&#x3C;/whisper>');
    expect(html).not.toContain('teal-whisper');
  });

  it('removes an orphan close tag without styling anything', () => {
    expect(render('hi</whisper> there')).toBe('<p>hi there</p>');
  });
});
