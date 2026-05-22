// SPDX-License-Identifier: AGPL-3.0-only

import { and, eq, isNull, sql } from 'drizzle-orm';
import { createDb } from '../db/client.js';
import { pendingCodes } from '../db/schema.js';
import { ApiError } from '../middleware/error-envelope.js';

const MAX_ATTEMPTS = 3;

/**
 * Atomically increment the invitation's attempt counter and, if the cap is hit,
 * mark the invitation revoked. Returns the invitation row if still usable; throws
 * ApiError otherwise.
 */
export async function consumeInvitationAttempt(codeHmac: Uint8Array) {
  const { db } = createDb();
  const updated = await db
    .update(pendingCodes)
    .set({ attemptCount: sql`${pendingCodes.attemptCount} + 1` })
    .where(and(eq(pendingCodes.codeHmac, codeHmac), isNull(pendingCodes.revokedAt)))
    .returning();
  const row = updated[0];
  if (!row) throw new ApiError(404, 'not_found', 'Invitation not found or revoked');
  if (row.redeemedAt !== null) {
    throw new ApiError(409, 'invitation_consumed', 'Invitation already redeemed');
  }
  if (row.expiresAt < new Date()) {
    throw new ApiError(410, 'expired', 'Invitation expired');
  }
  if (row.attemptCount > MAX_ATTEMPTS) {
    await db.update(pendingCodes).set({ revokedAt: new Date() }).where(eq(pendingCodes.id, row.id));
    throw new ApiError(
      429,
      'invitation_attempts_exhausted',
      'Invitation has reached the attempt limit and is now revoked',
    );
  }
  return row;
}
