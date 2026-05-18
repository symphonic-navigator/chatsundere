// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { argon2id, hkdfSha256 } from '../../src/primitives/kdf.js';
import { ARGON2ID_PARAMS } from '../../src/types.js';

describe('hkdfSha256', () => {
  it('produces a 32-byte key by default', async () => {
    const ikm = new TextEncoder().encode('input key material');
    const out = await hkdfSha256(ikm, new Uint8Array(), 'test-info-v1');
    expect(out.length).toBe(32);
  });

  it('produces different outputs for different info strings', async () => {
    const ikm = new TextEncoder().encode('seed');
    const a = await hkdfSha256(ikm, new Uint8Array(), 'info::a');
    const b = await hkdfSha256(ikm, new Uint8Array(), 'info::b');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('produces identical outputs for the same inputs (deterministic)', async () => {
    const ikm = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const a = await hkdfSha256(ikm, new Uint8Array(), 'context');
    const b = await hkdfSha256(ikm, new Uint8Array(), 'context');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('supports a custom output length', async () => {
    const out = await hkdfSha256(new Uint8Array([0]), new Uint8Array(), 'ctx', 16);
    expect(out.length).toBe(16);
  });
});

describe('argon2id', () => {
  it('produces a 32-byte hash with the documented parameters', async () => {
    const out = await argon2id('passphrase', new Uint8Array(16), ARGON2ID_PARAMS);
    expect(out.length).toBe(32);
  });

  it('is deterministic for the same inputs', async () => {
    const salt = Uint8Array.from(Array.from({ length: 16 }, (_, i) => i));
    const a = await argon2id('hunter2', salt, ARGON2ID_PARAMS);
    const b = await argon2id('hunter2', salt, ARGON2ID_PARAMS);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('produces different outputs for different passphrases', async () => {
    const salt = Uint8Array.from(Array.from({ length: 16 }, (_, i) => i));
    const a = await argon2id('hunter2', salt, ARGON2ID_PARAMS);
    const b = await argon2id('hunter3', salt, ARGON2ID_PARAMS);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('produces different outputs for different salts', async () => {
    const a = await argon2id('hunter2', new Uint8Array(16), ARGON2ID_PARAMS);
    const b = await argon2id(
      'hunter2',
      Uint8Array.from(Array.from({ length: 16 }, (_, i) => i + 1)),
      ARGON2ID_PARAMS,
    );
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});
