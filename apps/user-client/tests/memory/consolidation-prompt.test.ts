// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  buildConsolidationPrompt,
  validateMemoryBody,
} from '../../src/memory/consolidation-prompt.js';

describe('buildConsolidationPrompt', () => {
  it('templates the existing body, marks corrections, and lists entries', () => {
    const p = buildConsolidationPrompt({
      existingBody: 'Likes tea.',
      entries: [
        { content: 'Has a dog', isCorrection: false },
        { content: 'Actually prefers coffee', isCorrection: true },
      ],
    });
    expect(p).toContain('EXISTING MEMORY BODY:\nLikes tea.');
    expect(p).toContain('- Has a dog');
    expect(p).toContain('- [CORRECTION] Actually prefers coffee');
    expect(p).toContain('INSTRUCTIONS:');
    expect(p).toContain('under 3000 tokens');
  });

  it('shows a first-consolidation placeholder when no body exists', () => {
    const p = buildConsolidationPrompt({
      existingBody: null,
      entries: [{ content: 'X', isCorrection: false }],
    });
    expect(p).toContain('(no existing memory — this is the first consolidation)');
  });

  it('includes user guidance when provided', () => {
    const p = buildConsolidationPrompt({
      existingBody: null,
      entries: [{ content: 'X', isCorrection: false }],
      userGuidance: 'Focus on my work life.',
    });
    expect(p).toContain('USER GUIDANCE:');
    expect(p).toContain('Focus on my work life.');
  });
});

describe('validateMemoryBody', () => {
  it('rejects empty / whitespace', () => {
    expect(validateMemoryBody('')).toBe(false);
    expect(validateMemoryBody('   ')).toBe(false);
    expect(validateMemoryBody(null)).toBe(false);
  });
  it('accepts content within the token cap', () => {
    expect(validateMemoryBody('A short body.')).toBe(true);
  });
  it('rejects content over the cap', () => {
    expect(validateMemoryBody('x'.repeat(40), 5)).toBe(false); // ~10 tokens > 5
  });
});
