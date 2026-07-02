// SPDX-License-Identifier: MIT

/** Collections the sync server accepts (spec §5.4). */
export const SYNC_COLLECTIONS = [
  'settings',
  'providers',
  'mcpServers',
  'mindspaces',
  'personas',
  'chats',
  'messages',
  'pills',
  'seedTemplates',
  'libraries',
  'documents',
  'vectors',
  'memoryJournal',
  'memoryBody',
  'compactionCheckpoints',
] as const;
export type SyncCollection = (typeof SYNC_COLLECTIONS)[number];

/** One record on the push wire. Binary fields are base64url strings. */
export interface SyncPushRecord {
  blindId: string;
  collection: SyncCollection;
  envelopeVersion: number;
  baseRev: number;
  deleted: boolean;
  nonce?: string;
  ciphertext?: string;
  ciphertextHash?: string;
}

/** One record on the pull wire; tombstones omit the crypto fields. */
export interface SyncPulledRecord {
  blindId: string;
  collection: SyncCollection;
  envelopeVersion?: number;
  rev: number;
  deleted: boolean;
  nonce?: string;
  ciphertext?: string;
  ciphertextHash?: string;
}

export type SyncRecordErrorCode =
  | 'bad_collection'
  | 'collection_mismatch'
  | 'record_too_large'
  | 'quota_exceeded'
  | 'delete_rate_limited'
  | 'hash_mismatch';

export type SyncPushResult =
  | { status: 'ok'; rev: number }
  | { status: 'conflict'; current: SyncPulledRecord }
  | { status: 'tombstoned'; current: SyncPulledRecord }
  | { status: 'error'; code: SyncRecordErrorCode; usedBytes?: number; quotaBytes?: number };

export interface SyncPushRequest {
  records: SyncPushRecord[];
}
export interface SyncPushResponse {
  head: number;
  epoch: string;
  results: SyncPushResult[];
}
export interface SyncPullResponse {
  head: number;
  epoch: string;
  more: boolean;
  records: SyncPulledRecord[];
}
export interface DoorbellTicketResponse {
  ticket: string;
}
export interface DoorbellPoke {
  rev: number;
  epoch: string;
}

/** Redis deny-list keys (spec §9) — written by auth-service, read by sync-service. */
export const revokedJtiKey = (jti: string): string => `revoked:jti:${jti}`;
export const revokedSubKey = (sub: string): string => `revoked:sub:${sub}`;
