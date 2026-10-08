// SPDX-License-Identifier: AGPL-3.0-only
import { type PillRow, getClientDataDb } from '../boot/client-data-db.js';

/** Load the pills of the given messages in one indexed query, keyed by pill id. */
export async function loadReplayPills(messageIds: string[]): Promise<Map<string, PillRow>> {
  if (messageIds.length === 0) return new Map();
  const rows = await getClientDataDb().pills.where('messageId').anyOf(messageIds).toArray();
  return new Map(rows.map((p) => [p.id, p]));
}
