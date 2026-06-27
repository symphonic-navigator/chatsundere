// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { PersonaRow } from '../../src/boot/client-data-db.js';
import {
  fontVoiceMeta,
  instructionsMeta,
  integrationsMeta,
  isPersonaIncomplete,
  knowledgeMeta,
  memoryMeta,
  mindspaceMeta,
  missingRequirement,
  modelBehaviourMeta,
  roleplayMeta,
} from '../../src/lib/persona-hub.js';

const base = {
  instructions: 'be kind',
  canonicalId: 'c',
  providerId: 'p',
  modelId: 'm',
  chatsundereTonality: true,
  adultPersona: false,
  roleplay: false,
  narration: 'first',
  greetingEnabled: false,
  temperature: 0.85,
  askExpertDefault: false,
  mcpOverrides: {},
  libraryIds: [],
  useMemory: true,
  font: 'serif',
  voice: null,
  mindspaceId: null,
  textureOverride: null,
} as unknown as PersonaRow;

describe('isPersonaIncomplete / missingRequirement', () => {
  it('returns false / null for a fully configured persona', () => {
    expect(isPersonaIncomplete(base)).toBe(false);
    expect(missingRequirement(base)).toBeNull();
  });

  it('flags missing modelId', () => {
    expect(missingRequirement({ ...base, modelId: '' })).toBe('model');
  });

  it('flags whitespace-only instructions', () => {
    expect(missingRequirement({ ...base, instructions: '  ' })).toBe('instructions');
  });

  it('reports model before instructions when both are missing', () => {
    expect(missingRequirement({ ...base, modelId: '', instructions: '' })).toBe('model');
  });
});

describe('meta lines', () => {
  it('instructionsMeta — Chatsundere voice baseline', () => {
    expect(instructionsMeta(base)).toBe('Chatsundere voice');
  });

  it('instructionsMeta — adult flag appended', () => {
    expect(instructionsMeta({ ...base, adultPersona: true })).toBe('Chatsundere voice · Adult');
  });

  it('instructionsMeta — plain voice when tonality disabled', () => {
    expect(instructionsMeta({ ...base, chatsundereTonality: false })).toBe('Plain voice');
  });

  it('instructionsMeta — needs setup when instructions empty', () => {
    expect(instructionsMeta({ ...base, instructions: '' })).toBe('Needs setup');
  });

  it('roleplayMeta — off baseline', () => {
    expect(roleplayMeta(base)).toBe('Off');
  });

  it('roleplayMeta — first person', () => {
    expect(roleplayMeta({ ...base, roleplay: true })).toBe('First person');
  });

  it('roleplayMeta — third person with greeting', () => {
    expect(
      roleplayMeta({ ...base, roleplay: true, narration: 'third', greetingEnabled: true }),
    ).toBe('Third person · Greeting');
  });

  it('modelBehaviourMeta — temperature only', () => {
    expect(modelBehaviourMeta(base)).toBe('Temp 0.85');
  });

  it('modelBehaviourMeta — with expert flag', () => {
    expect(modelBehaviourMeta({ ...base, askExpertDefault: true })).toBe('Temp 0.85 · Expert');
  });

  it('integrationsMeta — default tools', () => {
    expect(integrationsMeta(base)).toBe('Default tools');
  });

  it('integrationsMeta — single override', () => {
    expect(integrationsMeta({ ...base, mcpOverrides: { s1: {} } as never })).toBe('1 override');
  });

  it('integrationsMeta — plural overrides', () => {
    expect(integrationsMeta({ ...base, mcpOverrides: { s1: {}, s2: {} } as never })).toBe(
      '2 overrides',
    );
  });

  it('knowledgeMeta — single library', () => {
    expect(knowledgeMeta({ ...base, libraryIds: ['a'] })).toBe('1 library');
  });

  it('knowledgeMeta — no libraries', () => {
    expect(knowledgeMeta(base)).toBe('No libraries');
  });

  it('knowledgeMeta — two libraries', () => {
    expect(knowledgeMeta({ ...base, libraryIds: ['a', 'b'] })).toBe('2 libraries');
  });

  it('memoryMeta — remembering', () => {
    expect(memoryMeta(base)).toBe('Remembering');
  });

  it('memoryMeta — off when disabled', () => {
    expect(memoryMeta({ ...base, useMemory: false })).toBe('Off');
  });

  it('memoryMeta — defaults to remembering when undefined', () => {
    expect(memoryMeta({ ...base, useMemory: undefined } as never)).toBe('Remembering');
  });

  it('fontVoiceMeta — font only', () => {
    expect(fontVoiceMeta(base)).toBe('Serif');
  });

  it('fontVoiceMeta — font with voice', () => {
    expect(fontVoiceMeta({ ...base, voice: 'aria' })).toBe('Serif · Voice');
  });

  it('mindspaceMeta — user default when no mindspaceId', () => {
    expect(mindspaceMeta(base, [])).toBe('User default');
  });

  it('mindspaceMeta — falls back when id set but not found', () => {
    expect(mindspaceMeta({ ...base, mindspaceId: 'missing' }, [])).toBe('User default');
  });

  it('mindspaceMeta — resolves displayName by id', () => {
    expect(
      mindspaceMeta({ ...base, mindspaceId: 'x' }, [{ id: 'x', displayName: 'Moonlit' }] as never),
    ).toBe('Moonlit');
  });
});
