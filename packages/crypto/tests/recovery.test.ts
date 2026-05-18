// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { computeRecoveryProof, deriveVerifierKey, verifyRecoveryProof } from '../src/recovery.js';
import { asRecoveryKey } from '../src/types.js';

const RK = asRecoveryKey(Uint8Array.from(Array.from({ length: 32 }, (_, i) => i ^ 0x55)));
const USERNAME = 'alice';
const SERVER_ID = 'https://chatsundere.example.com/api/auth/v1';

describe('recovery primitives', () => {
  it('deriveVerifierKey is deterministic', async () => {
    const a = await deriveVerifierKey(RK);
    const b = await deriveVerifierKey(RK);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(a.length).toBe(32);
  });

  it('verifies a freshly-computed proof', async () => {
    const vk = await deriveVerifierKey(RK);
    const nonce = Uint8Array.from(Array.from({ length: 16 }, (_, i) => i + 1));
    const proof = await computeRecoveryProof(RK, nonce, USERNAME, SERVER_ID);
    await expect(verifyRecoveryProof(vk, nonce, USERNAME, SERVER_ID, proof)).resolves.toBe(true);
  });

  it('rejects a proof with a wrong nonce', async () => {
    const vk = await deriveVerifierKey(RK);
    const goodNonce = new Uint8Array(16);
    const badNonce = Uint8Array.from(Array.from({ length: 16 }, (_, i) => i + 1));
    const proof = await computeRecoveryProof(RK, goodNonce, USERNAME, SERVER_ID);
    await expect(verifyRecoveryProof(vk, badNonce, USERNAME, SERVER_ID, proof)).resolves.toBe(
      false,
    );
  });

  it('rejects a proof with a wrong server id', async () => {
    const vk = await deriveVerifierKey(RK);
    const nonce = new Uint8Array(16);
    const proof = await computeRecoveryProof(RK, nonce, USERNAME, SERVER_ID);
    await expect(
      verifyRecoveryProof(vk, nonce, USERNAME, 'https://attacker.example.com', proof),
    ).resolves.toBe(false);
  });
});
