// SPDX-License-Identifier: AGPL-3.0-only
import type { SyncPulledRecord, SyncPushResult } from '@chatsundere/shared-types';
import type { McpOAuthGrantRow } from '../../../src/boot/client-data-db.js';

// Shared by the refresh and sign-in tests: the sync server's compare-and-set, simulated.

export const LOCAL_DEFAULTS = {
  pendingTokens: null,
  pendingBaseRev: null,
  pendingSpentRefresh: null,
  pendingNewFamily: false,
  seenGeneration: 0,
  heldGeneration: null,
} as const;

export function clone<T>(v: T): T {
  return structuredClone(v);
}

export function stripLocal(row: McpOAuthGrantRow): McpOAuthGrantRow {
  const {
    pendingTokens,
    pendingBaseRev,
    pendingSpentRefresh,
    pendingNewFamily,
    seenGeneration,
    heldGeneration,
    ...rest
  } = row;
  void pendingTokens;
  void pendingBaseRev;
  void pendingSpentRefresh;
  void pendingNewFamily;
  void seenGeneration;
  void heldGeneration;
  return rest as McpOAuthGrantRow;
}

/**
 * The sync server's per-record compare-and-set (apps/sync-service/src/records/store.ts):
 * a tombstone is terminal, an existing row with another revision conflicts, an absent
 * row is always accepted. The "ciphertext" is a reference to a stored clone.
 */
export class CasServer {
  head = 0;
  private records = new Map<string, { rev: number; deleted: boolean; ref: string | null }>();
  private bodies = new Map<string, McpOAuthGrantRow>();

  push(row: McpOAuthGrantRow, baseRev: number): SyncPushResult {
    const current = this.records.get(row.id);
    if (current?.deleted) return { status: 'tombstoned', current: this.pulled(row.id) };
    if (current !== undefined && current.rev !== baseRev) {
      return { status: 'conflict', current: this.pulled(row.id) };
    }
    const rev = ++this.head;
    const ref = `ref-${rev}`;
    this.bodies.set(ref, stripLocal(clone(row)));
    this.records.set(row.id, { rev, deleted: false, ref });
    return { status: 'ok', rev };
  }

  /** Writes as another device would, whatever the revision. */
  put(row: McpOAuthGrantRow): number {
    const result = this.push(row, this.rev(row.id));
    if (result.status !== 'ok') throw new Error('put failed');
    return result.rev;
  }

  tombstone(id: string): void {
    this.records.set(id, { rev: ++this.head, deleted: true, ref: null });
  }

  rev(id: string): number {
    return this.records.get(id)?.rev ?? 0;
  }

  row(id: string): McpOAuthGrantRow | null {
    const rec = this.records.get(id);
    if (!rec?.ref) return null;
    const body = this.bodies.get(rec.ref);
    return body ? clone(body) : null;
  }

  pulled(id: string): SyncPulledRecord {
    const rec = this.records.get(id);
    if (!rec) throw new Error('no record');
    return {
      blindId: `bid-${id}`,
      collection: 'mcpOAuthGrants',
      rev: rec.rev,
      deleted: rec.deleted,
      ...(rec.ref ? { nonce: 'n', ciphertext: rec.ref } : {}),
    };
  }

  body(ref: string): McpOAuthGrantRow | null {
    const b = this.bodies.get(ref);
    return b ? clone(b) : null;
  }

  ids(): string[] {
    return [...this.records.keys()];
  }
}
