# WS-0 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the client-side backend-discovery consumer, the central account-link gate, the connectivity regain-probe, and the `useServerGate` disabled-over-hidden derivation hook — the foundation every later transition workstream consumes.

**Architecture:** Three new Zustand stores/modules in `packages/ui-shared` (`server-config` validation, `account-link.store`, `discovery.store`) plus a regain-callback extension to the existing `connectivity.store`; one new wire type in `packages/shared-types`; a copy catalogue section, the `useServerGate` hook, effective-URL selectors, and boot wiring in `apps/user-client`. Memory-only state; no Dexie change; no `packages/crypto` change. Spec: `superpowers/specs/2026-07-02-ws0-foundation-design.md` (v2, Laura-passed).

**Tech Stack:** TypeScript strict, Zustand v5, Valibot, Vitest (jsdom + fake-indexeddb), pnpm + Turborepo.

## Global Constraints

- **Base branch:** `full-backend-transition` — branch off it and PR back into it, NEVER master.
- Every text artefact in British English (code, comments, tests, commit messages).
- SPDX headers: `LGPL-3.0-only` in `packages/ui-shared`, `MIT` in `packages/shared-types`, `AGPL-3.0-only` in `apps/user-client` — first line of every new file, matching siblings.
- TS `strict` + `noUncheckedIndexedAccess`. Biome is the pre-commit gate and it **bans non-null assertions (`!`)** — never write one.
- ESM relative imports carry the `.js` suffix (house style, see any existing import).
- No `localStorage`/`sessionStorage` persistence. All WS-0 state is memory-only by design.
- User-facing strings live ONLY in `apps/user-client/src/lib/copy.ts` — never inline in components/hooks.
- Do NOT touch: `apps/user-client/src/boot/client-data-db.ts` (Dexie v33 is reserved for the sync engine), anything under `packages/crypto/src`, `apps/user-client/src/lib/cors-proxy.ts`, `routes/onboarding/matrix.tsx`, `routes/app/account/server-linking.tsx`.
- Commit style: free-form imperative, subject capitalised, footer `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`.
- Test placement: `packages/ui-shared/tests/**` and `apps/user-client/tests/**` (both configs `include: tests/**/*.test.{ts,tsx}`; both setups already load `fake-indexeddb/auto`).
- After changing a `packages/*` file, downstream typechecks may see stale `dist/` — always gate with `pnpm typecheck --force` from the repo root (expect **14/14 successful**), never a bare cached `pnpm typecheck`.

---

### Task 1: `ServerConfig` wire type + `parseServerConfig` validation

**Files:**
- Create: `packages/shared-types/src/config.ts`
- Modify: `packages/shared-types/src/index.ts` (append export)
- Create: `packages/ui-shared/src/state/server-config.ts`
- Modify: `packages/ui-shared/src/index.ts` (append export)
- Test: `packages/ui-shared/tests/state/server-config.test.ts`

**Interfaces:**
- Consumes: nothing (leaf task).
- Produces: `ServerConfig` / `KnownServerFeature` (from `@chatsundere/shared-types`); `parseServerConfig(value: unknown): ServerConfig | null` (from `@chatsundere/ui-shared`). Tasks 3 and 5 rely on these exact names.

- [ ] **Step 1: Write the failing test**

`packages/ui-shared/tests/state/server-config.test.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { parseServerConfig } from '../../src/state/server-config.js';

describe('parseServerConfig', () => {
  it('accepts a minimal valid config', () => {
    expect(parseServerConfig({ features: [] })).toEqual({ features: [] });
  });

  it('accepts https URLs and preserves unknown feature strings', () => {
    const input = {
      proxyUrl: 'https://proxy.chatsundere.me',
      syncUrl: 'https://sync.chatsundere.me',
      features: ['proxy', 'sync', 'blobs', 'espresso-machine'],
    };
    expect(parseServerConfig(input)).toEqual(input);
  });

  it('tolerates unknown top-level keys (forward compatibility)', () => {
    const parsed = parseServerConfig({ features: ['proxy'], banner: 'hi' });
    expect(parsed).not.toBeNull();
    expect(parsed?.features).toEqual(['proxy']);
  });

  it('accepts http only for localhost hosts', () => {
    expect(
      parseServerConfig({ proxyUrl: 'http://localhost:3300', features: [] }),
    ).not.toBeNull();
    expect(
      parseServerConfig({ proxyUrl: 'http://127.0.0.1:3300', features: [] }),
    ).not.toBeNull();
    expect(
      parseServerConfig({ proxyUrl: 'http://proxy.chatsundere.me', features: [] }),
    ).toBeNull();
  });

  it('rejects a present-but-malformed URL (whole response invalid)', () => {
    expect(parseServerConfig({ proxyUrl: 'not a url', features: [] })).toBeNull();
  });

  it('rejects missing or malformed features', () => {
    expect(parseServerConfig({})).toBeNull();
    expect(parseServerConfig({ features: 'proxy' })).toBeNull();
    expect(parseServerConfig({ features: [42] })).toBeNull();
    expect(parseServerConfig(null)).toBeNull();
    expect(parseServerConfig('nonsense')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/ui-shared test -- tests/state/server-config.test.ts`
Expected: FAIL — cannot resolve `../../src/state/server-config.js`.

- [ ] **Step 3: Write the implementation**

`packages/shared-types/src/config.ts`:

```ts
// SPDX-License-Identifier: MIT

/** Response shape of the public backend-discovery endpoint `GET /api/v1/config`. */
export interface ServerConfig {
  proxyUrl?: string;
  syncUrl?: string;
  /** Feature flags; servers may send strings this client does not know yet. */
  features: string[];
}

/** Feature flags the client understands today. */
export type KnownServerFeature = 'proxy' | 'sync' | 'blobs';
```

Append to `packages/shared-types/src/index.ts`:

```ts
export type { ServerConfig, KnownServerFeature } from './config.js';
```

`packages/ui-shared/src/state/server-config.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import type { ServerConfig } from '@chatsundere/shared-types';
import * as v from 'valibot';

// http is permitted only for loopback hosts (dev); everything else must be
// https so a misconfigured operator is caught loudly at probe time (spec §4).
function isAcceptableUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  if (url.protocol !== 'http:') return false;
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

const AcceptableUrl = v.pipe(v.string(), v.check(isAcceptableUrl));

// looseObject: unknown top-level keys are tolerated (forward compatibility).
const ServerConfigSchema = v.looseObject({
  proxyUrl: v.optional(AcceptableUrl),
  syncUrl: v.optional(AcceptableUrl),
  features: v.array(v.string()),
});

/** Validate a discovery response; null means "not a Chatsundere backend". */
export function parseServerConfig(value: unknown): ServerConfig | null {
  const result = v.safeParse(ServerConfigSchema, value);
  if (!result.success) return null;
  const { proxyUrl, syncUrl, features } = result.output;
  return {
    ...(proxyUrl === undefined ? {} : { proxyUrl }),
    ...(syncUrl === undefined ? {} : { syncUrl }),
    features,
  };
}
```

Append to `packages/ui-shared/src/index.ts`:

```ts
export { parseServerConfig } from './state/server-config.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/ui-shared test -- tests/state/server-config.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared-types/src/config.ts packages/shared-types/src/index.ts \
  packages/ui-shared/src/state/server-config.ts packages/ui-shared/src/index.ts \
  packages/ui-shared/tests/state/server-config.test.ts
git commit -m "Add ServerConfig wire type and discovery-response validation"
```

---

### Task 2: `account-link.store` — the central linked gate

**Files:**
- Create: `packages/ui-shared/src/state/account-link.store.ts`
- Modify: `packages/ui-shared/src/index.ts` (append exports)
- Test: `packages/ui-shared/tests/state/account-link.store.test.ts`

**Interfaces:**
- Consumes: `getLinkedAccount(db: IDBDatabase)`, `openLocalDb()`, `putLinkedAccount`, `type LinkedAccountRow` — all already exported by `@chatsundere/crypto` (read-only use; the package itself is NOT modified).
- Produces: `useAccountLinkStore` (state `{ linkStatus: 'unknown' | 'local-only' | 'linked'; baseUrl: string | null; issuerLabel: string | null; role: 'primary_admin' | 'admin' | 'user' | null }`, actions `setLinked(row)`, `setLocalOnly()`), `initAccountLinkFromDb(db: IDBDatabase): Promise<void>`, `type LinkStatus`. Tasks 3, 5, 6 rely on these exact names.

- [ ] **Step 1: Write the failing test**

`packages/ui-shared/tests/state/account-link.store.test.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { openLocalDb, putLinkedAccount, type LinkedAccountRow } from '@chatsundere/crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  initAccountLinkFromDb,
  useAccountLinkStore,
} from '../../src/state/account-link.store.js';

function linkedRowFixture(): LinkedAccountRow {
  return {
    server_user_id: '0197fead-0000-7000-8000-000000000001',
    base_url: 'https://chatsundere.example.org',
    issuer_label: 'Example Operator',
    role: 'user',
    wrapped_mk_opaque_ciphertext: new Uint8Array([1]),
    wrapped_mk_opaque_nonce: new Uint8Array([2]),
    wrapped_mk_opaque_aad: new Uint8Array([3]),
    wrapped_mk_opaque_integrity: new Uint8Array([4]),
    linked_at: new Date('2026-07-01T00:00:00Z'),
  };
}

describe('account-link.store', () => {
  beforeEach(() => {
    useAccountLinkStore.setState({
      linkStatus: 'unknown',
      baseUrl: null,
      issuerLabel: null,
      role: null,
    });
    // fake-indexeddb/auto is loaded by tests/setup.ts; a fresh DB name per
    // run is unnecessary because deleteDatabase is implicit in a new suite.
    indexedDB.deleteDatabase('chatsundere');
  });

  it('starts as unknown so gates never claim enabled before the IDB read', () => {
    expect(useAccountLinkStore.getState().linkStatus).toBe('unknown');
  });

  it('initialises to local-only when no linked account row exists', async () => {
    const db = await openLocalDb();
    await initAccountLinkFromDb(db);
    const s = useAccountLinkStore.getState();
    expect(s.linkStatus).toBe('local-only');
    expect(s.baseUrl).toBeNull();
    db.close();
  });

  it('initialises to linked with base URL, issuer label, and role', async () => {
    const db = await openLocalDb();
    await putLinkedAccount(db, linkedRowFixture());
    await initAccountLinkFromDb(db);
    const s = useAccountLinkStore.getState();
    expect(s.linkStatus).toBe('linked');
    expect(s.baseUrl).toBe('https://chatsundere.example.org');
    expect(s.issuerLabel).toBe('Example Operator');
    expect(s.role).toBe('user');
    db.close();
  });

  it('setLocalOnly clears the linked details', () => {
    useAccountLinkStore.getState().setLinked(linkedRowFixture());
    useAccountLinkStore.getState().setLocalOnly();
    const s = useAccountLinkStore.getState();
    expect(s.linkStatus).toBe('local-only');
    expect(s.baseUrl).toBeNull();
    expect(s.issuerLabel).toBeNull();
    expect(s.role).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/ui-shared test -- tests/state/account-link.store.test.ts`
Expected: FAIL — cannot resolve `../../src/state/account-link.store.js`.

- [ ] **Step 3: Write the implementation**

`packages/ui-shared/src/state/account-link.store.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { getLinkedAccount, type LinkedAccountRow } from '@chatsundere/crypto';
import { create } from 'zustand';

export type LinkStatus = 'unknown' | 'local-only' | 'linked';

interface AccountLinkState {
  linkStatus: LinkStatus;
  baseUrl: string | null;
  issuerLabel: string | null;
  role: 'primary_admin' | 'admin' | 'user' | null;
  setLinked(row: Pick<LinkedAccountRow, 'base_url' | 'issuer_label' | 'role'>): void;
  setLocalOnly(): void;
}

/**
 * Central "does a linked account exist" gate (spec §6). Initial state is
 * 'unknown' so gates never briefly claim enabled before the boot-time IDB
 * read resolves. Existing per-screen getLinkedAccount reads migrate onto
 * this store organically in later workstreams.
 */
export const useAccountLinkStore = create<AccountLinkState>((set) => ({
  linkStatus: 'unknown',
  baseUrl: null,
  issuerLabel: null,
  role: null,
  setLinked: (row) =>
    set({
      linkStatus: 'linked',
      baseUrl: row.base_url,
      issuerLabel: row.issuer_label,
      role: row.role,
    }),
  setLocalOnly: () =>
    set({ linkStatus: 'local-only', baseUrl: null, issuerLabel: null, role: null }),
}));

/** Boot-time population from the crypto IDB (read-only accessor use). */
export async function initAccountLinkFromDb(db: IDBDatabase): Promise<void> {
  const row = await getLinkedAccount(db);
  if (row) useAccountLinkStore.getState().setLinked(row);
  else useAccountLinkStore.getState().setLocalOnly();
}
```

Append to `packages/ui-shared/src/index.ts`:

```ts
export { useAccountLinkStore, initAccountLinkFromDb } from './state/account-link.store.js';
export type { LinkStatus } from './state/account-link.store.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/ui-shared test -- tests/state/account-link.store.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui-shared/src/state/account-link.store.ts \
  packages/ui-shared/src/index.ts \
  packages/ui-shared/tests/state/account-link.store.test.ts
git commit -m "Add central account-link gate store with boot-time IDB init"
```

---

### Task 3: `discovery.store` — `probeServer` + `maybeProbeLinkedServer`

**Files:**
- Create: `packages/ui-shared/src/state/discovery.store.ts`
- Modify: `packages/ui-shared/src/index.ts` (append exports)
- Test: `packages/ui-shared/tests/state/discovery.store.test.ts`

**Interfaces:**
- Consumes: `parseServerConfig` (Task 1), `useAccountLinkStore` (Task 2), `useConnectivityStore` (existing).
- Produces: `useDiscoveryStore` (state `{ status: DiscoveryStatus; config: ServerConfig | null; baseUrl: string | null; fetchedAt: number | null }`), `probeServer(baseUrl: string): Promise<ProbeResult>`, `maybeProbeLinkedServer(): void`, `type DiscoveryStatus = 'unknown' | 'probing' | 'ok' | 'unreachable' | 'invalid'`, `type ProbeResult`. Tasks 5 and 6 rely on these exact names.

- [ ] **Step 1: Write the failing test**

`packages/ui-shared/tests/state/discovery.store.test.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAccountLinkStore } from '../../src/state/account-link.store.js';
import { useConnectivityStore } from '../../src/state/connectivity.store.js';
import {
  maybeProbeLinkedServer,
  probeServer,
  useDiscoveryStore,
} from '../../src/state/discovery.store.js';

const LINKED_URL = 'https://chatsundere.example.org';
const VALID_BODY = { proxyUrl: 'https://proxy.example.org', features: ['proxy'] };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function setLinked(): void {
  useAccountLinkStore.setState({
    linkStatus: 'linked',
    baseUrl: LINKED_URL,
    issuerLabel: null,
    role: 'user',
  });
}

describe('discovery.store', () => {
  beforeEach(() => {
    useDiscoveryStore.setState({ status: 'unknown', config: null, baseUrl: null, fetchedAt: null });
    useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null, issuerLabel: null, role: null });
    useConnectivityStore.setState({ state: { kind: 'local_online' } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('probeServer returns ok with the parsed config and hits /api/v1/config once', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(VALID_BODY));
    vi.stubGlobal('fetch', fetchMock);
    const result = await probeServer('https://example.org/chatsundere');
    expect(result).toEqual({ kind: 'ok', config: VALID_BODY });
    // Sub-path hosting: the prefix must be preserved.
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.org/chatsundere/api/v1/config',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('classifies network failure as unreachable and schema garbage as invalid', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    expect(await probeServer('https://a.example.org')).toEqual({ kind: 'unreachable' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ nope: true })));
    expect(await probeServer('https://b.example.org')).toEqual({ kind: 'invalid' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html></html>', { status: 404 })));
    expect(await probeServer('https://c.example.org')).toEqual({ kind: 'invalid' });
  });

  it('coalesces concurrent probes of the same base URL into one request', async () => {
    let release: (r: Response) => void = () => {};
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(gate);
    vi.stubGlobal('fetch', fetchMock);
    const [a, b] = [probeServer(LINKED_URL), probeServer(LINKED_URL)];
    release(jsonResponse(VALID_BODY));
    expect(await a).toEqual({ kind: 'ok', config: VALID_BODY });
    expect(await b).toEqual({ kind: 'ok', config: VALID_BODY });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('mutates the store and connectivity only for the linked base URL', async () => {
    setLinked();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(VALID_BODY)));

    // Candidate probe (onboarding): store untouched.
    await probeServer('https://candidate.example.org');
    expect(useDiscoveryStore.getState().status).toBe('unknown');

    // Linked probe: store populated, connectivity → linked_online.
    await probeServer(LINKED_URL);
    const s = useDiscoveryStore.getState();
    expect(s.status).toBe('ok');
    expect(s.config).toEqual(VALID_BODY);
    expect(s.baseUrl).toBe(LINKED_URL);
    expect(useConnectivityStore.getState().state.kind).toBe('linked_online');
  });

  it('linked probe failure sets unreachable on both stores; invalid leaves connectivity alone', async () => {
    setLinked();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('down')));
    await probeServer(LINKED_URL);
    expect(useDiscoveryStore.getState().status).toBe('unreachable');
    expect(useConnectivityStore.getState().state.kind).toBe('server_unreachable');

    useConnectivityStore.setState({ state: { kind: 'linked_online' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ bad: 1 })));
    await probeServer(LINKED_URL);
    expect(useDiscoveryStore.getState().status).toBe('invalid');
    expect(useConnectivityStore.getState().state.kind).toBe('linked_online');
  });

  it('a re-probe keeps the previous config while probing', async () => {
    setLinked();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(VALID_BODY)));
    await probeServer(LINKED_URL);

    let release: (r: Response) => void = () => {};
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(gate));
    const second = probeServer(LINKED_URL);
    expect(useDiscoveryStore.getState().status).toBe('probing');
    expect(useDiscoveryStore.getState().config).toEqual(VALID_BODY);
    release(jsonResponse(VALID_BODY));
    await second;
    expect(useDiscoveryStore.getState().status).toBe('ok');
  });

  it('maybeProbeLinkedServer is a no-op when local-only or offline', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    useAccountLinkStore.setState({ linkStatus: 'local-only', baseUrl: null, issuerLabel: null, role: null });
    maybeProbeLinkedServer();
    expect(fetchMock).not.toHaveBeenCalled();

    setLinked();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    maybeProbeLinkedServer();
    expect(fetchMock).not.toHaveBeenCalled();

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    fetchMock.mockResolvedValue(jsonResponse(VALID_BODY));
    maybeProbeLinkedServer();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/ui-shared test -- tests/state/discovery.store.test.ts`
Expected: FAIL — cannot resolve `../../src/state/discovery.store.js`.

- [ ] **Step 3: Write the implementation**

`packages/ui-shared/src/state/discovery.store.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import type { ServerConfig } from '@chatsundere/shared-types';
import { create } from 'zustand';
import { useAccountLinkStore } from './account-link.store.js';
import { useConnectivityStore } from './connectivity.store.js';
import { parseServerConfig } from './server-config.js';

export type DiscoveryStatus = 'unknown' | 'probing' | 'ok' | 'unreachable' | 'invalid';

interface DiscoveryState {
  status: DiscoveryStatus;
  /** Last successful config; deliberately kept during a re-probe (spec §5). */
  config: ServerConfig | null;
  baseUrl: string | null;
  fetchedAt: number | null;
}

/** Memory-only by design (spec decision 4) — no Dexie, no IDB. */
export const useDiscoveryStore = create<DiscoveryState>(() => ({
  status: 'unknown',
  config: null,
  baseUrl: null,
  fetchedAt: null,
}));

export type ProbeResult =
  | { kind: 'ok'; config: ServerConfig }
  | { kind: 'unreachable' }
  | { kind: 'invalid' };

// Mirrors apps/user-client/src/lib/fetch.ts joinUrl — path-prefix deployments
// (e.g. https://example.com/chatsundere) must keep the prefix, which
// `new URL(path, base)` would drop. ui-shared cannot import from an app.
function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const rel = path.startsWith('/') ? path : `/${path}`;
  return `${base}${rel}`;
}

const inFlight = new Map<string, Promise<ProbeResult>>();

/**
 * Probe a server's public discovery endpoint. Single-flight per base URL.
 * Mutates the discovery store (and connectivity) only when probing the
 * LINKED base URL; candidate probes (onboarding) just return the result.
 */
export function probeServer(baseUrl: string): Promise<ProbeResult> {
  const existing = inFlight.get(baseUrl);
  if (existing) return existing;
  const run = doProbe(baseUrl).finally(() => inFlight.delete(baseUrl));
  inFlight.set(baseUrl, run);
  return run;
}

async function doProbe(baseUrl: string): Promise<ProbeResult> {
  const link = useAccountLinkStore.getState();
  const isLinkedUrl = link.linkStatus === 'linked' && link.baseUrl === baseUrl;
  if (isLinkedUrl) useDiscoveryStore.setState({ status: 'probing', baseUrl });

  let response: Response;
  try {
    response = await fetch(joinUrl(baseUrl, '/api/v1/config'), {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
  } catch {
    if (isLinkedUrl) {
      useDiscoveryStore.setState({ status: 'unreachable' });
      useConnectivityStore.getState().onServerUnreachable();
    }
    return { kind: 'unreachable' };
  }

  const config = await readConfig(response);
  if (config === null) {
    // Reachable but not answering like a Chatsundere backend: the network is
    // fine, so connectivity is deliberately left alone (spec §5).
    if (isLinkedUrl) useDiscoveryStore.setState({ status: 'invalid' });
    return { kind: 'invalid' };
  }

  if (isLinkedUrl) {
    useDiscoveryStore.setState({ status: 'ok', config, baseUrl, fetchedAt: Date.now() });
    useConnectivityStore.getState().onServerOk();
  }
  return { kind: 'ok', config };
}

async function readConfig(response: Response): Promise<ServerConfig | null> {
  if (!response.ok) return null;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  return parseServerConfig(body);
}

/**
 * Fire-and-forget probe of the linked server, used at boot and as the
 * connectivity regain callback (spec §7). No-op when local-only or offline.
 */
export function maybeProbeLinkedServer(): void {
  const { linkStatus, baseUrl } = useAccountLinkStore.getState();
  if (linkStatus !== 'linked' || baseUrl === null) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  void probeServer(baseUrl);
}
```

Append to `packages/ui-shared/src/index.ts`:

```ts
export {
  useDiscoveryStore,
  probeServer,
  maybeProbeLinkedServer,
} from './state/discovery.store.js';
export type { DiscoveryStatus, ProbeResult } from './state/discovery.store.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/ui-shared test -- tests/state/discovery.store.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui-shared/src/state/discovery.store.ts \
  packages/ui-shared/src/index.ts \
  packages/ui-shared/tests/state/discovery.store.test.ts
git commit -m "Add discovery store with single-flight config probe"
```

---

### Task 4: Connectivity regain-probe wiring

**Files:**
- Modify: `packages/ui-shared/src/state/connectivity.store.ts` (function `attachConnectivityListeners`, lines 45-55)
- Test: `packages/ui-shared/tests/state/connectivity.regain.test.ts` (new file — do not edit the existing `connectivity.store.test.ts`)

**Interfaces:**
- Consumes: nothing new — the regain callback is injected, so this module gains NO import of discovery/account-link (avoids a store import cycle).
- Produces: `attachConnectivityListeners(opts?: ConnectivityListenerOptions)` where `ConnectivityListenerOptions = { onRegain?: () => void }`. The existing zero-argument call keeps compiling. Task 6 relies on this exact signature.

- [ ] **Step 1: Write the failing test**

`packages/ui-shared/tests/state/connectivity.regain.test.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';

// attachConnectivityListeners guards with a module-level flag, so each test
// gets a fresh module registry.
describe('attachConnectivityListeners regain wiring', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('invokes onRegain exactly once per online event', async () => {
    const { attachConnectivityListeners } = await import(
      '../../src/state/connectivity.store.js'
    );
    const onRegain = vi.fn();
    attachConnectivityListeners({ onRegain });
    window.dispatchEvent(new Event('online'));
    expect(onRegain).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('online'));
    expect(onRegain).toHaveBeenCalledTimes(2);
  });

  it('invokes onRegain when the document becomes visible, not when hidden', async () => {
    const { attachConnectivityListeners } = await import(
      '../../src/state/connectivity.store.js'
    );
    const onRegain = vi.fn();
    attachConnectivityListeners({ onRegain });

    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onRegain).not.toHaveBeenCalled();

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onRegain).toHaveBeenCalledTimes(1);
  });

  it('still transitions network state on online/offline events', async () => {
    const { attachConnectivityListeners, useConnectivityStore } = await import(
      '../../src/state/connectivity.store.js'
    );
    attachConnectivityListeners({});
    useConnectivityStore.setState({ state: { kind: 'local_online' } });
    window.dispatchEvent(new Event('offline'));
    expect(useConnectivityStore.getState().state.kind).toBe('local_offline');
    window.dispatchEvent(new Event('online'));
    expect(useConnectivityStore.getState().state.kind).toBe('local_online');
  });

  it('attaches only once — a second call does not double the callbacks', async () => {
    const { attachConnectivityListeners } = await import(
      '../../src/state/connectivity.store.js'
    );
    const onRegain = vi.fn();
    attachConnectivityListeners({ onRegain });
    attachConnectivityListeners({ onRegain });
    window.dispatchEvent(new Event('online'));
    expect(onRegain).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/ui-shared test -- tests/state/connectivity.regain.test.ts`
Expected: FAIL — the first two tests fail (`onRegain` never called); the signature change does not exist yet.

- [ ] **Step 3: Write the implementation**

In `packages/ui-shared/src/state/connectivity.store.ts`, replace the existing `attachConnectivityListeners` (lines 45-55) with:

```ts
let listenersAttached = false;

export interface ConnectivityListenerOptions {
  /**
   * Invoked once per regain event — window 'online' and document
   * visibility→visible (spec §7: exactly one probe per regain event; the
   * probe itself is single-flight, so double events are harmless). The
   * callback is injected so this module never imports the discovery or
   * account-link stores.
   */
  onRegain?: () => void;
}

export function attachConnectivityListeners(opts: ConnectivityListenerOptions = {}): void {
  if (typeof window === 'undefined') return;
  if (listenersAttached) return;
  listenersAttached = true;
  window.addEventListener('online', () => {
    useConnectivityStore.getState().onNetworkOnline();
    opts.onRegain?.();
  });
  window.addEventListener('offline', () => useConnectivityStore.getState().onNetworkOffline());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') opts.onRegain?.();
  });
  if (!navigator.onLine) useConnectivityStore.getState().onNetworkOffline();
}
```

Append to the connectivity exports in `packages/ui-shared/src/index.ts` (line 5 area):

```ts
export type { ConnectivityListenerOptions } from './state/connectivity.store.js';
```

- [ ] **Step 4: Run tests to verify they pass — including the existing suite**

Run: `pnpm --filter @chatsundere/ui-shared test`
Expected: PASS — all ui-shared tests including the pre-existing `connectivity.store.test.ts` and `session.store.test.ts` (the zero-argument call form still compiles and behaves identically).

- [ ] **Step 5: Commit**

```bash
git add packages/ui-shared/src/state/connectivity.store.ts \
  packages/ui-shared/src/index.ts \
  packages/ui-shared/tests/state/connectivity.regain.test.ts
git commit -m "Add regain callback and foreground listener to connectivity wiring"
```

---

### Task 5: `useServerGate` + copy catalogue + effective URLs (user-client)

**Files:**
- Modify: `apps/user-client/src/env.ts` (add `VITE_INVITE_REQUEST_URL`)
- Modify: `apps/user-client/.env.example` (document the new variable)
- Modify: `apps/user-client/src/lib/copy.ts` (new top-level `serverGate` section)
- Create: `apps/user-client/src/lib/server-gate.ts`
- Create: `apps/user-client/src/lib/server-urls.ts`
- Test: `apps/user-client/tests/lib/server-gate.test.ts`

**Interfaces:**
- Consumes: `useAccountLinkStore`/`LinkStatus` (Task 2), `useDiscoveryStore`/`DiscoveryStatus` (Task 3), `useConnectivityStore`/`Connectivity` (existing), `ServerConfig`/`KnownServerFeature` (Task 1).
- Produces: `deriveServerGate(inputs: GateInputs): ServerGate` (pure, exported for tests), `useServerGate(feature: KnownServerFeature): ServerGate`, `effectiveProxyUrl(): string | null`, `effectiveSyncUrl(): string | null`, `type GateReason`. WS-B/A/C/D consume these; WS-0 itself adds no UI call site.

- [ ] **Step 1: Write the failing test**

`apps/user-client/tests/lib/server-gate.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { copy } from '../../src/lib/copy.js';
import { deriveServerGate, type GateInputs } from '../../src/lib/server-gate.js';

function inputs(overrides: Partial<GateInputs>): GateInputs {
  return {
    linkStatus: 'linked',
    connectivity: 'linked_online',
    discoveryStatus: 'ok',
    config: { proxyUrl: 'https://proxy.example.org', features: ['proxy', 'sync'] },
    feature: 'proxy',
    hasInviteUrl: false,
    ...overrides,
  };
}

describe('deriveServerGate', () => {
  it('enables when linked, online, and the feature is offered', () => {
    expect(deriveServerGate(inputs({}))).toEqual({
      enabled: true,
      reason: null,
      tooltip: null,
    });
  });

  it('boot-pending link state routes to the checking bucket, never invitation copy', () => {
    const gate = deriveServerGate(inputs({ linkStatus: 'unknown' }));
    expect(gate.reason).toBe('unknown');
    expect(gate.tooltip).toBe(copy.serverGate.checking);
  });

  it('local-only picks the invite variant only when an invite URL is configured', () => {
    const without = deriveServerGate(inputs({ linkStatus: 'local-only' }));
    expect(without.reason).toBe('local-only');
    expect(without.tooltip).toBe(copy.serverGate.localOnly);

    const withInvite = deriveServerGate(
      inputs({ linkStatus: 'local-only', hasInviteUrl: true }),
    );
    expect(withInvite.tooltip).toBe(copy.serverGate.localOnlyWithInvite);
  });

  it('auth-failed takes priority over offline and never claims a waiting cure', () => {
    const gate = deriveServerGate(inputs({ connectivity: 'server_auth_failed' }));
    expect(gate.reason).toBe('auth-action');
    expect(gate.tooltip).toBe(copy.serverGate.authAction);
  });

  it('server_unreachable and local_offline both read as offline', () => {
    for (const kind of ['server_unreachable', 'local_offline'] as const) {
      const gate = deriveServerGate(inputs({ connectivity: kind }));
      expect(gate.reason).toBe('offline');
      expect(gate.tooltip).toBe(copy.serverGate.offline);
    }
  });

  it('discovery invalid is server-error, distinct from offline', () => {
    const gate = deriveServerGate(
      inputs({ discoveryStatus: 'invalid', connectivity: 'linked_online' }),
    );
    expect(gate.reason).toBe('server-error');
    expect(gate.tooltip).toBe(copy.serverGate.serverOdd);
  });

  it('no config yet this session reads as checking', () => {
    const gate = deriveServerGate(
      inputs({ discoveryStatus: 'probing', config: null }),
    );
    expect(gate.reason).toBe('unknown');
  });

  it('a re-probe with a prior config keeps gating on that config', () => {
    const gate = deriveServerGate(inputs({ discoveryStatus: 'probing' }));
    expect(gate.enabled).toBe(true);
  });

  it('a feature the server does not offer is feature-missing', () => {
    const gate = deriveServerGate(inputs({ feature: 'blobs' }));
    expect(gate.reason).toBe('feature-missing');
    expect(gate.tooltip).toBe(copy.serverGate.featureMissing);
  });

  it('disabled gates always carry a tooltip; enabled gates never do', () => {
    const disabled = deriveServerGate(inputs({ linkStatus: 'local-only' }));
    expect(disabled.tooltip).not.toBeNull();
    const enabled = deriveServerGate(inputs({}));
    expect(enabled.tooltip).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- tests/lib/server-gate.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/server-gate.js`.

- [ ] **Step 3: Write the implementation**

Add to the `EnvSchema` object in `apps/user-client/src/env.ts` (after `VITE_PROXY_URL`, line 20):

```ts
  VITE_INVITE_REQUEST_URL: v.optional(v.pipe(v.string(), v.url())),
```

Add to `apps/user-client/.env.example` (after the `# VITE_PROXY_URL=` line):

```
# Operator-specific "request an invitation" page; when set, local-only gate
# tooltips offer it as the invitation path (spec: WS-0 §8).
# VITE_INVITE_REQUEST_URL=https://example.org/request-invite
```

Add a new top-level section to the `copy` object in `apps/user-client/src/lib/copy.ts` (sibling of `create:`, exact strings — Laura-passed, do not reword):

```ts
  serverGate: {
    localOnly: 'This comes alive once you link an account. Link one under Account → Server linking.',
    localOnlyWithInvite:
      'This comes alive once you link an account. Link one under Account → Server linking — or request an invitation.',
    offline: "Your server isn't reachable right now. This wakes up again the moment the connection returns.",
    authAction:
      'The server stopped recognising this session. Sync your passphrase under Account → Server linking to restore the link.',
    serverOdd:
      'Your server is answering unexpectedly. This usually resolves itself — if it keeps happening, your operator will want to know.',
    featureMissing: "Your server doesn't offer this yet. Operators can enable it — nothing is missing on your side.",
    checking: 'Checking what your server offers…',
  },
```

`apps/user-client/src/lib/server-gate.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { KnownServerFeature, ServerConfig } from '@chatsundere/shared-types';
import {
  type Connectivity,
  type DiscoveryStatus,
  type LinkStatus,
  useAccountLinkStore,
  useConnectivityStore,
  useDiscoveryStore,
} from '@chatsundere/ui-shared';
import { env } from '../env.js';
import { copy } from './copy.js';

/**
 * Machine-readable disabled reasons, deliberately isomorphic to the distinct
 * user next-steps (spec §8, Laura-passed): consumers must be able to branch
 * on `reason` alone — invitation pointer for local-only, operator hint for
 * server-error — without re-reading the underlying stores.
 */
export type GateReason =
  | 'local-only'
  | 'offline'
  | 'auth-action'
  | 'server-error'
  | 'feature-missing'
  | 'unknown';

export interface ServerGate {
  enabled: boolean;
  reason: GateReason | null; // null iff enabled
  tooltip: string | null; // ready-to-render copy, null iff enabled
}

export interface GateInputs {
  linkStatus: LinkStatus;
  connectivity: Connectivity['kind'];
  discoveryStatus: DiscoveryStatus;
  config: ServerConfig | null;
  feature: KnownServerFeature;
  hasInviteUrl: boolean;
}

function disabled(reason: GateReason, tooltip: string): ServerGate {
  return { enabled: false, reason, tooltip };
}

/** Pure derivation per the spec §8 table — first match wins. */
export function deriveServerGate(i: GateInputs): ServerGate {
  if (i.linkStatus === 'unknown') return disabled('unknown', copy.serverGate.checking);
  if (i.linkStatus === 'local-only') {
    return disabled(
      'local-only',
      i.hasInviteUrl ? copy.serverGate.localOnlyWithInvite : copy.serverGate.localOnly,
    );
  }
  if (i.connectivity === 'server_auth_failed') {
    return disabled('auth-action', copy.serverGate.authAction);
  }
  if (i.connectivity === 'server_unreachable' || i.connectivity === 'local_offline') {
    return disabled('offline', copy.serverGate.offline);
  }
  if (i.discoveryStatus === 'invalid') {
    return disabled('server-error', copy.serverGate.serverOdd);
  }
  // 'unknown'/'probing' before any success this session; a re-probe keeps
  // gating on the previous config (spec §5: config kept during re-probe).
  if (i.config === null) return disabled('unknown', copy.serverGate.checking);
  if (!i.config.features.includes(i.feature)) {
    return disabled('feature-missing', copy.serverGate.featureMissing);
  }
  return { enabled: true, reason: null, tooltip: null };
}

/**
 * The disabled-over-hidden gate for server-coupled features. Affordance
 * mandate (spec §8): consumers MUST surface `tooltip` through a
 * touch-reachable affordance; `title` is desktop augmentation only.
 */
export function useServerGate(feature: KnownServerFeature): ServerGate {
  const linkStatus = useAccountLinkStore((s) => s.linkStatus);
  const connectivity = useConnectivityStore((s) => s.state.kind);
  const discoveryStatus = useDiscoveryStore((s) => s.status);
  const config = useDiscoveryStore((s) => s.config);
  return deriveServerGate({
    linkStatus,
    connectivity,
    discoveryStatus,
    config,
    feature,
    hasInviteUrl: env.VITE_INVITE_REQUEST_URL !== undefined,
  });
}
```

`apps/user-client/src/lib/server-urls.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { useDiscoveryStore } from '@chatsundere/ui-shared';
import { env } from '../env.js';

/**
 * Discovery is the source of truth for service URLs (spec §9). The VITE_*
 * values are dev-only overrides — honoured exclusively under
 * `import.meta.env.DEV`, so a production build can never pin a stale URL.
 */
export function effectiveProxyUrl(): string | null {
  const override = import.meta.env.DEV ? env.VITE_PROXY_URL : undefined;
  return override ?? useDiscoveryStore.getState().config?.proxyUrl ?? null;
}

export function effectiveSyncUrl(): string | null {
  const override = import.meta.env.DEV ? env.VITE_SYNC_URL : undefined;
  return override ?? useDiscoveryStore.getState().config?.syncUrl ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- tests/lib/server-gate.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/env.ts apps/user-client/.env.example \
  apps/user-client/src/lib/copy.ts apps/user-client/src/lib/server-gate.ts \
  apps/user-client/src/lib/server-urls.ts \
  apps/user-client/tests/lib/server-gate.test.ts
git commit -m "Add useServerGate derivation, gate copy catalogue, and effective URL selectors"
```

---

### Task 6: Boot wiring

**Files:**
- Create: `apps/user-client/src/boot/server-foundation.ts`
- Modify: `apps/user-client/src/main.tsx` (lines 2, 41)
- Test: `apps/user-client/tests/boot/server-foundation.test.ts`

**Interfaces:**
- Consumes: `initAccountLinkFromDb`, `maybeProbeLinkedServer`, `attachConnectivityListeners({ onRegain })` (Tasks 2-4), `getDb` (`apps/user-client/src/boot/open-db.ts:20`).
- Produces: `initServerFoundation(): Promise<void>` — called once from `main.tsx` boot.

- [ ] **Step 1: Write the failing test**

`apps/user-client/tests/boot/server-foundation.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import {
  openLocalDb,
  putLinkedAccount,
  type LinkedAccountRow,
} from '@chatsundere/crypto';
import { useAccountLinkStore } from '@chatsundere/ui-shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const probeSpy = vi.hoisted(() => vi.fn());
vi.mock('@chatsundere/ui-shared', async (importOriginal) => {
  const original = await importOriginal<typeof import('@chatsundere/ui-shared')>();
  return { ...original, maybeProbeLinkedServer: probeSpy };
});

const dbHolder = vi.hoisted(() => ({ db: null as IDBDatabase | null }));
vi.mock('../../src/boot/open-db.js', () => ({
  getDb: () => {
    if (!dbHolder.db) throw new Error('test db not opened');
    return dbHolder.db;
  },
}));

import { initServerFoundation } from '../../src/boot/server-foundation.js';

function linkedRowFixture(): LinkedAccountRow {
  return {
    server_user_id: '0197fead-0000-7000-8000-000000000002',
    base_url: 'https://chatsundere.example.org',
    issuer_label: null,
    role: 'user',
    wrapped_mk_opaque_ciphertext: new Uint8Array([1]),
    wrapped_mk_opaque_nonce: new Uint8Array([2]),
    wrapped_mk_opaque_aad: new Uint8Array([3]),
    wrapped_mk_opaque_integrity: new Uint8Array([4]),
    linked_at: new Date('2026-07-01T00:00:00Z'),
  };
}

describe('initServerFoundation', () => {
  beforeEach(async () => {
    probeSpy.mockClear();
    useAccountLinkStore.setState({
      linkStatus: 'unknown',
      baseUrl: null,
      issuerLabel: null,
      role: null,
    });
    dbHolder.db?.close();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('chatsundere');
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
    dbHolder.db = await openLocalDb();
  });

  it('populates local-only and still fires the probe attempt (which no-ops)', async () => {
    await initServerFoundation();
    expect(useAccountLinkStore.getState().linkStatus).toBe('local-only');
    expect(probeSpy).toHaveBeenCalledTimes(1);
  });

  it('populates linked state from the IDB row, then probes', async () => {
    const db = dbHolder.db;
    if (!db) throw new Error('unreachable');
    await putLinkedAccount(db, linkedRowFixture());
    await initServerFoundation();
    const s = useAccountLinkStore.getState();
    expect(s.linkStatus).toBe('linked');
    expect(s.baseUrl).toBe('https://chatsundere.example.org');
    expect(probeSpy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- tests/boot/server-foundation.test.ts`
Expected: FAIL — cannot resolve `../../src/boot/server-foundation.js`.

- [ ] **Step 3: Write the implementation**

`apps/user-client/src/boot/server-foundation.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { initAccountLinkFromDb, maybeProbeLinkedServer } from '@chatsundere/ui-shared';
import { getDb } from './open-db.js';

/**
 * WS-0 boot wiring (spec §7): populate the central account-link gate from
 * the crypto IDB, then fire the initial discovery probe. The probe is a
 * no-op when local-only or offline, so calling it unconditionally is safe.
 */
export async function initServerFoundation(): Promise<void> {
  await initAccountLinkFromDb(getDb());
  maybeProbeLinkedServer();
}
```

In `apps/user-client/src/main.tsx`, change line 2 from:

```ts
import { attachConnectivityListeners } from '@chatsundere/ui-shared';
```

to:

```ts
import { attachConnectivityListeners, maybeProbeLinkedServer } from '@chatsundere/ui-shared';
```

add after the `openDb` import (line 6):

```ts
import { initServerFoundation } from './boot/server-foundation.js';
```

and change the boot body line 41 from:

```ts
  attachConnectivityListeners();
```

to:

```ts
  attachConnectivityListeners({ onRegain: maybeProbeLinkedServer });
  await initServerFoundation();
```

(One awaited IDB `get` — milliseconds; keeping it before `render()`'s ready
state means returning users get real gate states on first paint.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- tests/boot/server-foundation.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/boot/server-foundation.ts apps/user-client/src/main.tsx \
  apps/user-client/tests/boot/server-foundation.test.ts
git commit -m "Wire server foundation into boot with regain probe callback"
```

---

### Task 7: Full gates + STATUS update

**Files:**
- Modify: `STATUS-TRANSITION.md` (repo root — sections 6 "Doing now" and 7 "Next")

**Interfaces:**
- Consumes: everything above.
- Produces: a green branch ready for Liz's review, Larissa-free by design, Laura spec-passed.

- [ ] **Step 1: Run the full verification battery**

```bash
pnpm typecheck --force        # expect: 14 successful, 14 total, 0 cached
pnpm --filter @chatsundere/ui-shared test
pnpm --filter @chatsundere/user-client test
pnpm build                    # full TS pipeline — the real build gate
pnpm exec biome check packages/shared-types/src/config.ts \
  packages/ui-shared/src/state/server-config.ts \
  packages/ui-shared/src/state/account-link.store.ts \
  packages/ui-shared/src/state/discovery.store.ts \
  packages/ui-shared/src/state/connectivity.store.ts \
  packages/ui-shared/src/index.ts packages/shared-types/src/index.ts \
  apps/user-client/src/env.ts apps/user-client/src/lib/copy.ts \
  apps/user-client/src/lib/server-gate.ts apps/user-client/src/lib/server-urls.ts \
  apps/user-client/src/boot/server-foundation.ts apps/user-client/src/main.tsx
```

Expected: typecheck 14/14; ui-shared suite fully green; user-client suite green **except** possibly the known environmental baseline (a trio of Node-26 experimental-localStorage failures totalling exactly 8 test failures on some hosts — 0 or exactly those 8 are both acceptable; anything else is a regression to fix, and "pre-existing failure" claims must be verified against the base branch, not asserted). Biome: no diagnostics.

- [ ] **Step 2: Update `STATUS-TRANSITION.md`**

In section 6 ("Doing now"), replace the current body with a line recording:
WS-0 Foundation BUILT on this branch (spec `superpowers/specs/2026-07-02-ws0-foundation-design.md` v2 Laura-passed, plan `superpowers/plans/2026-07-02-ws0-foundation.md`, all tasks green) — awaiting Liz's review and Chris's §13 manual verification. In section 7, mark item 1 as done-pending-verify; item 2 (WS-B + WS-E) becomes the next spec session. Keep the file's voice and update the `Last updated:` line.

- [ ] **Step 3: Commit**

```bash
git add STATUS-TRANSITION.md
git commit -m "Record WS-0 Foundation build in transition status [skip ci]"
```

---

## Self-Review (performed at plan time)

- **Spec coverage:** §4 wire type+validation → Task 1; §5 store+probe → Task 3; §6 link store → Task 2; §7 regain+boot → Tasks 4+6; §8 gate+copy (incl. Laura's reason taxonomy and copy revisions) → Task 5; §9 URL precedence → Task 5 (`server-urls.ts`); §10 error paths → Tasks 1+3 tests; §11 scope boundary → Global Constraints; §12 test matrix → distributed per task; §13 manual verification → stays with Chris post-merge; §14 consumption contract → Interfaces blocks. The §8 affordance mandate is enforced at consumer time (WS-B+), carried here as the `useServerGate` JSDoc.
- **Type consistency:** `LinkStatus`/`DiscoveryStatus`/`ProbeResult`/`ServerGate`/`GateInputs` names verified identical across Tasks 2/3/5/6; `Connectivity['kind']` matches the existing union; `LinkedAccountRow` fixture fields match `packages/crypto/src/db/schema.ts:28-38`.
- **Placeholder scan:** clean — every code step carries complete code; no TBD/TODO/"similar to".
