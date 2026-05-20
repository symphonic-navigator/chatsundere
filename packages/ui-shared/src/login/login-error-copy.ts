// SPDX-License-Identifier: LGPL-3.0-only
import { CryptoError } from '@chatsundere/crypto';

/**
 * Copy keys for login-related errors, app-agnostic. Each consuming app maps
 * these to its own British-English strings via its `copy.ts`.
 *
 * `passkeyCancelled` is intentionally treated as a non-error in most UIs (the
 * user simply chose not to authenticate). Apps may display nothing for it.
 */
export type LoginCopyKey =
  | 'invalidPassphrase'
  | 'integrityFailure'
  | 'prfRequired'
  | 'passkeyCancelled'
  | 'serverUnreachable'
  | 'authFailed'
  | 'genericError';

/**
 * Translate a thrown error from a login flow into a stable copy key. Apps map
 * the returned key to their own strings in `copy.ts`.
 *
 * Login orchestration hooks are deliberately not extracted in this task. The
 * crypto login flows (`loginOnlineLinked`, `loginWithLocalBiometric`,
 * `loginLocalWithPassphrase`) return rich result objects (session, mk,
 * serverOutcome) that callers consume in app-specific ways — setSession,
 * connectivity dispatch, navigation. Wrapping that orchestration in a shared
 * hook would either lock all consumers into user-client's specific dispatch
 * sequence or expose so many callbacks that the hook adds no value over
 * calling the crypto flow directly. The error-mapping function is the only
 * piece both apps genuinely share, so that is the only piece we extract here.
 */
export function mapLoginErrorToCopyKey(err: unknown): LoginCopyKey {
  if (err instanceof CryptoError) {
    switch (err.code) {
      case 'wrong_passphrase':
        return 'invalidPassphrase';
      case 'integrity_check_failed':
      case 'corrupted_data':
        return 'integrityFailure';
      case 'prf_not_supported':
        return 'prfRequired';
      default:
        return 'genericError';
    }
  }

  if (
    err instanceof DOMException &&
    (err.name === 'NotAllowedError' || err.name === 'AbortError')
  ) {
    return 'passkeyCancelled';
  }

  if (err !== null && typeof err === 'object' && 'status' in err) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === 'number') {
      if (status === 401) return 'authFailed';
      if (status >= 500) return 'serverUnreachable';
    }
  }

  return 'genericError';
}
