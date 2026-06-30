// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { preprocessIntegrations } from '../../../src/lib/integrations/preprocess-integrations.js';
import { TEAL_MARK_END, TEAL_MARK_START } from '../../../src/lib/teal/preprocess-teal.js';

describe('preprocessIntegrations', () => {
  it('replaces a shower tag with marked glow display', () => {
    const out = preprocessIntegrations('yay [sfx:emoji-shower 🔥🦊💖]');
    expect(out).toBe(
      `yay ${TEAL_MARK_START}sfx-glow${TEAL_MARK_END}🚿🔥🦊💖🚿${TEAL_MARK_START}/sfx-glow${TEAL_MARK_END}`,
    );
  });

  it('leaves an unknown command literal', () => {
    expect(preprocessIntegrations('[sfx:confetti 🎉]')).toBe('[sfx:confetti 🎉]');
  });

  it('does not touch tags inside code spans', () => {
    expect(preprocessIntegrations('`[sfx:emoji-shower 🔥]`')).toBe('`[sfx:emoji-shower 🔥]`');
  });
});
