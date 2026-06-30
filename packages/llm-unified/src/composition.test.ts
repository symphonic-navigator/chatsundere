// SPDX-License-Identifier: LGPL-3.0-only

import { describe, expect, it } from 'bun:test';
import { type BuildPromptInputs, buildPrompt } from './composition.js';
import {
  NSFW_PROMPT,
  ROLEPLAY_BEHAVIOUR_PROMPT,
  TONALITY_PROMPT,
} from './identity/chatsundere-identity.js';
import { SCREEN_EFFECTS_PROMPT } from './integrations/index.js';
import { TEAL_EXPRESSION_PROMPT } from './teal/teal.js';

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
    modelInstructions: '',
    screenEffectsEnabled: false,
    ...overrides,
  };
}

describe('buildPrompt', () => {
  it('returns just the persona instructions when nothing else is set', () => {
    // TEAL is always present in the chat job; use title (no spoken text, D8) to
    // verify that no other optional segment resolves when all toggles are off.
    expect(buildPrompt(inputs(), 'title')).toBe('You are a helpful assistant.');
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
    // Band 1: tonality, nsfw, global, teal (always-on), persona (roleplay absent — disabled) — Band 2 before Band 3
    expect(out).toBe(
      [
        TONALITY_PROMPT,
        NSFW_PROMPT,
        'GLOBAL',
        TEAL_EXPRESSION_PROMPT,
        'PERSONA',
        'ABOUT',
        'PROJECT',
        'MEMORY',
      ].join('\n\n'),
    );
  });

  it('omits the tonality segment when the toggle is off', () => {
    const out = buildPrompt(inputs({ tonalityEnabled: false, personaInstructions: 'P' }), 'chat');
    expect(out).not.toContain(TONALITY_PROMPT);
    expect(out).toContain('P');
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
    // Whitespace-only global must not leave a blank gap between segments.
    expect(out).not.toContain('\n\n\n');
    expect(out).toContain('P');
    expect(out).toContain('A');
    expect(out.indexOf('P')).toBeLessThan(out.indexOf('A'));
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
  modelInstructions: '',
  screenEffectsEnabled: false,
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
    // No tools instruction — the tools segment must be absent.
    expect(out).not.toContain('calculate_js');
    expect(out).toContain('You are a helpful companion.');
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
    // No lore context provided — the lore segment must be absent.
    expect(out).not.toContain('LORE');
    expect(out).toContain('P');
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

describe('teal segment', () => {
  it('is always present in chat and greeting', () => {
    for (const job of ['chat', 'greeting'] as const) {
      const out = buildPrompt(inputs({}), job);
      expect(out).toContain('Expressive delivery');
    }
  });

  it('is absent from title and memory jobs', () => {
    for (const job of ['title', 'memory'] as const) {
      const out = buildPrompt(inputs({}), job);
      expect(out).not.toContain('Expressive delivery');
    }
  });

  it('sits before roleplay, which stays directly before persona', () => {
    const out = buildPrompt(
      inputs({
        roleplayEnabled: true,
        personaInstructions: 'PERSONA-MARK',
      }),
      'chat',
    );
    const tealIdx = out.indexOf('Expressive delivery');
    const rpIdx = out.indexOf('roleplay mode');
    const pIdx = out.indexOf('PERSONA-MARK');
    expect(tealIdx).toBeGreaterThanOrEqual(0);
    expect(tealIdx).toBeLessThan(rpIdx);
    expect(rpIdx).toBeLessThan(pIdx);
    // Nothing between the end of the roleplay block and the start of persona.
    const rpEnd = out.indexOf(ROLEPLAY_BEHAVIOUR_PROMPT) + ROLEPLAY_BEHAVIOUR_PROMPT.length;
    expect(out.slice(rpEnd, pIdx)).toBe('\n\n');
  });
});

describe('openerEcho segment', () => {
  it('echoes the opener in Band 2 on a chat job when openerContext is set', () => {
    const out = buildPrompt(
      { ...baseInputs, openerContext: 'Hello, traveller. I am glad you came.' },
      'chat',
    );
    expect(out).toContain('You opened this conversation by greeting the user');
    expect(out).toContain('Hello, traveller. I am glad you came.');
  });

  it('omits the opener echo on greeting and title jobs', () => {
    expect(buildPrompt({ ...baseInputs, openerContext: 'Hi.' }, 'greeting')).not.toContain(
      'You opened this conversation',
    );
    expect(buildPrompt({ ...baseInputs, openerContext: 'Hi.' }, 'title')).not.toContain(
      'You opened this conversation',
    );
  });

  it('omits the opener echo when openerContext is empty', () => {
    expect(buildPrompt({ ...baseInputs, openerContext: '' }, 'chat')).not.toContain(
      'You opened this conversation',
    );
  });
});

describe('modelInstructions segment', () => {
  it('is present in chat and greeting when provided', () => {
    for (const job of ['chat', 'greeting'] as const) {
      const out = buildPrompt(inputs({ modelInstructions: 'MODEL-MARK' }), job);
      expect(out).toContain('MODEL-MARK');
    }
  });

  it('is absent from title and memory jobs even when provided', () => {
    for (const job of ['title', 'memory'] as const) {
      const out = buildPrompt(inputs({ modelInstructions: 'MODEL-MARK' }), job);
      expect(out).not.toContain('MODEL-MARK');
    }
  });

  it('sits after teal and before roleplay, with persona last', () => {
    const out = buildPrompt(
      inputs({
        modelInstructions: 'MODEL-MARK',
        roleplayEnabled: true,
        personaInstructions: 'PERSONA-MARK',
      }),
      'chat',
    );
    const tealIdx = out.indexOf('Expressive delivery');
    const miIdx = out.indexOf('MODEL-MARK');
    const rpIdx = out.indexOf('roleplay mode');
    const pIdx = out.indexOf('PERSONA-MARK');
    expect(tealIdx).toBeGreaterThanOrEqual(0);
    expect(tealIdx).toBeLessThan(miIdx);
    expect(miIdx).toBeLessThan(rpIdx);
    expect(rpIdx).toBeLessThan(pIdx);
  });

  it('drops the segment when the string is empty', () => {
    const out = buildPrompt(inputs({}), 'chat');
    expect(out).not.toContain('MODEL-MARK');
  });
});

describe('screen-effects prompt segment', () => {
  it('is injected for chat when enabled', () => {
    const out = buildPrompt(inputs({ screenEffectsEnabled: true }), 'chat');
    expect(out).toContain(SCREEN_EFFECTS_PROMPT);
  });

  it('is omitted when disabled (gated on the toggle)', () => {
    const out = buildPrompt(inputs({ screenEffectsEnabled: false }), 'chat');
    expect(out).not.toContain('emoji-shower');
  });

  it('is omitted for title and memory jobs even when enabled', () => {
    expect(buildPrompt(inputs({ screenEffectsEnabled: true }), 'title')).not.toContain(
      'emoji-shower',
    );
    expect(buildPrompt(inputs({ screenEffectsEnabled: true }), 'memory')).not.toContain(
      'emoji-shower',
    );
  });
});
