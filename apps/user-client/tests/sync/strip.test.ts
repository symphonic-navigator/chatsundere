// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { SETTINGS_SYNC_ALLOWLIST, restoreLocalFields, stripForSeal } from '../../src/sync/strip.js';

describe('strip — settings allowlist polarity (§10, Larissa I-2)', () => {
  it('seals only allowlisted fields; device-local ones never leave', () => {
    const settings = {
      id: 1,
      displayName: 'Aria',
      globalInstructions: 'be kind',
      // device-local — must NOT be sealed
      adultMode: 'nsfw',
      corsProxy: { url: 'x', sharedKey: { ciphertext: 'secret' } },
      screenEffectsEnabled: false,
      animationsEnabled: false,
      updatedAt: 100,
    };
    const sealed = stripForSeal('settings', settings) as Record<string, unknown>;
    expect(sealed.displayName).toBe('Aria');
    expect(sealed.globalInstructions).toBe('be kind');
    expect(sealed.updatedAt).toBe(100);
    expect('adultMode' in sealed).toBe(false);
    expect('corsProxy' in sealed).toBe(false);
    expect('screenEffectsEnabled' in sealed).toBe(false);
    expect('animationsEnabled' in sealed).toBe(false);
  });

  it('excludes the security-sensitive and device-local fields from the allowlist', () => {
    for (const field of [
      'adultMode',
      'corsProxy',
      'screenEffectsEnabled',
      'animationsEnabled',
      'voiceStopHintSeen',
      'spectrumEnabled',
      'id',
    ]) {
      expect(SETTINGS_SYNC_ALLOWLIST).not.toContain(field);
    }
  });

  it('keeps updatedAt in the allowlist for the M-8 replay guard', () => {
    expect(SETTINGS_SYNC_ALLOWLIST).toContain('updatedAt');
  });

  it('round-trips: an unlisted field survives locally and is never sealed', () => {
    const local = {
      id: 1,
      displayName: 'Old',
      adultMode: 'sfw',
      corsProxy: { url: 'keep-me' },
      updatedAt: 1,
    };
    // A pulled row carries only allowlisted fields (the server never saw the rest).
    const pulled = stripForSeal('settings', {
      id: 1,
      displayName: 'New',
      adultMode: 'nsfw', // if this were sealed it would clobber local — it must not be
      updatedAt: 5,
    });
    const restored = restoreLocalFields('settings', pulled, local) as Record<string, unknown>;
    expect(restored.displayName).toBe('New'); // server won the allowlisted field
    expect(restored.adultMode).toBe('sfw'); // device-local value preserved
    expect(restored.corsProxy).toEqual({ url: 'keep-me' }); // device-local secret preserved
    expect(restored.id).toBe(1);
  });
});

describe('strip — deny-list collections (§10)', () => {
  it('strips mcpServers device-probe fields', () => {
    const server = {
      id: 'srv-1',
      name: 'tools',
      allowDirect: true, // user intent — syncs
      routing: 'direct', // probe result — stripped
      resolvedEndpoint: 'http://x', // stripped
      lastTestedAt: 123, // stripped
      lastError: 'boom', // stripped
      updatedAt: 9,
    };
    const sealed = stripForSeal('mcpServers', server) as Record<string, unknown>;
    expect(sealed.allowDirect).toBe(true);
    expect(sealed.name).toBe('tools');
    expect('routing' in sealed).toBe(false);
    expect('resolvedEndpoint' in sealed).toBe(false);
    expect('lastTestedAt' in sealed).toBe(false);
    expect('lastError' in sealed).toBe(false);
  });

  it('strips chats transient + derived fields', () => {
    const chat = {
      id: 'c1',
      title: 'Hi',
      draftInput: 'typing…',
      openerPending: true,
      compactionToastShown: true,
      lastMessageAt: 55,
      bookmarkedMessageCount: 3,
      activeCompactionId: 'cp1',
      updatedAt: 7,
    };
    const sealed = stripForSeal('chats', chat) as Record<string, unknown>;
    expect(sealed.title).toBe('Hi');
    for (const field of [
      'draftInput',
      'openerPending',
      'compactionToastShown',
      'lastMessageAt',
      'bookmarkedMessageCount',
      'activeCompactionId',
    ]) {
      expect(field in sealed).toBe(false);
    }
  });

  it('restores deny-listed fields from the local row on open', () => {
    const local = { id: 'c1', title: 'old', draftInput: 'keep', lastMessageAt: 999, updatedAt: 1 };
    const pulled = { id: 'c1', title: 'new', updatedAt: 5 };
    const restored = restoreLocalFields('chats', pulled, local) as Record<string, unknown>;
    expect(restored.title).toBe('new');
    expect(restored.draftInput).toBe('keep');
    expect(restored.lastMessageAt).toBe(999);
  });

  it('does not strip unknown/new fields on non-settings collections (sync by default)', () => {
    const persona = { id: 'p1', name: 'x', updatedAt: 1, brandNewField: 'travels' };
    const sealed = stripForSeal('personas', persona) as Record<string, unknown>;
    expect(sealed.brandNewField).toBe('travels');
  });

  it('returns pulled unchanged when no local row exists', () => {
    const pulled = { id: 'c9', title: 'fresh', updatedAt: 3 };
    expect(restoreLocalFields('chats', pulled, undefined)).toEqual(pulled);
  });
});
