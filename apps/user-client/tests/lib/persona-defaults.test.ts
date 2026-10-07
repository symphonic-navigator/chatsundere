// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PERSONA_INSTRUCTIONS,
  instructionsOrDefault,
} from '../../src/lib/persona-defaults.js';
import { defaultDraft } from '../../src/routes/app/persona/persona-draft.js';

describe('persona defaults', () => {
  it('the default instruction is the friendly-assistant line', () => {
    expect(DEFAULT_PERSONA_INSTRUCTIONS).toBe('You are a friendly assistant.');
  });

  it('a new draft starts with the default instruction', () => {
    expect(defaultDraft(undefined, undefined, undefined).instructions).toBe(
      DEFAULT_PERSONA_INSTRUCTIONS,
    );
  });

  it('instructionsOrDefault keeps real imported instructions', () => {
    expect(instructionsOrDefault('Be a pirate.')).toBe('Be a pirate.');
  });

  it('instructionsOrDefault falls back to the default for empty or blank imports', () => {
    expect(instructionsOrDefault('')).toBe(DEFAULT_PERSONA_INSTRUCTIONS);
    expect(instructionsOrDefault('   \n ')).toBe(DEFAULT_PERSONA_INSTRUCTIONS);
  });
});
