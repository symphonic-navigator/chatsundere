// SPDX-License-Identifier: AGPL-3.0-only
//
// Race test for /api/v1/passkey/login/finish's single-use webauthn:auth:*
// Redis state consumption (Finding #9 scope extension, task A2b).
// Requires a live Redis instance. Skipped when REDIS_URL is absent.

import { describe, expect, it } from 'bun:test';
import { createRedis } from '../../src/redis/client.js';
import { createServer } from '../../src/server.js';

const skip = !process.env.REDIS_URL;

describe.skipIf(skip)('POST /api/v1/passkey/login/finish — race', () => {
  const app = createServer();
  const redis = createRedis();

  it('lets exactly one of two concurrent /finish calls pass the state-existence check', async () => {
    const sessionId = `race-test-${Math.random().toString(36).slice(2, 10)}`;
    // Seed a "fake" round (the enumeration-resistant shape used for unknown
    // usernames at /start) so the winning request short-circuits to a 401
    // without needing a real WebAuthn assertion or a DB-backed user.
    await redis.set(
      `webauthn:auth:${sessionId}`,
      JSON.stringify({ challenge: 'race-test-challenge', fake: true }),
      'EX',
      120,
    );

    const body = JSON.stringify({
      session_id: sessionId,
      response: {
        id: 'race-test-credential',
        rawId: 'race-test-credential',
        response: {
          clientDataJSON: 'x',
          authenticatorData: 'x',
          signature: 'x',
          userHandle: 'x',
        },
        authenticatorAttachment: 'platform',
        clientExtensionResults: {},
        type: 'public-key',
      },
    });

    const request = () =>
      app.request('/api/v1/passkey/login/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body,
      });

    const [first, second] = await Promise.all([request(), request()]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    // Exactly one call finds the round state (fake round -> 401 invalid_credentials);
    // the other finds it already consumed (410 expired).
    expect(statuses).toEqual([401, 410]);
  });
});
