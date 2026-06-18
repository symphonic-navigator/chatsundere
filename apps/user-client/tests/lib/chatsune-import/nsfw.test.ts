// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { resolveImportedNsfw } from '../../../src/lib/chatsune-import/nsfw.js';

describe('resolveImportedNsfw (monotonic upgrade)', () => {
  it('false + true => true', () => expect(resolveImportedNsfw(false, true)).toBe(true));
  it('true + false => true (never downgraded)', () =>
    expect(resolveImportedNsfw(true, false)).toBe(true));
  it('false + false => false', () => expect(resolveImportedNsfw(false, false)).toBe(false));
  it('true + true => true', () => expect(resolveImportedNsfw(true, true)).toBe(true));
});
