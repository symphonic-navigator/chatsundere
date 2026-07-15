// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { PersonaRow } from '../../src/boot/client-data-db.js';
import {
  greetingHelperGate,
  mainModelUnsuitableAsWorker,
  showBackgroundHelperWarning,
} from '../../src/lib/persona-hub.js';

/** Minimal persona carrying only the fields these helpers read. */
function persona(over: Partial<PersonaRow>): PersonaRow {
  return {
    canonicalId: null,
    backgroundCanonicalId: null,
    roleplay: false,
    greetingEnabled: false,
    ...over,
  } as unknown as PersonaRow;
}

const withHelper = {
  backgroundCanonicalId: 'glm-5',
  backgroundProviderId: 'row-1',
  backgroundModelId: 'zai/glm-5',
};

describe('mainModelUnsuitableAsWorker', () => {
  it('is true for a flagged (DeepSeek) main model, false otherwise', () => {
    expect(mainModelUnsuitableAsWorker(persona({ canonicalId: 'deepseek-v3.2' }))).toBe(true);
    expect(mainModelUnsuitableAsWorker(persona({ canonicalId: 'glm-5' }))).toBe(false);
    expect(mainModelUnsuitableAsWorker(persona({ canonicalId: null }))).toBe(false);
    expect(mainModelUnsuitableAsWorker(persona({ canonicalId: 'unknown-id' }))).toBe(false);
  });
});

describe('showBackgroundHelperWarning', () => {
  it('shows only when the main model is flagged AND no helper is set', () => {
    // flagged, no helper → warn
    expect(showBackgroundHelperWarning(persona({ canonicalId: 'deepseek-v3.2' }))).toBe(true);
    // flagged, helper set → cleared
    expect(
      showBackgroundHelperWarning(persona({ canonicalId: 'deepseek-v3.2', ...withHelper })),
    ).toBe(false);
    // not flagged, no helper → no warn
    expect(showBackgroundHelperWarning(persona({ canonicalId: 'glm-5' }))).toBe(false);
    // no main model chosen yet → no warn
    expect(showBackgroundHelperWarning(persona({ canonicalId: null }))).toBe(false);
  });
});

describe('greetingHelperGate', () => {
  it('names roleplay-off as the first blocker (even when the helper is also unset)', () => {
    const g = greetingHelperGate(persona({ roleplay: false }));
    expect(g.disabled).toBe(true);
    expect(g.reason).toBe('Enable Roleplay to set a greeting');
  });

  it('names greeting-off next when roleplay is on', () => {
    const g = greetingHelperGate(persona({ roleplay: true, greetingEnabled: false }));
    expect(g.disabled).toBe(true);
    expect(g.reason).toBe('Turn the greeting on first');
  });

  it('names the missing helper last, pointing at the main screen', () => {
    const g = greetingHelperGate(persona({ roleplay: true, greetingEnabled: true }));
    expect(g.disabled).toBe(true);
    expect(g.reason).toBe("Set a background helper on the persona's main screen first");
  });

  it('is enabled once roleplay, greeting, and a helper are all present', () => {
    const g = greetingHelperGate(persona({ roleplay: true, greetingEnabled: true, ...withHelper }));
    expect(g.disabled).toBe(false);
    expect(g.reason).toBeUndefined();
  });
});
