// SPDX-License-Identifier: LGPL-3.0-only

import { describe, expect, it } from 'bun:test';
import { type BuildPromptInputs, buildPrompt } from './composition.js';
import { NSFW_PROMPT, TONALITY_PROMPT } from './identity/chatsundere-identity.js';

function inputs(overrides: Partial<BuildPromptInputs> = {}): BuildPromptInputs {
  return {
    tonalityEnabled: false,
    nsfwEnabled: false,
    globalInstructions: '',
    personaInstructions: 'You are a helpful assistant.',
    aboutMe: '',
    projectInstructions: '',
    memoryContext: '',
    toolsInstruction: '',
    ...overrides,
  };
}

describe('buildPrompt', () => {
  it('returns just the persona instructions when nothing else is set', () => {
    expect(buildPrompt(inputs(), 'chat')).toBe('You are a helpful assistant.');
  });

  it('orders segments by band then position', () => {
    const out = buildPrompt(
      inputs({
        tonalityEnabled: true,
        nsfwEnabled: true,
        globalInstructions: 'GLOBAL',
        personaInstructions: 'PERSONA',
        aboutMe: 'ABOUT',
        projectInstructions: 'PROJECT',
        memoryContext: 'MEMORY',
      }),
      'chat',
    );
    // Band 1: tonality, nsfw, global, persona — Band 2: about, project, memory
    expect(out).toBe(
      [TONALITY_PROMPT, NSFW_PROMPT, 'GLOBAL', 'PERSONA', 'ABOUT', 'PROJECT', 'MEMORY'].join(
        '\n\n',
      ),
    );
  });

  it('omits the tonality segment when the toggle is off', () => {
    const out = buildPrompt(inputs({ tonalityEnabled: false, personaInstructions: 'P' }), 'chat');
    expect(out).toBe('P');
  });

  it('omits the NSFW segment when the persona is not adult', () => {
    const out = buildPrompt(inputs({ nsfwEnabled: false, personaInstructions: 'P' }), 'chat');
    expect(out).not.toContain('explicit erotica');
  });

  it('includes the NSFW segment when the persona is adult', () => {
    const out = buildPrompt(inputs({ nsfwEnabled: true, personaInstructions: 'P' }), 'chat');
    expect(out).toContain('explicit erotica');
  });

  it('skips whitespace-only free-text segments without leaving gaps', () => {
    const out = buildPrompt(
      inputs({ globalInstructions: '  \n ', personaInstructions: 'P', aboutMe: 'A' }),
      'chat',
    );
    expect(out).toBe('P\n\nA');
  });

  it('drops Band 2 and Band 3 segments for the title job', () => {
    const out = buildPrompt(
      inputs({
        tonalityEnabled: true,
        globalInstructions: 'GLOBAL',
        personaInstructions: 'PERSONA',
        aboutMe: 'ABOUT',
        projectInstructions: 'PROJECT',
        memoryContext: 'MEMORY',
      }),
      'title',
    );
    expect(out).toBe([TONALITY_PROMPT, 'GLOBAL', 'PERSONA'].join('\n\n'));
  });

  it('keeps the NSFW segment in the title job for an adult persona', () => {
    const out = buildPrompt(inputs({ nsfwEnabled: true, personaInstructions: 'P' }), 'title');
    expect(out).toContain('explicit erotica');
  });

  it('keeps the NSFW segment out of the title job for an SFW persona', () => {
    const out = buildPrompt(inputs({ nsfwEnabled: false, personaInstructions: 'P' }), 'title');
    expect(out).not.toContain('explicit erotica');
  });

  it('is idempotent for the same input', () => {
    const i = inputs({ tonalityEnabled: true, aboutMe: 'Y' });
    expect(buildPrompt(i, 'chat')).toBe(buildPrompt(i, 'chat'));
  });

  it('throws when persona instructions is empty', () => {
    expect(() => buildPrompt(inputs({ personaInstructions: '' }), 'chat')).toThrow(
      /personaInstructions/,
    );
  });
});

const baseInputs: BuildPromptInputs = {
  tonalityEnabled: false,
  nsfwEnabled: false,
  globalInstructions: '',
  personaInstructions: 'You are a helpful companion.',
  aboutMe: '',
  projectInstructions: '',
  memoryContext: '',
  toolsInstruction: '',
};

describe('tools segment', () => {
  it('includes the tools instruction in a chat prompt when present', () => {
    const out = buildPrompt(
      { ...baseInputs, toolsInstruction: 'Use calculate_js for maths.' },
      'chat',
    );
    expect(out).toContain('Use calculate_js for maths.');
  });

  it('omits the tools instruction for the title job (chat-only)', () => {
    const out = buildPrompt(
      { ...baseInputs, toolsInstruction: 'Use calculate_js for maths.' },
      'title',
    );
    expect(out).not.toContain('calculate_js');
  });

  it('drops the segment when the instruction is empty', () => {
    const out = buildPrompt(baseInputs, 'chat');
    expect(out).toBe('You are a helpful companion.');
  });
});

describe('knowledgeLibraries segment', () => {
  it('includes the knowledge awareness text in a chat prompt', () => {
    const out = buildPrompt(
      { ...baseInputs, knowledgeLibrariesContext: 'You can search: Farblehre — colour notes.' },
      'chat',
    );
    expect(out).toContain('You can search: Farblehre — colour notes.');
  });

  it('drops the segment when empty', () => {
    const out = buildPrompt({ ...baseInputs }, 'chat');
    expect(out).not.toContain('You can search');
  });

  it('drops the segment for the title job even when provided', () => {
    const out = buildPrompt(
      { ...baseInputs, knowledgeLibrariesContext: 'You can search: X.' },
      'title',
    );
    expect(out).not.toContain('You can search');
  });

  it('orders knowledge after memories', () => {
    const out = buildPrompt(
      { ...baseInputs, memoryContext: 'MEM', knowledgeLibrariesContext: 'KB' },
      'chat',
    );
    expect(out.indexOf('MEM')).toBeLessThan(out.indexOf('KB'));
  });
});
