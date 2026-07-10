// SPDX-License-Identifier: AGPL-3.0-only
//
// Layer-1 (app-level) coverage for the `rows.length > 1` branch of
// assertOpaqueWrappingPresent (src/auth/wrapping-integrity.ts). Task A3
// (migration 0006) added a DB-level partial unique index that makes a
// genuine second OPAQUE row unreachable via any real insert, so
// tests/integration/wrapping-integrity.test.ts was rewritten to drive that
// stronger DB-layer guarantee directly — which left this app-level
// defence-in-depth branch (retained for e.g. a constraint dropped
// out-of-band) with zero coverage. This test restores it by injecting a
// fake DB that reports two OPAQUE rows for the same user, bypassing the
// need to defeat the DB constraint via a real insert.

import { describe, expect, it, spyOn } from 'bun:test';
import { assertOpaqueWrappingPresent } from '../../src/auth/wrapping-integrity.js';
import type { Db } from '../../src/db/client.js';
import { metrics } from '../../src/metrics.js';

function fakeDbWithTwoOpaqueRows(inserts: unknown[]): Db {
  return {
    select: () => ({
      from: () => ({
        where: async () => [
          {
            wrappedMasterKey: new Uint8Array(32),
            wrapNonce: new Uint8Array(12),
            wrapAad: new Uint8Array(8),
          },
          {
            wrappedMasterKey: new Uint8Array(32),
            wrapNonce: new Uint8Array(12),
            wrapAad: new Uint8Array(8),
          },
        ],
      }),
    }),
    insert: () => ({
      values: async (row: unknown) => {
        inserts.push(row);
      },
    }),
    // biome-ignore lint/suspicious/noExplicitAny: minimal stub — only the select/insert chains exercised by assertOpaqueWrappingPresent matter
  } as any;
}

describe('assertOpaqueWrappingPresent — multiple_opaque_methods branch', () => {
  it('throws a generic error, writes the audit row, and increments the metric — without leaking the reason', async () => {
    const inserts: unknown[] = [];
    const db = fakeDbWithTwoOpaqueRows(inserts);
    const incSpy = spyOn(metrics.authWrappingInvariantViolationsTotal, 'inc');

    let thrown: unknown;
    try {
      await assertOpaqueWrappingPresent({ userId: 'user-1', db });
    } catch (err) {
      thrown = err;
    }

    // 1. Throws a generic 500-class error that does not leak "multiple" or
    // "null" — the joining device must not learn the specific reason.
    expect(thrown).toBeInstanceOf(Error);
    const err = thrown as Error & { status?: number };
    expect(err.status).toBe(500);
    const message = err.message.toLowerCase();
    expect(message).not.toContain('multiple');
    expect(message).not.toContain('null');

    // 2. Writes the wrapping_invariant_violated audit row with the correct
    // reason (the reason IS allowed server-side, in the audit log; it is
    // only withheld from the HTTP response above).
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      eventType: 'wrapping_invariant_violated',
      userId: 'user-1',
      metadata: { reason: 'multiple_opaque_methods' },
    });

    // 3. Increments the metric with the correct reason label.
    expect(incSpy).toHaveBeenCalledTimes(1);
    expect(incSpy).toHaveBeenCalledWith({ reason: 'multiple_opaque_methods' });

    incSpy.mockRestore();
  });
});
