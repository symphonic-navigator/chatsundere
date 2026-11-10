// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { type MasterKey, asMasterKey, getRandomBytes } from '@chatsundere/crypto';
import type { SyncPulledRecord, SyncPushResult } from '@chatsundere/shared-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type McpOAuthGrantRow,
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../../src/boot/client-data-db.js';
import { openTokens, sealTokens } from '../../../src/data/mcp-oauth-grants.js';
import { type EncryptedBlob, sealSecret } from '../../../src/lib/secrets.js';
import {
  type EnsureDeps,
  type EnsureResult,
  type GrantStore,
  createEnsureDeps,
  ensureAccessToken,
  publishNewFamily,
  publishPendingTokens,
} from '../../../src/mcp/oauth/ensure-token.js';
import { acceptedFields, judgePulledGrant } from '../../../src/mcp/oauth/grant-generation.js';
import { createNamedMutex, withGrantLock } from '../../../src/mcp/oauth/grant-lock.js';
import type { AdoptOutcome } from '../../../src/mcp/oauth/grant-store.js';
import { createOAuthFetch } from '../../../src/mcp/oauth/oauth-fetch.js';
import { createPkce } from '../../../src/mcp/oauth/pkce.js';
import { type TokenSet, exchangeCode } from '../../../src/mcp/oauth/token-client.js';
import { type FakeAuthOptions, createFakeAuthServer } from './fake-auth-server.js';
import { CasServer, LOCAL_DEFAULTS, clone } from './grant-harness.js';

// ===== The simulated world =====

const ID = 'srv-1';
const CLIENT = 'client-fixed';
const REDIRECT = 'https://chatsune.me/oauth/callback';
const LEASE = 5 * 60_000;
const HOUR = 3_600_000;

type World = { t: number };

type Forced = 'network' | 'error' | 'epoch-mismatch' | 'tombstoned' | 'poison-conflict' | null;
type PushResult = SyncPushResult | { status: 'network' } | { status: 'epoch-mismatch' };
type PushEntry = { row: McpOAuthGrantRow; baseRev: number; mkBytes: number[]; mkRef: MasterKey };

/** One simulated device: its local rows and revisions, clocks, lock and push log. */
class Device {
  rows = new Map<string, McpOAuthGrantRow>();
  revs = new Map<string, number>();
  wallOffset = 0;
  monoOffset = 0;
  observations = new Map<string, { rev: number; since: number }>();
  pushes: PushEntry[] = [];
  plan: Forced[] = [];
  snapshots = 0;
  syncRequests = 0;
  lock = createNamedMutex();
  beforePush?: (row: McpOAuthGrantRow, baseRev: number) => Promise<void> | void;
  afterPush?: (row: McpOAuthGrantRow, result: PushResult) => Promise<void> | void;
  onSleep?: () => Promise<void> | void;
  onWriteLocal?: (patch: Partial<McpOAuthGrantRow>) => Promise<void> | void;
  /** Runs before a token request is forwarded to the authorisation server. */
  tokenGate?: (init: RequestInit) => Promise<void> | void;
  /** Replaces the token endpoint entirely when it returns a response. */
  tokenOverride?: () => Promise<Response | null> | Response | null;
  afterToken?: () => void;
  tokenPosts = 0;

  constructor(
    readonly deviceId: string,
    readonly world: World,
    readonly cas: CasServer,
    readonly auth: ReturnType<typeof createFakeAuthServer>,
    readonly mk: MasterKey,
  ) {}

  private fetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/token')) {
      this.tokenPosts++;
      await this.tokenGate?.(init ?? {});
      const override = await this.tokenOverride?.();
      if (override) return override;
      const response = await this.auth.fetch(input, init);
      this.afterToken?.();
      return response;
    }
    return this.auth.fetch(input, init);
  };

  private writeIfHigher(row: McpOAuthGrantRow, rev: number): void {
    if (rev > (this.revs.get(row.id) ?? 0)) {
      this.rows.set(row.id, clone(row));
      this.revs.set(row.id, rev);
    }
  }

  private forced(kind: Forced, row: McpOAuthGrantRow): PushResult | null {
    switch (kind) {
      case 'network':
        return { status: 'network' };
      case 'error':
        return { status: 'error', code: 'quota_exceeded' };
      case 'epoch-mismatch':
        return { status: 'epoch-mismatch' };
      case 'tombstoned':
        return {
          status: 'tombstoned',
          current: { blindId: 'x', collection: 'mcpOAuthGrants', rev: 99, deleted: true },
        };
      case 'poison-conflict':
        return {
          status: 'conflict',
          current: {
            blindId: `bid-${row.id}`,
            collection: 'mcpOAuthGrants',
            rev: this.cas.head + 50,
            deleted: false,
            nonce: 'n',
            ciphertext: 'poison',
          },
        };
      default:
        return null;
    }
  }

  readonly store: GrantStore = {
    snapshot: async (id) => {
      this.snapshots++;
      const row = this.rows.get(id);
      return row ? { row: clone(row), rev: this.revs.get(id) ?? 0 } : null;
    },
    putLocal: async (row) => {
      this.rows.set(row.id, clone(row));
    },
    writeLocal: async (id, patch) => {
      const row = this.rows.get(id);
      if (row) this.rows.set(id, { ...row, ...clone(patch) });
      await this.onWriteLocal?.(patch);
    },
    push: async (row, baseRev, mk) => {
      this.pushes.push({ row: clone(row), baseRev, mkBytes: Array.from(mk), mkRef: mk });
      await this.beforePush?.(row, baseRev);
      const kind = this.plan.length > 0 ? (this.plan.shift() ?? null) : null;
      let result = this.forced(kind, row);
      if (!result) {
        result = this.cas.push(row, baseRev);
        if (result.status === 'ok') this.writeIfHigher(row, result.rev);
      }
      await this.afterPush?.(row, result);
      return result;
    },
    open: async (record) => {
      if (!record.ciphertext || record.ciphertext === 'poison') return null;
      return this.cas.body(record.ciphertext);
    },
    adopt: async (record) => this.adopt(record),
    pendingIds: async () =>
      [...this.rows.values()].filter((r) => r.pendingTokens != null).map((r) => r.id),
    requestSync: () => {
      this.syncRequests++;
    },
  };

  /**
   * Mirrors applyRecord for grants: pulled wins above the stored revision unless it is an
   * older generation, which is refused with its revision recorded; pending survives.
   */
  adopt(record: SyncPulledRecord): AdoptOutcome {
    const id = record.blindId.replace(/^bid-/, '');
    if (record.rev <= (this.revs.get(id) ?? 0)) return 'stale';
    if (record.deleted) {
      this.rows.delete(id);
      this.revs.delete(id);
      return 'stale';
    }
    if (!record.ciphertext || record.ciphertext === 'poison') return 'stale';
    const body = this.cas.body(record.ciphertext);
    if (!body) return 'stale';
    const local = this.rows.get(id);
    const verdict = judgePulledGrant(local, body);
    if (local && verdict.kind === 'refuse') {
      this.rows.set(id, { ...local, heldGeneration: verdict.heldGeneration });
      this.revs.set(id, record.rev);
      return 'refused';
    }
    this.rows.set(id, {
      ...body,
      pendingTokens: local?.pendingTokens ?? null,
      pendingBaseRev: local?.pendingBaseRev ?? null,
      pendingSpentRefresh: local?.pendingSpentRefresh ?? null,
      pendingNewFamily: local?.pendingNewFamily ?? false,
      ...acceptedFields(local, body),
    });
    this.revs.set(id, record.rev);
    return 'adopted';
  }

  pull(): void {
    for (const id of this.cas.ids()) this.adopt(this.cas.pulled(id));
  }

  restart(): void {
    this.observations = new Map();
  }

  deps(overrides: Partial<EnsureDeps> = {}): EnsureDeps {
    return {
      store: this.store,
      oauthFetch: createOAuthFetch({ fetch: this.fetch }),
      mk: this.mk,
      isLinked: true,
      hasProxy: false,
      deviceId: this.deviceId,
      wallNow: () => this.world.t + this.wallOffset,
      monotonicNow: () => this.world.t + this.monoOffset,
      sleep: async (ms) => {
        this.world.t += ms;
        await this.onSleep?.();
      },
      observations: this.observations,
      lock: this.lock,
      ...overrides,
    };
  }

  ensure(
    opts: Parameters<typeof ensureAccessToken>[2] = {},
    overrides: Partial<EnsureDeps> = {},
  ): Promise<EnsureResult> {
    return ensureAccessToken(ID, this.deps(overrides), opts);
  }

  row(): McpOAuthGrantRow {
    const row = this.rows.get(ID);
    if (!row) throw new Error('no local row');
    return row;
  }

  claimPushes(): PushEntry[] {
    return this.pushes.filter((p) => p.row.claim !== null);
  }
}

type Setup = {
  world: World;
  auth: ReturnType<typeof createFakeAuthServer>;
  cas: CasServer;
  mk: MasterKey;
  a: Device;
  b: Device;
  first: TokenSet;
};

async function signIn(
  auth: ReturnType<typeof createFakeAuthServer>,
  world: World,
): Promise<TokenSet> {
  const { verifier, challenge } = await createPkce();
  const { code } = await auth.state.authorise({
    redirectUri: REDIRECT,
    state: 'st',
    codeChallenge: challenge,
    clientId: CLIENT,
  });
  const { tokens } = await exchangeCode(
    {
      tokenEndpoint: auth.state.urls.token,
      code,
      verifier,
      clientId: CLIENT,
      redirectUri: REDIRECT,
      resource: auth.state.urls.mcp,
    },
    { oauthFetch: createOAuthFetch({ fetch: auth.fetch }), hasProxy: false, now: () => world.t },
  );
  return tokens;
}

function grantRow(
  auth: ReturnType<typeof createFakeAuthServer>,
  tokens: EncryptedBlob | null,
  overrides: Partial<McpOAuthGrantRow> = {},
): McpOAuthGrantRow {
  return {
    id: ID,
    resource: auth.state.urls.mcp,
    issuer: auth.state.urls.issuer,
    tokenEndpoint: auth.state.urls.token,
    revocationEndpoint: auth.state.urls.revocation,
    clientId: CLIENT,
    registration: 'dcr',
    scope: null,
    tokenRoute: 'direct',
    tokens,
    claim: null,
    ...LOCAL_DEFAULTS,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

async function setup(
  options: FakeAuthOptions = {},
  rowOverrides: Partial<McpOAuthGrantRow> = {},
): Promise<Setup> {
  const world: World = { t: 1_800_000_000_000 };
  const auth = createFakeAuthServer({ graceSeconds: 30, ...options, now: () => world.t });
  const cas = new CasServer();
  const mk = asMasterKey(getRandomBytes(32));
  const first = await signIn(auth, world);
  cas.put(grantRow(auth, await sealTokens(first, mk, ID), rowOverrides));
  const a = new Device('dev-a', world, cas, auth, mk);
  const b = new Device('dev-b', world, cas, auth, mk);
  a.pull();
  b.pull();
  return { world, auth, cas, mk, a, b, first };
}

function expire(s: Setup): void {
  s.world.t += HOUR;
}

async function tokensOf(
  s: Setup,
  blob: EncryptedBlob | null | undefined,
): Promise<TokenSet | null> {
  return openTokens(blob ?? null, s.mk, ID);
}

async function serverTokens(s: Setup): Promise<TokenSet | null> {
  return tokensOf(s, s.cas.row(ID)?.tokens);
}

function okToken(r: EnsureResult): string {
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  return r.accessToken;
}

/** Lets other pending work run; real timers only. */
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

/** A different pair written by another device, valid for an hour. */
async function otherPair(s: Setup, tag: string): Promise<TokenSet> {
  return {
    accessToken: `at-${tag}`,
    refreshToken: `rt-${tag}`,
    accessExpiresAt: s.world.t + HOUR,
    scope: null,
  };
}

/** Device A refreshes but cannot publish, leaving a pending pair. */
async function leavePending(s: Setup): Promise<TokenSet> {
  s.a.plan = [null, 'network'];
  const r = await s.a.ensure();
  okToken(r);
  const pair = await tokensOf(s, s.a.row().pendingTokens);
  if (!pair) throw new Error('no pending pair');
  return pair;
}

afterEach(async () => {
  vi.useRealTimers();
  await _resetClientDataDbForTests();
});

// ===== The numbered cases of the task brief =====

describe('ensureAccessToken, linked device', () => {
  it('1. a valid token needs no claim and no refresh', async () => {
    const s = await setup();
    expect(okToken(await s.a.ensure())).toBe(s.first.accessToken);
    expect(s.a.pushes).toHaveLength(0);
    expect(s.auth.state.refreshAttempts).toHaveLength(0);
    expect(s.auth.state.familyRevoked).toBe(false);
  });

  it('2. an expired token is claimed, refreshed and published; the other device reuses it', async () => {
    const s = await setup();
    expire(s);
    const token = okToken(await s.a.ensure());
    expect(token).not.toBe(s.first.accessToken);
    const row = s.a.row();
    expect(row.pendingTokens).toBeNull();
    expect(row.pendingBaseRev).toBeNull();
    expect(row.pendingSpentRefresh).toBeNull();
    expect(row.pendingNewFamily).toBe(false);
    expect(s.cas.row(ID)?.claim).toBeNull();
    expect((await serverTokens(s))?.accessToken).toBe(token);

    s.b.pull();
    expect(okToken(await s.b.ensure())).toBe(token);
    expect(s.b.pushes).toHaveLength(0);
    expect(s.auth.state.refreshAttempts).toHaveLength(1);
    expect(s.auth.state.familyRevoked).toBe(false);
  });

  it('3. two devices racing make exactly one refresh and end with the same token', async () => {
    const s = await setup();
    expire(s);
    const arrivals = gate();
    let count = 0;
    let aFirstDone = (): void => undefined;
    const aFirst = new Promise<void>((resolve) => {
      aFirstDone = resolve;
    });
    s.a.beforePush = async () => {
      if (++count === 2) arrivals.open();
      await arrivals.wait();
    };
    s.b.beforePush = async () => {
      s.b.beforePush = undefined;
      if (++count === 2) arrivals.open();
      await arrivals.wait();
      await aFirst;
    };
    s.a.afterPush = () => {
      s.a.beforePush = undefined;
      s.a.afterPush = undefined;
      aFirstDone();
    };
    const pa = s.a.ensure();
    s.b.onSleep = async () => {
      await pa;
      s.b.pull();
    };
    const pb = s.b.ensure();
    const [ra, rb] = await Promise.all([pa, pb]);
    expect(okToken(ra)).toBe(okToken(rb));
    expect(s.auth.state.refreshAttempts).toHaveLength(1);
    expect(s.auth.state.familyRevoked).toBe(false);
  });

  it('4. a stale offline device gets conflict and never presents its old token', async () => {
    const s = await setup();
    expire(s);
    const fresh = okToken(await s.b.ensure());
    const attempts = s.auth.state.refreshAttempts.length;
    // A was offline throughout and still holds the first pair.
    expect(okToken(await s.a.ensure())).toBe(fresh);
    expect(s.a.claimPushes()).toHaveLength(1);
    expect(s.auth.state.refreshAttempts).toHaveLength(attempts);
    expect(s.auth.state.familyRevoked).toBe(false);
  });

  it('5. a token from an earlier sign-in is never presented after re-consent', async () => {
    const s = await setup();
    expire(s);
    const second = await signIn(s.auth, s.world);
    s.cas.put(grantRow(s.auth, await sealTokens(second, s.mk, ID)));
    // A has not pulled the new sign-in and its first-family token has expired.
    expect(okToken(await s.a.ensure())).toBe(second.accessToken);
    expect(s.auth.state.refreshAttempts).toHaveLength(0);
    expect(s.auth.state.familyRevoked).toBe(false);
  });

  it("6. a pulled foreign claim is waited for, and the claimer's row adopted", async () => {
    const s = await setup();
    expire(s);
    const hold = gate();
    s.b.tokenGate = () => hold.wait();
    const pb = s.b.ensure();
    await until(() => hold.reached());
    s.a.pull();
    expect(s.a.row().claim?.deviceId).toBe('dev-b');
    s.a.onSleep = async () => {
      hold.open();
      await pb;
      s.a.pull();
    };
    const onWaiting = vi.fn();
    const ra = await s.a.ensure({ onWaiting });
    expect(okToken(ra)).toBe(okToken(await pb));
    expect(s.a.pushes).toHaveLength(0);
    expect(onWaiting).toHaveBeenCalledTimes(1);
    expect(s.a.syncRequests).toBeGreaterThan(0);
    expect(s.auth.state.refreshAttempts).toHaveLength(1);
    expect(s.auth.state.familyRevoked).toBe(false);
  });

  it('7. a foreign claim longer than the 20 s budget returns waiting, with no push', async () => {
    const s = await setup();
    expire(s);
    s.cas.put({ ...s.a.row(), claim: { deviceId: 'dev-c', at: s.world.t } });
    s.a.pull();
    const start = s.world.t;
    expect(await s.a.ensure()).toEqual({ ok: false, reason: 'waiting' });
    expect(s.world.t - start).toBeGreaterThanOrEqual(20_000);
    expect(s.world.t - start).toBeLessThan(25_000);
    expect(s.a.pushes).toHaveLength(0);
    expect(s.auth.state.refreshAttempts).toHaveLength(0);
    expect(s.auth.state.familyRevoked).toBe(false);
  });

  it('8. a claim observed unchanged for the lease is taken over by compare-and-set', async () => {
    const s = await setup();
    expire(s);
    s.cas.put({ ...s.a.row(), claim: { deviceId: 'dev-c', at: s.world.t } });
    s.a.pull();
    expect(await s.a.ensure()).toEqual({ ok: false, reason: 'waiting' });
    s.world.t += LEASE;
    const token = okToken(await s.a.ensure());
    expect(s.a.claimPushes()).toHaveLength(1);
    expect(s.a.claimPushes()[0]?.row.claim?.deviceId).toBe('dev-a');
    expect((await serverTokens(s))?.accessToken).toBe(token);
    expect(s.auth.state.refreshAttempts).toHaveLength(1);
    expect(s.auth.state.familyRevoked).toBe(false);
  });

  it('8b. a claim whose revision changes during observation restarts the observation', async () => {
    const s = await setup();
    expire(s);
    s.cas.put({ ...s.a.row(), claim: { deviceId: 'dev-c', at: 1 } });
    s.a.pull();
    const t0 = s.world.t;
    expect(await s.a.ensure()).toEqual({ ok: false, reason: 'waiting' });
    s.world.t = t0 + 60_000;
    s.cas.put({ ...s.a.row(), claim: { deviceId: 'dev-c', at: 2 } });
    s.a.pull();
    expect(await s.a.ensure()).toEqual({ ok: false, reason: 'waiting' });
    s.world.t = t0 + LEASE + 30_000;
    expect(await s.a.ensure()).toEqual({ ok: false, reason: 'waiting' });
    expect(s.a.pushes).toHaveLength(0);
    s.world.t = t0 + 60_000 + LEASE + 1_000;
    okToken(await s.a.ensure());
    expect(s.auth.state.refreshAttempts).toHaveLength(1);
    expect(s.auth.state.familyRevoked).toBe(false);
  });

  it('9. an own leftover claim without a pending pair is treated as a foreign one', async () => {
    const s = await setup();
    expire(s);
    s.cas.put({ ...s.a.row(), claim: { deviceId: 'dev-a', at: s.world.t } });
    s.a.pull();
    expect(await s.a.ensure()).toEqual({ ok: false, reason: 'waiting' });
    expect(s.a.pushes).toHaveLength(0);
    expect(s.auth.state.refreshAttempts).toHaveLength(0);
    s.world.t += LEASE;
    okToken(await s.a.ensure());
    expect(s.auth.state.refreshAttempts).toHaveLength(1);
    expect(s.auth.state.familyRevoked).toBe(false);
  });

  it('10. after a failed publish the next call publishes the pending pair and never re-refreshes', async () => {
    const s = await setup();
    expire(s);
    const pair = await leavePending(s);
    expect(s.cas.row(ID)?.claim?.deviceId).toBe('dev-a');

    // Publish still fails: the pending pair is used while valid, no claim is pushed.
    const before = s.a.pushes.length;
    s.a.plan = ['network'];
    expect(okToken(await s.a.ensure())).toBe(pair.accessToken);
    s.a.plan = ['network'];
    expect(await s.a.ensure({ rejectedToken: pair.accessToken })).toEqual({
      ok: false,
      reason: 'waiting',
    });
    const since = s.a.pushes.slice(before);
    expect(since).toHaveLength(2);
    expect(since.every((p) => p.row.claim === null)).toBe(true);

    // Publish succeeds.
    expect(okToken(await s.a.ensure())).toBe(pair.accessToken);
    expect(s.cas.row(ID)?.claim).toBeNull();
    expect((await serverTokens(s))?.accessToken).toBe(pair.accessToken);
    expect(s.a.row().pendingTokens).toBeNull();
    expect(s.auth.state.refreshAttempts).toHaveLength(1);
    expect(s.auth.state.familyRevoked).toBe(false);
  });

  it('11. a crash between refresh and publish leaves pending fields that are published later', async () => {
    const s = await setup();
    expire(s);
    let pushes = 0;
    s.a.beforePush = () => {
      if (++pushes === 2) throw new Error('simulated crash');
    };
    // The throw stands in for the tab dying: the caller only ever sees `waiting`.
    expect(await s.a.ensure()).toEqual({ ok: false, reason: 'waiting' });
    s.a.beforePush = undefined;
    const claimRev = s.cas.rev(ID);
    const row = s.a.row();
    expect(row.pendingTokens).not.toBeNull();
    expect(row.pendingBaseRev).toBe(claimRev);
    expect(row.pendingSpentRefresh).not.toBeNull();

    s.a.restart();
    await publishPendingTokens(s.a.deps());
    const last = s.a.pushes.at(-1);
    expect(last?.baseRev).toBe(claimRev);
    expect(s.cas.row(ID)?.claim).toBeNull();
    const published = await serverTokens(s);
    expect(published?.accessToken).toBe((await tokensOf(s, row.pendingTokens))?.accessToken);
    s.b.pull();
    expect(okToken(await s.b.ensure())).toBe(published?.accessToken);
    expect(s.auth.state.refreshAttempts).toHaveLength(1);
    expect(s.auth.state.familyRevoked).toBe(false);
  });

  it('12. a publish conflict whose current holds the spent token re-pushes at most 3 times', async () => {
    const s = await setup();
    expire(s);
    const pair = await leavePending(s);
    // A takeover in progress: B's claim over the spent token, at a new revision.
    s.cas.put({ ...(s.cas.row(ID) as McpOAuthGrantRow), claim: { deviceId: 'dev-b', at: 1 } });
    expect(okToken(await s.a.ensure())).toBe(pair.accessToken);
    expect((await serverTokens(s))?.accessToken).toBe(pair.accessToken);
    expect(s.cas.row(ID)?.claim).toBeNull();
    expect(s.a.row().pendingTokens).toBeNull();

    const s2 = await setup();
    expire(s2);
    const pair2 = await leavePending(s2);
    const before = s2.a.pushes.length;
    s2.a.beforePush = () => {
      s2.cas.put({ ...(s2.cas.row(ID) as McpOAuthGrantRow), claim: { deviceId: 'dev-b', at: 1 } });
    };
    expect(okToken(await s2.a.ensure())).toBe(pair2.accessToken);
    expect(s2.a.pushes.length - before).toBe(4);
    expect(s2.a.row().pendingTokens).not.toBeNull();
    expect(s2.auth.state.refreshAttempts).toHaveLength(1);
    expect(s.auth.state.refreshAttempts).toHaveLength(1);
    expect(s.auth.state.familyRevoked).toBe(false);
  });

  it('13. a publish conflict with a different pair adopts it, also after a restart and a pull', async () => {
    const s = await setup();
    expire(s);
    await leavePending(s);
    const t3 = await otherPair(s, 'three');
    s.cas.put(grantRow(s.auth, await sealTokens(t3, s.mk, ID)));
    expect(okToken(await s.a.ensure())).toBe(t3.accessToken);
    expect((await serverTokens(s))?.refreshToken).toBe(t3.refreshToken);
    expect(s.a.row().pendingTokens).toBeNull();

    const s2 = await setup();
    expire(s2);
    await leavePending(s2);
    const other = await otherPair(s2, 'three');
    s2.cas.put(grantRow(s2.auth, await sealTokens(other, s2.mk, ID)));
    s2.a.pull();
    expect((await tokensOf(s2, s2.a.row().tokens))?.refreshToken).toBe(other.refreshToken);
    s2.a.restart();
    const before = s2.a.pushes.length;
    await publishPendingTokens(s2.a.deps());
    expect(s2.a.pushes.length - before).toBe(1);
    expect((await serverTokens(s2))?.refreshToken).toBe(other.refreshToken);
    expect(s2.a.row().pendingTokens).toBeNull();
    expect(s2.auth.state.refreshAttempts).toHaveLength(1);
    expect(s2.auth.state.familyRevoked).toBe(false);
  });

  it('14. publish tombstoned discards and revokes; undecryptable, error, epoch-mismatch keep', async () => {
    const s = await setup();
    expire(s);
    const pair = await leavePending(s);
    for (const kind of ['poison-conflict', 'error', 'epoch-mismatch'] as const) {
      s.a.plan = [kind];
      expect(okToken(await s.a.ensure())).toBe(pair.accessToken);
      expect(s.a.row().pendingTokens).not.toBeNull();
    }
    s.cas.tombstone(ID);
    expect(await s.a.ensure()).toEqual({ ok: false, reason: 'dead' });
    expect(s.a.row().pendingTokens).toBeNull();
    expect(s.auth.state.revoked).toContain(pair.refreshToken);
    expect(s.auth.state.refreshAttempts).toHaveLength(1);
    // The revocation is ours, through /revoke.
    expect(s.auth.state.familyRevoked).toBe(true);
  });

  it('15. a pull between write-ahead and publish does not move the publish base', async () => {
    const s = await setup();
    expire(s);
    const newer = await otherPair(s, 'nine');
    const sealedNewer = await sealTokens(newer, s.mk, ID);
    s.a.onWriteLocal = (patch) => {
      if (patch.pendingTokens) {
        s.a.onWriteLocal = undefined;
        s.cas.put(grantRow(s.auth, sealedNewer));
        s.a.pull();
      }
    };
    okToken(await s.a.ensure());
    expect((await serverTokens(s))?.refreshToken).toBe(newer.refreshToken);
    expect((await tokensOf(s, s.a.row().tokens))?.refreshToken).toBe(newer.refreshToken);
    expect(s.a.row().pendingTokens).toBeNull();
    expect(s.auth.state.refreshAttempts).toHaveLength(1);
    expect(s.auth.state.familyRevoked).toBe(false);
  });

  it('16. claim results: network, error, epoch-mismatch wait; tombstoned is dead; poison is bounded', async () => {
    const s = await setup();
    expire(s);
    for (const kind of ['network', 'error', 'epoch-mismatch'] as const) {
      s.a.plan = [kind];
      expect(await s.a.ensure()).toEqual({ ok: false, reason: 'waiting' });
    }
    s.a.plan = ['tombstoned'];
    expect(await s.a.ensure()).toEqual({ ok: false, reason: 'dead' });
    const before = s.a.pushes.length;
    s.a.plan = Array.from({ length: 10 }, () => 'poison-conflict' as const);
    expect(await s.a.ensure()).toEqual({ ok: false, reason: 'waiting' });
    expect(s.a.pushes.length - before).toBe(3);
    expect(s.auth.state.refreshAttempts).toHaveLength(0);
    expect(s.auth.state.familyRevoked).toBe(false);
  });

  it('17. a lost token response is retried within 25 s', async () => {
    const s = await setup();
    expire(s);
    s.auth.state.loseNextTokenResponse = true;
    okToken(await s.a.ensure());
    expect(s.auth.state.refreshAttempts.map((r) => r.outcome)).toEqual(['ok', 'replayed']);
    expect(s.auth.state.familyRevoked).toBe(false);
  });

  it('17b. after 25 s of lost responses the state is in doubt and the claim cleared', async () => {
    const s = await setup();
    expire(s);
    s.a.afterToken = () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await s.a.ensure()).toEqual({ ok: false, reason: 'in-doubt' });
    expect(s.cas.row(ID)?.claim).toBeNull();
    const attempts = s.auth.state.refreshAttempts;
    expect(attempts.length).toBeGreaterThan(1);
    const firstAt = attempts[0]?.at ?? 0;
    expect(attempts.every((r) => r.at - firstAt < 25_000)).toBe(true);
    expect(s.auth.state.familyRevoked).toBe(false);
  });

  it("17c. the request's 20 s timeout aborts a hung fetch, which is then retried", async () => {
    const s = await setup();
    expire(s);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let hung = false;
    s.a.tokenGate = (init) => {
      s.a.tokenGate = undefined;
      hung = true;
      return new Promise<void>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          s.world.t += 20_000;
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    };
    const p = s.a.ensure();
    await vi.waitFor(() => expect(hung).toBe(true));
    await vi.advanceTimersByTimeAsync(20_000);
    vi.useRealTimers();
    okToken(await p);
    expect(s.a.tokenPosts).toBe(2);
    expect(s.auth.state.refreshAttempts).toHaveLength(1);
    expect(s.auth.state.familyRevoked).toBe(false);
  });

  it('18. invalid_grant publishes tokens: null; a conflict adopts; a 503 clears the claim', async () => {
    const s = await setup();
    const dead: TokenSet = {
      accessToken: 'at-dead',
      refreshToken: 'rt-unknown',
      accessExpiresAt: s.world.t - 1,
      scope: null,
    };
    s.cas.put(grantRow(s.auth, await sealTokens(dead, s.mk, ID)));
    s.a.pull();
    expect(await s.a.ensure()).toEqual({ ok: false, reason: 'dead' });
    expect(s.cas.row(ID)?.tokens).toBeNull();
    expect(s.cas.row(ID)?.claim).toBeNull();
    expect(s.auth.state.refreshAttempts.map((r) => r.outcome)).toEqual(['invalid_grant']);
    expect(s.auth.state.familyRevoked).toBe(false);

    // A new sign-in lands while the dead grant is being published: adopted, not overwritten.
    const s2 = await setup();
    s2.cas.put(grantRow(s2.auth, await sealTokens(dead, s2.mk, ID)));
    s2.a.pull();
    const fresh = await otherPair(s2, 'fresh');
    let n = 0;
    s2.a.beforePush = async () => {
      if (++n === 2) s2.cas.put(grantRow(s2.auth, await sealTokens(fresh, s2.mk, ID)));
    };
    await s2.a.ensure();
    expect((await serverTokens(s2))?.refreshToken).toBe(fresh.refreshToken);
    expect((await tokensOf(s2, s2.a.row().tokens))?.refreshToken).toBe(fresh.refreshToken);

    // A 503 spends nothing: the claim is cleared, and the next call claims at once.
    const s3 = await setup();
    expire(s3);
    s3.a.tokenOverride = () => new Response('unavailable', { status: 503 });
    expect(await s3.a.ensure()).toEqual({ ok: false, reason: 'waiting' });
    expect(s3.cas.row(ID)?.claim).toBeNull();
    s3.a.tokenOverride = undefined;
    const start = s3.world.t;
    okToken(await s3.a.ensure());
    expect(s3.world.t - start).toBeLessThan(5_000);
    expect(s3.auth.state.refreshAttempts).toHaveLength(1);
    expect(s3.auth.state.familyRevoked).toBe(false);
  });

  it('19. without a grace period a retried refresh ends dead, without throwing', async () => {
    const s = await setup({ graceSeconds: 0 });
    expire(s);
    s.auth.state.loseNextTokenResponse = true;
    expect(await s.a.ensure()).toEqual({ ok: false, reason: 'dead' });
    expect(s.auth.state.refreshAttempts.map((r) => r.outcome)).toEqual(['ok', 'reuse-revoked']);
    expect(s.auth.state.familyRevoked).toBe(true);
  });

  it('21. a wall clock 5 minutes ahead never takes over a live claim', async () => {
    const s = await setup();
    expire(s);
    const hold = gate();
    s.a.tokenGate = () => hold.wait();
    const pa = s.a.ensure();
    await until(() => hold.reached());
    s.b.wallOffset = LEASE;
    s.b.pull();
    expect(await s.b.ensure()).toEqual({ ok: false, reason: 'waiting' });
    expect(s.b.pushes).toHaveLength(0);
    hold.open();
    okToken(await pa);
    expect(s.auth.state.refreshAttempts).toHaveLength(1);
    expect(s.auth.state.familyRevoked).toBe(false);
  });

  it('22. without expiry: no proactive refresh, one refresh per 401, never a loop', async () => {
    const s = await setup({ expiresIn: null });
    expect(s.first.accessExpiresAt).toBeNull();
    s.world.t += 10 * HOUR;
    expect(okToken(await s.a.ensure())).toBe(s.first.accessToken);
    expect(s.auth.state.refreshAttempts).toHaveLength(0);
    const second = okToken(await s.a.ensure({ rejectedToken: s.first.accessToken }));
    expect(second).not.toBe(s.first.accessToken);
    expect(s.auth.state.refreshAttempts).toHaveLength(1);
    const posts = s.a.tokenPosts;
    s.a.tokenOverride = () =>
      new Response(JSON.stringify({ error: 'invalid_grant' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    const third = await s.a.ensure({ rejectedToken: second });
    expect(third.ok).toBe(false);
    expect(['dead', 'in-doubt']).toContain(third.ok ? '' : third.reason);
    expect(s.a.tokenPosts - posts).toBe(1);
    expect(s.auth.state.familyRevoked).toBe(false);
  });

  it('23. a rejected token already replaced returns the current one without refreshing', async () => {
    const s = await setup();
    expect(okToken(await s.a.ensure({ rejectedToken: 'at-something-older' }))).toBe(
      s.first.accessToken,
    );
    expect(s.auth.state.refreshAttempts).toHaveLength(0);
    expect(s.auth.state.familyRevoked).toBe(false);
  });

  it('24. no key at the start is locked; a key zeroed mid-flight leaves the private copy intact', async () => {
    const s = await setup();
    expire(s);
    expect(await s.a.ensure({}, { mk: null })).toEqual({ ok: false, reason: 'locked' });
    expect(s.a.pushes).toHaveLength(0);

    const session = asMasterKey(new Uint8Array(s.mk));
    s.a.afterToken = () => {
      session.fill(0);
    };
    const token = okToken(await s.a.ensure({}, { mk: session }));
    expect(Array.from(session).every((b) => b === 0)).toBe(true);
    expect((await serverTokens(s))?.accessToken).toBe(token);
    const publish = s.a.pushes.at(-1);
    expect(publish?.row.claim).toBeNull();
    expect(publish?.mkRef).not.toBe(session);
    expect(publish?.mkBytes).toEqual(Array.from(s.mk));
    expect(s.auth.state.refreshAttempts).toHaveLength(1);
    expect(s.auth.state.familyRevoked).toBe(false);
  });

  it('25. two tabs make one refresh; a caller abort never cancels the POST', async () => {
    const s = await setup();
    expire(s);
    const controller = new AbortController();
    s.a.tokenGate = () => {
      controller.abort();
    };
    const tab1 = s.a.ensure({ signal: controller.signal }, { lock: withGrantLock });
    const tab2 = s.a.ensure({}, { lock: withGrantLock });
    const [r1, r2] = await Promise.all([tab1, tab2]);
    expect(okToken(r1)).toBe(okToken(r2));
    // The second tab only ran once the first was done: claim and publish, nothing more.
    expect(s.a.pushes).toHaveLength(2);
    expect((await serverTokens(s))?.accessToken).toBe(okToken(r1));
    expect(s.auth.state.refreshAttempts).toHaveLength(1);
    expect(s.auth.state.familyRevoked).toBe(false);
  });

  it('25c. the lock fallback queues callers per name, and an abort only cancels the wait', async () => {
    const lock = createNamedMutex();
    const order: string[] = [];
    const first = gate();
    const one = lock('x', async () => {
      order.push('one-in');
      await first.wait();
      order.push('one-out');
    });
    const controller = new AbortController();
    const aborted = lock('x', async () => order.push('aborted-ran'), {
      signal: controller.signal,
    });
    const two = lock('x', async () => order.push('two-in'));
    const other = lock('y', async () => order.push('other-name'));
    await other;
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    expect(order).toEqual(['one-in', 'other-name']);
    first.open();
    await Promise.all([one, two]);
    expect(order).toEqual(['one-in', 'other-name', 'one-out', 'two-in']);
  });

  it('25b. two createEnsureDeps calls share one observations map', async () => {
    await openClientDataDb();
    const one = await createEnsureDeps();
    const two = await createEnsureDeps();
    expect(one.observations).toBe(two.observations);
    expect(one.deviceId).toBe(two.deviceId);
  });

  it('26. no grant row is no-grant, never dead', async () => {
    const s = await setup();
    s.a.rows.clear();
    expect(await s.a.ensure()).toEqual({ ok: false, reason: 'no-grant' });
    expect(s.auth.state.refreshAttempts).toHaveLength(0);
    expect(s.auth.state.familyRevoked).toBe(false);
  });

  it('28. a tab frozen between claim and POST sends nothing, releases the claim and re-snapshots', async () => {
    for (const clock of ['wall', 'mono'] as const) {
      const s = await setup();
      expire(s);
      // Every claim it wins is followed by a freeze.
      s.a.afterPush = (row, result) => {
        if (result.status !== 'ok' || row.claim === null) return;
        if (clock === 'wall') s.a.wallOffset += 6 * 60_000;
        else s.a.monoOffset += 6 * 60_000;
      };
      let snapshotsAtClaim = 0;
      s.a.beforePush = () => {
        snapshotsAtClaim = s.a.snapshots;
      };
      expect(await s.a.ensure()).toEqual({ ok: false, reason: 'waiting' });
      expect(s.a.snapshots).toBeGreaterThan(0);
      expect(snapshotsAtClaim).toBeGreaterThan(1);
      expect(s.a.tokenPosts).toBe(0);
      // Each unspent claim was released, so no device waits out a lease over it.
      expect(s.cas.row(ID)?.claim).toBeNull();
      expect(s.a.claimPushes()).toHaveLength(2);
      expect(s.auth.state.refreshAttempts).toHaveLength(0);
      expect(s.auth.state.familyRevoked).toBe(false);
    }
  });

  it('28b. after one freeze before any POST, the flow claims afresh and refreshes', async () => {
    const s = await setup();
    expire(s);
    s.a.afterPush = (row, result) => {
      if (result.status !== 'ok' || row.claim === null) return;
      s.a.afterPush = undefined;
      s.a.wallOffset += 6 * 60_000;
    };
    const token = okToken(await s.a.ensure());
    const release = s.a.pushes[1];
    expect(release?.row.claim).toBeNull();
    expect(release?.baseRev).toBe((s.a.pushes[0]?.baseRev ?? 0) + 1);
    expect(s.a.claimPushes()).toHaveLength(2);
    expect(s.a.tokenPosts).toBe(1);
    expect((await serverTokens(s))?.accessToken).toBe(token);
    expect(s.auth.state.refreshAttempts).toHaveLength(1);
    expect(s.auth.state.familyRevoked).toBe(false);
  });

  it('28c. a freeze after a POST went out keeps the claim, since the token may be spent', async () => {
    const s = await setup();
    expire(s);
    s.a.afterToken = () => {
      s.a.afterToken = undefined;
      s.a.wallOffset += 6 * 60_000;
      throw new TypeError('Failed to fetch');
    };
    expect(await s.a.ensure()).toEqual({ ok: false, reason: 'waiting' });
    expect(s.a.tokenPosts).toBe(1);
    expect(s.cas.row(ID)?.claim?.deviceId).toBe('dev-a');
    expect(s.auth.state.refreshAttempts).toHaveLength(1);
    expect(s.auth.state.familyRevoked).toBe(false);
  });

  it('32. while the link status is unknown nothing is claimed, written or published', async () => {
    const s = await setup();
    expire(s);
    await leavePending(s);
    const before = s.a.pushes.length;
    const row = s.a.row();
    expect(await s.a.ensure({}, { isLinked: false, linkKnown: false })).toEqual({
      ok: false,
      reason: 'waiting',
    });
    await publishPendingTokens(s.a.deps({ isLinked: false, linkKnown: false }));
    await publishNewFamily(ID, s.a.deps({ isLinked: false, linkKnown: false }));
    expect(s.a.pushes).toHaveLength(before);
    expect(s.a.row()).toEqual(row);
    expect(s.a.tokenPosts).toBe(1);
    expect(s.auth.state.refreshAttempts).toHaveLength(1);
    expect(s.auth.state.familyRevoked).toBe(false);
  });

  it('33. a write-ahead that throws after the POST keeps the claim and returns the token', async () => {
    const s = await setup();
    expire(s);
    const write = s.a.store.writeLocal;
    s.a.store.writeLocal = async (id, patch) => {
      if (patch.pendingTokens) throw new Error('quota');
      await write(id, patch);
    };
    const token = okToken(await s.a.ensure());
    expect(token).not.toBe(s.first.accessToken);
    expect(s.a.tokenPosts).toBe(1);
    expect(s.cas.row(ID)?.claim?.deviceId).toBe('dev-a');
    expect(s.a.row().pendingTokens).toBeNull();
    expect(s.auth.state.refreshAttempts).toHaveLength(1);
    expect(s.auth.state.familyRevoked).toBe(false);
  });

  it('34. an unexpected throw is waiting, without its message, and the key copy is zeroed', async () => {
    const s = await setup();
    expire(s);
    let given: MasterKey | null = null;
    s.a.store.push = async (_row, _rev, mk) => {
      given = mk;
      throw new Error('internal detail that must not leak');
    };
    const result = await s.a.ensure();
    expect(result).toEqual({ ok: false, reason: 'waiting' });
    expect(JSON.stringify(result)).not.toContain('internal');
    expect(given).not.toBeNull();
    expect(Array.from(given ?? []).every((b) => b === 0)).toBe(true);
    expect(Array.from(s.mk).every((b) => b === 0)).toBe(false);
    expect(s.auth.state.refreshAttempts).toHaveLength(0);
    expect(s.auth.state.familyRevoked).toBe(false);
  });

  it('29. no refresh token is dead and a proxy route without a proxy is no-proxy, unclaimed', async () => {
    const s = await setup({ issueRefresh: false });
    expire(s);
    expect(await s.a.ensure()).toEqual({ ok: false, reason: 'dead' });
    expect(s.a.pushes).toHaveLength(0);

    const p = await setup({}, { tokenRoute: 'proxy' });
    expire(p);
    expect(await p.a.ensure({}, { hasProxy: false })).toEqual({ ok: false, reason: 'no-proxy' });
    expect(p.a.pushes).toHaveLength(0);
    expect(p.auth.state.refreshAttempts).toHaveLength(0);
    expect(p.auth.state.familyRevoked).toBe(false);
  });

  it('30. a corrupt tokens blob is dead, without throwing', async () => {
    const s = await setup();
    s.cas.put({
      ...s.a.row(),
      tokens: { version: 1, ciphertext: new Uint8Array([1, 2, 3, 4]), nonce: new Uint8Array(12) },
    });
    s.a.pull();
    expect(await s.a.ensure()).toEqual({ ok: false, reason: 'dead' });

    const malformed = await sealSecret('{"accessToken":5}', s.mk, `mcp/${ID}/oauth-tokens`);
    s.cas.put({ ...s.a.row(), tokens: malformed });
    s.a.pull();
    expect(await s.a.ensure()).toEqual({ ok: false, reason: 'dead' });
    expect(s.a.pushes).toHaveLength(0);
    expect(s.auth.state.refreshAttempts).toHaveLength(0);
    expect(s.auth.state.familyRevoked).toBe(false);
  });

  it("31. after step 3's publish adopts, the flow uses the adopted row", async () => {
    const s = await setup();
    expire(s);
    await leavePending(s);
    const claimsBefore = s.a.claimPushes().length;
    const t3 = await otherPair(s, 'adopted');
    s.cas.put(grantRow(s.auth, await sealTokens(t3, s.mk, ID)));
    expect(okToken(await s.a.ensure())).toBe(t3.accessToken);
    expect(s.a.claimPushes()).toHaveLength(claimsBefore);
    expect(s.auth.state.refreshAttempts).toHaveLength(1);
    expect(s.auth.state.familyRevoked).toBe(false);
  });
});

describe('ensureAccessToken, unlinked device', () => {
  it('20. no claim, a plain local write; a decoupled pending pair is promoted first', async () => {
    const s = await setup();
    expire(s);
    const token = okToken(await s.a.ensure({}, { isLinked: false }));
    expect(s.a.pushes).toHaveLength(0);
    expect(s.a.row().claim).toBeNull();
    expect((await tokensOf(s, s.a.row().tokens))?.accessToken).toBe(token);
    expect(s.auth.state.refreshAttempts).toHaveLength(1);

    const s2 = await setup();
    expire(s2);
    const pair = await leavePending(s2);
    expire(s2);
    okToken(await s2.a.ensure({}, { isLinked: false }));
    expect(s2.a.row().pendingTokens).toBeNull();
    expect(s2.a.row().pendingSpentRefresh).toBeNull();
    const presented = s2.auth.state.refreshAttempts.map((r) => r.token);
    expect(presented).toHaveLength(2);
    expect(presented[1]).toBe(pair.refreshToken);
    expect(s2.auth.state.familyRevoked).toBe(false);
  });
});

describe('publishNewFamily', () => {
  async function stageNewFamily(s: Setup, baseRev: number): Promise<TokenSet> {
    const fresh = await signIn(s.auth, s.world);
    await s.a.store.writeLocal(ID, {
      pendingTokens: await sealTokens(fresh, s.mk, ID),
      pendingBaseRev: baseRev,
      pendingSpentRefresh: null,
      pendingNewFamily: true,
    });
    return fresh;
  }

  it('27. re-pushes over the old row on conflict, at most 3 times per attempt', async () => {
    const s = await setup();
    const fresh = await stageNewFamily(s, 0);
    await s.a.lock(ID, () => publishNewFamily(ID, s.a.deps()));
    expect((await serverTokens(s))?.refreshToken).toBe(fresh.refreshToken);
    const row = s.a.row();
    expect(row.pendingTokens).toBeNull();
    expect(row.pendingBaseRev).toBeNull();
    expect(row.pendingSpentRefresh).toBeNull();
    expect(row.pendingNewFamily).toBe(false);

    const s2 = await setup();
    await stageNewFamily(s2, 0);
    s2.a.beforePush = () => {
      s2.cas.put(s2.cas.row(ID) as McpOAuthGrantRow);
    };
    await s2.a.lock(ID, () => publishNewFamily(ID, s2.a.deps()));
    expect(s2.a.pushes).toHaveLength(4);
    expect(s2.a.row().pendingNewFamily).toBe(true);
    expect(s2.auth.state.refreshAttempts).toHaveLength(0);
    expect(s2.auth.state.familyRevoked).toBe(false);
  });

  it('27b. offline keeps it pending and usable; the old-family device then adopts the new one', async () => {
    const s = await setup();
    const fresh = await stageNewFamily(s, s.cas.rev(ID));
    s.a.plan = ['network'];
    await s.a.lock(ID, () => publishNewFamily(ID, s.a.deps()));
    expect(s.a.row().pendingNewFamily).toBe(true);
    s.a.plan = ['network'];
    expect(okToken(await s.a.ensure())).toBe(fresh.accessToken);
    expect(s.a.claimPushes()).toHaveLength(0);

    await publishPendingTokens(s.a.deps());
    expect((await serverTokens(s))?.refreshToken).toBe(fresh.refreshToken);
    s.b.pull();
    expire(s);
    okToken(await s.b.ensure());
    expect(s.auth.state.refreshAttempts.map((r) => r.token)).toEqual([fresh.refreshToken]);
    expect(s.auth.state.familyRevoked).toBe(false);
  });

  it('27c. step 3 and publishPendingTokens follow the new-family rule, never adopting the old row', async () => {
    const s = await setup();
    const fresh = await stageNewFamily(s, 0);
    expect(okToken(await s.a.ensure())).toBe(fresh.accessToken);
    expect((await serverTokens(s))?.refreshToken).toBe(fresh.refreshToken);
    expect(s.a.row().pendingNewFamily).toBe(false);

    const s2 = await setup();
    const fresh2 = await stageNewFamily(s2, 0);
    await publishPendingTokens(s2.a.deps());
    expect((await serverTokens(s2))?.refreshToken).toBe(fresh2.refreshToken);
    expect((await tokensOf(s2, s2.a.row().tokens))?.refreshToken).toBe(fresh2.refreshToken);
    expect(s2.auth.state.refreshAttempts).toHaveLength(0);
    expect(s2.auth.state.familyRevoked).toBe(false);
  });

  it('27d. tombstoned discards and revokes', async () => {
    const s = await setup();
    const fresh = await stageNewFamily(s, s.cas.rev(ID));
    s.cas.tombstone(ID);
    await s.a.lock(ID, () => publishNewFamily(ID, s.a.deps()));
    expect(s.a.row().pendingTokens).toBeNull();
    expect(s.auth.state.revoked).toContain(fresh.refreshToken);
    expect(s.auth.state.refreshAttempts).toHaveLength(0);
    expect(s.auth.state.familyRevoked).toBe(true);
  });

  it('27e. after a published new family, a later ordinary pair follows the adopt rule', async () => {
    const s = await setup();
    await stageNewFamily(s, 0);
    await s.a.lock(ID, () => publishNewFamily(ID, s.a.deps()));
    expire(s);
    await leavePending(s);
    expect(s.a.row().pendingNewFamily).toBe(false);
    const other = await otherPair(s, 'other');
    s.cas.put(grantRow(s.auth, await sealTokens(other, s.mk, ID)));
    expect(okToken(await s.a.ensure())).toBe(other.accessToken);
    expect((await serverTokens(s))?.refreshToken).toBe(other.refreshToken);
    expect(s.auth.state.refreshAttempts).toHaveLength(1);
    expect(s.auth.state.familyRevoked).toBe(false);
  });
});

describe('the device harness', () => {
  it('device adopt refuses an older generation', async () => {
    const s = await setup({}, { generation: 4 });
    s.b.rows.set(ID, { ...s.b.row(), generation: 9, seenGeneration: 9, pendingBaseRev: 1 });
    const before = s.b.row();
    s.cas.put(grantRow(s.auth, null, { generation: 2, scope: 'older' }));

    expect(s.b.adopt(s.cas.pulled(ID))).toBe('refused');
    expect(s.b.row()).toEqual({ ...before, heldGeneration: 2 });
    expect(s.b.revs.get(ID)).toBe(s.cas.rev(ID));
    expect(s.b.adopt(s.cas.pulled(ID))).toBe('stale');

    s.cas.put(grantRow(s.auth, null, { generation: 9, scope: 'equal' }));
    expect(s.b.adopt(s.cas.pulled(ID))).toBe('adopted');
    expect(s.b.row().scope).toBe('equal');
    expect(s.b.row().seenGeneration).toBe(9);
    expect(s.b.row().heldGeneration).toBeNull();
    expect(s.b.row().pendingBaseRev).toBe(1);
  });
});
