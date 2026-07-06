// SPDX-License-Identifier: AGPL-3.0-only

import { and, eq, isNull, sql } from 'drizzle-orm';
import { createDb } from '../db/client.js';
import { pendingCodes } from '../db/schema.js';
import { ApiError } from '../middleware/error-envelope.js';

const MAX_ATTEMPTS = 3;

/**
 * Atomically increments the pending code's attempt counter and, if the cap is
 * hit, marks the row revoked. Returns the row if still usable; otherwise
 * throws ApiError. Applies to both invitation and pairing codes — the error
 * shapes are deliberately generic so the same response shape covers both.
 *
 * When `expectedType` is given, a wrong-kind submission short-circuits to a
 * 400 `kind_mismatch` *without* spending an attempt — closes Larissa β M1:
 * otherwise an attacker who saw a pairing-code plaintext could exhaust the
 * 4-attempt cap by submitting `kind: 'invitation'` against it (or vice
 * versa), DoSing the legitimate user's still-valid code.
 *
 * Status codes by failure mode:
 *  - 400 `kind_mismatch`             — code's type does not match expectedType
 *  - 404 `code_not_found_or_expired` — no row, or row already revoked
 *  - 410 `code_already_redeemed`     — row was already redeemed
 *  - 410 `code_expired`              — row's expires_at is in the past
 *  - 429 `code_attempts_exhausted`   — attempt cap hit; row is now revoked
 */
export async function consumePendingCodeAttempt(
  codeHmac: Uint8Array,
  expectedType?: 'invitation' | 'pairing',
) {
  const { db } = createDb();

  if (expectedType) {
    // Pre-check type before the attempt-consuming UPDATE so wrong-kind
    // submissions cannot exhaust the legitimate user's attempt budget.
    // The type column never changes after insert, so the TOCTOU window
    // between this SELECT and the UPDATE below is not exploitable.
    const typeRows = await db
      .select({ type: pendingCodes.type })
      .from(pendingCodes)
      .where(and(eq(pendingCodes.codeHmac, codeHmac), isNull(pendingCodes.revokedAt)))
      .limit(1);
    const typeRow = typeRows[0];
    if (typeRow && typeRow.type !== expectedType) {
      // Generic message — the error.code already discriminates kind_mismatch
      // for the client; do not echo the actual `type` value back so a
      // shoulder-surfer of the code plaintext cannot learn whether the row
      // they captured is invitation- or pairing-typed (Larissa β L1).
      throw new ApiError(400, 'kind_mismatch', 'Code is not valid for this request kind');
    }
    // If typeRow is undefined the consume below will throw 404 — same shape
    // it would have without the pre-check, so no extra information leaks.
  }

  const updated = await db
    .update(pendingCodes)
    .set({ attemptCount: sql`${pendingCodes.attemptCount} + 1` })
    .where(and(eq(pendingCodes.codeHmac, codeHmac), isNull(pendingCodes.revokedAt)))
    .returning();
  const row = updated[0];
  if (!row) throw new ApiError(404, 'code_not_found_or_expired', 'Code not found or revoked');
  if (row.redeemedAt !== null) {
    // 410 Gone (was 409): a redeemed one-time code is terminally spent, not a
    // conflict — aligns with code_expired (410) and the atomic-CAS path in
    // routes/join.ts, which already emits 410 for the same code.
    throw new ApiError(410, 'code_already_redeemed', 'Code already redeemed');
  }
  if (row.expiresAt < new Date()) {
    throw new ApiError(410, 'code_expired', 'Code expired');
  }
  if (row.attemptCount > MAX_ATTEMPTS) {
    await db.update(pendingCodes).set({ revokedAt: new Date() }).where(eq(pendingCodes.id, row.id));
    throw new ApiError(
      429,
      'code_attempts_exhausted',
      'Code has reached the attempt limit and is now revoked',
    );
  }
  return row;
}
