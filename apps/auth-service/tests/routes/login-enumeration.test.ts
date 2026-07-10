// SPDX-License-Identifier: AGPL-3.0-only
//
// Finding #10a: POST /api/v1/opaque/login/start already masks the OPAQUE ke2
// for unknown/suspended users (registrationRecord: null), but used to leak
// existence through the SIBLING wrap fields — wrapped_mk_opaque: null for an
// absent/suspended user vs a real base64url blob for an active one. This
// suite asserts the response SHAPE (not just the ke2) is now identical across
// active, unknown, and suspended users, and that the decoy wrap is
// deterministic per username rather than fresh-random per call (which would
// itself be a distinguishing tell). Requires a live PostgreSQL + Redis —
// skipped when either is absent.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { opaqueServerIdentity } from '@chatsundere/shared-types';
import { client as opaqueClient, ready as opaqueReady } from '@serenity-kit/opaque';
import { eq } from 'drizzle-orm';
import { generateCode, hashCode } from '../../src/codes/token.js';
import { closeDb, createDb } from '../../src/db/client.js';
import { pendingCodes, users } from '../../src/db/schema.js';
import { closeRedis, createRedis } from '../../src/redis/client.js';
import { createServer } from '../../src/server.js';

const skip = !process.env.DATABASE_URL || !process.env.REDIS_URL;

describe.skipIf(skip)('OPAQUE login/start enumeration mitigation (Finding #10a)', () => {
  const password = 'correct-horse-battery-staple-enum-test';
  const runId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  let app: ReturnType<typeof createServer>;
  let activeUsername: string;
  let activeUserId: string;
  let suspendedUsername: string;
  let suspendedUserId: string;

  async function registerUser(username: string): Promise<string> {
    const { db } = createDb();
    const invitationCode = generateCode();
    const codeHmac = await hashCode(invitationCode);
    await db.insert(pendingCodes).values({
      type: 'invitation',
      codeHmac,
      role: 'user',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const { clientRegistrationState, registrationRequest } = opaqueClient.startRegistration({
      password,
    });

    const startRes = await app.request('/api/v1/join/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        kind: 'invitation',
        code: invitationCode,
        registration_request: registrationRequest,
      }),
    });
    const startBody = (await startRes.json()) as {
      session_id: string;
      registration_response: string;
    };

    const { registrationRecord } = opaqueClient.finishRegistration({
      password,
      clientRegistrationState,
      registrationResponse: startBody.registration_response,
      identifiers: {
        client: username,
        server: opaqueServerIdentity(process.env.API_BASE_URL ?? 'http://localhost:3100/auth'),
      },
    });

    // Full-fidelity fixture: a real client sends a 48-byte AEAD ciphertext
    // (32-byte AMK + 16-byte GCM tag), a 12-byte nonce, and an AAD of
    // `${username}::opaque::v1` (packages/crypto/src/primitives/aad.ts). A
    // minimal same-length-for-everything stub would make the "same shape as
    // active" assertions below vacuously true regardless of whether the
    // fix actually matches real byte lengths.
    const zero32 = Buffer.alloc(32).toString('base64url');
    const realisticCiphertext = Buffer.alloc(48, 0xab).toString('base64url');
    const realisticNonce = Buffer.alloc(12, 0xcd).toString('base64url');
    const realisticAad = Buffer.from(`${username}::opaque::v1`, 'utf8').toString('base64url');
    const finishRes = await app.request('/api/v1/join/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        kind: 'invitation',
        session_id: startBody.session_id,
        username,
        registration_record: registrationRecord,
        wrapped_mk_opaque: realisticCiphertext,
        wrap_nonce_opaque: realisticNonce,
        wrap_aad_opaque: realisticAad,
        wrapped_mk_recovery: zero32,
        wrap_nonce_recovery: zero32,
        wrap_aad_recovery: zero32,
        recovery_verifier_key: zero32,
      }),
    });
    const finishBody = (await finishRes.json()) as { user_id: string };
    return finishBody.user_id;
  }

  beforeAll(async () => {
    const redis = createRedis();
    const rlKeys = await redis.keys('rl:login:*');
    if (rlKeys.length) await redis.del(...rlKeys);

    await opaqueReady;
    app = createServer();

    activeUsername = `enum-active-${runId}`.slice(0, 32);
    suspendedUsername = `enum-suspend-${runId}`.slice(0, 32);

    activeUserId = await registerUser(activeUsername);
    suspendedUserId = await registerUser(suspendedUsername);

    // Suspend the second user directly — the join flow has no path to a
    // suspended account, so this mirrors what an admin suspension does.
    const { db } = createDb();
    await db.update(users).set({ suspendedAt: new Date() }).where(eq(users.id, suspendedUserId));
  });

  afterAll(async () => {
    const { db } = createDb();
    for (const userId of [activeUserId, suspendedUserId]) {
      if (!userId) continue;
      await db
        .update(pendingCodes)
        .set({ redeemedByUserId: null })
        .where(eq(pendingCodes.redeemedByUserId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
    await closeDb();
    await closeRedis();
  });

  async function loginStart(username: string) {
    const { startLoginRequest } = opaqueClient.startLogin({ password });
    const res = await app.request('/api/v1/opaque/login/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ username, start_login_request: startLoginRequest }),
    });
    const body = (await res.json()) as {
      session_id: string;
      login_response: string;
      wrapped_mk_opaque: string | null;
      wrap_nonce_opaque: string | null;
      wrap_aad_opaque: string | null;
    };
    return { status: res.status, body };
  }

  it('returns the same response shape for active, unknown, and suspended users', async () => {
    const unknownUsername = `enum-unknown-${runId}`.slice(0, 32);

    const [active, unknown, suspended] = await Promise.all([
      loginStart(activeUsername),
      loginStart(unknownUsername),
      loginStart(suspendedUsername),
    ]);

    for (const result of [active, unknown, suspended]) {
      expect(result.status).toBe(200);
      expect(typeof result.body.session_id).toBe('string');
      expect(typeof result.body.login_response).toBe('string');
      // The wrap fields must be present and non-null for all three — a
      // null-vs-present split is itself an existence oracle.
      expect(result.body.wrapped_mk_opaque).not.toBeNull();
      expect(result.body.wrap_nonce_opaque).not.toBeNull();
      expect(result.body.wrap_aad_opaque).not.toBeNull();
      expect(typeof result.body.wrapped_mk_opaque).toBe('string');
      // Same length class as a real wrap: 48-byte ciphertext (32-byte AMK +
      // 16-byte AES-GCM tag), 12-byte AES-GCM nonce.
      expect(Buffer.from(result.body.wrapped_mk_opaque as string, 'base64url').length).toBe(48);
      expect(Buffer.from(result.body.wrap_nonce_opaque as string, 'base64url').length).toBe(12);
    }
  });

  it('derives a decoy that is stable across two calls for the same unknown username', async () => {
    const unknownUsername = `enum-stable-${runId}`.slice(0, 32);

    const first = await loginStart(unknownUsername);
    const second = await loginStart(unknownUsername);

    expect(first.body.wrapped_mk_opaque).toBe(second.body.wrapped_mk_opaque);
    expect(first.body.wrap_nonce_opaque).toBe(second.body.wrap_nonce_opaque);
    expect(first.body.wrap_aad_opaque).toBe(second.body.wrap_aad_opaque);
  });

  it('derives different decoys for two different unknown usernames', async () => {
    const usernameA = `enum-diff-a-${runId}`.slice(0, 32);
    const usernameB = `enum-diff-b-${runId}`.slice(0, 32);

    const a = await loginStart(usernameA);
    const b = await loginStart(usernameB);

    expect(a.body.wrapped_mk_opaque).not.toBe(b.body.wrapped_mk_opaque);
  });

  it('does not leak account existence via wrap_aad_opaque case-folding for a mixed-case unknown username', async () => {
    // Real usernames are always lowercase (validated /^[a-z][a-z0-9_-]{2,31}$/
    // at registration/rename, stored citext), so a genuine account's AAD is
    // always `${lowercaseUsername}::opaque::v1` regardless of the case sent
    // in the request. If the decoy echoed the raw request case instead, an
    // attacker could send a mixed-case username and use the AAD's case
    // (lowercased vs echoed-as-sent) as a 100%-reliable existence oracle.
    const mixedCaseUnknown = `Enum-Mixed-${runId}`.slice(0, 32);

    const result = await loginStart(mixedCaseUnknown);

    const decodedAad = Buffer.from(result.body.wrap_aad_opaque as string, 'base64url').toString(
      'utf8',
    );
    expect(decodedAad).toBe(`${mixedCaseUnknown.toLowerCase()}::opaque::v1`);
    expect(decodedAad).not.toBe(`${mixedCaseUnknown}::opaque::v1`);
  });
});
