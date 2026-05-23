// SPDX-License-Identifier: LGPL-3.0-only

import { describe, expect, it } from 'bun:test';
import { type CompositionLayers, composeSystemPrompt } from './composition.js';

function baseLayers(overrides: Partial<CompositionLayers> = {}): CompositionLayers {
  return {
    globalUnlocker: '',
    aboutMe: '',
    personaInstructions: 'You are a helpful assistant.',
    projectInstructions: '',
    memoryContext: '',
    ...overrides,
  };
}

describe('composeSystemPrompt', () => {
  it('returns just the persona instructions when only that layer is set', () => {
    const out = composeSystemPrompt(baseLayers());
    expect(out).toBe('You are a helpful assistant.');
  });

  it('joins layers in the spec-defined order with blank-line separators', () => {
    const out = composeSystemPrompt(
      baseLayers({
        globalUnlocker: 'The user is an adult.',
        aboutMe: 'Chris is a backend developer.',
        personaInstructions: 'You are Aurum.',
        projectInstructions: 'This project explores mindspace textures.',
        memoryContext: 'Previously: discussed cloudy textures.',
      }),
    );
    expect(out).toBe(
      'The user is an adult.\n\nChris is a backend developer.\n\nYou are Aurum.\n\nThis project explores mindspace textures.\n\nPreviously: discussed cloudy textures.',
    );
  });

  it('skips empty layers without leaving blank-line gaps', () => {
    const out = composeSystemPrompt(
      baseLayers({
        globalUnlocker: 'NSFW allowed.',
        personaInstructions: 'You are Aurum.',
      }),
    );
    expect(out).toBe('NSFW allowed.\n\nYou are Aurum.');
  });

  it('treats whitespace-only layers as empty', () => {
    const out = composeSystemPrompt(
      baseLayers({
        aboutMe: '   \n  ',
        personaInstructions: 'You are Aurum.',
      }),
    );
    expect(out).toBe('You are Aurum.');
  });

  it('is idempotent — composing twice with the same input yields the same output', () => {
    const layers = baseLayers({ globalUnlocker: 'X', aboutMe: 'Y' });
    expect(composeSystemPrompt(layers)).toBe(composeSystemPrompt(layers));
  });

  it('throws when persona instructions is empty', () => {
    expect(() => composeSystemPrompt(baseLayers({ personaInstructions: '' }))).toThrow(
      /personaInstructions/,
    );
  });
});
