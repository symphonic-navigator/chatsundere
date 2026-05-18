// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { deriveDek } from '../src/dek.js';
import { asMasterKey } from '../src/types.js';

const MK = asMasterKey(Uint8Array.from(Array.from({ length: 32 }, (_, i) => i)));

describe('deriveDek', () => {
  it('returns a 32-byte DEK', async () => {
    const dek = await deriveDek(MK, 'vault/conversations');
    expect(dek.length).toBe(32);
  });

  it('is deterministic per context', async () => {
    const a = await deriveDek(MK, 'vault/conversations');
    const b = await deriveDek(MK, 'vault/conversations');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('produces distinct DEKs for distinct contexts', async () => {
    const a = await deriveDek(MK, 'vault/conversations');
    const b = await deriveDek(MK, 'vault/personas');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('rejects empty contexts', async () => {
    await expect(deriveDek(MK, '')).rejects.toThrow();
  });
});
