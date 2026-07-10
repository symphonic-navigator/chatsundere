// SPDX-License-Identifier: AGPL-3.0-only
//
// Concurrency backstop for auth_methods (Finding #9 defence-in-depth, Task
// A3): two interleaved delete-then-insert transactions — the exact shape
// routes/recovery.ts's /finish handler uses — must never leave two 'opaque'
// rows for one user, even if the nonce-consumption race that normally
// serialises concurrent recovery/finish calls (Task A2's GETDEL fix) is
// bypassed, or races independently at the DB layer.
//
// Two `db.transaction()` calls fired via Promise.all do NOT reliably
// interleave — bun/postgres.js executes them back-to-back on separate pool
// connections in practice, so the natural race never manifests. Instead this
// test drives two manually-reserved connections directly, forcing the exact
// interleave that would corrupt the row set: A deletes and holds the
// transaction open, B's DELETE blocks on A's row lock, A inserts+commits,
// then B's DELETE unblocks (finding nothing left to delete) before B
// attempts its own INSERT. Requires a live PostgreSQL instance. Skipped when
// DATABASE_URL is absent.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { closeDb, createDb } from '../../src/db/client.js';
import { authMethods, users } from '../../src/db/schema.js';

const skip = !process.env.DATABASE_URL;

describe.skipIf(skip)('auth_methods unique (user_id, method_type) backstop for opaque', () => {
  let userId: string;

  beforeAll(async () => {
    const { db } = createDb();
    const inserted = await db
      .insert(users)
      .values({
        username: `unique-idx-test-${Date.now()}`,
        role: 'user',
        recoveryVerifierKey: new Uint8Array(32),
      })
      .returning({ id: users.id });
    const row = inserted[0];
    if (!row) throw new Error('test setup: user insert returned no row');
    userId = row.id;

    await db.insert(authMethods).values({
      userId,
      methodType: 'opaque',
      opaqueCredential: new Uint8Array(32),
      wrappedMasterKey: new Uint8Array(32),
      wrapNonce: new Uint8Array(12),
      wrapAad: new Uint8Array(16),
    });
  });

  afterAll(async () => {
    if (userId) {
      const { db } = createDb();
      await db.delete(authMethods).where(eq(authMethods.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
    await closeDb();
  });

  it('leaves exactly one opaque row after two interleaved recovery-shaped delete+insert transactions', async () => {
    const { db, sql } = createDb();

    const connA = await sql.reserve();
    const connB = await sql.reserve();

    try {
      await connA`BEGIN`;
      await connB`BEGIN`;

      // A deletes the only existing row and holds the transaction open
      // (uncommitted) — mirrors the first line of recovery.ts's tx.
      await connA`DELETE FROM auth_methods WHERE user_id = ${userId}`;

      // B's DELETE targets the same row and blocks on A's row lock until A
      // commits or rolls back. postgres.js tagged-template queries are lazy
      // (they only hit the wire once awaited), so this must be wrapped in an
      // immediately-invoked async function to force it onto the wire now —
      // otherwise it would not actually start until later, defeating the
      // interleave this test exists to force.
      const bDeletePromise = (async () =>
        connB`DELETE FROM auth_methods WHERE user_id = ${userId}`)();

      // Give B's DELETE time to reach Postgres and start blocking before A
      // commits, so the two genuinely overlap rather than running serially.
      await new Promise((resolve) => setTimeout(resolve, 100));

      // A inserts its fresh opaque row and commits — mirrors the rest of
      // recovery.ts's tx.
      await connA`INSERT INTO auth_methods
        (user_id, method_type, opaque_credential, wrapped_master_key, wrap_nonce, wrap_aad)
        VALUES (${userId}, 'opaque', ${Buffer.from([1])}, ${Buffer.alloc(32)}, ${Buffer.alloc(12)}, ${Buffer.alloc(16)})`;
      await connA`COMMIT`;

      // B's DELETE now unblocks — under READ COMMITTED it finds the row it
      // targeted already gone (deleted by A's committed tx) and affects 0
      // rows. B then attempts its own INSERT for the same (user_id, 'opaque')
      // pair A just committed.
      await bDeletePromise;
      try {
        await connB`INSERT INTO auth_methods
          (user_id, method_type, opaque_credential, wrapped_master_key, wrap_nonce, wrap_aad)
          VALUES (${userId}, 'opaque', ${Buffer.from([2])}, ${Buffer.alloc(32)}, ${Buffer.alloc(12)}, ${Buffer.alloc(16)})`;
        await connB`COMMIT`;
      } catch {
        await connB`ROLLBACK`;
      }
    } finally {
      connA.release();
      connB.release();
    }

    const rows = await db
      .select({ id: authMethods.id })
      .from(authMethods)
      .where(and(eq(authMethods.userId, userId), eq(authMethods.methodType, 'opaque')));

    expect(rows).toHaveLength(1);
  });
});
