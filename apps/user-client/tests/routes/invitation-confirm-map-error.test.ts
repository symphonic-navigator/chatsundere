// SPDX-License-Identifier: AGPL-3.0-only
import { CryptoError } from '@chatsundere/crypto';
import { describe, expect, it } from 'vitest';
import { HttpError } from '../../src/lib/fetch.js';
import { mapSubmitError } from '../../src/routes/onboarding/invitation/confirm.js';

describe('InvitationConfirm mapSubmitError — join lifecycle codes (F4/F5)', () => {
  it('maps code_expired to a specific fatal screen', () => {
    expect(mapSubmitError(new HttpError(410, 'code_expired', 'gone'))).toEqual({
      kind: 'screen',
      screen: {
        kind: 'fatal',
        message: 'This invitation has expired. Ask the person who invited you for a fresh code.',
      },
    });
  });

  it('maps code_already_redeemed to a specific fatal screen', () => {
    expect(mapSubmitError(new HttpError(410, 'code_already_redeemed', 'gone'))).toEqual({
      kind: 'screen',
      screen: {
        kind: 'fatal',
        message:
          'This invitation has already been used. Ask the person who invited you for a new one.',
      },
    });
  });

  it('maps code_attempts_exhausted to a specific fatal screen', () => {
    expect(mapSubmitError(new HttpError(429, 'code_attempts_exhausted', 'locked'))).toEqual({
      kind: 'screen',
      screen: {
        kind: 'fatal',
        message:
          'Too many tries — this invitation is now locked for safety. Ask the person who invited you for a new one.',
      },
    });
  });

  it('maps rate_limited to the wait-a-minute fatal screen', () => {
    expect(mapSubmitError(new HttpError(429, 'rate_limited', 'slow down'))).toEqual({
      kind: 'screen',
      screen: {
        kind: 'fatal',
        message: 'Too many attempts. Please wait a minute, then try again.',
      },
    });
  });

  it('aligns session_expired copy with the pairing side', () => {
    expect(mapSubmitError(new HttpError(410, 'session_expired', 'expired'))).toEqual({
      kind: 'screen',
      screen: {
        kind: 'fatal',
        message:
          'This took a little too long and the secure session timed out. Please start again.',
      },
    });
  });

  it('still falls through unrecognised errors to the generic fatal screen', () => {
    expect(mapSubmitError(new Error('boom'))).toEqual({
      kind: 'screen',
      screen: { kind: 'fatal', message: 'Something went wrong. Please try again.' },
    });
  });
});

describe('InvitationConfirm mapSubmitError — username conflict (Defect A)', () => {
  it('maps a CryptoError conflict (late-link linkToServer) to an inline username error', () => {
    expect(mapSubmitError(new CryptoError('conflict', 'taken'))).toEqual({
      kind: 'username_inline',
      message: 'This username is taken on this server. Choose another.',
    });
  });

  it('maps an HttpError username_taken (fresh-PWA join) to an inline username error', () => {
    expect(mapSubmitError(new HttpError(409, 'username_taken', 'conflict'))).toEqual({
      kind: 'username_inline',
      message: 'This username is taken on this server. Choose another.',
    });
  });

  it('maps a CryptoError invalid_input (rename-mode malformed name) to an inline error', () => {
    expect(mapSubmitError(new CryptoError('invalid_input', 'bad'))).toEqual({
      kind: 'username_inline',
      message: 'Use 3–32 characters: lowercase letters, numbers, - or _.',
    });
  });
});
