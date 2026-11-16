// SPDX-License-Identifier: AGPL-3.0-only
import type { MasterKey } from '@chatsundere/crypto';
import type { SyncPulledRecord } from '@chatsundere/shared-types';
import { type McpOAuthGrantRow, getClientDataDb } from '../../boot/client-data-db.js';
import { type ApplyOutcome, applyRecord, flushInvalidations } from '../../sync/apply.js';
import {
  type DirectPushResult,
  openPulledGrant,
  pushRecordDirect,
  runSyncCycle,
  snapshotGrant,
} from '../../sync/worker.js';

/**
 * What adopting a server record did (spec §5.3). Over Dexie: `inserted` and
 * `resolved` (pulled) map to `adopted`; `refused` maps to `refused`; every other
 * apply outcome (`echo`, `stale`, `rejected`, `tamper`, `suppressed`,
 * `unavailable`, `skipped`, `tombstoned`) maps to `stale`.
 */
export type AdoptOutcome = 'adopted' | 'refused' | 'stale';

/** Maps an apply outcome onto what a grant caller needs to know. */
export function adoptOutcomeOf(outcome: ApplyOutcome): AdoptOutcome {
  if (outcome.kind === 'inserted') return 'adopted';
  if (outcome.kind === 'resolved' && outcome.winner === 'pulled') return 'adopted';
  if (outcome.kind === 'refused') return 'refused';
  return 'stale';
}

/**
 * Everything the refresh algorithm needs from storage and sync (spec §5). The real one
 * sits on Dexie and the sync server; tests give each simulated device its own.
 */
export interface GrantStore {
  /** Row and revision, read together. */
  snapshot(id: string): Promise<{ row: McpOAuthGrantRow; rev: number } | null>;
  /** Writes a whole row locally, replacing any other; never reaches the server by itself. */
  putLocal(row: McpOAuthGrantRow): Promise<void>;
  /** A local-only patch; never reaches the server by itself. */
  writeLocal(id: string, patch: Partial<McpOAuthGrantRow>): Promise<void>;
  /** The direct compare-and-set push of exactly this row at exactly this base. */
  push(row: McpOAuthGrantRow, baseRev: number, mk: MasterKey): Promise<DirectPushResult>;
  /** Opens a record the server returned; null when it does not open. */
  open(record: SyncPulledRecord, mk: MasterKey): Promise<McpOAuthGrantRow | null>;
  /** Applies a record the server returned, as a pull would, and says what it did. */
  adopt(record: SyncPulledRecord): Promise<AdoptOutcome>;
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
    putLocal: async (row) => {
      await getClientDataDb().mcpOAuthGrants.put(row);
    },
    writeLocal: async (id, patch) => {
      await getClientDataDb().mcpOAuthGrants.update(id, patch);
    },
    push: (row, baseRev, mk) =>
      pushRecordDirect({ collection: 'mcpOAuthGrants', key: row.id, row, baseRev, mk }),
    open: (record, mk) => openPulledGrant(mk, record),
    adopt: async (record) => {
      const outcome = await applyRecord(record);
      flushInvalidations();
      return adoptOutcomeOf(outcome);
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
