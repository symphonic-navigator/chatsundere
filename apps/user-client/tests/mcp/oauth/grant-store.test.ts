// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { adoptOutcomeOf } from '../../../src/mcp/oauth/grant-store.js';

describe('adoptOutcomeOf', () => {
  it('maps an insert or a pulled win to adopted', () => {
    expect(adoptOutcomeOf({ kind: 'inserted' })).toBe('adopted');
    expect(adoptOutcomeOf({ kind: 'resolved', winner: 'pulled' })).toBe('adopted');
  });

  it('maps a refusal to refused', () => {
    expect(adoptOutcomeOf({ kind: 'refused' })).toBe('refused');
  });

  it('maps a local win, an echo and a stale record to stale', () => {
    expect(adoptOutcomeOf({ kind: 'resolved', winner: 'local' })).toBe('stale');
    expect(adoptOutcomeOf({ kind: 'echo' })).toBe('stale');
    expect(adoptOutcomeOf({ kind: 'stale' })).toBe('stale');
  });
});
