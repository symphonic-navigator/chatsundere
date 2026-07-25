// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { buildContentAxisPrompt } from './content-axis.js';
import { NSFW_PROMPT, TONALITY_PROMPT } from './identity/chatsundere-identity.js';

describe('buildContentAxisPrompt', () => {
  it('returns empty when all gates off and global empty', () => {
    expect(
      buildContentAxisPrompt({
        nsfwEnabled: false,
        tonalityEnabled: false,
        globalInstructions: '',
      }),
    ).toBe('');
  });

  it('joins tonality then nsfw then global when all present', () => {
    const out = buildContentAxisPrompt({
      nsfwEnabled: true,
      tonalityEnabled: true,
      globalInstructions: '  BE BOLD  ',
    });
    expect(out.startsWith(TONALITY_PROMPT)).toBe(true);
    expect(out).toContain(NSFW_PROMPT);
    expect(out.endsWith('BE BOLD')).toBe(true);
    expect(out).toBe(`${TONALITY_PROMPT}\n\n${NSFW_PROMPT}\n\nBE BOLD`);
  });

  it('omits whitespace-only global instructions', () => {
    const out = buildContentAxisPrompt({
      nsfwEnabled: true,
      tonalityEnabled: false,
      globalInstructions: '   \n',
    });
    expect(out).toBe(NSFW_PROMPT);
  });
});
