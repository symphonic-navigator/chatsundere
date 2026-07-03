// SPDX-License-Identifier: LGPL-3.0-only
import { afterEach, describe, expect, test } from 'bun:test';
import { getProxyAuthSource, setProxyAuthSource } from './proxy-auth.js';

afterEach(() => setProxyAuthSource(null));

describe('proxy auth source registry', () => {
  test('starts unset and returns the registered source', () => {
    expect(getProxyAuthSource()).toBeNull();
    const source = {
      getUrl: () => 'https://proxy.example',
      getToken: () => 'tok',
      refreshToken: async () => 'tok2',
    };
    setProxyAuthSource(source);
    expect(getProxyAuthSource()).toBe(source);
  });

  test('null clears the registration', () => {
    setProxyAuthSource({
      getUrl: () => null,
      getToken: () => null,
      refreshToken: async () => null,
    });
    setProxyAuthSource(null);
    expect(getProxyAuthSource()).toBeNull();
  });
});
