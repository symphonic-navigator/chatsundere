// SPDX-License-Identifier: AGPL-3.0-only
import { useAccountLinkStore } from '@chatsundere/ui-shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/env.js', () => ({
  env: { VITE_AUTH_URL: 'http://dev-override.test', VITE_USER_CLIENT_URL: '/' },
}));

import { effectiveAuthUrl } from '../../src/lib/server-urls.js';

describe('effectiveAuthUrl', () => {
  beforeEach(() => {
    useAccountLinkStore.setState({
      linkStatus: 'unknown',
      baseUrl: null,
      issuerLabel: null,
      role: null,
    });
  });

  // The module-scope mock above supplies a VITE_AUTH_URL, and Vitest always
  // runs with MODE === 'test', so devOverridesActive() is false for every
  // test in this file. A pass here therefore witnesses two things at once:
  // that effectiveAuthUrl() reads the linked-account store, and that the
  // VITE_AUTH_URL override does not leak into a non-dev build.
  it('returns the linked account base URL', () => {
    useAccountLinkStore.getState().setLinked({
      base_url: 'https://auth.example.com',
      issuer_label: 'Example',
      role: 'primary_admin',
    });
    expect(effectiveAuthUrl()).toBe('https://auth.example.com');
  });

  it('throws when no linked account is published', () => {
    useAccountLinkStore.getState().setLocalOnly();
    expect(() => effectiveAuthUrl()).toThrow(/no linked account/i);
  });
});
