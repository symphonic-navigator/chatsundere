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

describe('newest-first budget selection', () => {
  it('drops the oldest committed lines when the budget is tight, keeping the newest', () => {
    // Each line "- [committed] <item>" costs ~7 tokens; budget for ~2 lines.
    const out = assembleMemoryContext({
      memoryBody: '',
      committed: ['oldest entry text', 'middle entry text', 'newest entry text'],
      uncommitted: [],
      maxTokens: 15,
    });
    expect(out).toContain('newest entry text');
    expect(out).not.toContain('oldest entry text');
  });

  it('emits survivors in chronological order', () => {
    const out = assembleMemoryContext({
      memoryBody: '',
      committed: ['first entry', 'second entry'],
      uncommitted: [],
      maxTokens: 6000,
    });
    const first = out.indexOf('first entry');
    const second = out.indexOf('second entry');
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(second);
  });

  it('pending entries also keep newest under a tight budget', () => {
    const out = assembleMemoryContext({
      memoryBody: '',
      committed: [],
      uncommitted: ['old pending entry', 'new pending entry'],
      maxTokens: 8,
    });
    expect(out).toContain('new pending entry');
    expect(out).not.toContain('old pending entry');
  });
});
