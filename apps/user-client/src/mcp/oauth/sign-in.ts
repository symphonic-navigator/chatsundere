// SPDX-License-Identifier: AGPL-3.0-only
import type { MasterKey } from '@chatsundere/crypto';
import { useAccountLinkStore, useSessionStore } from '@chatsundere/ui-shared';
import {
  type McpOAuthGrantRow,
  type McpOAuthPendingRow,
  type McpServerRow,
  getClientDataDb,
} from '../../boot/client-data-db.js';
import { sealTokens } from '../../data/mcp-oauth-grants.js';
import { upsertMcpServer } from '../../data/mcp-servers.js';
import { QK } from '../../data/queryKeys.js';
import { queryClient } from '../../lib/queryClient.js';
import { openSecret, sealSecret } from '../../lib/secrets.js';
import { SyncOfflineError, mutateSynced } from '../../sync/enqueue.js';
import { isClass2Allowed } from '../../sync/gate.js';
import {
  CALLBACK_CHANNEL,
  type CallbackPayload,
  decodeCallbackPayload,
  encodeCallbackPayload,
} from './callback-payload.js';
import { clientMetadataUrl, isPubliclyFetchableOrigin, redirectUri } from './client-metadata.js';
import type { OAuthDiscovery } from './discovery.js';
import { type EnsureDeps, copyKey, publishNewFamily } from './ensure-token.js';
import { createNamedMutex, withGrantLock } from './grant-lock.js';
import { openTokensSafe } from './grant-publish.js';
import type { OAuthFetch } from './oauth-fetch.js';
import { createPkce, randomState } from './pkce.js';
import { type TokenSet, exchangeCode, registerClient, revokeToken } from './token-client.js';
import { OAuthError, assertSecureEndpoint, canonicalResource } from './url.js';

/**
 * Sign-in orchestration for OAuth MCP servers (MCP OAuth spec §5 "New sign-ins", §6,
 * §8, §9). Everything slow happens in `prepareSignIn`, before the UI opens the window.
 */

/** The server settings chosen before signing in, saved once the grant exists. */
export type ServerDraft = Pick<
  McpServerRow,
  'name' | 'prefix' | 'onByDefault' | 'autoRun' | 'allowDirect' | 'routing' | 'resolvedEndpoint'
> & { url: string };

/** A sign-in in progress; the sealed body of an `mcpOAuthPending` row. */
export type PendingSignIn = {
  state: string;
  verifier: string;
  serverId: string;
  isNewServer: boolean;
  draft: ServerDraft | null;
  resource: string;
  issuer: string;
  tokenEndpoint: string;
  revocationEndpoint: string | null;
  clientId: string;
  registration: 'cimd' | 'dcr';
  scope: string | null;
  issParameterSupported: boolean;
  redirectUri: string;
  createdAt: number;
  /**
   * The URL the sign-in opened, so a reopened waiting screen can offer *Open sign-in
   * again* without a new state. Absent on rows sealed before it was kept.
   */
  authorizationUrl?: string;
};

/** Collaborators of a sign-in; `now` exists so tests can fix the clock. */
export type SignInDeps = {
  oauthFetch: OAuthFetch;
  hasProxy: boolean;
  /** The session key; read once at entry and copied, since locking zeroes it in place. */
  mk: MasterKey | null;
  origin: string;
  ensure: EnsureDeps;
  now?: (() => number) | undefined;
};

/**
 * How a completion ended. `already-connected` carries the draft so a save that never
 * happened can still finish; `locked` means there was no key to open the sign-in with.
 */
export type CompleteResult =
  | { ok: true; serverId: string; draft: ServerDraft | null; grant: McpOAuthGrantRow }
  | { ok: false; reason: 'already-connected'; serverId: string; draft: ServerDraft | null }
  | { ok: false; reason: CompleteFailure };

/** The reasons a completion fails without anything to resume. */
export type CompleteFailure =
  | 'unknown-state'
  | 'cancelled'
  | 'expired'
  | 'iss-mismatch'
  | 'exchange-failed'
  | 'approved-apps-only'
  | 'server-problem'
  | 'locked';

/**
 * Maps the `error` of an authorisation response (RFC 6749 §4.1.2.1) to a reason. Only
 * the user's own refusal reads as cancelled; the raw code never reaches the screen.
 */
export function callbackErrorReason(error: string): CompleteFailure {
  switch (error) {
    case 'access_denied':
      return 'cancelled';
    case 'unauthorized_client':
    case 'invalid_client':
    case 'unsupported_response_type':
      return 'approved-apps-only';
    case 'server_error':
    case 'temporarily_unavailable':
      return 'server-problem';
    default:
      return 'exchange-failed';
  }
}

/** A pending sign-in lives this long; a completed one may outlive it (see the sweep). */
const PENDING_LIFETIME_MS = 10 * 60_000;
/** After an unlock, the app returns to a waiting screen by itself only this soon. */
const RECENT_MS = 2 * 60_000;

/** States this tab started or reopened; only these are acknowledged on the channel. */
const held = new Set<string>();

const stateFallback = createNamedMutex();

function pendingSlot(state: string): string {
  return `mcp/oauth-pending/${state}`;
}

function clock(deps: { now?: (() => number) | undefined }): () => number {
  return deps.now ?? Date.now;
}

const fail = (reason: CompleteFailure): CompleteResult => ({ ok: false, reason });

/**
 * Serialises completions of one `state` across this device's tabs, so a code is
 * spent at most once. Queues in-process where Web Locks are absent.
 */
function withStateLock<T>(state: string, fn: () => Promise<T>): Promise<T> {
  const name = `chatsundere-mcp-oauth-state-${state}`;
  const locks = globalThis.navigator?.locks;
  if (locks && typeof locks.request === 'function') {
    return locks.request(name, () => fn()) as Promise<T>;
  }
  return stateFallback(name, fn);
}

function unionScope(base: string | null, extra: readonly string[] = []): string | null {
  const out: string[] = [];
  for (const s of [base ?? '', ...extra].flatMap((v) => v.split(/\s+/))) {
    if (s !== '' && !out.includes(s)) out.push(s);
  }
  return out.length > 0 ? out.join(' ') : null;
}

/** Opens a pending row; throws when it was sealed under another key or for another state. */
export async function openPendingSignIn(
  row: McpOAuthPendingRow,
  mk: MasterKey,
): Promise<PendingSignIn> {
  const p = JSON.parse(await openSecret(row.sealed, mk, pendingSlot(row.state))) as PendingSignIn;
  if (typeof p !== 'object' || p === null || p.state !== row.state || p.serverId !== row.serverId) {
    throw new Error('The pending sign-in does not match its row.');
  }
  return p;
}

/**
 * Prepares a sign-in: client identity (CIMD on a public origin, else DCR), PKCE, a
 * sealed pending row. Returns the URL to open; all async work is done by then, so the
 * window can open synchronously on the next gesture. A new server gets its id here.
 */
export async function prepareSignIn(
  d: OAuthDiscovery,
  args: { serverId?: string; draft: ServerDraft | null; extraScopes?: string[] },
  deps: SignInDeps,
): Promise<{ state: string; authorizationUrl: string }> {
  // Before any request: a token is never minted for a resource it may not be sent to.
  assertSecureEndpoint(d.resource, 'MCP server');
  // Before any request: a hostile server must not get a `javascript:` URL opened.
  assertSecureEndpoint(d.authorizationEndpoint, 'authorisation');
  assertSecureEndpoint(d.tokenEndpoint, 'token');
  // Before any request too: a registration made while locked would only be wasted.
  const mk = copyKey(deps.mk);
  if (mk === null) throw new OAuthError('locked', 'Unlock the app to sign in.');
  let clientId: string;
  let registration: 'cimd' | 'dcr';
  let resource: string;
  let redirect: string;
  try {
    resource = canonicalResource(d.resource);
    redirect = redirectUri(deps.origin);
    const existing =
      args.serverId === undefined
        ? null
        : ((await deps.ensure.store.snapshot(args.serverId))?.row ?? null);
    // A reconnect keeps its registered client while it still fits this issuer and
    // redirect, rather than leaving one more registration behind at the server.
    const reusable =
      existing?.registration === 'dcr' &&
      existing.issuer === d.issuer &&
      existing.redirectUri === redirect
        ? existing
        : null;
    if (d.cimdSupported && isPubliclyFetchableOrigin(deps.origin)) {
      clientId = clientMetadataUrl(deps.origin);
      registration = 'cimd';
    } else if (reusable) {
      clientId = reusable.clientId;
      registration = 'dcr';
    } else if (d.registrationEndpoint !== null) {
      clientId = (
        await registerClient(d, redirect, { oauthFetch: deps.oauthFetch, hasProxy: deps.hasProxy })
      ).clientId;
      registration = 'dcr';
    } else {
      throw new OAuthError('no-client-identity', 'This server only accepts approved apps.');
    }
  } catch (err) {
    mk.fill(0);
    throw err;
  }
  try {
    const { verifier, challenge } = await createPkce();
    const state = randomState();
    const now = clock(deps)();
    const scope = unionScope(d.scope, args.extraScopes);
    const url = new URL(d.authorizationEndpoint);
    const q = url.searchParams;
    q.set('response_type', 'code');
    q.set('client_id', clientId);
    q.set('redirect_uri', redirect);
    q.set('state', state);
    q.set('code_challenge', challenge);
    q.set('code_challenge_method', 'S256');
    q.set('resource', resource);
    if (scope !== null) q.set('scope', scope);
    const pending: PendingSignIn = {
      state,
      verifier,
      serverId: args.serverId ?? crypto.randomUUID(),
      isNewServer: args.serverId === undefined,
      draft: args.draft,
      resource,
      issuer: d.issuer,
      tokenEndpoint: d.tokenEndpoint,
      revocationEndpoint: d.revocationEndpoint,
      clientId,
      registration,
      scope,
      issParameterSupported: d.issParameterSupported,
      redirectUri: redirect,
      createdAt: now,
      authorizationUrl: url.toString(),
    };
    const sealed = await sealSecret(JSON.stringify(pending), mk, pendingSlot(state));
    await getClientDataDb().mcpOAuthPending.put({
      state,
      sealed,
      serverId: pending.serverId,
      createdAt: now,
    });
    held.add(state);
    return { state, authorizationUrl: url.toString() };
  } finally {
    mk.fill(0);
  }
}

/**
 * Stores the fresh family under the grant lock (spec §5 "New sign-ins"): as a pending
 * new family published by direct push on a linked device, as plain `tokens` on an
 * unlinked one. Never through `mutateSynced`, which would lose the spent code's tokens.
 */
async function storeGrant(
  p: PendingSignIn,
  exchanged: { tokens: TokenSet; tokenRoute: 'direct' | 'proxy' },
  deps: SignInDeps,
  mk: MasterKey,
): Promise<McpOAuthGrantRow> {
  const ensure: EnsureDeps = { ...deps.ensure, mk };
  const lock = ensure.lock ?? withGrantLock;
  const sealed = await sealTokens(exchanged.tokens, mk, p.serverId);
  const unlinked = !ensure.isLinked && ensure.linkKnown !== false;
  return lock(p.serverId, async () => {
    const snap = await ensure.store.snapshot(p.serverId);
    const now = clock(deps)();
    const base: McpOAuthGrantRow = {
      id: p.serverId,
      resource: p.resource,
      issuer: p.issuer,
      tokenEndpoint: p.tokenEndpoint,
      revocationEndpoint: p.revocationEndpoint,
      clientId: p.clientId,
      registration: p.registration,
      scope: exchanged.tokens.scope ?? p.scope,
      tokenRoute: exchanged.tokenRoute,
      redirectUri: p.redirectUri,
      tokens: null,
      claim: null,
      createdAt: snap?.row.createdAt ?? now,
      updatedAt: now,
    };
    if (unlinked) {
      const row: McpOAuthGrantRow = { ...base, tokens: sealed };
      await ensure.store.putLocal(row);
      return row;
    }
    // With the link status unknown this stays pending; it is published, or promoted
    // on an unlinked device, once the status is known.
    const row: McpOAuthGrantRow = {
      ...base,
      pendingTokens: sealed,
      pendingBaseRev: snap?.rev ?? 0,
      pendingSpentRefresh: null,
      pendingNewFamily: true,
    };
    await ensure.store.putLocal(row);
    try {
      await publishNewFamily(p.serverId, ensure);
    } catch {
      // Spec §5: anything undefined keeps the pair pending. The tokens are stored, so
      // the sign-in has succeeded; a later sync opportunity publishes them.
    }
    return (await ensure.store.snapshot(p.serverId).catch(() => null))?.row ?? row;
  });
}

async function completeLocked(
  payload: CallbackPayload,
  deps: SignInDeps,
  mk: MasterKey,
): Promise<CompleteResult> {
  const db = getClientDataDb();
  const row = await db.mcpOAuthPending.get(payload.state);
  if (!row) return fail('unknown-state');
  let p: PendingSignIn;
  try {
    p = await openPendingSignIn(row, mk);
  } catch {
    return fail('unknown-state');
  }
  // Before expiry, so a re-paste of a finished sign-in is told apart from an unknown one.
  if (row.completedAt !== undefined) {
    return { ok: false, reason: 'already-connected', serverId: p.serverId, draft: p.draft };
  }
  if (clock(deps)() - row.createdAt >= PENDING_LIFETIME_MS) {
    await db.mcpOAuthPending.delete(row.state);
    held.delete(row.state);
    return fail('expired');
  }
  if ('error' in payload) {
    await db.mcpOAuthPending.delete(row.state);
    held.delete(row.state);
    return fail(callbackErrorReason(payload.error));
  }
  // Mix-up defence (RFC 9207): required when advertised, and exact when present.
  if (payload.iss !== undefined ? payload.iss !== p.issuer : p.issParameterSupported) {
    return fail('iss-mismatch');
  }
  let exchanged: { tokens: TokenSet; tokenRoute: 'direct' | 'proxy' };
  try {
    // Outside the grant lock: the code is short-lived, and a refresh may hold the lock.
    exchanged = await exchangeCode(
      {
        tokenEndpoint: p.tokenEndpoint,
        code: payload.code,
        verifier: p.verifier,
        clientId: p.clientId,
        redirectUri: p.redirectUri,
        resource: p.resource,
      },
      { oauthFetch: deps.oauthFetch, hasProxy: deps.hasProxy, now: clock(deps) },
    );
  } catch {
    // The pending row stays: the screen offers to start again, and nothing was stored.
    return fail('exchange-failed');
  }
  const grant = await storeGrant(p, exchanged, deps, mk);
  try {
    await db.mcpOAuthPending.put({ ...row, completedAt: clock(deps)() });
  } catch {
    // The grant is stored, which is what counts; a re-paste then spends nothing new,
    // since the code is already used, and fails as an exchange.
  }
  void queryClient.invalidateQueries({ queryKey: QK.mcpOAuthGrants });
  return { ok: true, serverId: p.serverId, draft: p.draft, grant };
}

/**
 * Completes a sign-in from the callback or a pasted code. Under a Web Lock on the
 * state, so two tabs never spend one code; the key is copied at entry and zeroed after.
 */
export async function completeSignIn(
  payload: CallbackPayload,
  deps: SignInDeps,
): Promise<CompleteResult> {
  const mk = copyKey(deps.mk);
  if (mk === null) return { ok: false, reason: 'locked' };
  try {
    return await withStateLock(payload.state, () => completeLocked(payload, deps, mk));
  } catch {
    // Storage or sealing failed. The message may name internals, so only the reason leaves.
    return fail('exchange-failed');
  } finally {
    mk.fill(0);
  }
}

/** Marks a pending sign-in as this tab's, e.g. when its waiting screen is reopened. */
export function holdPendingSignIn(state: string): void {
  held.add(state);
}

/** The slice of BroadcastChannel the listener needs, so tests can fake it. */
export type CallbackChannelLike = {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
  close?(): void;
};

function asPayload(v: unknown): CallbackPayload | null {
  try {
    // Round-trips through the paste parser, which accepts exactly the expected shapes.
    return decodeCallbackPayload(encodeCallbackPayload(v as CallbackPayload));
  } catch {
    return null;
  }
}

/**
 * Listens for the callback page. Only a tab holding the matching pending sign-in
 * acknowledges and hands the payload on; the caller then runs `completeSignIn`.
 */
export function listenForCallback(
  onResult: (payload: CallbackPayload) => void,
  opts: { channel?: CallbackChannelLike } = {},
): () => void {
  const channel: CallbackChannelLike = opts.channel ?? new BroadcastChannel(CALLBACK_CHANNEL);
  let stopped = false;
  channel.onmessage = (event) => {
    const data = event.data as { type?: unknown; payload?: unknown } | null;
    if (!data || data.type !== 'result') return;
    const payload = asPayload(data.payload);
    if (!payload || !held.has(payload.state)) return;
    void getClientDataDb()
      .mcpOAuthPending.get(payload.state)
      .then(
        (row) => {
          if (stopped || !row) return;
          channel.postMessage({ type: 'ack', state: payload.state });
          onResult(payload);
        },
        () => undefined,
      );
  };
  return () => {
    stopped = true;
    channel.onmessage = null;
    if (!opts.channel) channel.close?.();
  };
}

/** Cancels a sign-in: its pending row is deleted, so a late callback is unknown. */
export async function cancelSignIn(state: string): Promise<void> {
  held.delete(state);
  await getClientDataDb().mcpOAuthPending.delete(state);
}

/**
 * Deletes pending sign-ins older than 10 minutes, except a completed one whose server
 * row is still missing: `finishOrphanedSignIns` needs it to save that row.
 */
export async function sweepExpiredSignIns(now: number = Date.now()): Promise<void> {
  const db = getClientDataDb();
  await db.transaction('rw', [db.mcpOAuthPending, db.mcpServers], async () => {
    for (const row of await db.mcpOAuthPending.toArray()) {
      if (now - row.createdAt < PENDING_LIFETIME_MS) continue;
      if (row.completedAt !== undefined && !(await db.mcpServers.get(row.serverId))) continue;
      await db.mcpOAuthPending.delete(row.state);
      held.delete(row.state);
    }
  });
}

/** The newest unfinished sign-in started within the last 2 minutes, or null. */
export async function recentPendingSignIn(
  now: number = Date.now(),
  mk: MasterKey | null = useSessionStore.getState().mk,
): Promise<PendingSignIn | null> {
  const key = copyKey(mk);
  if (key === null) return null;
  try {
    const rows = (
      await getClientDataDb()
        .mcpOAuthPending.where('createdAt')
        .above(now - RECENT_MS)
        .toArray()
    )
      .filter((r) => r.completedAt === undefined && r.createdAt <= now)
      .sort((a, b) => b.createdAt - a.createdAt);
    for (const row of rows) {
      try {
        return await openPendingSignIn(row, key);
      } catch {
        // Sealed under another key: not this session's sign-in.
      }
    }
    return null;
  } finally {
    key.fill(0);
  }
}

/** The server row a draft becomes; connecting counts as this device's first-use consent. */
export function serverRowFromDraft(
  serverId: string,
  draft: ServerDraft,
  now: number,
): McpServerRow {
  return {
    id: serverId,
    name: draft.name,
    url: draft.url,
    prefix: draft.prefix,
    auth: { scheme: 'oauth' },
    onByDefault: draft.onByDefault,
    autoRun: draft.autoRun,
    enabled: true,
    allowDirect: draft.allowDirect,
    routing: draft.routing,
    resolvedEndpoint: draft.resolvedEndpoint,
    tools: [],
    hiddenTools: [],
    lastTestedAt: null,
    lastError: null,
    firstUseConsentFor: draft.url,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Saves the server row of every completed sign-in whose row is missing, from its draft
 * and with `deferWhenOffline`, so a device that died or went offline after the exchange
 * never orphans its grant. Called at list load.
 */
export async function finishOrphanedSignIns(
  opts: { mk?: MasterKey | null; now?: () => number } = {},
): Promise<void> {
  const key = copyKey(opts.mk === undefined ? useSessionStore.getState().mk : opts.mk);
  if (key === null) return;
  const now = opts.now ?? Date.now;
  const db = getClientDataDb();
  let saved = false;
  try {
    for (const row of await db.mcpOAuthPending.toArray()) {
      if (row.completedAt === undefined) continue;
      if (await db.mcpServers.get(row.serverId)) continue;
      let p: PendingSignIn | null = null;
      try {
        p = await openPendingSignIn(row, key);
      } catch {
        p = null;
      }
      // No draft (a reconnect), or the grant removed meanwhile: nothing to save.
      if (!p?.draft || !(await db.mcpOAuthGrants.get(row.serverId))) {
        await db.mcpOAuthPending.delete(row.state);
        continue;
      }
      try {
        // Add-if-absent inside the write: a row saved meanwhile, perhaps already edited
        // by the user, is never overwritten.
        await upsertMcpServer(serverRowFromDraft(p.serverId, p.draft, now()), {
          deferWhenOffline: true,
          ifAbsent: true,
        });
        saved = true;
      } catch {
        // Retried at the next list load; the pending row stays for that.
      }
    }
  } finally {
    key.fill(0);
  }
  if (saved) void queryClient.invalidateQueries({ queryKey: QK.mcpServers });
}

/** Revokes every live token the grant holds; true when nothing live is left unrevoked. */
async function revokeHeld(
  row: McpOAuthGrantRow,
  mk: MasterKey,
  deps: SignInDeps,
): Promise<boolean> {
  const live = new Set<string>();
  for (const blob of [row.pendingTokens, row.tokens]) {
    const t = await openTokensSafe(blob, mk, row.id);
    if (t !== null && t !== 'corrupt') live.add(t.refreshToken ?? t.accessToken);
  }
  if (live.size === 0) return true;
  if (row.revocationEndpoint === null) return false;
  if (row.tokenRoute === 'proxy' && !deps.hasProxy) return false;
  let all = true;
  for (const token of live) {
    const done = await revokeToken(
      {
        revocationEndpoint: row.revocationEndpoint,
        token,
        clientId: row.clientId,
        route: row.tokenRoute,
      },
      { oauthFetch: deps.oauthFetch, hasProxy: deps.hasProxy },
    );
    all = all && done;
  }
  return all;
}

/**
 * Remove server, for an OAuth server (spec §8): best-effort revocation at the server,
 * then one synced delete of the server row with the grant as its cascade, on all
 * devices. `revoked: false` means the server may still consider the app signed in.
 */
export async function removeGrant(
  serverId: string,
  deps: SignInDeps,
): Promise<{ revoked: boolean }> {
  // Checked first: revoking and then failing to delete would leave a dead grant behind.
  if (useAccountLinkStore.getState().linkStatus === 'linked' && !isClass2Allowed()) {
    throw new SyncOfflineError();
  }
  const mk = copyKey(deps.mk);
  let revoked = false;
  try {
    const snap = await deps.ensure.store.snapshot(serverId);
    if (!snap) revoked = true;
    else if (mk !== null) revoked = await revokeHeld(snap.row, mk, deps);
  } finally {
    mk?.fill(0);
  }
  await mutateSynced({
    collection: 'mcpServers',
    key: serverId,
    op: 'delete',
    tables: ['mcpServers', 'mcpOAuthGrants', 'mcpOAuthPending'],
    write: async (tx) => {
      await tx.table('mcpServers').delete(serverId);
      await tx.table('mcpOAuthGrants').delete(serverId);
      // A completed sign-in's draft must not bring the server back at the next list load.
      await tx.table('mcpOAuthPending').where('serverId').equals(serverId).delete();
    },
    cascade: [{ collection: 'mcpOAuthGrants', key: serverId }],
  });
  void queryClient.invalidateQueries({ queryKey: QK.mcpServers });
  void queryClient.invalidateQueries({ queryKey: QK.mcpOAuthGrants });
  return { revoked };
}
