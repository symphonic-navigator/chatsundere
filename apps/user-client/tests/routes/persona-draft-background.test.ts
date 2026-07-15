// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { defaultDraft } from '../../src/routes/app/persona/persona-draft.js';

describe('defaultDraft — background helper', () => {
  it('leaves the background helper unset and the greeting-helper toggle off', () => {
    const d = defaultDraft(undefined, undefined, undefined);
    expect(d.backgroundCanonicalId).toBeNull();
    expect(d.backgroundProviderId).toBeUndefined();
    expect(d.backgroundModelId).toBeUndefined();
    expect(d.greetingUsesBackgroundModel).toBe(false);
  });
});
