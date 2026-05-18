// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { createMasterKeySession } from '../src/session.js';
import { asMasterKey } from '../src/types.js';

const MK = asMasterKey(Uint8Array.from(Array.from({ length: 32 }, (_, i) => i)));

describe('MasterKeySession', () => {
  it('exposes mode, userId, username, online', () => {
    const session = createMasterKeySession({
      mk: MK,
      userId: 'local-uuid',
      username: 'alice',
      mode: 'local',
      online: false,
    });
    expect(session.mode).toBe('local');
    expect(session.username).toBe('alice');
    expect(session.online).toBe(false);
  });

  it('derives a DEK and encrypts/decrypts under it', async () => {
    const session = createMasterKeySession({
      mk: MK,
      userId: 'u',
      username: 'alice',
      mode: 'local',
      online: false,
    });
    const { ciphertext, nonce } = await session.encrypt(
      new TextEncoder().encode('secret'),
      'vault/test',
    );
    const decrypted = await session.decrypt({ ciphertext, nonce, context: 'vault/test' });
    expect(new TextDecoder().decode(decrypted)).toBe('secret');
  });

  it('close() zeros the MK buffer (best-effort)', () => {
    const mkCopy = new Uint8Array(MK);
    const session = createMasterKeySession({
      mk: asMasterKey(mkCopy),
      userId: 'u',
      username: 'alice',
      mode: 'local',
      online: false,
    });
    session.close();
    expect(mkCopy.every((b) => b === 0)).toBe(true);
  });
});
