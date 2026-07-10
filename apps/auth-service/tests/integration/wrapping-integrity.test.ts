// SPDX-License-Identifier: AGPL-3.0-only
//
// Defence-in-depth test for the auth_methods "exactly one OPAQUE row per
// user" invariant (ADR 0021). Registers a real user via the OPAQUE join
// flow, then confirms a second OPAQUE auth_methods row for that user is
// rejected outright by the DB — see migration 0006 (Task A3, Finding #9).
// Before that migration, this scenario was only caught by the app-level
// assertOpaqueWrappingPresent assertion (src/auth/wrapping-integrity.ts),
// which is retained as a second line of defence but is no longer the
// primary guarantee.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { opaqueServerIdentity } from '@chatsundere/shared-types';
import { client as opaqueClient, ready as opaqueReady } from '@serenity-kit/opaque';
import { and, eq } from 'drizzle-orm';
import { generateCode, hashCode } from '../../src/codes/token.js';
import { closeDb, createDb } from '../../src/db/client.js';
import { authMethods, pendingCodes, users } from '../../src/db/schema.js';
import { createRedis } from '../../src/redis/client.js';
import { createServer } from '../../src/server.js';

const skip = !process.env.DATABASE_URL || !process.env.REDIS_URL;
const password = 'wrapping-integrity-test-passphrase';

describe.skipIf(skip)('Wrapping-integrity invariant on /api/v1/join/finish', () => {
  const username = `wrap-${Date.now()}`.slice(0, 32).replace(/-/g, 'x');

  let app: ReturnType<typeof createServer>;
  let userId: string;
  let originalWrappedMk: Uint8Array;
  let originalWrapNonce: Uint8Array;
  let originalWrapAad: Uint8Array;
  const redis = createRedis();

  beforeAll(async () => {
    await opaqueReady;
    app = createServer();
    const { db } = createDb();
    // Drop cross-file rate-limit pollution before this file's /join calls.
    const rlKeys = await redis.keys('rl:join_*');
    if (rlKeys.length) await redis.del(...rlKeys);

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
    const linkStart = await app.request('/api/v1/join/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        kind: 'invitation',
        code: invitationCode,
        registration_request: registrationRequest,
      }),
    });
    const linkStartBody = (await linkStart.json()) as {
      session_id: string;
      registration_response: string;
    };
    const { registrationRecord } = opaqueClient.finishRegistration({
      password,
      clientRegistrationState,
      registrationResponse: linkStartBody.registration_response,
      identifiers: {
        client: username,
        server: opaqueServerIdentity(process.env.API_BASE_URL ?? 'http://localhost:3100/auth'),
      },
    });
    const zero32 = Buffer.alloc(32).toString('base64url');
    await app.request('/api/v1/join/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        kind: 'invitation',
        session_id: linkStartBody.session_id,
        username,
        registration_record: registrationRecord,
        wrapped_mk_opaque: zero32,
        wrap_nonce_opaque: zero32,
        wrap_aad_opaque: zero32,
        wrapped_mk_recovery: zero32,
        wrap_nonce_recovery: zero32,
        wrap_aad_recovery: zero32,
        recovery_verifier_key: zero32,
      }),
    });

    const userRow = (
      await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1)
    )[0];
    if (!userRow) throw new Error('test setup: user row not found');
    userId = userRow.id;

    // Capture the original wrapping so we can restore it between tests.
    const opaqueRow = (
      await db
        .select({
          wrappedMasterKey: authMethods.wrappedMasterKey,
          wrapNonce: authMethods.wrapNonce,
          wrapAad: authMethods.wrapAad,
        })
        .from(authMethods)
        .where(and(eq(authMethods.userId, userId), eq(authMethods.methodType, 'opaque')))
        .limit(1)
    )[0];
    if (!opaqueRow?.wrappedMasterKey || !opaqueRow.wrapNonce || !opaqueRow.wrapAad) {
      throw new Error('test setup: OPAQUE wrapping missing after link');
    }
    originalWrappedMk = opaqueRow.wrappedMasterKey;
    originalWrapNonce = opaqueRow.wrapNonce;
    originalWrapAad = opaqueRow.wrapAad;
  });

  beforeEach(async () => {
    // Restore the original wrapping (in case a prior test corrupted it) and
    // clear any leftover pairing codes for the test user.
    const { db } = createDb();
    await db
      .update(authMethods)
      .set({
        wrappedMasterKey: originalWrappedMk,
        wrapNonce: originalWrapNonce,
        wrapAad: originalWrapAad,
      })
      .where(and(eq(authMethods.userId, userId), eq(authMethods.methodType, 'opaque')));
    await db.delete(pendingCodes).where(eq(pendingCodes.createdBy, userId));
  });

  afterAll(async () => {
    if (userId) {
      const { db } = createDb();
      await db
        .update(pendingCodes)
        .set({ redeemedByUserId: null })
        .where(eq(pendingCodes.redeemedByUserId, userId));
      await db.delete(pendingCodes).where(eq(pendingCodes.createdBy, userId));
      await db.delete(authMethods).where(eq(authMethods.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
    await closeDb();
  });

  it('rejects a second OPAQUE auth_methods row for the same user at the database', async () => {
    // Prior to migration 0006 (Task A3, Finding #9 defence-in-depth) the
    // schema allowed a second OPAQUE row per user, and this test drove that
    // state through the /finish flow to exercise the app-level
    // multiple_opaque_methods assertion in assertOpaqueWrappingPresent. The
    // migration adds a partial unique index on (user_id, method_type) WHERE
    // method_type = 'opaque', so that state is no longer reachable through
    // any insert — legitimate or tampered — without first defeating the
    // constraint itself. The app-level assertion in
    // src/auth/wrapping-integrity.ts is retained as defence-in-depth (e.g.
    // against a constraint dropped out-of-band), but this test now verifies
    // the stronger, DB-level guarantee directly: the insert itself fails.
    const { db } = createDb();
    const garbage = new Uint8Array(32);
    const secondInsert = async () =>
      db.insert(authMethods).values({
        userId,
        methodType: 'opaque',
        opaqueCredential: garbage,
        opaqueUserIdentifier: 'second-opaque-method',
        opaqueClientIdentifier: 'second-username',
        wrappedMasterKey: garbage,
        wrapNonce: garbage,
        wrapAad: garbage,
      });
    await expect(secondInsert()).rejects.toThrow(
      /duplicate key value violates unique constraint "auth_methods_user_opaque_unique"/,
    );

    // Confirm the user still has exactly one OPAQUE row — the rejected
    // insert left no partial row behind.
    const opaqueRows = await db
      .select({ id: authMethods.id })
      .from(authMethods)
      .where(and(eq(authMethods.userId, userId), eq(authMethods.methodType, 'opaque')));
    expect(opaqueRows).toHaveLength(1);
  });
});
