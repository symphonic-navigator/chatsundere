import { describe, expect, it } from 'vitest';
import { chunkMarkdown } from './chunker.js';

describe('chunkMarkdown', () => {
  it('returns one chunk with an empty heading path for short headingless text', () => {
    const chunks = chunkMarkdown('Just a short paragraph.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ text: 'Just a short paragraph.', headingPath: [], chunkIndex: 0 });
  });

  it('tracks the heading hierarchy as a headingPath', () => {
    const md = '# Title\n\nIntro.\n\n## Section\n\nBody under section.';
    const chunks = chunkMarkdown(md);
    expect(chunks.map((c) => c.headingPath)).toEqual([['Title'], ['Title', 'Section']]);
    expect(chunks[0]?.text).toContain('Intro.');
    expect(chunks[1]?.text).toContain('Body under section.');
  });

  it('assigns sequential chunkIndex values', () => {
    const md = '# A\n\nx\n\n# B\n\ny';
    const chunks = chunkMarkdown(md);
    expect(chunks.map((c) => c.chunkIndex)).toEqual([0, 1]);
  });

  it('splits an oversized section into multiple chunks by paragraph', () => {
    const para = 'word '.repeat(400).trim();
    const md = `# Big\n\n${para}\n\n${para}\n\n${para}`;
    const chunks = chunkMarkdown(md, { maxTokens: 500 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.headingPath).toEqual(['Big']);
  });

  it('hard-splits a single paragraph that exceeds the budget on word boundaries', () => {
    const huge = 'token '.repeat(2000).trim();
    const chunks = chunkMarkdown(huge, { maxTokens: 200 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.text.length).toBeGreaterThan(0);
  });

  it('returns no chunks for empty or whitespace-only input', () => {
    expect(chunkMarkdown('')).toEqual([]);
    expect(chunkMarkdown('   \n\n  ')).toEqual([]);
  });

  it('returns chunks with the agreed shape', () => {
    const [chunk] = chunkMarkdown('# H\n\nbody');
    expect(chunk).toMatchObject({
      text: expect.any(String),
      headingPath: expect.any(Array),
      chunkIndex: expect.any(Number),
    });
  });

  it('handles CRLF line endings', () => {
    const chunks = chunkMarkdown('# Title\r\n\r\nBody text.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.headingPath).toEqual(['Title']);
    expect(chunks[0]?.text).toBe('Body text.');
  });
});
