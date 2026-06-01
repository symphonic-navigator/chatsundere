// SPDX-License-Identifier: AGPL-3.0-only
import { type MasterKey, asMasterKey, getRandomBytes } from '@chatsundere/crypto';
import { describe, expect, it } from 'vitest';
import { createCredentialBus } from '../../src/credentials/credential-bus.js';
import type { CredentialSource } from '../../src/credentials/types.js';

const mk: MasterKey = asMasterKey(getRandomBytes(32));

/** A fake source that serves exactly one id with one key. */
function fakeSource(servedId: string, key: string): CredentialSource {
  return {
    kind: 'fake',
    has: async (id) => id === servedId,
    get: async (id) => (id === servedId ? key : null),
  };
}

describe('createCredentialBus', () => {
  it('hasCredential is true when any source serves the id', async () => {
    const bus = createCredentialBus([fakeSource('nano-gpt', 'k')]);
    expect(await bus.hasCredential('nano-gpt')).toBe(true);
  });

  it('hasCredential is false for an unknown id', async () => {
    const bus = createCredentialBus([fakeSource('nano-gpt', 'k')]);
    expect(await bus.hasCredential('unknown')).toBe(false);
  });

  it('getCredentialKey returns the first non-null source result', async () => {
    const bus = createCredentialBus([
      fakeSource('other', 'wrong'),
      fakeSource('nano-gpt', 'right'),
    ]);
    expect(await bus.getCredentialKey('nano-gpt', mk)).toBe('right');
  });

  it('getCredentialKey returns null for an unknown id', async () => {
    const bus = createCredentialBus([fakeSource('nano-gpt', 'k')]);
    expect(await bus.getCredentialKey('unknown', mk)).toBeNull();
  });

  it('first-match: an earlier source wins over a later one', async () => {
    const bus = createCredentialBus([
      fakeSource('nano-gpt', 'first'),
      fakeSource('nano-gpt', 'second'),
    ]);
    expect(await bus.getCredentialKey('nano-gpt', mk)).toBe('first');
  });

  it('forwards the MasterKey to the source on retrieval', async () => {
    let receivedMk: MasterKey | null = null;
    const recordingSource: CredentialSource = {
      kind: 'recording',
      has: async () => true,
      get: async (_id, sourceMk) => {
        receivedMk = sourceMk;
        return 'k';
      },
    };
    const bus = createCredentialBus([recordingSource]);
    await bus.getCredentialKey('nano-gpt', mk);
    expect(receivedMk).toBe(mk);
  });
});
