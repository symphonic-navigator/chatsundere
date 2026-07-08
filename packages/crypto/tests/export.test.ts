// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { CryptoError } from '../src/errors.js';
import {
  type EncryptedContainer,
  decryptExportPack,
  encryptExportPack,
} from '../src/export/encrypt-export.js';

const inner = new TextEncoder().encode('the inner pack bytes — pretend gzip');

describe('encryptExportPack / decryptExportPack', () => {
  test('round-trips under the correct password', async () => {
    const c = await encryptExportPack('correct horse', inner, 'chatsundere/persona');
    const out = await decryptExportPack('correct horse', c);
    expect(new TextDecoder().decode(out)).toBe('the inner pack bytes — pretend gzip');
  });

  test('wrong password throws wrong_password', async () => {
    const c = await encryptExportPack('right', inner, 'chatsundere/knowledge');
    await expect(decryptExportPack('wrong', c)).rejects.toMatchObject({ code: 'wrong_password' });
  });

  test('tampered ciphertext is rejected', async () => {
    const c = await encryptExportPack('pw', inner, 'chatsundere/persona');
    c.payload[0] = (c.payload[0] ?? 0) ^ 0xff;
    await expect(decryptExportPack('pw', c)).rejects.toBeInstanceOf(CryptoError);
  });

  test('enclosedFormat is bound into the tag', async () => {
    const c = await encryptExportPack('pw', inner, 'chatsundere/persona');
    const swapped: EncryptedContainer = { ...c, enclosedFormat: 'chatsundere/knowledge' };
    await expect(decryptExportPack('pw', swapped)).rejects.toBeInstanceOf(CryptoError);
  });

  test('kdf params are stored and sufficient to decrypt', async () => {
    const c = await encryptExportPack('pw', inner, 'chatsundere/persona');
    expect(c.kdf.name).toBe('argon2id');
    expect(c.kdf.memorySizeKiB).toBeGreaterThan(0);
    expect(await decryptExportPack('pw', c)).toEqual(inner);
  });

  test('rejects out-of-bounds KDF params before deriving', async () => {
    const c = await encryptExportPack('pw', inner, 'chatsundere/persona');
    const evil = { ...c, kdf: { ...c.kdf, memorySizeKiB: 8_000_000 } };
    await expect(decryptExportPack('pw', evil)).rejects.toMatchObject({ code: 'invalid_input' });
  });

  test('tampered nonce is rejected', async () => {
    const c = await encryptExportPack('pw', inner, 'chatsundere/persona');
    const flip = (s: string): string => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
    await expect(decryptExportPack('pw', { ...c, nonce: flip(c.nonce) })).rejects.toBeInstanceOf(
      CryptoError,
    );
  });

  test('tampered salt is rejected', async () => {
    const c = await encryptExportPack('pw', inner, 'chatsundere/persona');
    const flip = (s: string): string => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
    await expect(
      decryptExportPack('pw', { ...c, kdf: { ...c.kdf, salt: flip(c.kdf.salt) } }),
    ).rejects.toBeInstanceOf(CryptoError);
  });
});
