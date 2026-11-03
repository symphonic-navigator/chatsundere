// SPDX-License-Identifier: AGPL-3.0-only
import type { MasterKey } from '@chatsundere/crypto';
import type { SyncPulledRecord } from '@chatsundere/shared-types';
import { type McpOAuthGrantRow, getClientDataDb } from '../../boot/client-data-db.js';
import { applyRecord, flushInvalidations } from '../../sync/apply.js';
import {
  type DirectPushResult,
  openPulledGrant,
  pushRecordDirect,
  runSyncCycle,
  snapshotGrant,
} from '../../sync/worker.js';

/**
 * Everything the refresh algorithm needs from storage and sync (spec §5). The real one
 * sits on Dexie and the sync server; tests give each simulated device its own.
 */
export interface GrantStore {
  /** Row and revision, read together. */
  snapshot(id: string): Promise<{ row: McpOAuthGrantRow; rev: number } | null>;
  /** A local-only patch; never reaches the server by itself. */
  writeLocal(id: string, patch: Partial<McpOAuthGrantRow>): Promise<void>;
  /** The direct compare-and-set push of exactly this row at exactly this base. */
  push(row: McpOAuthGrantRow, baseRev: number, mk: MasterKey): Promise<DirectPushResult>;
  /** Opens a record the server returned; null when it does not open. */
  open(record: SyncPulledRecord, mk: MasterKey): Promise<McpOAuthGrantRow | null>;
  /** Applies a record the server returned, as a pull would. */
  adopt(record: SyncPulledRecord): Promise<void>;
  /** Ids of grants holding an unpublished pair. */
  pendingIds(): Promise<string[]>;
  /** Asks for a sync cycle without waiting for it. */
  requestSync(): void;
}

/** A waiting device polls every second; a cycle is asked for at most this often. */
const SYNC_REQUEST_INTERVAL_MS = 2_000;

/** The grant store over this device's database and the sync server. */
export function createDexieGrantStore(): GrantStore {
  let lastRequest = Number.NEGATIVE_INFINITY;
  return {
    snapshot: (id) => snapshotGrant(id),
    writeLocal: async (id, patch) => {
      await getClientDataDb().mcpOAuthGrants.update(id, patch);
    },
    push: (row, baseRev, mk) =>
      pushRecordDirect({ collection: 'mcpOAuthGrants', key: row.id, row, baseRev, mk }),
    open: (record, mk) => openPulledGrant(mk, record),
    adopt: async (record) => {
      await applyRecord(record);
      flushInvalidations();
    },
    pendingIds: async () =>
      (await getClientDataDb()
        .mcpOAuthGrants.filter((r) => r.pendingTokens !== null && r.pendingTokens !== undefined)
        .primaryKeys()) as string[],
    requestSync: () => {
      const now = Date.now();
      if (now - lastRequest < SYNC_REQUEST_INTERVAL_MS) return;
      lastRequest = now;
      // Never awaited: a grant holder must not wait on a sync cycle (lock order, spec §5).
      void runSyncCycle().catch(() => undefined);
    },
  };
}
