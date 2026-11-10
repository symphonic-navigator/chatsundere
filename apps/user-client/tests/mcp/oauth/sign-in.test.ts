// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { type MasterKey, asMasterKey, getRandomBytes } from '@chatsundere/crypto';
import { setProxyAuthSource } from '@chatsundere/llm-unified';
import type { SyncPulledRecord } from '@chatsundere/shared-types';
import { useAccountLinkStore } from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type McpOAuthGrantRow,
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../../src/boot/client-data-db.js';
import { openTokens } from '../../../src/data/mcp-oauth-grants.js';
import type { CallbackPayload } from '../../../src/mcp/oauth/callback-payload.js';
import type { OAuthDiscovery } from '../../../src/mcp/oauth/discovery.js';
import {
  type EnsureDeps,
  ensureAccessToken,
  publishPendingTokens,
} from '../../../src/mcp/oauth/ensure-token.js';
import { acceptedFields, judgePulledGrant } from '../../../src/mcp/oauth/grant-generation.js';
import {
  type AdoptOutcome,
  type GrantStore,
  createDexieGrantStore,
} from '../../../src/mcp/oauth/grant-store.js';
import { createOAuthFetch } from '../../../src/mcp/oauth/oauth-fetch.js';
import {
  type CompleteResult,
  type ServerDraft,
  type SignInDeps,
  cancelSignIn,
  completeSignIn,
  finishOrphanedSignIns,
  holdPendingSignIn,
  listenForCallback,
  openPendingSignIn,
  prepareSignIn,
  recentPendingSignIn,
  removeGrant,
  serverRowFromDraft,
  sweepExpiredSignIns,
} from '../../../src/mcp/oauth/sign-in.js';
import { OAuthError } from '../../../src/mcp/oauth/url.js';
import { type FakeAuthOptions, createFakeAuthServer } from './fake-auth-server.js';
import { CasServer, clone } from './grant-harness.js';

const PUBLIC_ORIGIN = 'https://chatsune.me';
const PRIVATE_ORIGIN = 'https://192.168.1.20';
const MINUTE = 60_000;
const HOUR = 3_600_000;

type PushHook = (row: McpOAuthGrantRow) => 'network' | 'throw' | null;

type World = {
  t: number;
  auth: ReturnType<typeof createFakeAuthServer>;
  cas: CasServer;
  mk: MasterKey;
  pushes: { row: McpOAuthGrantRow; baseRev: number; mkBytes: number[] }[];
  pushHook: PushHook | null;
  counts: { code: number; refresh: number };
  /** Access tokens handed out by code exchanges, in order. Fake values only. */
  issued: string[];
  hooks: {
    beforeCode?: () => Promise<void> | void;
    afterRefresh?: () => Promise<void> | void;
    revokeFails?: boolean;
  };
  store: GrantStore;
  oauthFetch: ReturnType<typeof createOAuthFetch>;
};

let w: World;

/**
 * The device's real Dexie grant store, with the sync server's compare-and-set
 * simulated: an `ok` writes the row and its revision as `pushRecordDirect` does.
 */
function casStore(world: () => World): GrantStore {
  const base = createDexieGrantStore();
  return {
    ...base,
    push: async (row, baseRev, mk) => {
      const x = world();
      x.pushes.push({ row: clone(row), baseRev, mkBytes: Array.from(mk) });
      const forced = x.pushHook?.(row) ?? null;
      if (forced === 'network') return { status: 'network' };
      if (forced === 'throw') throw new Error('The simulated push failed unexpectedly.');
      const result = x.cas.push(row, baseRev);
      if (result.status !== 'ok') return result;
      const db = getClientDataDb();
      let written = false;
      await db.transaction('rw', [db.mcpOAuthGrants, db.syncRows], async () => {
        const meta = await db.syncRows.get(['mcpOAuthGrants', row.id]);
        if (meta && result.rev <= meta.rev) return;
        await db.mcpOAuthGrants.put(row);
        await db.syncRows.put({
          collection: 'mcpOAuthGrants',
          key: row.id,
          rev: result.rev,
          ciphertextHash: '',
        });
        written = true;
      });
      return { ...result, written };
    },
    open: async (record) => (record.ciphertext ? world().cas.body(record.ciphertext) : null),
    adopt: async (record: SyncPulledRecord): Promise<AdoptOutcome> => {
      const id = record.blindId.replace(/^bid-/, '');
      const db = getClientDataDb();
      const meta = await db.syncRows.get(['mcpOAuthGrants', id]);
      if (meta && record.rev <= meta.rev) return 'stale';
      if (record.deleted || !record.ciphertext) {
        await db.mcpOAuthGrants.delete(id);
        return 'stale';
      }
      const body = world().cas.body(record.ciphertext);
      if (!body) return 'stale';
      const local = await db.mcpOAuthGrants.get(id);
      const verdict = judgePulledGrant(local, body);
      if (local && verdict.kind === 'refuse') {
        await db.mcpOAuthGrants.update(id, { heldGeneration: verdict.heldGeneration });
      } else {
        await db.mcpOAuthGrants.put({
          ...body,
          pendingTokens: local?.pendingTokens ?? null,
          pendingBaseRev: local?.pendingBaseRev ?? null,
          pendingSpentRefresh: local?.pendingSpentRefresh ?? null,
          pendingNewFamily: local?.pendingNewFamily ?? false,
          ...acceptedFields(local, body),
        });
      }
      // A refusal records the revision only; the stored row, and so its hash, stay as they were.
      const refused = local !== undefined && verdict.kind === 'refuse';
      await db.syncRows.put({
        collection: 'mcpOAuthGrants',
        key: id,
        rev: record.rev,
        ciphertextHash: refused ? (meta?.ciphertextHash ?? '') : '',
      });
      return refused ? 'refused' : 'adopted';
    },
    requestSync: () => undefined,
  };
}

function setup(options: FakeAuthOptions = {}): World {
  const world = {
    t: 1_800_000_000_000,
    cas: new CasServer(),
    mk: asMasterKey(getRandomBytes(32)),
    pushes: [],
    pushHook: null,
    counts: { code: 0, refresh: 0 },
    issued: [],
    hooks: {},
  } as unknown as World;
  world.auth = createFakeAuthServer({ ...options, now: () => world.t });
  const fakeFetch: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/token')) {
      const grant = new URLSearchParams(String(init?.body ?? '')).get('grant_type');
      if (grant === 'authorization_code') {
        world.counts.code++;
        await world.hooks.beforeCode?.();
        const response = await world.auth.fetch(input, init);
        const copy = (await response.clone().json()) as { access_token?: string };
        if (copy.access_token) world.issued.push(copy.access_token);
        return response;
      }
      world.counts.refresh++;
      const response = await world.auth.fetch(input, init);
      await world.hooks.afterRefresh?.();
      return response;
    }
    if (path.endsWith('/revoke') && world.hooks.revokeFails) {
      throw new TypeError('Failed to fetch');
    }
    return world.auth.fetch(input, init);
  };
  world.oauthFetch = createOAuthFetch({ fetch: fakeFetch });
  world.store = casStore(() => world);
  setProxyAuthSource({
    getUrl: () => world.auth.state.urls.proxyBase,
    getToken: () => 'account-token',
    refreshToken: async () => 'account-token-2',
  });
  return world;
}

function discovery(
  world: World,
  overrides: Partial<OAuthDiscovery> = {},
  options: FakeAuthOptions = {},
): OAuthDiscovery {
  const u = world.auth.state.urls;
  return {
    kind: 'oauth',
    resource: u.mcp,
    issuer: u.issuer,
    resourceName: 'Fake MCP',
    authorizationEndpoint: u.authorisation,
    tokenEndpoint: u.token,
    registrationEndpoint: options.dcr === false ? null : u.registration,
    revocationEndpoint: u.revocation,
    cimdSupported: options.cimd === true,
    issParameterSupported: options.advertiseIss === true,
    viaProxy: false,
    scope: null,
    ...overrides,
  };
}

function ensureDeps(overrides: Partial<EnsureDeps> = {}): EnsureDeps {
  return {
    store: w.store,
    oauthFetch: w.oauthFetch,
    mk: w.mk,
    isLinked: true,
    linkKnown: true,
    hasProxy: false,
    deviceId: 'dev-a',
    wallNow: () => w.t,
    monotonicNow: () => w.t,
    sleep: async (ms) => {
      w.t += ms;
    },
    observations: new Map(),
    ...overrides,
  };
}

function deps(overrides: Partial<SignInDeps> = {}, ensure: Partial<EnsureDeps> = {}): SignInDeps {
  return {
    oauthFetch: w.oauthFetch,
    hasProxy: false,
    mk: w.mk,
    origin: PRIVATE_ORIGIN,
    ensure: ensureDeps(ensure),
    now: () => w.t,
    ...overrides,
  };
}

const DRAFT: ServerDraft = {
  name: 'Fake MCP',
  prefix: 'fake',
  onByDefault: true,
  autoRun: false,
  allowDirect: false,
  routing: null,
  resolvedEndpoint: null,
  url: 'https://mcp.example/mcp',
};

/** Plays the user's browser: approves at the authorisation server and returns the callback. */
async function approve(
  authorizationUrl: string,
): Promise<{ code: string; state: string; iss?: string }> {
  const q = new URL(authorizationUrl).searchParams;
  const scope = q.get('scope');
  const minted = await w.auth.state.authorise({
    redirectUri: q.get('redirect_uri') ?? '',
    state: q.get('state') ?? '',
    codeChallenge: q.get('code_challenge') ?? '',
    clientId: q.get('client_id') ?? '',
    ...(scope ? { scope } : {}),
  });
  return minted.iss
    ? { code: minted.code, state: minted.state, iss: minted.iss }
    : { code: minted.code, state: minted.state };
}

async function signIn(
  d: OAuthDiscovery,
  args: { serverId?: string; draft?: ServerDraft | null; extraScopes?: string[] } = {},
  dd: SignInDeps = deps(),
): Promise<{ result: CompleteResult; state: string; payload: CallbackPayload }> {
  const { state, authorizationUrl } = await prepareSignIn(
    d,
    { draft: args.draft === undefined ? DRAFT : args.draft, ...args },
    dd,
  );
  const payload = await approve(authorizationUrl);
  return { result: await completeSignIn(payload, dd), state, payload };
}

function expectOk(r: CompleteResult): Extract<CompleteResult, { ok: true }> {
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  return r;
}

async function localGrant(id: string): Promise<McpOAuthGrantRow | undefined> {
  return getClientDataDb().mcpOAuthGrants.get(id);
}

async function accessOf(blob: McpOAuthGrantRow['tokens'] | undefined, id: string, mk = w.mk) {
  return (await openTokens(blob ?? null, mk, id))?.accessToken ?? null;
}

async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 2000; i++) {
    if (cond()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('condition not reached');
}

function gate(): { wait: () => Promise<void>; open: () => void; reached: () => boolean } {
  let open = (): void => undefined;
  let reached = false;
  const p = new Promise<void>((resolve) => {
    open = resolve;
  });
  return {
    wait: () => {
      reached = true;
      return p;
    },
    open: () => open(),
    reached: () => reached,
  };
}

/** Flattens a stored row, bytes included, so a plaintext search sees everything. */
function serialise(v: unknown): string {
  return JSON.stringify(v, (_k, value: unknown) =>
    value instanceof Uint8Array
      ? `${new TextDecoder('latin1').decode(value)}|${btoa(String.fromCharCode(...value))}`
      : value,
  );
}

beforeEach(async () => {
  await openClientDataDb();
  w = setup();
});

afterEach(async () => {
  setProxyAuthSource(null);
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  await _resetClientDataDbForTests();
});

describe('prepareSignIn', () => {
  it('uses CIMD on a public origin when advertised', async () => {
    w = setup({ cimd: true });
    const { authorizationUrl } = await prepareSignIn(
      discovery(w, {}, { cimd: true }),
      { draft: DRAFT },
      deps({ origin: PUBLIC_ORIGIN }),
    );
    const q = new URL(authorizationUrl).searchParams;
    expect(q.get('client_id')).toBe(`${PUBLIC_ORIGIN}/oauth/client-metadata.json`);
    expect(w.auth.state.registrations).toHaveLength(0);
  });

  it('uses DCR on a private origin even when CIMD is advertised', async () => {
    w = setup({ cimd: true });
    const { authorizationUrl } = await prepareSignIn(
      discovery(w, {}, { cimd: true }),
      { draft: DRAFT },
      deps({ origin: PRIVATE_ORIGIN }),
    );
    expect(w.auth.state.registrations).toHaveLength(1);
    expect(new URL(authorizationUrl).searchParams.get('client_id')).toBe(
      w.auth.state.registrations[0]?.clientId,
    );
  });

  it('without CIMD or DCR it refuses with no-client-identity and stores nothing', async () => {
    const d = discovery(w, { registrationEndpoint: null, cimdSupported: true });
    const err = await prepareSignIn(d, { draft: DRAFT }, deps({ origin: PRIVATE_ORIGIN })).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(OAuthError);
    expect((err as OAuthError).kind).toBe('no-client-identity');
    expect(await getClientDataDb().mcpOAuthPending.count()).toBe(0);
  });

  it('refuses a javascript: authorisation endpoint before anything is stored', async () => {
    const d = discovery(w, { authorizationEndpoint: 'javascript:alert(1)' });
    const err = await prepareSignIn(d, { draft: DRAFT }, deps()).catch((e: unknown) => e);
    expect((err as OAuthError).kind).toBe('not-secure');
    expect(w.auth.state.registrations).toHaveLength(0);
    expect(await getClientDataDb().mcpOAuthPending.count()).toBe(0);
  });

  it('refuses a plaintext http resource before any registration or storage', async () => {
    const d = discovery(w, { resource: 'http://kumbu.example/mcp' });
    const err = await prepareSignIn(d, { draft: DRAFT }, deps({ origin: PRIVATE_ORIGIN })).catch(
      (e: unknown) => e,
    );
    expect((err as OAuthError).kind).toBe('not-secure');
    expect(w.auth.state.registrations).toHaveLength(0);
    expect(await getClientDataDb().mcpOAuthPending.count()).toBe(0);
  });

  it('builds the authorisation URL with every required parameter', async () => {
    const d = discovery(w, { scope: 'read' });
    const { state, authorizationUrl } = await prepareSignIn(d, { draft: DRAFT }, deps());
    const url = new URL(authorizationUrl);
    expect(`${url.origin}${url.pathname}`).toBe(w.auth.state.urls.authorisation);
    const q = url.searchParams;
    expect(q.get('response_type')).toBe('code');
    expect(q.get('client_id')).toBeTruthy();
    expect(q.get('redirect_uri')).toBe(`${PRIVATE_ORIGIN}/oauth/callback`);
    expect(q.get('state')).toBe(state);
    expect(q.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('resource')).toBe(w.auth.state.urls.mcp);
    expect(q.get('scope')).toBe('read');
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('omits scope when there is none', async () => {
    const { authorizationUrl } = await prepareSignIn(discovery(w), { draft: DRAFT }, deps());
    expect(new URL(authorizationUrl).searchParams.has('scope')).toBe(false);
  });

  it('seals the pending row: no verifier plaintext is stored', async () => {
    const { state } = await prepareSignIn(discovery(w), { draft: DRAFT }, deps());
    const row = await getClientDataDb().mcpOAuthPending.get(state);
    if (!row) throw new Error('no pending row');
    const pending = await openPendingSignIn(row, w.mk);
    expect(pending.verifier.length).toBe(43);
    const stored = serialise(row);
    expect(stored.includes(pending.verifier)).toBe(false);
    expect(stored.includes(pending.clientId)).toBe(false);
    expect(stored.includes('Fake MCP')).toBe(false);
  });
});

describe('completeSignIn', () => {
  it('a full sign-in writes a grant with the canonical resource and the answering route', async () => {
    w = setup({ cors: false });
    const d = discovery(w, { resource: 'https://MCP.example:443/mcp/' });
    const dd = deps({ hasProxy: true }, { hasProxy: true });
    // Registration falls through to the proxy too, as the direct route is refused.
    const { result } = await signIn(d, {}, dd);
    const ok = expectOk(result);
    expect(ok.grant.resource).toBe('https://mcp.example/mcp');
    expect(ok.grant.tokenRoute).toBe('proxy');
    expect(ok.grant.id).toBe(ok.serverId);
    expect(ok.draft).toEqual(DRAFT);
    expect(await accessOf(w.cas.row(ok.serverId)?.tokens, ok.serverId)).toBe(w.issued[0]);
    expect(w.auth.state.log.some((l) => l.startsWith('POST proxy auth.example/token'))).toBe(true);
  });

  it('a direct exchange records the direct route', async () => {
    const { result } = await signIn(discovery(w));
    expect(expectOk(result).grant.tokenRoute).toBe('direct');
  });

  it('an unknown state is refused without any token request', async () => {
    await prepareSignIn(discovery(w), { draft: DRAFT }, deps());
    const r = await completeSignIn({ code: 'code-x', state: 'not-a-state' }, deps());
    expect(r).toEqual({ ok: false, reason: 'unknown-state' });
    expect(w.counts.code).toBe(0);
  });

  it('a second paste of a finished sign-in is already-connected, with its draft', async () => {
    const { result, payload } = await signIn(discovery(w));
    const ok = expectOk(result);
    const again = await completeSignIn(payload, deps());
    expect(again).toEqual({
      ok: false,
      reason: 'already-connected',
      serverId: ok.serverId,
      draft: DRAFT,
    });
    expect(w.counts.code).toBe(1);
  });

  it('an iss that differs is iss-mismatch, and nothing is exchanged', async () => {
    const { state, authorizationUrl } = await prepareSignIn(discovery(w), { draft: DRAFT }, deps());
    const { code } = await approve(authorizationUrl);
    const r = await completeSignIn({ code, state, iss: 'https://evil.example' }, deps());
    expect(r).toEqual({ ok: false, reason: 'iss-mismatch' });
    expect(w.counts.code).toBe(0);
  });

  it('a missing iss is iss-mismatch when the server advertises the parameter', async () => {
    w = setup({ advertiseIss: true });
    const d = discovery(w, {}, { advertiseIss: true });
    const { state, authorizationUrl } = await prepareSignIn(d, { draft: DRAFT }, deps());
    const { code } = await approve(authorizationUrl);
    expect(await completeSignIn({ code, state }, deps())).toEqual({
      ok: false,
      reason: 'iss-mismatch',
    });
    expect(w.counts.code).toBe(0);
  });

  it('a matching iss when advertised succeeds', async () => {
    w = setup({ advertiseIss: true });
    const { result, payload } = await signIn(discovery(w, {}, { advertiseIss: true }));
    expect('iss' in payload).toBe(true);
    expectOk(result);
  });

  it('a missing iss when not advertised succeeds', async () => {
    const { result, payload } = await signIn(discovery(w));
    expect('iss' in payload).toBe(false);
    expectOk(result);
  });

  it('a failed exchange keeps the pending row, so a fresh code still completes', async () => {
    const { state, authorizationUrl } = await prepareSignIn(discovery(w), { draft: DRAFT }, deps());
    const r = await completeSignIn({ code: 'code-bogus', state }, deps());
    expect(r).toEqual({ ok: false, reason: 'exchange-failed' });
    expect(await getClientDataDb().mcpOAuthPending.get(state)).toBeDefined();
    const second = await completeSignIn(await approve(authorizationUrl), deps());
    expectOk(second);
  });

  it('an expired pending row is expired and removed, with no token request', async () => {
    const { state, authorizationUrl } = await prepareSignIn(discovery(w), { draft: DRAFT }, deps());
    const payload = await approve(authorizationUrl);
    w.t += 10 * MINUTE;
    expect(await completeSignIn(payload, deps())).toEqual({ ok: false, reason: 'expired' });
    expect(await getClientDataDb().mcpOAuthPending.get(state)).toBeUndefined();
    expect(w.counts.code).toBe(0);
  });

  it('an error callback is cancelled, with no token request', async () => {
    const { state } = await prepareSignIn(discovery(w), { draft: DRAFT }, deps());
    expect(await completeSignIn({ error: 'access_denied', state }, deps())).toEqual({
      ok: false,
      reason: 'cancelled',
    });
    expect(w.counts.code).toBe(0);
  });

  it.each([
    ['unauthorized_client', 'approved-apps-only'],
    ['invalid_client', 'approved-apps-only'],
    ['unsupported_response_type', 'approved-apps-only'],
    ['server_error', 'server-problem'],
    ['temporarily_unavailable', 'server-problem'],
    ['invalid_scope', 'exchange-failed'],
    ['something_new', 'exchange-failed'],
  ])('an error callback %s is %s, ends the sign-in, and spends nothing', async (error, reason) => {
    const { state } = await prepareSignIn(discovery(w), { draft: DRAFT }, deps());
    expect(await completeSignIn({ error, state }, deps())).toEqual({ ok: false, reason });
    expect(w.counts.code).toBe(0);
    expect(await getClientDataDb().mcpOAuthPending.get(state)).toBeUndefined();
  });

  it('two tabs completing the same callback make one token request', async () => {
    const { authorizationUrl } = await prepareSignIn(discovery(w), { draft: DRAFT }, deps());
    const payload = await approve(authorizationUrl);
    const [a, b] = await Promise.all([
      completeSignIn(payload, deps()),
      completeSignIn(payload, deps()),
    ]);
    expect(w.counts.code).toBe(1);
    const reasons = [a, b].map((r) => (r.ok ? 'ok' : r.reason)).sort();
    expect(reasons).toEqual(['already-connected', 'ok']);
  });

  it('linked but offline at the publish: tokens are kept as pending and ok is returned', async () => {
    useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
    w.pushHook = () => 'network';
    const { result } = await signIn(discovery(w));
    const ok = expectOk(result);
    const row = await localGrant(ok.serverId);
    expect(row?.pendingNewFamily).toBe(true);
    expect(row?.tokens ?? null).toBeNull();
    expect(await accessOf(row?.pendingTokens, ok.serverId)).toBe(w.issued[0]);
    expect(w.cas.row(ok.serverId)).toBeNull();
    expect(await getClientDataDb().syncOutbox.count()).toBe(0);
    w.pushHook = null;
    await publishPendingTokens(ensureDeps());
    expect(await accessOf(w.cas.row(ok.serverId)?.tokens, ok.serverId)).toBe(w.issued[0]);
  });

  it('a new server gets a uuid that is both the grant id and the server row id', async () => {
    const { result } = await signIn(discovery(w), { draft: DRAFT });
    const ok = expectOk(result);
    expect(ok.serverId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(ok.grant.id).toBe(ok.serverId);
    expect(w.cas.row(ok.serverId)?.id).toBe(ok.serverId);
    await finishOrphanedSignIns({ mk: w.mk, now: () => w.t });
    const server = await getClientDataDb().mcpServers.get(ok.serverId);
    expect(server?.id).toBe(ok.serverId);
    expect(server?.auth).toEqual({ scheme: 'oauth' });
    expect(server?.url).toBe(DRAFT.url);
  });

  it('a refresh holding the grant lock in another tab cannot overwrite the new family', async () => {
    const first = expectOk((await signIn(discovery(w))).result);
    const id = first.serverId;
    await getClientDataDb().mcpServers.put(serverRowFromDraft(id, DRAFT, w.t));
    w.t += HOUR;
    const held = gate();
    w.hooks.afterRefresh = held.wait;
    const tab2 = ensureAccessToken(id, ensureDeps());
    await until(held.reached);

    // Another origin, so the reconnect registers a client of its own that the hook can tell apart.
    const { authorizationUrl } = await prepareSignIn(
      discovery(w),
      { serverId: id, draft: null },
      deps({ origin: 'https://10.0.0.5' }),
    );
    const newClient = new URL(authorizationUrl).searchParams.get('client_id');
    // The new family's publish is offline, so it must survive as the pending pair.
    w.pushHook = (row) => (row.clientId === newClient ? 'network' : null);
    const completing = completeSignIn(await approve(authorizationUrl), deps());
    await until(() => w.counts.code === 2);
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    held.open();
    const [refreshed, done] = await Promise.all([tab2, completing]);
    expect(refreshed.ok).toBe(true);
    expectOk(done);

    const row = await localGrant(id);
    expect(row?.pendingNewFamily).toBe(true);
    expect(await accessOf(row?.pendingTokens, id)).toBe(w.issued[1]);
    w.pushHook = null;
    await publishPendingTokens(ensureDeps());
    expect(await accessOf(w.cas.row(id)?.tokens, id)).toBe(w.issued[1]);
    expect(w.cas.row(id)?.clientId).toBe(newClient);
  });

  it('unlinked: tokens are written directly, with no pending fields and no push', async () => {
    const { result } = await signIn(discovery(w), {}, deps({}, { isLinked: false }));
    const ok = expectOk(result);
    const row = await localGrant(ok.serverId);
    expect(await accessOf(row?.tokens, ok.serverId)).toBe(w.issued[0]);
    expect(row?.pendingTokens ?? null).toBeNull();
    expect(row?.pendingNewFamily ?? false).toBe(false);
    expect(row?.pendingBaseRev ?? null).toBeNull();
    expect(w.pushes).toHaveLength(0);
  });

  it('the app locking during the exchange leaves the private key copy intact', async () => {
    const original = new Uint8Array(w.mk);
    w.hooks.beforeCode = () => {
      w.mk.fill(0);
    };
    const { result } = await signIn(discovery(w));
    const ok = expectOk(result);
    const key = asMasterKey(original);
    expect(await accessOf(w.cas.row(ok.serverId)?.tokens, ok.serverId, key)).toBe(w.issued[0]);
    expect(w.pushes.length).toBeGreaterThan(0);
    for (const p of w.pushes) expect(p.mkBytes).toEqual(Array.from(original));
  });

  it('no key at the start is locked, without a token request', async () => {
    const { authorizationUrl } = await prepareSignIn(discovery(w), { draft: DRAFT }, deps());
    const payload = await approve(authorizationUrl);
    expect(await completeSignIn(payload, deps({ mk: null }))).toEqual({
      ok: false,
      reason: 'locked',
    });
    expect(w.counts.code).toBe(0);
  });

  it('reconnecting with a serverId replaces the grant under the same id; extra scopes are a union', async () => {
    const first = expectOk((await signIn(discovery(w, { scope: 'read' }))).result);
    const id = first.serverId;
    const { authorizationUrl } = await prepareSignIn(
      discovery(w, { scope: 'read' }),
      { serverId: id, draft: null, extraScopes: ['write', 'read'] },
      deps(),
    );
    expect(new URL(authorizationUrl).searchParams.get('scope')).toBe('read write');
    const second = expectOk(await completeSignIn(await approve(authorizationUrl), deps()));
    expect(second.serverId).toBe(id);
    expect(second.draft).toBeNull();
    expect(second.grant.scope).toBe('read write');
    expect(await accessOf(w.cas.row(id)?.tokens, id)).toBe(w.issued[1]);
    expect(await getClientDataDb().mcpOAuthGrants.count()).toBe(1);
  });

  it('a publish that throws after the tokens are stored keeps them pending and still succeeds', async () => {
    w.pushHook = () => 'throw';
    const { result, payload } = await signIn(discovery(w));
    const ok = expectOk(result);
    const row = await localGrant(ok.serverId);
    expect(row?.pendingNewFamily).toBe(true);
    expect(await accessOf(row?.pendingTokens, ok.serverId)).toBe(w.issued[0]);
    const again = await completeSignIn(payload, deps());
    expect(again.ok ? 'ok' : again.reason).toBe('already-connected');
    w.pushHook = null;
    await publishPendingTokens(ensureDeps());
    expect(await accessOf(w.cas.row(ok.serverId)?.tokens, ok.serverId)).toBe(w.issued[0]);
  });
});

describe('grant generations on a new sign-in', () => {
  async function reconnect(id: string): Promise<void> {
    const { authorizationUrl } = await prepareSignIn(
      discovery(w),
      { serverId: id, draft: null },
      deps(),
    );
    expectOk(await completeSignIn(await approve(authorizationUrl), deps()));
  }

  /** Puts the server's row at `serverGeneration` and the local one at the given fields. */
  async function stage(
    id: string,
    serverGeneration: number,
    local: Partial<McpOAuthGrantRow>,
  ): Promise<void> {
    w.cas.put({ ...(w.cas.row(id) as McpOAuthGrantRow), generation: serverGeneration });
    const db = getClientDataDb();
    await db.mcpOAuthGrants.update(id, local);
    await db.syncRows.put({
      collection: 'mcpOAuthGrants',
      key: id,
      rev: w.cas.rev(id),
      ciphertextHash: '',
    });
  }

  it('storeGrant keeps the high-water mark', async () => {
    const id = expectOk((await signIn(discovery(w))).result).serverId;
    await stage(id, 4, { generation: 9, seenGeneration: 9, heldGeneration: 4 });
    const before = w.pushes.length;
    await reconnect(id);
    expect(w.pushes.slice(before).map((p) => p.row.generation)).toEqual([10]);
    expect(w.cas.row(id)?.generation).toBe(10);
    const row = await localGrant(id);
    expect(row?.generation).toBe(10);
    expect(row?.seenGeneration).toBe(10);
    expect(row?.heldGeneration).toBeNull();
    expect(row?.pendingTokens ?? null).toBeNull();
  });

  it('a refused record mid-sign-in keeps the pending pair and the push still carries the mark', async () => {
    const id = expectOk((await signIn(discovery(w))).result).serverId;
    await stage(id, 9, { generation: 9, seenGeneration: 9 });
    const inner = w.store;
    const outcomes: AdoptOutcome[] = [];
    let pendingIntact = false;
    w.store = {
      ...inner,
      push: async (row, baseRev, mk) => {
        if (outcomes.length === 0) {
          // The server replays generation 4 under a new revision before it answers.
          w.cas.put({ ...(w.cas.row(id) as McpOAuthGrantRow), generation: 4 });
          outcomes.push(await inner.adopt(w.cas.pulled(id)));
          const local = await localGrant(id);
          pendingIntact =
            local?.pendingNewFamily === true &&
            local.pendingTokens != null &&
            local.heldGeneration === 4;
        }
        return inner.push(row, baseRev, mk);
      },
    };
    const before = w.pushes.length;
    await reconnect(id);
    expect(outcomes).toEqual(['refused']);
    expect(pendingIntact).toBe(true);
    const generations = w.pushes.slice(before).map((p) => p.row.generation);
    expect(generations.length).toBeGreaterThan(0);
    for (const g of generations) expect(g).toBe(10);
    expect(w.cas.row(id)?.generation).toBe(10);
    expect(await accessOf(w.cas.row(id)?.tokens, id)).toBe(w.issued[1]);
    const row = await localGrant(id);
    expect(row?.seenGeneration).toBe(10);
    expect(row?.heldGeneration).toBeNull();
  });

  it('sign-in replacing an ordinary pending pair sends no revocation', async () => {
    const id = expectOk((await signIn(discovery(w))).result).serverId;
    w.t += HOUR;
    // The claim goes out, the publish does not: an ordinary pair stays pending.
    w.pushHook = (row) => (row.claim === null ? 'network' : null);
    expect((await ensureAccessToken(id, ensureDeps())).ok).toBe(true);
    w.pushHook = null;
    const pendingRow = await localGrant(id);
    expect(pendingRow?.pendingNewFamily).toBe(false);
    expect(pendingRow?.pendingTokens != null).toBe(true);
    // Revoking after the new code is exchanged could end the new family too (RFC 7009
    // per-grant revocation), so the replaced pair is dropped without a revocation.
    const revokedBefore = w.auth.state.revoked.length;
    await reconnect(id);
    expect(w.auth.state.revoked.length - revokedBefore).toBe(0);
    expect(await accessOf(w.cas.row(id)?.tokens, id)).toBe(w.issued[1]);
    expect((await localGrant(id))?.pendingTokens ?? null).toBeNull();
  });
});

describe('client identity on a reconnect', () => {
  it('reuses the registered client while the issuer and redirect URI are unchanged', async () => {
    const first = expectOk((await signIn(discovery(w))).result);
    expect(w.auth.state.registrations).toHaveLength(1);
    expect(first.grant.redirectUri).toBe(`${PRIVATE_ORIGIN}/oauth/callback`);
    const { authorizationUrl } = await prepareSignIn(
      discovery(w),
      { serverId: first.serverId, draft: null },
      deps(),
    );
    expect(w.auth.state.registrations).toHaveLength(1);
    expect(new URL(authorizationUrl).searchParams.get('client_id')).toBe(first.grant.clientId);
    expectOk(await completeSignIn(await approve(authorizationUrl), deps()));
  });

  it('registers again when the redirect URI or the issuer changed', async () => {
    const first = expectOk((await signIn(discovery(w))).result);
    const moved = await prepareSignIn(
      discovery(w),
      { serverId: first.serverId, draft: null },
      deps({ origin: 'https://10.0.0.5' }),
    );
    expect(w.auth.state.registrations).toHaveLength(2);
    expect(new URL(moved.authorizationUrl).searchParams.get('client_id')).not.toBe(
      first.grant.clientId,
    );
    await prepareSignIn(
      discovery(w, { issuer: 'https://other-issuer.example' }),
      { serverId: first.serverId, draft: null },
      deps(),
    );
    expect(w.auth.state.registrations).toHaveLength(3);
  });

  it('without a key it refuses as locked before any registration', async () => {
    const err = await prepareSignIn(discovery(w), { draft: DRAFT }, deps({ mk: null })).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(OAuthError);
    expect((err as OAuthError).kind).toBe('locked');
    expect(w.auth.state.registrations).toHaveLength(0);
    expect(await getClientDataDb().mcpOAuthPending.count()).toBe(0);
  });
});

describe('listening, cancelling and sweeping', () => {
  function fakeChannel() {
    const sent: unknown[] = [];
    const channel = {
      postMessage: (m: unknown) => sent.push(m),
      onmessage: null as ((event: MessageEvent) => void) | null,
      close: () => undefined,
    };
    const deliver = (data: unknown) => channel.onmessage?.({ data } as MessageEvent);
    return { channel, sent, deliver };
  }

  it('only the tab holding the pending state acknowledges', async () => {
    const { state } = await prepareSignIn(discovery(w), { draft: DRAFT }, deps());
    await getClientDataDb().mcpOAuthPending.put({
      state: 'foreign-state',
      sealed: (await getClientDataDb().mcpOAuthPending.get(state))?.sealed as never,
      serverId: 'x',
      createdAt: w.t,
    });
    const { channel, sent, deliver } = fakeChannel();
    const got: CallbackPayload[] = [];
    const stop = listenForCallback((p) => got.push(p), { channel });
    deliver({ type: 'result', payload: { code: 'c', state: 'foreign-state' } });
    deliver({ type: 'result', payload: { code: 'c', state: 'unknown' } });
    deliver({ type: 'ack', state });
    deliver({ type: 'result', payload: { code: 'c', state } });
    await until(() => got.length === 1);
    expect(sent).toEqual([{ type: 'ack', state }]);
    expect(got[0]?.state).toBe(state);
    holdPendingSignIn('foreign-state');
    deliver({ type: 'result', payload: { code: 'c', state: 'foreign-state' } });
    await until(() => got.length === 2);
    stop();
    expect(channel.onmessage).toBeNull();
  });

  it('cancel deletes the pending row, so the callback is then unknown', async () => {
    const { state, authorizationUrl } = await prepareSignIn(discovery(w), { draft: DRAFT }, deps());
    await cancelSignIn(state);
    expect(await getClientDataDb().mcpOAuthPending.get(state)).toBeUndefined();
    expect(await completeSignIn(await approve(authorizationUrl), deps())).toEqual({
      ok: false,
      reason: 'unknown-state',
    });
  });

  it('recentPendingSignIn returns a sign-in only within 2 minutes', async () => {
    const { state } = await prepareSignIn(discovery(w), { draft: DRAFT }, deps());
    expect((await recentPendingSignIn(w.t + MINUTE, w.mk))?.state).toBe(state);
    expect(await recentPendingSignIn(w.t + 2 * MINUTE + 1, w.mk)).toBeNull();
  });

  it('the sweep drops expired rows but keeps a completed one whose server row is missing', async () => {
    const stale = await prepareSignIn(discovery(w), { draft: DRAFT }, deps());
    const { result } = await signIn(discovery(w));
    const ok = expectOk(result);
    const db = getClientDataDb();
    w.t += 11 * MINUTE;
    await sweepExpiredSignIns(w.t);
    expect(await db.mcpOAuthPending.get(stale.state)).toBeUndefined();
    expect(await db.mcpOAuthPending.where('serverId').equals(ok.serverId).count()).toBe(1);
    await finishOrphanedSignIns({ mk: w.mk, now: () => w.t });
    expect((await db.mcpServers.get(ok.serverId))?.name).toBe(DRAFT.name);
    await sweepExpiredSignIns(w.t);
    expect(await db.mcpOAuthPending.count()).toBe(0);
  });

  it('death before the server row is saved: the list load saves it offline, a re-paste returns the draft', async () => {
    const { result, payload } = await signIn(discovery(w));
    const ok = expectOk(result);
    // Linked and offline: only a deferred write can land.
    useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
    const again = await completeSignIn(payload, deps());
    expect(again).toEqual({
      ok: false,
      reason: 'already-connected',
      serverId: ok.serverId,
      draft: DRAFT,
    });
    await finishOrphanedSignIns({ mk: w.mk, now: () => w.t });
    const server = await getClientDataDb().mcpServers.get(ok.serverId);
    expect(server?.prefix).toBe(DRAFT.prefix);
    expect(server?.firstUseConsentFor).toBe(DRAFT.url);
  });

  it('never overwrites a server row saved between the check and the write', async () => {
    const ok = expectOk((await signIn(discovery(w))).result);
    const db = getClientDataDb();
    const edited = { ...serverRowFromDraft(ok.serverId, DRAFT, w.t), name: 'Renamed by the user' };
    const realGet = db.mcpServers.get.bind(db.mcpServers);
    const spy = vi.spyOn(db.mcpServers, 'get').mockImplementation((async (key: string) => {
      const before = await realGet(key);
      // The user's own save lands just after the orphan check has looked.
      await db.mcpServers.put(edited);
      return before;
    }) as never);
    try {
      await finishOrphanedSignIns({ mk: w.mk, now: () => w.t });
    } finally {
      spy.mockRestore();
    }
    expect((await db.mcpServers.get(ok.serverId))?.name).toBe('Renamed by the user');
  });
});

describe('removeGrant', () => {
  it('revokes the refresh token, then deletes the grant and the server row', async () => {
    const ok = expectOk((await signIn(discovery(w))).result);
    const db = getClientDataDb();
    await db.mcpServers.put(serverRowFromDraft(ok.serverId, DRAFT, w.t));
    const refresh = (await openTokens(w.cas.row(ok.serverId)?.tokens ?? null, w.mk, ok.serverId))
      ?.refreshToken;
    expect(await removeGrant(ok.serverId, deps())).toEqual({ revoked: true });
    expect(w.auth.state.revoked.includes(refresh ?? '')).toBe(true);
    expect(await db.mcpOAuthGrants.get(ok.serverId)).toBeUndefined();
    expect(await db.mcpServers.get(ok.serverId)).toBeUndefined();
  });

  it('a failed revocation is revoked: false and still deletes', async () => {
    const ok = expectOk((await signIn(discovery(w))).result);
    const db = getClientDataDb();
    await db.mcpServers.put(serverRowFromDraft(ok.serverId, DRAFT, w.t));
    w.hooks.revokeFails = true;
    expect(await removeGrant(ok.serverId, deps())).toEqual({ revoked: false });
    expect(await db.mcpOAuthGrants.get(ok.serverId)).toBeUndefined();
    expect(await db.mcpServers.get(ok.serverId)).toBeUndefined();
  });
});
