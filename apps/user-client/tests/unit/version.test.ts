// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { APP_VERSION } from '../../src/lib/version';

describe('APP_VERSION', () => {
  it('exposes version, sha, and builtAt strings', () => {
    expect(typeof APP_VERSION.version).toBe('string');
    expect(typeof APP_VERSION.sha).toBe('string');
    expect(typeof APP_VERSION.builtAt).toBe('string');
  });
  it('defaults to "dev" when no build-time globals are defined', () => {
    // In the Vitest env the globals are NOT defined via vite.config's
    // `define`, because Vitest uses its own config. So defaults apply.
    expect(APP_VERSION.version).toBe('dev');
    expect(APP_VERSION.sha).toBe('dev');
    expect(APP_VERSION.builtAt).toBe('dev');
  });
});
