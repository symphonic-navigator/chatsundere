// SPDX-License-Identifier: AGPL-3.0-only

import { type MasterKey, asMasterKey, getRandomBytes } from '@chatsundere/crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { type EncryptedBlob, openSecret, sealSecret } from '../../src/lib/secrets.js';

let mk: MasterKey;
let otherMk: MasterKey;

const SLOT_A = 'provider/test-row-a/api-key';
const SLOT_B = 'provider/test-row-b/api-key';

beforeAll(() => {
  mk = asMasterKey(getRandomBytes(32));
  otherMk = asMasterKey(getRandomBytes(32));
});

describe('sealSecret + openSecret', () => {
  it('round-trips an ASCII secret', async () => {
    const blob = await sealSecret('hello-world-api-key', mk, SLOT_A);
    const plain = await openSecret(blob, mk, SLOT_A);
    expect(plain).toBe('hello-world-api-key');
  });

  it('round-trips a Unicode secret', async () => {
    const secret = 'für-mich-und-😺-und-Ω';
    const blob = await sealSecret(secret, mk, SLOT_A);
    const plain = await openSecret(blob, mk, SLOT_A);
    expect(plain).toBe(secret);
  });

  it('produces version=1 blobs with 12-byte nonce', async () => {
    const blob = await sealSecret('x', mk, SLOT_A);
    expect(blob.version).toBe(1);
    expect(blob.nonce.length).toBe(12);
    expect(blob.ciphertext.length).toBeGreaterThan(0);
  });

  it('produces distinct ciphertexts for the same plaintext (random nonce)', async () => {
    const a = await sealSecret('same-plaintext', mk, SLOT_A);
    const b = await sealSecret('same-plaintext', mk, SLOT_A);
    expect(a.nonce).not.toEqual(b.nonce);
    expect(a.ciphertext).not.toEqual(b.ciphertext);
  });

  it('fails to open with a different MasterKey', async () => {
    const blob = await sealSecret('top-secret', mk, SLOT_A);
    await expect(openSecret(blob, otherMk, SLOT_A)).rejects.toThrow();
  });

  it('fails to open a tampered ciphertext (AES-GCM auth tag check)', async () => {
    const blob = await sealSecret('top-secret', mk, SLOT_A);
    const tampered: EncryptedBlob = {
      ...blob,
      ciphertext: new Uint8Array(blob.ciphertext),
    };
    tampered.ciphertext[0] = (tampered.ciphertext[0] ?? 0) ^ 0x01;
    await expect(openSecret(tampered, mk, SLOT_A)).rejects.toThrow();
  });

  it('refuses to open a blob with unknown version', async () => {
    const blob = await sealSecret('x', mk, SLOT_A);
    const wrongVersion = { ...blob, version: 99 as unknown as 1 };
    await expect(openSecret(wrongVersion, mk, SLOT_A)).rejects.toThrow(/version/);
  });

  it('fails to open with a different slotId (ciphertext-swap defence)', async () => {
    const blob = await sealSecret('top-secret', mk, SLOT_A);
    await expect(openSecret(blob, mk, SLOT_B)).rejects.toThrow();
  });

  it('rejects empty slotId in sealSecret', async () => {
    await expect(sealSecret('x', mk, '')).rejects.toThrow(/slotId/);
  });

  it('rejects empty slotId in openSecret', async () => {
    const blob = await sealSecret('x', mk, SLOT_A);
    await expect(openSecret(blob, mk, '')).rejects.toThrow(/slotId/);
  });
});
