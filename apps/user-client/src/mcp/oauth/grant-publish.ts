// SPDX-License-Identifier: AGPL-3.0-only
import type { MasterKey } from '@chatsundere/crypto';
import type { McpOAuthGrantRow } from '../../boot/client-data-db.js';
import { openSpentRefresh, openTokens } from '../../data/mcp-oauth-grants.js';
import type { EncryptedBlob } from '../../lib/secrets.js';
import { generationOf, isGrantHeld, seenOf, stampForPush } from './grant-generation.js';
import type { GrantStore } from './grant-store.js';
import type { OAuthFetch } from './oauth-fetch.js';
import { type TokenSet, revokeToken } from './token-client.js';

/** What the publish paths need; a subset of `EnsureDeps`. */
export type PublishDeps = {
  store: GrantStore;
  oauthFetch: OAuthFetch;
  hasProxy: boolean;
  isLinked: boolean;
  wallNow(): number;
};

/**
 * `published` and `adopted` settle the pending pair; `discarded` means the server row is
 * gone; `kept` leaves it for a later attempt; `none` means there was nothing to publish.
 */
export type PublishOutcome = 'published' | 'adopted' | 'discarded' | 'kept' | 'none';

/** A re-push after a conflict that is not a newer rotation, at most this often per attempt. */
const MAX_REPUSHES = 3;

/** The patch that ends a pending pair's life. */
export const CLEARED_PENDING: Partial<McpOAuthGrantRow> = {
  pendingTokens: null,
  pendingBaseRev: null,
  pendingSpentRefresh: null,
  pendingNewFamily: false,
};

/** Opens a token blob; `corrupt` instead of throwing when it does not open. */
export async function openTokensSafe(
  blob: EncryptedBlob | null | undefined,
  mk: MasterKey,
  serverId: string,
): Promise<TokenSet | null | 'corrupt'> {
  try {
    return await openTokens(blob ?? null, mk, serverId);
  } catch {
    return 'corrupt';
  }
}

/** Revokes a pair nobody will publish, best-effort (spec §5). */
async function revokePair(
  row: McpOAuthGrantRow,
  blob: EncryptedBlob,
  mk: MasterKey,
  deps: PublishDeps,
): Promise<void> {
  const pair = await openTokensSafe(blob, mk, row.id);
  if (pair === null || pair === 'corrupt' || !pair.refreshToken || !row.revocationEndpoint) return;
  if (row.tokenRoute === 'proxy' && !deps.hasProxy) return;
  await revokeToken(
    {
      revocationEndpoint: row.revocationEndpoint,
      token: pair.refreshToken,
      clientId: row.clientId,
      route: row.tokenRoute,
    },
    { oauthFetch: deps.oauthFetch, hasProxy: deps.hasProxy },
  );
}

/** The row as published: the pending pair becomes `tokens`, and the claim is released. */
function publishedRow(
  row: McpOAuthGrantRow,
  pending: EncryptedBlob,
  now: number,
): McpOAuthGrantRow {
  return { ...row, ...CLEARED_PENDING, tokens: pending, claim: null, updatedAt: now };
}

/**
 * Step 9 of spec §5, or its new-sign-in rule when `pendingNewFamily` is set. The caller
 * holds the grant lock. On an unlinked device the pair is simply promoted into `tokens`.
 */
export async function publishPending(
  serverId: string,
  deps: PublishDeps,
  mk: MasterKey,
): Promise<PublishOutcome> {
  const snap = await deps.store.snapshot(serverId);
  const pending = snap?.row.pendingTokens;
  if (!snap || !pending) return 'none';
  const row = snap.row;
  if (!deps.isLinked) {
    await deps.store.writeLocal(serverId, { ...CLEARED_PENDING, tokens: pending, claim: null });
    return 'published';
  }
  const newFamily = row.pendingNewFamily === true;
  // A held grant publishes only a new sign-in (spec §5.4); the ordinary pair waits.
  if (isGrantHeld(row) && !newFamily) return 'kept';
  const body = publishedRow(row, pending, deps.wallNow());
  let spent: string | null = null;
  if (!newFamily && row.pendingSpentRefresh) {
    try {
      spent = await openSpentRefresh(row.pendingSpentRefresh, mk, serverId);
    } catch {
      spent = null;
    }
  }
  let baseRev = row.pendingBaseRev ?? 0;
  let baseGeneration = generationOf(row);
  let seen = seenOf(row);
  for (let attempt = 0; attempt <= MAX_REPUSHES; attempt++) {
    if (attempt > 0) {
      // A pull may have refused a record or raised the mark since the last attempt.
      const fresh = await deps.store.snapshot(serverId);
      if (!fresh) return 'kept';
      if (isGrantHeld(fresh.row) && !newFamily) return 'kept';
      seen = Math.max(seen, seenOf(fresh.row));
    }
    const result = await deps.store.push(
      stampForPush({ ...body, seenGeneration: seen }, baseGeneration),
      baseRev,
      mk,
    );
    if (result.status === 'ok') {
      if (result.written === false) {
        // The server took the pair, but a newer local revision kept it out of the row. A
        // hold means that revision was refused, so the pair may be the only copy this
        // device has; otherwise an accepted newer row superseded it, and publishing it
        // again could present a spent token.
        const after = await deps.store.snapshot(serverId);
        if (after && isGrantHeld(after.row)) return 'kept';
      }
      await deps.store.writeLocal(serverId, CLEARED_PENDING);
      return 'published';
    }
    if (result.status === 'tombstoned') {
      await revokePair(row, pending, mk, deps);
      await deps.store.writeLocal(serverId, CLEARED_PENDING);
      return 'discarded';
    }
    if (result.status !== 'conflict') return 'kept';
    if (newFamily) {
      // A fresh sign-in always beats the old row, whatever it holds; its generation still
      // has to climb above the row it overwrites when that row opens (spec §5.2).
      const opened = await deps.store.open(result.current, mk);
      baseGeneration = opened ? generationOf(opened) : generationOf(row);
      baseRev = result.current.rev;
      continue;
    }
    const current = await deps.store.open(result.current, mk);
    if (!current) return 'kept';
    if (generationOf(current) < seen) {
      // An older copy than this device has seen: a refusal, never a base (spec §5.3).
      // The adopt outcome is ignored on purpose: refused or stale, the pair is kept.
      await deps.store.adopt(result.current);
      return 'kept';
    }
    const currentTokens = await openTokensSafe(current.tokens, mk, serverId);
    if (currentTokens === 'corrupt' || spent === null) return 'kept';
    if ((currentTokens?.refreshToken ?? null) === spent) {
      // Nothing newer exists; the row may carry another device's claim over the spent token.
      baseGeneration = generationOf(current);
      baseRev = result.current.rev;
      continue;
    }
    // A newer rotation or sign-in won, unless the adopt itself was refused.
    if ((await deps.store.adopt(result.current)) === 'refused') return 'kept';
    await deps.store.writeLocal(serverId, CLEARED_PENDING);
    return 'adopted';
  }
  return 'kept';
}
