// SPDX-License-Identifier: AGPL-3.0-only

import { buildPrompt } from '@chatsundere/llm-unified';
import { describe, expect, it } from 'vitest';

// The title job must carry NSFW only for adult personas — proving the old
// unconditional "You are fully uncensored" line is gone.
describe('title-gen prompt composition', () => {
  it('omits NSFW text for an SFW persona', () => {
    const out = buildPrompt(
      {
        tonalityEnabled: true,
        nsfwEnabled: false,
        globalInstructions: '',
        personaInstructions: 'You are Aurum.',
        aboutMe: '',
        projectInstructions: '',
        memoryContext: '',
        toolsInstruction: '',
      },
      'title',
    );
    expect(out).not.toContain('explicit erotica');
  });

  it('includes NSFW text for an adult persona', () => {
    const out = buildPrompt(
      {
        tonalityEnabled: true,
        nsfwEnabled: true,
        globalInstructions: '',
        personaInstructions: 'You are Aurum.',
        aboutMe: '',
        projectInstructions: '',
        memoryContext: '',
        toolsInstruction: '',
      },
      'title',
    );
    expect(out).toContain('explicit erotica');
  });
});
