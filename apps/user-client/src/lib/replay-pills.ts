// SPDX-License-Identifier: AGPL-3.0-only
import { type AttachmentRow, type PillRow, getClientDataDb } from '../boot/client-data-db.js';

/** Load the pills of the given messages in one indexed query, keyed by pill id. */
export async function loadReplayPills(messageIds: string[]): Promise<Map<string, PillRow>> {
  if (messageIds.length === 0) return new Map();
  const rows = await getClientDataDb().pills.where('messageId').anyOf(messageIds).toArray();
  return new Map(rows.map((p) => [p.id, p]));
}

/** Load the attachments of the given messages in one indexed query, grouped by message id and sorted by `order`. */
export async function loadReplayAttachments(
  messageIds: string[],
): Promise<Map<string, AttachmentRow[]>> {
  const out = new Map<string, AttachmentRow[]>();
  if (messageIds.length === 0) return out;
  const rows = await getClientDataDb().attachments.where('messageId').anyOf(messageIds).toArray();
  for (const a of rows) {
    if (a.messageId === null) continue;
    const list = out.get(a.messageId);
    if (list) list.push(a);
    else out.set(a.messageId, [a]);
  }
  for (const list of out.values()) list.sort((a, b) => a.order - b.order);
  return out;
}
