// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import {
  ROLEPLAY_BEHAVIOUR_PROMPT,
  ROLEPLAY_NSFW_PROMPT,
  roleplayFormattingPrompt,
} from './chatsundere-identity.js';

describe('roleplay identity texts', () => {
  test('first-person formatting block narrates from the character perspective', () => {
    const text = roleplayFormattingPrompt('first', 'Grisnelda');
    expect(text).toContain('never breaks character');
    expect(text).toContain('between asterisks');
    expect(text).toContain('first person');
    expect(text).toContain('*I sit down on the floor');
    expect(text).not.toContain('Grisnelda sits down');
  });

  test('third-person formatting block templates the persona name', () => {
    const text = roleplayFormattingPrompt('third', 'Grisnelda');
    expect(text).toContain('third person');
    expect(text).toContain('describing Grisnelda from the outside');
    expect(text).toContain('*Grisnelda sits down on the floor');
  });

  test('behaviour and NSFW blocks carry their key clauses', () => {
    expect(ROLEPLAY_BEHAVIOUR_PROMPT).toContain('answers concisely');
    expect(ROLEPLAY_BEHAVIOUR_PROMPT).toContain('not repetitive');
    expect(ROLEPLAY_NSFW_PROMPT).toContain('fully permitted and welcomed');
  });
});
