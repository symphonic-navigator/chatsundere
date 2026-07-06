// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { deriveDek } from '../src/dek.js';
import { deriveIdentityTag, identityTagFromDek } from '../src/identity-tag.js';
import { asMasterKey } from '../src/types.js';

const MK_A = asMasterKey(Uint8Array.from(Array.from({ length: 32 }, (_, i) => i)));
const MK_B = asMasterKey(Uint8Array.from(Array.from({ length: 32 }, (_, i) => i + 100)));
const CTX = 'client-data/identity-binding-v1';

describe('deriveIdentityTag', () => {
  it('returns a 64-char lowercase hex string (SHA-256)', async () => {
    const tag = await deriveIdentityTag(MK_A, CTX);
    expect(tag).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic per (master key, context)', async () => {
    const a = await deriveIdentityTag(MK_A, CTX);
    const b = await deriveIdentityTag(MK_A, CTX);
    expect(a).toBe(b);
  });

  it('differs across master keys (binds to identity)', async () => {
    const a = await deriveIdentityTag(MK_A, CTX);
    const b = await deriveIdentityTag(MK_B, CTX);
    expect(a).not.toBe(b);
  });

  it('differs across contexts (domain separation)', async () => {
    const a = await deriveIdentityTag(MK_A, CTX);
    const b = await deriveIdentityTag(MK_A, 'other/context-v1');
    expect(a).not.toBe(b);
  });

  it('is one-way: reveals neither the master key nor the raw DEK', async () => {
    const tag = await deriveIdentityTag(MK_A, CTX);
    const mkHex = Buffer.from(MK_A).toString('hex');
    const dekHex = Buffer.from(await deriveDek(MK_A, CTX)).toString('hex');
    expect(tag).not.toBe(mkHex);
    expect(tag).not.toBe(dekHex);
  });

  it('rejects an empty context', async () => {
    await expect(deriveIdentityTag(MK_A, '')).rejects.toThrow();
  });

  it('identityTagFromDek matches deriveIdentityTag for the same DEK (encapsulated path)', async () => {
    const viaMk = await deriveIdentityTag(MK_A, CTX);
    const viaDek = await identityTagFromDek(await deriveDek(MK_A, CTX));
    expect(viaDek).toBe(viaMk);
  });
});
