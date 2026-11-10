// SPDX-License-Identifier: AGPL-3.0-only
import { type MasterKey, asMasterKey } from '@chatsundere/crypto';
import { useAccountLinkStore, useSessionStore } from '@chatsundere/ui-shared';
import type { McpOAuthGrantRow } from '../../boot/client-data-db.js';
import { getDeviceId, sealSpentRefresh, sealTokens } from '../../data/mcp-oauth-grants.js';
import { isProxyAvailable } from '../../lib/proxy-auth.js';
import { generationOf, isGrantHeld, stampForPush } from './grant-generation.js';
import { type GrantLockFn, withGrantLock } from './grant-lock.js';
import { type PublishOutcome, openTokensSafe, publishPending } from './grant-publish.js';
import { type AdoptOutcome, type GrantStore, createDexieGrantStore } from './grant-store.js';
import { type OAuthFetch, createOAuthFetch } from './oauth-fetch.js';
import { type TokenSet, refreshTokens } from './token-client.js';
import { OAuthError } from './url.js';

export type { GrantStore } from './grant-store.js';

/**
 * Refresh serialisation across devices (MCP OAuth spec §5). A device presents a refresh
 * token only if that exact token was in the row it just won a compare-and-set with, and
 * that row carried no claim it had not watched lapse. Every number below is from §5.
 */

/** A foreign claim may be taken over after this long, observed on our own clock. */
const CLAIM_LEASE_MS = 5 * 60_000;
/** How long one call waits for a foreign claim before returning `waiting`. */
const WAIT_BUDGET_MS = 20_000;
/** A lost response is retried with the same token only within this window. */
const RETRY_WINDOW_MS = 25_000;
/** Past this since the claim was won, a tab has been frozen; it must not send. */
const FROZEN_AFTER_MS = 60_000;
/** An access token with less than this left is refreshed proactively. */
const PROACTIVE_MS = 60_000;
const POLL_MS = 1_000;
const RETRY_PAUSE_MS = 2_000;
const MAX_CLAIM_CONFLICTS = 3;
/** Belt and braces against a loop no rule above foresaw. */
const MAX_STEPS = 64;

/** The outcome of asking for a usable access token. */
export type EnsureResult =
  | { ok: true; accessToken: string }
  | {
      ok: false;
      reason: 'dead' | 'no-grant' | 'waiting' | 'in-doubt' | 'locked' | 'no-proxy' | 'held';
    };

/** Collaborators of the refresh algorithm; all time comes from here so tests can drive it. */
export interface EnsureDeps {
  store: GrantStore;
  oauthFetch: OAuthFetch;
  mk: MasterKey | null;
  isLinked: boolean;
  /**
   * False while the link status is still unknown (boot). Then nothing is claimed, pushed
   * or promoted: an unlinked write on a device that turns out linked could present a
   * spent token. Defaults to true.
   */
  linkKnown?: boolean | undefined;
  hasProxy: boolean;
  deviceId: string;
  wallNow(): number;
  monotonicNow(): number;
  sleep(ms: number): Promise<void>;
  /** Per device: the revision each claimed grant was first seen at, on the monotonic clock. */
  observations: Map<string, { rev: number; since: number }>;
  /** The grant lock; defaults to the Web Lock. Simulated devices each bring their own. */
  lock?: GrantLockFn | undefined;
}

type EnsureOpts = { rejectedToken?: string; signal?: AbortSignal; onWaiting?: () => void };

type Run = { serverId: string; deps: EnsureDeps; mk: MasterKey; opts: EnsureOpts };

const fail = (reason: Extract<EnsureResult, { ok: false }>['reason']): EnsureResult => ({
  ok: false,
  reason,
});
const ok = (accessToken: string): EnsureResult => ({ ok: true, accessToken });

/**
 * Whether the hold stops this row (MCP OAuth hardening spec §5.4). A new sign-in's
 * pending pair is never blocked: it is this device's own fresh grant, and its `ok`
 * clears the hold.
 */
function blocked(row: McpOAuthGrantRow): boolean {
  return isGrantHeld(row) && !(row.pendingTokens && row.pendingNewFamily === true);
}

/** One per tab: a lease is observed across many calls of at most 20 s each. */
const observations = new Map<string, { rev: number; since: number }>();

/** The real collaborators. The key is read afresh on every call. */
export async function createEnsureDeps(): Promise<EnsureDeps> {
  return {
    store: createDexieGrantStore(),
    oauthFetch: createOAuthFetch(),
    mk: useSessionStore.getState().mk,
    isLinked: useAccountLinkStore.getState().linkStatus === 'linked',
    linkKnown: ['linked', 'local-only'].includes(useAccountLinkStore.getState().linkStatus),
    hasProxy: isProxyAvailable(),
    deviceId: await getDeviceId(),
    wallNow: () => Date.now(),
    monotonicNow: () => performance.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    observations,
  };
}

/**
 * A private copy of the key, because locking the app zeroes the session's buffer in
 * place. Null when there is no key, or it is already zeroed.
 */
export function copyKey(mk: MasterKey | null): MasterKey | null {
  if (mk === null) return null;
  const copy = new Uint8Array(mk);
  if (copy.every((b) => b === 0)) return null;
  return asMasterKey(copy);
}

function usable(t: TokenSet, run: Run): boolean {
  if (t.accessToken === run.opts.rejectedToken) return false;
  return t.accessExpiresAt === null || t.accessExpiresAt - run.deps.wallNow() > PROACTIVE_MS;
}

/** Sleeps, but returns false at once when the caller aborts. */
async function pause(run: Run, ms: number): Promise<boolean> {
  const signal = run.opts.signal;
  if (signal?.aborted) return false;
  if (!signal) {
    await run.deps.sleep(ms);
    return true;
  }
  let onAbort = (): void => undefined;
  const aborted = new Promise<false>((resolve) => {
    onAbort = () => resolve(false);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([run.deps.sleep(ms).then(() => true), aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/** True once this device has seen the claim at this revision for the whole lease. */
function claimLapsed(run: Run, rev: number): boolean {
  const now = run.deps.monotonicNow();
  const seen = run.deps.observations.get(run.serverId);
  if (!seen || seen.rev !== rev) {
    run.deps.observations.set(run.serverId, { rev, since: now });
    return false;
  }
  return now - seen.since >= CLAIM_LEASE_MS;
}

type Presented =
  | { kind: 'ok'; pair: TokenSet }
  | { kind: 'invalid' }
  | { kind: 'failed' }
  | { kind: 'in-doubt' }
  | { kind: 'frozen'; sent: boolean };

/**
 * POSTs the refresh token, retrying a lost response on the same route within 25 s of the
 * first send. With `wonAt`, each POST is preceded by the frozen-tab check (step 7). The
 * caller's signal never reaches the request: a request once sent is seen through.
 */
async function present(
  run: Run,
  row: McpOAuthGrantRow,
  refreshToken: string,
  wonAt: { wall: number; mono: number } | null,
): Promise<Presented> {
  const { deps } = run;
  let firstSend: number | null = null;
  for (;;) {
    if (
      wonAt &&
      (deps.wallNow() - wonAt.wall > FROZEN_AFTER_MS ||
        deps.monotonicNow() - wonAt.mono > FROZEN_AFTER_MS)
    ) {
      return { kind: 'frozen', sent: firstSend !== null };
    }
    if (firstSend !== null && deps.monotonicNow() - firstSend >= RETRY_WINDOW_MS) {
      return { kind: 'in-doubt' };
    }
    firstSend ??= deps.monotonicNow();
    try {
      const pair = await refreshTokens(
        {
          tokenEndpoint: row.tokenEndpoint,
          refreshToken,
          clientId: row.clientId,
          resource: row.resource,
          route: row.tokenRoute,
        },
        { oauthFetch: deps.oauthFetch, hasProxy: deps.hasProxy, now: () => deps.wallNow() },
      );
      return { kind: 'ok', pair };
    } catch (err) {
      const kind = err instanceof OAuthError ? err.kind : null;
      if (kind === 'invalid-grant') return { kind: 'invalid' };
      if (kind !== 'network') return { kind: 'failed' };
      await deps.sleep(RETRY_PAUSE_MS);
    }
  }
}

/**
 * Releases our claim by compare-and-set at the claim's revision. The push is advisory;
 * the returned adopt outcome of a conflict (null without one) tells the caller whether
 * the server answered with an older generation it must hold off.
 */
async function releaseClaim(
  run: Run,
  claimed: McpOAuthGrantRow,
  rev: number,
): Promise<AdoptOutcome | null> {
  const released = stampForPush({ ...claimed, claim: null }, generationOf(claimed));
  const result = await run.deps.store.push(released, rev, run.mk);
  if (result.status !== 'conflict') return null;
  return run.deps.store.adopt(result.current);
}

/** After `adopted`: the adopted row's token when usable and not held, otherwise `fallback`. */
async function adoptedOr(run: Run, fallback: EnsureResult): Promise<EnsureResult> {
  const snap = await run.deps.store.snapshot(run.serverId);
  if (snap && blocked(snap.row)) return fail('held');
  const t = snap ? await openTokensSafe(snap.row.tokens, run.mk, run.serverId) : null;
  return t && t !== 'corrupt' && usable(t, run) ? ok(t.accessToken) : fallback;
}

/** Steps 7 to 9, once the claim is won at revision `rev`. Null means go back to step 2. */
async function refreshUnderClaim(
  run: Run,
  claimed: McpOAuthGrantRow,
  rev: number,
  refreshToken: string,
  wonAt: { wall: number; mono: number },
): Promise<EnsureResult | null> {
  const { deps, mk, serverId } = run;
  const outcome = await present(run, claimed, refreshToken, wonAt);
  switch (outcome.kind) {
    case 'frozen':
      // Nothing went out, so the token is unspent: release the claim rather than leave
      // every device waiting out a lease over it.
      if (!outcome.sent && (await releaseClaim(run, claimed, rev)) === 'refused') {
        return fail('held');
      }
      return null;
    case 'failed':
      if ((await releaseClaim(run, claimed, rev)) === 'refused') return fail('held');
      return fail('waiting');
    case 'in-doubt':
      if ((await releaseClaim(run, claimed, rev)) === 'refused') return fail('held');
      return fail('in-doubt');
    case 'invalid': {
      const dead = stampForPush(
        { ...claimed, tokens: null, claim: null, updatedAt: deps.wallNow() },
        generationOf(claimed),
      );
      const result = await deps.store.push(dead, rev, mk);
      if (result.status !== 'conflict') return fail('dead');
      // Never overwrite a newer row: it may be a new sign-in.
      if ((await deps.store.adopt(result.current)) === 'refused') return fail('held');
      return adoptedOr(run, fail('dead'));
    }
    case 'ok':
      break;
  }
  const pair = outcome.pair;
  // Step 8: written ahead, because a pull may replace `tokens` before the publish.
  try {
    await deps.store.writeLocal(serverId, {
      pendingTokens: await sealTokens(pair, mk, serverId),
      pendingBaseRev: rev,
      pendingSpentRefresh: await sealSpentRefresh(refreshToken, mk, serverId),
      pendingNewFamily: false,
    });
  } catch {
    // The pair could not be kept. Our claim stays on the row, so no device presents the
    // spent token before the lease lapses; this call still gets its access token.
    return ok(pair.accessToken);
  }
  const published = await publishPending(serverId, deps, mk);
  if (published === 'discarded') return fail('dead');
  if (published === 'adopted') return adoptedOr(run, ok(pair.accessToken));
  if (published === 'kept') {
    // A refusal may have landed since the claim (plan D-9): the fresh pair stays pending
    // and our claim stays on the row, so no device presents the spent token meanwhile.
    const snap = await deps.store.snapshot(serverId);
    if (snap && blocked(snap.row)) return fail('held');
  }
  return ok(pair.accessToken);
}

/** Step 3's answer while a pair stays unpublished: never a claim. */
async function pendingAnswer(run: Run, row: McpOAuthGrantRow): Promise<EnsureResult> {
  const pair = await openTokensSafe(row.pendingTokens, run.mk, run.serverId);
  return pair && pair !== 'corrupt' && usable(pair, run) ? ok(pair.accessToken) : fail('waiting');
}

async function linkedFlow(run: Run): Promise<EnsureResult> {
  const { deps, serverId, mk, opts } = run;
  const startMono = deps.monotonicNow();
  let claimConflicts = 0;
  let frozenOnce = false;
  let toldWaiting = false;
  for (let step = 0; step < MAX_STEPS; step++) {
    // Step 2.
    let snap = await deps.store.snapshot(serverId);
    if (!snap) return fail('no-grant');
    // Checked at every snapshot, not only on entry: a pull may refuse an older copy at
    // any point, and the next claim would otherwise be pushed over it.
    if (blocked(snap.row)) return fail('held');
    // Step 3.
    if (snap.row.pendingTokens) {
      const outcome: PublishOutcome = await publishPending(serverId, deps, mk);
      if (outcome === 'discarded') return fail('dead');
      snap = await deps.store.snapshot(serverId);
      if (!snap) return fail('no-grant');
      if (blocked(snap.row)) return fail('held');
      if (snap.row.pendingTokens) return pendingAnswer(run, snap.row);
    }
    const { row, rev } = snap;
    // Step 4.
    const tokens = await openTokensSafe(row.tokens, mk, serverId);
    if (tokens === null || tokens === 'corrupt') return fail('dead');
    if (usable(tokens, run)) return ok(tokens.accessToken);
    // Step 5: any claim, our own leftover included, may cover a token already spent.
    if (row.claim) {
      if (!claimLapsed(run, rev)) {
        if (deps.monotonicNow() - startMono >= WAIT_BUDGET_MS) return fail('waiting');
        if (!toldWaiting) {
          toldWaiting = true;
          opts.onWaiting?.();
        }
        deps.store.requestSync();
        const left = WAIT_BUDGET_MS - (deps.monotonicNow() - startMono);
        if (!(await pause(run, Math.max(1, Math.min(POLL_MS, left))))) return fail('waiting');
        continue;
      }
    } else {
      deps.observations.delete(serverId);
    }
    // Step 6.
    if (!tokens.refreshToken) return fail('dead');
    if (row.tokenRoute === 'proxy' && !deps.hasProxy) return fail('no-proxy');
    // Taken before the push, so a freeze while its answer is in flight also counts.
    const wonAt = { wall: deps.wallNow(), mono: deps.monotonicNow() };
    // Stamped, so the release and `invalid_grant` pushes over it land one generation higher.
    const claimed = stampForPush(
      { ...row, claim: { deviceId: deps.deviceId, at: wonAt.wall } },
      generationOf(row),
    );
    const result = await deps.store.push(claimed, rev, mk);
    if (result.status === 'conflict') {
      claimConflicts++;
      if ((await deps.store.adopt(result.current)) === 'refused') return fail('held');
      if (claimConflicts >= MAX_CLAIM_CONFLICTS) return fail('waiting');
      continue;
    }
    if (result.status === 'tombstoned') return fail('dead');
    if (result.status !== 'ok') return fail('waiting');
    deps.observations.delete(serverId);
    const done = await refreshUnderClaim(run, claimed, result.rev, tokens.refreshToken, wonAt);
    if (done) return done;
    // A second freeze in one call: give up rather than claim again and again.
    if (frozenOnce) return fail('waiting');
    frozenOnce = true;
  }
  return fail('waiting');
}

/** An unlinked device: the lock alone serialises, and every write is local (spec §5). */
async function unlinkedFlow(run: Run): Promise<EnsureResult> {
  const { deps, serverId, mk } = run;
  let snap = await deps.store.snapshot(serverId);
  if (!snap) return fail('no-grant');
  if (snap.row.pendingTokens) {
    // Promoted first, so the token the pair replaced is never presented.
    await publishPending(serverId, deps, mk);
    snap = await deps.store.snapshot(serverId);
    if (!snap) return fail('no-grant');
  }
  const row = snap.row;
  const tokens = await openTokensSafe(row.tokens, mk, serverId);
  if (tokens === null || tokens === 'corrupt') return fail('dead');
  if (usable(tokens, run)) return ok(tokens.accessToken);
  if (!tokens.refreshToken) return fail('dead');
  if (row.tokenRoute === 'proxy' && !deps.hasProxy) return fail('no-proxy');
  const outcome = await present(run, row, tokens.refreshToken, null);
  switch (outcome.kind) {
    case 'ok':
      await deps.store.writeLocal(serverId, {
        tokens: await sealTokens(outcome.pair, mk, serverId),
        claim: null,
        updatedAt: deps.wallNow(),
      });
      return ok(outcome.pair.accessToken);
    case 'invalid':
      await deps.store.writeLocal(serverId, {
        tokens: null,
        claim: null,
        updatedAt: deps.wallNow(),
      });
      return fail('dead');
    case 'in-doubt':
      return fail('in-doubt');
    default:
      return fail('waiting');
  }
}

/**
 * Returns a usable access token for an OAuth server, refreshing under the cross-device
 * claim when needed (spec §5). `rejectedToken` is the token a 401 just refused;
 * `opts.signal` only cancels waiting and never reaches a request.
 */
export async function ensureAccessToken(
  serverId: string,
  deps: EnsureDeps,
  opts: EnsureOpts = {},
): Promise<EnsureResult> {
  const mk = copyKey(deps.mk);
  if (mk === null) return fail('locked');
  if (deps.linkKnown === false) {
    mk.fill(0);
    return fail('waiting');
  }
  const lock = deps.lock ?? withGrantLock;
  const run: Run = { serverId, deps, mk, opts };
  try {
    return await lock(serverId, () => (deps.isLinked ? linkedFlow(run) : unlinkedFlow(run)), {
      signal: opts.signal,
    });
  } catch {
    // An abort, or anything unforeseen (storage, sealing): never surfaced to the caller,
    // whose only safe reading is to wait. The message may name internals.
    return fail('waiting');
  } finally {
    mk.fill(0);
  }
}

/**
 * Publishes a new sign-in's pending pair, which always beats the old row (spec §5 "New
 * sign-ins"). The caller holds the grant lock; locks here are not re-entrant.
 */
export async function publishNewFamily(serverId: string, deps: EnsureDeps): Promise<void> {
  if (deps.linkKnown === false) return;
  const mk = copyKey(deps.mk);
  if (mk === null) return;
  try {
    await publishPending(serverId, deps, mk);
  } finally {
    mk.fill(0);
  }
}

/** Publishes every grant's unpublished pair, taking each grant's lock in turn. */
export async function publishPendingTokens(deps: EnsureDeps): Promise<void> {
  if (deps.linkKnown === false) return;
  const mk = copyKey(deps.mk);
  if (mk === null) return;
  const lock = deps.lock ?? withGrantLock;
  try {
    for (const id of await deps.store.pendingIds()) {
      try {
        await lock(id, () => publishPending(id, deps, mk));
      } catch {
        // One grant's failure must not hold back the others; it is retried next cycle.
      }
    }
  } finally {
    mk.fill(0);
  }
}
