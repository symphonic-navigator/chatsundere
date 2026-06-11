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
    // Band 1: tonality, nsfw, global, persona — Band 2 before Band 3
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

describe('lore segment', () => {
  it('places the lore segment after memories and before knowledge libraries', () => {
    const out = buildPrompt(
      inputs({
        personaInstructions: 'P',
        memoryContext: 'MEM',
        loreContext: 'LORE',
        knowledgeLibrariesContext: 'KB',
      }),
      'chat',
    );
    expect(out.indexOf('MEM')).toBeLessThan(out.indexOf('LORE'));
    expect(out.indexOf('LORE')).toBeLessThan(out.indexOf('KB'));
  });

  it('omits the lore segment when empty', () => {
    const out = buildPrompt(inputs({ personaInstructions: 'P' }), 'chat');
    expect(out).toBe('P');
  });

  it('drops the lore segment for the title job', () => {
    const out = buildPrompt(inputs({ personaInstructions: 'P', loreContext: 'LORE' }), 'title');
    expect(out).toBe('P');
  });
});

describe('roleplay segment', () => {
  it('absent when roleplayEnabled is false/undefined', () => {
    const out = buildPrompt(inputs({}), 'chat');
    expect(out).not.toContain('roleplay mode');
  });

  it('present and ordered between global and persona instructions', () => {
    const out = buildPrompt(
      inputs({
        roleplayEnabled: true,
        narration: 'first',
        personaName: 'Grisnelda',
        globalInstructions: 'GLOBAL-MARK',
        personaInstructions: 'PERSONA-MARK',
      }),
      'chat',
    );
    const gi = out.indexOf('GLOBAL-MARK');
    const rp = out.indexOf('roleplay mode');
    const pi = out.indexOf('PERSONA-MARK');
    expect(gi).toBeGreaterThanOrEqual(0);
    expect(rp).toBeGreaterThan(gi);
    expect(pi).toBeGreaterThan(rp);
    expect(out).toContain('Further facts about the assistant');
    expect(out).not.toContain('kinks and fetishes');
  });

  it('NSFW re-unlock block rides adultPersona', () => {
    const out = buildPrompt(inputs({ roleplayEnabled: true, nsfwEnabled: true }), 'chat');
    expect(out).toContain('kinks and fetishes');
  });

  it('third-person narration templates the persona name', () => {
    const out = buildPrompt(
      inputs({ roleplayEnabled: true, narration: 'third', personaName: 'Grisnelda' }),
      'chat',
    );
    expect(out).toContain('describing Grisnelda from the outside');
  });
});

describe('greeting job', () => {
  it('includes Band 1 + About Me, drops lore/knowledge/tools', () => {
    const out = buildPrompt(
      inputs({
        roleplayEnabled: true,
        aboutMe: 'ABOUT-MARK',
        loreContext: 'LORE-MARK',
        knowledgeLibrariesContext: 'KB-MARK',
        toolsInstruction: 'TOOLS-MARK',
        projectInstructions: 'PROJECT-MARK',
        memoryContext: 'MEMORY-MARK',
      }),
      'greeting',
    );
    expect(out).toContain('ABOUT-MARK');
    expect(out).toContain('roleplay mode');
    expect(out).not.toContain('LORE-MARK');
    expect(out).not.toContain('KB-MARK');
    expect(out).not.toContain('TOOLS-MARK');
    expect(out).not.toContain('PROJECT-MARK');
    expect(out).not.toContain('MEMORY-MARK');
  });
});
