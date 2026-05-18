// SPDX-License-Identifier: LGPL-3.0-only

import { CryptoError } from './errors.js';

const REQUIRED_GLOBALS = [
  'crypto',
  'TextEncoder',
  'TextDecoder',
  'Uint8Array',
  'indexedDB',
] as const;

/**
 * Refuses to continue if the runtime is missing any of the primitives this
 * library depends on. Called once at application boot. Failure is loud;
 * silent fallback is not safe in a crypto context.
 */
export function assertRuntimeSupport(): void {
  for (const name of REQUIRED_GLOBALS) {
    if (!(name in globalThis)) {
      throw new CryptoError('runtime_unsupported', `Missing required global: ${name}`);
    }
  }
  if (typeof globalThis.crypto?.subtle === 'undefined') {
    throw new CryptoError('runtime_unsupported', 'crypto.subtle is unavailable');
  }
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new CryptoError('runtime_unsupported', 'crypto.getRandomValues is unavailable');
  }
}
