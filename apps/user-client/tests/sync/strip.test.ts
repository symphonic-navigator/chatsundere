// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  SETTINGS_SYNC_ALLOWLIST,
  patchTouchesSyncedField,
  restoreLocalFields,
  stripForSeal,
} from '../../src/sync/strip.js';

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

  it('gives a pulled mcpServers row with no local row explicit null probe fields', () => {
    const restored = restoreLocalFields('mcpServers', { id: 'srv-1', name: 'tools' }, undefined);
    expect(restored).toEqual({
      id: 'srv-1',
      name: 'tools',
      routing: null,
      resolvedEndpoint: null,
      lastTestedAt: null,
      lastError: null,
      firstUseConsentFor: null,
    });
  });

  it("keeps this device's probe fields when a pulled mcpServers row lands on a local one", () => {
    const restored = restoreLocalFields(
      'mcpServers',
      { id: 'srv-1' },
      { id: 'srv-1', routing: 'proxy', resolvedEndpoint: 'https://s/mcp', lastTestedAt: 5 },
    ) as Record<string, unknown>;
    expect(restored.routing).toBe('proxy');
    expect(restored.resolvedEndpoint).toBe('https://s/mcp');
    expect(restored.lastError).toBeNull();
  });

  it.each([
    ['url', { url: 'https://new/mcp', allowDirect: false }],
    ['allowDirect', { url: 'https://old/mcp', allowDirect: true }],
  ])('drops the local route when the pulled row changes %s', (_field, changed) => {
    const local = {
      id: 's',
      url: 'https://old/mcp',
      allowDirect: false,
      routing: 'proxy',
      resolvedEndpoint: 'https://old/mcp',
      lastTestedAt: 5,
      lastError: null,
    };
    const restored = restoreLocalFields('mcpServers', { id: 's', ...changed }, local) as Record<
      string,
      unknown
    >;
    expect(restored.routing).toBeNull();
    expect(restored.resolvedEndpoint).toBeNull();
    expect(restored.lastTestedAt).toBeNull();
  });

  it('never takes device-local mcpServers fields from the pulled row', () => {
    const restored = restoreLocalFields(
      'mcpServers',
      { id: 's', routing: 'direct', resolvedEndpoint: 'https://evil/mcp' },
      undefined,
    ) as Record<string, unknown>;
    expect(restored.routing).toBeNull();
    expect(restored.resolvedEndpoint).toBeNull();
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

  it('strips documents embedding-pipeline fields (Finding V — one-directional vectors)', () => {
    const doc = {
      id: 'd1',
      libraryId: 'l1',
      title: 'Doc',
      content: 'body',
      embeddingStatus: 'ready',
      embeddingError: null,
      chunkCount: 3,
      triggerPhrases: [],
      updatedAt: 5,
    };
    const sealed = stripForSeal('documents', doc) as Record<string, unknown>;
    expect(sealed.title).toBe('Doc');
    expect(sealed.content).toBe('body');
    for (const field of ['embeddingStatus', 'embeddingError', 'chunkCount']) {
      expect(field in sealed).toBe(false);
    }
  });

  it('restores documents embedding-pipeline fields from the local row on open', () => {
    const local = {
      id: 'd1',
      libraryId: 'l1',
      title: 'Doc',
      content: 'body',
      embeddingStatus: 'ready',
      embeddingError: null,
      chunkCount: 3,
      triggerPhrases: [],
      updatedAt: 1,
    };
    const pulled = { id: 'd1', libraryId: 'l1', title: 'Doc', content: 'body v2', updatedAt: 5 };
    const restored = restoreLocalFields('documents', pulled, local) as Record<string, unknown>;
    expect(restored.content).toBe('body v2');
    expect(restored.embeddingStatus).toBe('ready');
    expect(restored.chunkCount).toBe(3);
  });
});

describe('chats deny-list — editingMessageId is device-local', () => {
  it('strips editingMessageId before seal', () => {
    const sealed = stripForSeal('chats', {
      id: 'c1',
      title: 'T',
      draftInput: 'half typed',
      editingMessageId: 'u7',
    }) as Record<string, unknown>;
    expect('editingMessageId' in sealed).toBe(false);
    expect('draftInput' in sealed).toBe(false);
    expect(sealed.title).toBe('T');
  });

  it('restores editingMessageId from the local row after a pull', () => {
    const restored = restoreLocalFields(
      'chats',
      { id: 'c1', title: 'T' },
      { id: 'c1', title: 'old', editingMessageId: 'u7' },
    ) as Record<string, unknown>;
    expect(restored.editingMessageId).toBe('u7');
  });

  it('a patch of only editingMessageId is not a synced mutation', () => {
    expect(patchTouchesSyncedField('chats', ['editingMessageId'])).toBe(false);
  });
});

describe('chatFontScale is device-local', () => {
  it('is absent from the settings sync allowlist', () => {
    expect(SETTINGS_SYNC_ALLOWLIST).not.toContain('chatFontScale');
  });

  it('a chatFontScale-only patch is a plain local write (not a synced field)', () => {
    expect(patchTouchesSyncedField('settings', ['chatFontScale'])).toBe(false);
  });
});

describe('mcpOAuthGrants deny-list — the write-ahead copy stays on this device', () => {
  const PENDING_FIELDS = [
    'pendingTokens',
    'pendingBaseRev',
    'pendingSpentRefresh',
    'pendingNewFamily',
  ] as const;
  const sealedBlob = { version: 1, ciphertext: new Uint8Array([9]), nonce: new Uint8Array(12) };

  it('strips every pending field before seal and keeps the synced ones', () => {
    const grant = {
      id: 'srv-1',
      issuer: 'https://auth.example',
      tokens: sealedBlob,
      claim: { deviceId: 'dev-a', at: 5 },
      pendingTokens: sealedBlob,
      pendingBaseRev: 4,
      pendingSpentRefresh: sealedBlob,
      pendingNewFamily: true,
      updatedAt: 9,
    };
    const sealed = stripForSeal('mcpOAuthGrants', grant) as Record<string, unknown>;
    for (const field of PENDING_FIELDS) expect(field in sealed).toBe(false);
    expect(sealed.issuer).toBe('https://auth.example');
    expect(sealed.tokens).toBe(sealedBlob);
    expect(sealed.claim).toEqual({ deviceId: 'dev-a', at: 5 });
  });

  it('restores the local pending fields on open', () => {
    const local = {
      id: 'srv-1',
      pendingTokens: sealedBlob,
      pendingBaseRev: 4,
      pendingSpentRefresh: null,
      pendingNewFamily: true,
    };
    const restored = restoreLocalFields(
      'mcpOAuthGrants',
      { id: 'srv-1', tokens: null },
      local,
    ) as Record<string, unknown>;
    expect(restored.pendingTokens).toBe(sealedBlob);
    expect(restored.pendingBaseRev).toBe(4);
    expect(restored.pendingSpentRefresh).toBeNull();
    expect(restored.pendingNewFamily).toBe(true);
    expect(restored.tokens).toBeNull();
  });

  it('never takes pending fields from a pulled row', () => {
    const restored = restoreLocalFields(
      'mcpOAuthGrants',
      { id: 'srv-1', pendingTokens: sealedBlob, pendingNewFamily: true },
      undefined,
    ) as Record<string, unknown>;
    expect(restored.pendingTokens).toBeNull();
    expect(restored.pendingNewFamily).toBe(false);
  });

  it("keeps generation but strips this device's high-water mark and hold", () => {
    const sealed = stripForSeal('mcpOAuthGrants', {
      id: 'srv-1',
      generation: 3,
      seenGeneration: 9,
      heldGeneration: 4,
    }) as Record<string, unknown>;
    expect(sealed.generation).toBe(3);
    expect('seenGeneration' in sealed).toBe(false);
    expect('heldGeneration' in sealed).toBe(false);
  });

  it('defaults the generation bookkeeping on a fresh device and restores it from local', () => {
    const pulled = { id: 'srv-1', generation: 3, seenGeneration: 99, heldGeneration: 1 };
    const fresh = restoreLocalFields('mcpOAuthGrants', pulled, undefined) as Record<
      string,
      unknown
    >;
    expect(fresh.seenGeneration).toBe(0);
    expect(fresh.heldGeneration).toBeNull();
    expect(fresh.generation).toBe(3);
    const kept = restoreLocalFields('mcpOAuthGrants', pulled, {
      id: 'srv-1',
      seenGeneration: 9,
      heldGeneration: 4,
    }) as Record<string, unknown>;
    expect(kept.seenGeneration).toBe(9);
    expect(kept.heldGeneration).toBe(4);
  });

  it('a pending-only patch is not a synced mutation', () => {
    expect(patchTouchesSyncedField('mcpOAuthGrants', ['pendingTokens', 'pendingBaseRev'])).toBe(
      false,
    );
    expect(patchTouchesSyncedField('mcpOAuthGrants', ['claim'])).toBe(true);
  });
});

describe('mcpServers firstUseConsentFor is device-local', () => {
  it('is stripped before seal', () => {
    const sealed = stripForSeal('mcpServers', {
      id: 's',
      url: 'https://a/mcp',
      firstUseConsentFor: 'https://a/mcp',
    }) as Record<string, unknown>;
    expect('firstUseConsentFor' in sealed).toBe(false);
  });

  it('defaults to null on a device that never approved it', () => {
    const restored = restoreLocalFields(
      'mcpServers',
      { id: 's', url: 'https://a/mcp', firstUseConsentFor: 'https://a/mcp' },
      undefined,
    ) as Record<string, unknown>;
    expect(restored.firstUseConsentFor).toBeNull();
  });

  it('keeps the local approval while the url is unchanged', () => {
    const restored = restoreLocalFields(
      'mcpServers',
      { id: 's', url: 'https://a/mcp', allowDirect: false },
      { id: 's', url: 'https://a/mcp', allowDirect: false, firstUseConsentFor: 'https://a/mcp' },
    ) as Record<string, unknown>;
    expect(restored.firstUseConsentFor).toBe('https://a/mcp');
  });

  it('resets when a pulled url differs', () => {
    const restored = restoreLocalFields(
      'mcpServers',
      { id: 's', url: 'https://b/mcp', allowDirect: false },
      { id: 's', url: 'https://a/mcp', allowDirect: false, firstUseConsentFor: 'https://a/mcp' },
    ) as Record<string, unknown>;
    expect(restored.firstUseConsentFor).toBeNull();
  });
});
