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

  it('includes the roleplay block when the persona is a roleplay persona', () => {
    // Band-1 segments run in every job — roleplay is Band-1 — so the title job
    // must carry the roleplay block when the persona has roleplay:true.
    const out = buildPrompt(
      {
        tonalityEnabled: false,
        nsfwEnabled: false,
        globalInstructions: '',
        personaInstructions: 'You are Mira.',
        aboutMe: '',
        projectInstructions: '',
        memoryContext: '',
        toolsInstruction: '',
        roleplayEnabled: true,
        narration: 'third',
        personaName: 'Mira',
      },
      'title',
    );
    expect(out).toContain('roleplay mode');
  });
});
