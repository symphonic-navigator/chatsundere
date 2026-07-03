// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { syncCopy } from '../../src/sync/copy.js';

describe('syncCopy catalogue (§11.3)', () => {
  it('interpolates quota_exceeded with human-readable used/quota bytes', () => {
    const msg = syncCopy.attention.quotaExceeded({
      usedBytes: 1_572_864,
      quotaBytes: 10_485_760,
    });
    expect(msg).toContain('1.5 MB');
    expect(msg).toContain('10 MB');
    expect(msg).toContain('ask your operator');
  });

  it('interpolates the tombstone threshold count with singular/plural', () => {
    expect(syncCopy.attention.tombstoneThreshold(1)).toContain('1 item was');
    expect(syncCopy.attention.tombstoneThreshold(42)).toContain('42 items were');
    expect(syncCopy.attention.tombstoneThreshold(42)).toContain('30 days');
  });

  it('pluralises the waiting status line', () => {
    expect(syncCopy.status.waiting(1)).toBe('1 change waiting');
    expect(syncCopy.status.waiting(3)).toBe('3 changes waiting');
  });

  it('carries the six §11.1 status-line states', () => {
    expect(syncCopy.status.synced).toBe('Synced');
    expect(syncCopy.status.offline).toContain('queued');
    expect(syncCopy.status.pulling).toContain('Pulling your data');
    expect(syncCopy.status.recovery).toContain('your data is safe');
  });

  it('carries the two-tier settings notes and the gentle bookmark copy', () => {
    expect(syncCopy.settings.applied).toContain('settings were applied');
    expect(syncCopy.settings.precedence).toContain('took precedence');
    expect(syncCopy.offlineBookmark).toContain('need your server');
  });

  it('carries the remaining attention + conflict entries', () => {
    expect(syncCopy.attention.recordTooLarge).toContain('too large');
    expect(syncCopy.attention.deleteRateLimited).toContain('lot of deleting');
    expect(syncCopy.attention.recoveryPaused).toContain('paused');
    expect(syncCopy.attention.tamper).toContain('refused');
    expect(syncCopy.conflictLost).toContain('its version was kept');
  });
});
