// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { assembleMemoryContext } from '../../src/memory/assembly.js';

describe('assembleMemoryContext', () => {
  it('returns "" when there is nothing', () => {
    expect(assembleMemoryContext({ memoryBody: '', committed: [], uncommitted: [] })).toBe('');
  });

  it('wraps body + journal with committed/pending markers', () => {
    const out = assembleMemoryContext({
      memoryBody: 'Likes tea.',
      committed: ['Has a sister'],
      uncommitted: ['Learning TypeScript'],
    });
    expect(out).toContain('<usermemory priority="normal">');
    expect(out).toContain('<memory-body>\nLikes tea.\n</memory-body>');
    expect(out).toContain('- [committed] Has a sister');
    expect(out).toContain('- [pending] Learning TypeScript');
    expect(out.trimEnd().endsWith('</usermemory>')).toBe(true);
  });

  it('drops journal lines once the token budget is exhausted', () => {
    const out = assembleMemoryContext({
      memoryBody: 'B',
      committed: ['keep this one'],
      uncommitted: ['x'.repeat(400)], // ~100 tokens, over a tiny budget
      maxTokens: 20,
    });
    expect(out).toContain('- [committed] keep this one');
    expect(out).not.toContain('xxxx');
  });
});
