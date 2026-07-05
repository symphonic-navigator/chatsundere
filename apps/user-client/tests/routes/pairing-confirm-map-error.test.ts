// SPDX-License-Identifier: AGPL-3.0-only
import { CryptoError } from '@chatsundere/crypto';
import { JoinError } from '@chatsundere/shared-types';
import { describe, expect, it } from 'vitest';

import { HttpError } from '../../src/lib/fetch.js';
import { mapError } from '../../src/routes/onboarding/pairing/confirm.js';

// A mistyped passphrase during pairing must surface inline with a retry, not
// burn a pairing-attempt code on a generic fatal dead-end (Task 2).
describe('PairingConfirm mapError — wrong passphrase surfaces inline (Task 2)', () => {
  it('maps a client-side CryptoError("wrong_passphrase") to the inline passphrase error', () => {
    expect(mapError(new CryptoError('wrong_passphrase', 'OPAQUE login finish failed'))).toEqual({
      kind: 'passphrase_inline',
      message: 'Wrong passphrase.',
    });
  });

  it('maps the server opaque_authentication_failed HttpError to the inline passphrase error', () => {
    const err = new HttpError(401, 'opaque_authentication_failed', 'mutual auth failed');
    expect(mapError(err)).toEqual({
      kind: 'passphrase_inline',
      message: 'Wrong passphrase.',
    });
  });

  it('still routes CryptoError("conflict") to the existing local-account fatal screen', () => {
    expect(mapError(new CryptoError('conflict', 'local account exists'))).toEqual({
      kind: 'screen',
      screen: { kind: 'fatal', message: 'A local account already exists on this device.' },
    });
  });

  it('still falls through unrecognised errors to the generic fatal screen', () => {
    expect(mapError(new Error('boom'))).toEqual({
      kind: 'screen',
      screen: { kind: 'fatal', message: 'Something went wrong. Please try again.' },
    });
  });

  // Drift guard: this must match the string the server actually emits at
  // apps/auth-service/src/routes/join.ts:442. The stale constant this
  // replaces (OpaqueEvidenceInvalid) held the wrong string and was imported
  // by no one — this test pins the corrected single source of truth.
  it('keeps JoinError.OpaqueAuthenticationFailed aligned with the wire string', () => {
    expect(JoinError.OpaqueAuthenticationFailed).toBe('opaque_authentication_failed');
  });
});
