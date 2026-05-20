// SPDX-License-Identifier: LGPL-3.0-only
import { CryptoError } from '@chatsundere/crypto';
import { describe, expect, it } from 'vitest';
import { mapLoginErrorToCopyKey } from '../../src/login/login-error-copy.js';

describe('mapLoginErrorToCopyKey', () => {
  it('maps a 401 HttpError-shaped object to authFailed', () => {
    expect(mapLoginErrorToCopyKey({ status: 401 })).toBe('authFailed');
  });

  it('maps a 5xx HttpError-shaped object to serverUnreachable', () => {
    expect(mapLoginErrorToCopyKey({ status: 503 })).toBe('serverUnreachable');
  });

  it('maps DOMException NotAllowedError to passkeyCancelled', () => {
    expect(mapLoginErrorToCopyKey(new DOMException('cancelled', 'NotAllowedError'))).toBe(
      'passkeyCancelled',
    );
  });

  it('maps DOMException AbortError to passkeyCancelled', () => {
    expect(mapLoginErrorToCopyKey(new DOMException('aborted', 'AbortError'))).toBe(
      'passkeyCancelled',
    );
  });

  it('falls back to genericError for unknown errors', () => {
    expect(mapLoginErrorToCopyKey(new Error('something'))).toBe('genericError');
  });

  // CryptoError codes — verified against packages/crypto/src/errors.ts
  it('maps CryptoError wrong_passphrase to invalidPassphrase', () => {
    expect(mapLoginErrorToCopyKey(new CryptoError('wrong_passphrase', 'bad passphrase'))).toBe(
      'invalidPassphrase',
    );
  });

  it('maps CryptoError integrity_check_failed to integrityFailure', () => {
    expect(
      mapLoginErrorToCopyKey(new CryptoError('integrity_check_failed', 'corrupted vault')),
    ).toBe('integrityFailure');
  });

  it('maps CryptoError prf_not_supported to prfRequired', () => {
    expect(mapLoginErrorToCopyKey(new CryptoError('prf_not_supported', 'PRF not available'))).toBe(
      'prfRequired',
    );
  });

  it('maps CryptoError corrupted_data to integrityFailure', () => {
    expect(mapLoginErrorToCopyKey(new CryptoError('corrupted_data', 'data corrupted'))).toBe(
      'integrityFailure',
    );
  });

  it('falls back to genericError for other CryptoError codes', () => {
    expect(mapLoginErrorToCopyKey(new CryptoError('internal', 'unexpected'))).toBe('genericError');
  });
});
