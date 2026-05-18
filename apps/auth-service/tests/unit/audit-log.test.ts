// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { writeAudit } from '../../src/audit/log.js';

describe('writeAudit', () => {
  it('rejects metadata that does not match the per-event schema', async () => {
    const inserts: unknown[] = [];
    const fakeDb = {
      insert: () => ({
        values: async (row: unknown) => {
          inserts.push(row);
        },
      }),
      // biome-ignore lint/suspicious/noExplicitAny: minimal stub — only the insert chain matters
    } as any;
    await expect(
      writeAudit({
        db: fakeDb,
        eventType: 'invitation.created',
        metadata: { invitation_id: 'x' }, // missing role + expires_at
      }),
    ).rejects.toThrow();
    expect(inserts.length).toBe(0);
  });

  it('rejects metadata larger than 2 KiB', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: minimal stub — only the insert chain matters
    const fakeDb = { insert: () => ({ values: async () => undefined }) } as any;
    const big = 'x'.repeat(3000);
    await expect(
      writeAudit({
        db: fakeDb,
        eventType: 'invitation.created',
        metadata: { invitation_id: big, role: 'user', expires_at: '2026-01-01T00:00:00Z' },
      }),
    ).rejects.toThrow(/exceeds 2048 bytes/);
  });

  it('accepts well-formed metadata under the cap', async () => {
    const inserts: unknown[] = [];
    const fakeDb = {
      insert: () => ({
        values: async (row: unknown) => {
          inserts.push(row);
        },
      }),
      // biome-ignore lint/suspicious/noExplicitAny: minimal stub — only the insert chain matters
    } as any;
    await writeAudit({
      db: fakeDb,
      eventType: 'invitation.created',
      metadata: { invitation_id: 'inv-1', role: 'user', expires_at: '2026-01-01T00:00:00Z' },
    });
    expect(inserts.length).toBe(1);
  });
});
