import { describe, expect, it } from 'vitest';
import { resolveCleanupProfile } from '../../../src/lib/voice/voice-filter.js';

describe('resolveCleanupProfile', () => {
  it('auto with a recommendation uses the recommended cut-off', () => {
    expect(resolveCleanupProfile('auto', 50)).toEqual({ kind: 'highpass', hz: 50 });
    expect(resolveCleanupProfile('auto', 100)).toEqual({ kind: 'highpass', hz: 100 });
  });

  it('auto with no recommendation is plain (no filtering)', () => {
    expect(resolveCleanupProfile('auto', undefined)).toEqual({ kind: 'plain' });
  });

  it('off is always plain regardless of recommendation', () => {
    expect(resolveCleanupProfile('off', 50)).toEqual({ kind: 'plain' });
    expect(resolveCleanupProfile('off', undefined)).toEqual({ kind: 'plain' });
  });

  it('an explicit Hz value overrides the recommendation', () => {
    expect(resolveCleanupProfile(100, 50)).toEqual({ kind: 'highpass', hz: 100 });
    expect(resolveCleanupProfile(50, undefined)).toEqual({ kind: 'highpass', hz: 50 });
  });
});
