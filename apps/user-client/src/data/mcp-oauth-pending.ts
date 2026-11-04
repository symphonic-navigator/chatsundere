// SPDX-License-Identifier: AGPL-3.0-only
import { useSessionStore } from '@chatsundere/ui-shared';
import { useQuery } from '@tanstack/react-query';
import { getClientDataDb } from '../boot/client-data-db.js';
import { copyKey } from '../mcp/oauth/ensure-token.js';
import { openPendingSignIn } from '../mcp/oauth/sign-in.js';
import { QK } from './queryKeys.js';

/** A sign-in in progress on this device, as My Integrations lists it. */
export type PendingSignInSummary = {
  state: string;
  serverId: string;
  isNewServer: boolean;
  /** The draft's name for a new server; empty for a reconnect, whose row has one. */
  name: string;
  createdAt: number;
};

const LIFETIME_MS = 10 * 60_000;

/** This device's unfinished sign-ins younger than 10 minutes, newest first. */
export async function listPendingSignIns(
  now: number = Date.now(),
): Promise<PendingSignInSummary[]> {
  const key = copyKey(useSessionStore.getState().mk);
  if (key === null) return [];
  try {
    const rows = (await getClientDataDb().mcpOAuthPending.toArray())
      .filter((r) => r.completedAt === undefined && now - r.createdAt < LIFETIME_MS)
      .sort((a, b) => b.createdAt - a.createdAt);
    const out: PendingSignInSummary[] = [];
    for (const row of rows) {
      try {
        const p = await openPendingSignIn(row, key);
        out.push({
          state: p.state,
          serverId: p.serverId,
          isNewServer: p.isNewServer,
          name: p.draft?.name ?? '',
          createdAt: row.createdAt,
        });
      } catch {
        // Sealed under another key: not this session's sign-in.
      }
    }
    return out;
  } finally {
    key.fill(0);
  }
}

/** The pending sign-ins of this device, for the list and the detail page. */
export function usePendingSignIns() {
  return useQuery({ queryKey: QK.mcpOAuthPending, queryFn: () => listPendingSignIns() });
}
