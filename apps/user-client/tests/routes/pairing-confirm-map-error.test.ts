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

describe('PairingConfirm mapError — join lifecycle codes (F4/F5)', () => {
  it('maps code_expired to a specific fatal screen', () => {
    expect(mapError(new HttpError(410, 'code_expired', 'gone'))).toEqual({
      kind: 'screen',
      screen: {
        kind: 'fatal',
        message:
          'This pairing code has expired. Generate a fresh one on your other device and enter it here.',
      },
    });
  });

  it('maps code_already_redeemed to a specific fatal screen', () => {
    expect(mapError(new HttpError(410, 'code_already_redeemed', 'gone'))).toEqual({
      kind: 'screen',
      screen: {
        kind: 'fatal',
        message:
          'This pairing code has already been used. Generate a new one on your other device.',
      },
    });
  });

  it('maps code_attempts_exhausted to a specific fatal screen', () => {
    expect(mapError(new HttpError(429, 'code_attempts_exhausted', 'locked'))).toEqual({
      kind: 'screen',
      screen: {
        kind: 'fatal',
        message:
          'Too many tries — this code is now locked for safety. Generate a new one on your other device.',
      },
    });
  });

  it('maps rate_limited to the wait-a-minute fatal screen', () => {
    expect(mapError(new HttpError(429, 'rate_limited', 'slow down'))).toEqual({
      kind: 'screen',
      screen: {
        kind: 'fatal',
        message: 'Too many attempts. Please wait a minute, then try again.',
      },
    });
  });

  it('maps session_expired to the start-again fatal screen', () => {
    expect(mapError(new HttpError(410, 'session_expired', 'expired'))).toEqual({
      kind: 'screen',
      screen: {
        kind: 'fatal',
        message:
          'This took a little too long and the secure session timed out. Please start again.',
      },
    });
  });

  // Drift guards — pin the new constants to the exact strings the server emits.
  // Sources span two files: code_expired / code_already_redeemed /
  // code_attempts_exhausted from apps/auth-service/src/codes/rate-limit.ts, and
  // rate_limited from apps/auth-service/src/middleware/rate-limit.ts.
  it('keeps the new JoinError constants aligned with the wire strings', () => {
    expect(JoinError.RateLimited).toBe('rate_limited');
    expect(JoinError.CodeExpired).toBe('code_expired');
    expect(JoinError.CodeAlreadyRedeemed).toBe('code_already_redeemed');
    expect(JoinError.CodeAttemptsExhausted).toBe('code_attempts_exhausted');
  });
});
