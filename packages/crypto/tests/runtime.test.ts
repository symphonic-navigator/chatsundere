// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';

import { CryptoError } from '../src/errors.js';
import { assertRuntimeSupport } from '../src/runtime.js';

describe('assertRuntimeSupport', () => {
  it('returns silently when all primitives are present', () => {
    expect(() => assertRuntimeSupport()).not.toThrow();
  });

  it('throws CryptoError with runtime_unsupported when subtle is missing', () => {
    const original = globalThis.crypto;
    try {
      Object.defineProperty(globalThis, 'crypto', {
        value: { getRandomValues: crypto.getRandomValues },
        writable: true,
        configurable: true,
      });
      expect(() => assertRuntimeSupport()).toThrow(CryptoError);
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        value: original,
        writable: true,
        configurable: true,
      });
    }
  });
});
