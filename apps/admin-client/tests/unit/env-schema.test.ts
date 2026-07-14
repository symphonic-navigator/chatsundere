// SPDX-License-Identifier: AGPL-3.0-only
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { EnvSchema } from '../../src/env.js';

describe('EnvSchema', () => {
  // The regression test for the bug this plan fixes: the production image
  // supplies no VITE_* at all (apps/user-client/Dockerfile:60 passes only
  // VITE_BASE). A schema that rejects that empty environment throws at module
  // scope, before createRoot runs, and the admin renders nothing but its
  // background.
  it('accepts an environment with no VITE_ values at all', () => {
    const result = v.safeParse(EnvSchema, {});
    expect(result.success).toBe(true);
  });

  it('defaults the user-client URL to the domain root', () => {
    const result = v.safeParse(EnvSchema, {});
    expect(result.success && result.output.VITE_USER_CLIENT_URL).toBe('/');
  });

  it('still rejects a malformed dev override, loudly', () => {
    const result = v.safeParse(EnvSchema, { VITE_AUTH_URL: 'not-a-url' });
    expect(result.success).toBe(false);
  });
});
