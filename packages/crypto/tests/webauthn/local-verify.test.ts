// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { CryptoError } from '../../src/errors.js';
import { generateLocalChallenge, verifyLocalAssertion } from '../../src/webauthn/local-verify.js';

describe('webauthn local-verify', () => {
  it('generateLocalChallenge returns 32 random bytes', () => {
    const a = generateLocalChallenge();
    const b = generateLocalChallenge();
    expect(a.length).toBe(32);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('rejects a sign-counter rollback for non-synced authenticators', async () => {
    await expect(
      verifyLocalAssertion({
        credentialId: Uint8Array.from([1, 2, 3, 4]),
        publicKey: Uint8Array.from([0]), // not parsed in the rollback short-circuit
        storedSignCounter: 5,
        receivedSignCounter: 3,
        aaguid: '00000000-0000-0000-0000-000000000000',
        challenge: new Uint8Array(32),
        clientDataJson: '{}',
        authenticatorData: new Uint8Array(0),
        signature: new Uint8Array(0),
        origin: 'https://localhost',
      }),
    ).rejects.toMatchObject({
      constructor: CryptoError,
      code: 'webauthn_sign_counter_rollback',
    });
  });

  it('tolerates signCounter=0 for synced-passkey AAGUIDs', async () => {
    // We can't easily forge a real signature here; this test only
    // confirms the rollback short-circuit does NOT fire for synced
    // authenticators. A real verification failure may follow with a
    // different code; we accept any other CryptoError that is not the
    // rollback one.
    try {
      await verifyLocalAssertion({
        credentialId: Uint8Array.from([1, 2, 3, 4]),
        publicKey: Uint8Array.from([0]),
        storedSignCounter: 5,
        receivedSignCounter: 0,
        aaguid: 'fbfc3007-154e-4ecc-8c0b-6e020557d7bd', // Apple
        challenge: new Uint8Array(32),
        clientDataJson: '{}',
        authenticatorData: new Uint8Array(0),
        signature: new Uint8Array(0),
        origin: 'https://localhost',
      });
    } catch (err) {
      expect(err).toBeInstanceOf(CryptoError);
      expect((err as CryptoError).code).not.toBe('webauthn_sign_counter_rollback');
    }
  });
});
