// SPDX-License-Identifier: AGPL-3.0-only

import { and, eq } from 'drizzle-orm';
import { writeAudit } from '../audit/log.js';
import { type Db, createDb } from '../db/client.js';
import { authMethods } from '../db/schema.js';
import { metrics } from '../metrics.js';
import { ApiError } from '../middleware/error-envelope.js';

export interface OpaqueWrapping {
  wrappedMasterKey: Uint8Array;
  wrapNonce: Uint8Array;
  wrapAad: Uint8Array;
}

/**
 * Defence-in-depth check for the join-pairing flow per ADR 0021: every
 * account has exactly one OPAQUE auth_method row, and that row carries
 * non-null `wrapped_master_key` / `wrap_nonce` / `wrap_aad`. The invariant
 * holds by construction — registration inserts the wrapping atomically with
 * the auth_method row, passphrase-change updates it atomically, and nothing
 * else writes those columns. A violation here means either a code regression
 * in those flows or external DB tampering. Both warrant alarms and a refusal
 * to surface wrapped MK material to the joining device.
 *
 * Returns the wrapping on success. On any anomaly: writes a
 * `wrapping_invariant_violated` audit row, increments
 * auth_wrapping_invariant_violations_total{reason=...}, and throws
 * ApiError(500, 'wrapping_invariant_violated', …) with a generic message —
 * we do not leak the specific reason to the joining device.
 */
export async function assertOpaqueWrappingPresent(args: {
  userId: string;
  // Injectable for unit tests that need to drive the anomaly branches
  // (rows.length === 0 / > 1, null wrapping columns) without a real DB —
  // see tests/unit/wrapping-integrity.test.ts. Production call sites omit
  // this and get the real connection.
  db?: Db;
}): Promise<OpaqueWrapping> {
  const db = args.db ?? createDb().db;
  const rows = await db
    .select({
      wrappedMasterKey: authMethods.wrappedMasterKey,
      wrapNonce: authMethods.wrapNonce,
      wrapAad: authMethods.wrapAad,
    })
    .from(authMethods)
    .where(and(eq(authMethods.userId, args.userId), eq(authMethods.methodType, 'opaque')));

  if (rows.length === 0) {
    await fail(db, args.userId, 'no_opaque_method');
  }
  if (rows.length > 1) {
    await fail(db, args.userId, 'multiple_opaque_methods');
  }
  const r = rows[0];
  // rows.length checked above so r is defined; the optional-chain keeps
  // TypeScript happy without a non-null assertion.
  if (!r?.wrappedMasterKey || !r.wrapNonce || !r.wrapAad) {
    await fail(db, args.userId, 'null_wrapping_columns');
  }
  // Narrowed by the throws inside fail() but TS does not follow that;
  // re-affirm with definite checks.
  const wrapped = r?.wrappedMasterKey;
  const nonce = r?.wrapNonce;
  const aad = r?.wrapAad;
  if (!wrapped || !nonce || !aad) {
    throw new ApiError(500, 'wrapping_invariant_violated', 'Cannot complete pairing');
  }
  return { wrappedMasterKey: wrapped, wrapNonce: nonce, wrapAad: aad };
}

async function fail(
  db: Db,
  userId: string,
  reason: 'no_opaque_method' | 'multiple_opaque_methods' | 'null_wrapping_columns',
): Promise<never> {
  await writeAudit({
    db,
    eventType: 'wrapping_invariant_violated',
    userId,
    metadata: { reason },
  });
  metrics.authWrappingInvariantViolationsTotal.inc({ reason });
  throw new ApiError(
    500,
    'wrapping_invariant_violated',
    'Cannot complete pairing — please contact your operator',
  );
}
