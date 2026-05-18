// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';

describe('runtime smoke', () => {
  it('has webcrypto', () => {
    expect(globalThis.crypto).toBeDefined();
    expect(globalThis.crypto.subtle).toBeDefined();
  });

  it('has fake indexeddb preloaded', () => {
    expect(globalThis.indexedDB).toBeDefined();
  });
});
