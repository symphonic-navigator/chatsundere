// SPDX-License-Identifier: AGPL-3.0-only
//
// Integration tests for the admin audit-log endpoint.
// Requires a live PostgreSQL instance and Redis. Skipped when DATABASE_URL is absent.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { opaqueServerIdentity } from '@chatsundere/shared-types';
import { client as opaqueClient, ready as opaqueReady } from '@serenity-kit/opaque';
import { eq } from 'drizzle-orm';
import { generateCode, hashCode } from '../../src/codes/token.js';
import { closeDb, createDb } from '../../src/db/client.js';
import { auditLog, pendingCodes, users } from '../../src/db/schema.js';
import { issueTokens } from '../../src/jwt/issue.js';
import { createRedis } from '../../src/redis/client.js';
import { createServer } from '../../src/server.js';

const skip = !process.env.DATABASE_URL || !process.env.REDIS_URL;

const ORIGIN = { Origin: 'http://localhost:3000' };
const JSON_ORIGIN = { 'Content-Type': 'application/json', ...ORIGIN };

/** Registers a fresh user via the OPAQUE link flow and returns their user id. */
async function registerUser(
  app: ReturnType<typeof createServer>,
  opts: { password: string; username: string; role?: 'primary_admin' | 'admin' | 'user' },
): Promise<{ userId: string }> {
  const { db } = createDb();
  const invitationCode = generateCode();
  const codeHmac = await hashCode(invitationCode);
  await db.insert(pendingCodes).values({
    type: 'invitation',
    codeHmac,
    role: opts.role ?? 'user',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  const { clientRegistrationState, registrationRequest } = opaqueClient.startRegistration({
    password: opts.password,
  });

  const startRes = await app.request('/api/v1/join/start', {
    method: 'POST',
    headers: JSON_ORIGIN,
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
    password: opts.password,
    clientRegistrationState,
    registrationResponse: startBody.registration_response,
    identifiers: {
      client: opts.username,
      server: opaqueServerIdentity(process.env.API_BASE_URL ?? 'http://localhost:3100/auth'),
    },
  });

  const zero32 = Buffer.alloc(32).toString('base64url');
  const finishRes = await app.request('/api/v1/join/finish', {
    method: 'POST',
    headers: JSON_ORIGIN,
    body: JSON.stringify({
      kind: 'invitation',
      session_id: startBody.session_id,
      username: opts.username,
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

  const finishBody = (await finishRes.json()) as { user_id: string };
  return { userId: finishBody.user_id };
}

/** Cleans up a user and their referenced invitation rows (FK constraint). */
async function cleanupUser(userId: string): Promise<void> {
  const { db } = createDb();
  await db
    .update(pendingCodes)
    .set({ redeemedByUserId: null })
    .where(eq(pendingCodes.redeemedByUserId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

describe.skipIf(skip)('Admin audit-log endpoint', () => {
  let app: ReturnType<typeof createServer>;
  let adminId: string;
  let subjectId: string;
  let adminToken: string;

  beforeAll(async () => {
    const rlRedis = createRedis();
    const rlKeys = await rlRedis.keys('rl:join_*');
    if (rlKeys.length) await rlRedis.del(...rlKeys);
    await opaqueReady;
    app = createServer();
    ({ userId: adminId } = await registerUser(app, {
      password: 'audit-admin-pass-1',
      username: `audit-admin-${Date.now()}`,
      role: 'admin',
    }));
    ({ userId: subjectId } = await registerUser(app, {
      password: 'audit-subject-pass-1',
      username: `audit-subject-${Date.now()}`,
      role: 'user',
    }));
    // Mirror token issuance EXACTLY as admin-users.test.ts does it.
    const tokens = await issueTokens({ userId: adminId, role: 'admin' });
    adminToken = tokens.accessToken;

    // Seeded with far-future timestamps so these admin-action rows sort ahead of
    // the `user.linked` / `invitation.redeemed` rows the join flow writes for the
    // subject at registration time (those carry a null actor and createdAt = now()).
    const { db } = createDb();
    await db.insert(auditLog).values([
      {
        eventType: 'user.suspended',
        userId: subjectId,
        actorUserId: adminId,
        metadata: {},
        createdAt: new Date('2099-01-01T10:00:00Z'),
      },
      {
        eventType: 'user.unsuspended',
        userId: subjectId,
        actorUserId: adminId,
        metadata: {},
        createdAt: new Date('2099-01-01T11:00:00Z'),
      },
    ]);
  });

  afterAll(async () => {
    const { db } = createDb();
    await db.delete(auditLog).where(eq(auditLog.userId, subjectId));
    await cleanupUser(subjectId);
    await cleanupUser(adminId);
    await closeDb();
  });

  it('returns usernames for user_id and actor_user_id', async () => {
    const res = await app.request(`/api/v1/admin/audit-log?user_id=${subjectId}`, {
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: Array<{ user_username: string | null; actor_username: string | null }>;
    };
    expect(body.entries.length).toBeGreaterThanOrEqual(2);
    const first = body.entries[0];
    expect(first?.user_username).toStartWith('audit-subject-');
    expect(first?.actor_username).toStartWith('audit-admin-');
  });

  it('orders newest first', async () => {
    const res = await app.request(`/api/v1/admin/audit-log?user_id=${subjectId}`, {
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    const body = (await res.json()) as { entries: Array<{ created_at: string }> };
    const times = body.entries.map((e) => new Date(e.created_at).getTime());
    const sorted = [...times].sort((a, b) => b - a);
    expect(times).toEqual(sorted);
  });

  it('returns null usernames for a deleted user', async () => {
    const { userId: doomedId } = await registerUser(app, {
      password: 'audit-doomed-pass-1',
      username: `audit-doomed-${Date.now()}`,
      role: 'user',
    });
    const { db } = createDb();
    await db.insert(auditLog).values({
      eventType: 'user.deleted_by_admin',
      userId: null,
      actorUserId: doomedId,
      metadata: {},
    });
    await cleanupUser(doomedId);
    const res = await app.request('/api/v1/admin/audit-log?event_type=user.deleted_by_admin', {
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    const body = (await res.json()) as {
      entries: Array<{ actor_user_id: string | null; actor_username: string | null }>;
    };
    for (const entry of body.entries) {
      expect(entry.actor_username).toBeNull();
    }
  });
});
