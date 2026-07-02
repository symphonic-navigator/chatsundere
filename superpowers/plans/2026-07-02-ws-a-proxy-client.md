# WS-A Implementation Plan — Proxy Client

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap the client from the retired shared-key CORS proxy protocol to the authenticated proxy (account JWT in `x-chatsundere-authorization`, proxy URL from discovery), with late-binding credentials, 401-refresh-retry, honest availability gating, and the removal of the key-management UI.

**Architecture:** A `ProxyAuthSource` seam in `packages/llm-unified` (registered at boot by the user-client, read at request-build time) replaces the `corsProxyUrl`/`corsProxyKey` threading everywhere. Streaming 401s refresh via a new `onUnauthorised` hook on `withStreamingRetry`; single-shot paths use a new `fetchWithProxyAuth` wrapper. Availability moves from `!!settings.corsProxy` to the WS-0 server gate (`feature: 'proxy'`). Spec: `superpowers/specs/2026-07-02-ws-a-proxy-client-design.md` (v2, Laura-passed).

**Tech Stack:** TypeScript strict, Bun test (`llm-unified`), Vitest + Testing Library (user-client), Zustand v5, React 18, pnpm + Turborepo.

## Operating rules for the overnight worker (READ FIRST)

These rules are binding and override your defaults. The repo's CLAUDE.md may
not be in your context — everything you need is in this section.

1. **STOP-guard — verify the base before touching anything.** All of these must
   hold, or STOP immediately, change nothing, and report:
   - `STATUS-TRANSITION.md` exists at the repo root (you are based on the
     `full-backend-transition` sprint branch, not master);
   - `superpowers/specs/2026-07-02-ws-a-proxy-client-design.md` exists;
   - `packages/ui-shared/src/state/discovery.store.ts` AND
     `packages/ui-shared/src/state/account-link.store.ts` exist (WS-0 landed);
   - `packages/llm-unified/src/proxy-auth.ts` does NOT exist (the work is not
     already done).
2. **Parallel-workstream note.** WS-B/WS-E (onboarding + step-up) may land on
   the base branch around the same time. The only shared file is
   `apps/user-client/src/lib/fetch.ts` (WS-E adds an interceptor; this plan
   only renames/exports the refresh helper in Task 4). Base yourself on the
   branch tip as you find it; if `fetch.ts` already contains step-up code,
   keep it intact and make only this plan's change. Never resolve conflicts by
   deleting the other workstream's code.
3. **Branch + integration target.** Work on a fresh branch cut from
   `full-backend-transition` (if your harness names the branch itself, accept
   its name). Any PR you open targets **`full-backend-transition` — NEVER
   `master`**. Do NOT merge anything yourself; the humans audit, device-test,
   and integrate.
4. **Language.** Every text artefact is British English — code, comments,
   tests, copy strings, commit messages (`initialise`, `behaviour`, `colour`).
   No German anywhere in the repo.
5. **TDD per task, in plan order.** Failing test → run it and confirm the
   exact expected failure → minimal implementation → confirm pass → commit.
   Tasks are ordered topologically over the import graph; do not reorder.
   If you dispatch subagents: one per task, review between tasks; subagents
   never merge, push, or switch branches.
6. **Commit convention.** Free-form imperative subject, capitalised, prefixed
   `A:` (e.g. `A: Add ProxyAuthSource seam to llm-unified`). Footer on every
   commit: `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`.
7. **Gates — exact commands.** Per task, the commands the task names. At the
   end (Task 8), the FULL battery, never just touched dirs:
   `pnpm typecheck --force` (expect **14 successful, 14 total, 0 cached** —
   never trust a cached typecheck),
   `pnpm --filter @chatsundere/llm-unified test` (Bun runner),
   `pnpm --filter @chatsundere/ui-shared test`,
   `pnpm --filter @chatsundere/user-client test`,
   `pnpm --filter @chatsundere/admin-client test`, and `pnpm build`.
   Biome **bans non-null assertions (`!`)** and is the pre-commit hook; run
   `pnpm exec biome check <touched files>` before committing, not after.
8. **Known-green baseline.** The user-client vitest suite has a known
   environmental baseline on some hosts: exactly **8 failures** from a trio of
   Node-26 experimental-localStorage tests. **0 or exactly 8** are both
   acceptable; any other failure count is a regression you introduced. Never
   claim a failure is "pre-existing" without confirming it fails identically
   on the base branch.
9. **Audit gates are NOT yours to run.** Laura (UX) audits the built diff
   after your run; Larissa (security) audits the token-attach path. Do not
   attempt any audit yourself; build exactly what the plan says.
10. **Scope guard.** Never touch
    `apps/user-client/src/boot/client-data-db.ts` (its next Dexie version is
    reserved for the sync engine — the deprecated `SettingsRow.corsProxy`
    field stays byte-for-byte as it is), anything under
    `apps/sync-service`, `apps/proxy-service`, `apps/auth-service`, or
    `packages/crypto`. No new dependencies. No drag-and-drop UI. No tokens in
    `localStorage`.
11. **The attach-scope invariant (Larissa will check this).** The account JWT
    is attached in exactly two code sites — the `cors-proxy` branch of
    `llm-unified/src/transport.ts` and the proxy branch of
    `apps/user-client/src/mcp/mcp-client.ts` — always paired with the URL
    from `ProxyAuthSource.getUrl()`. It must never be attached to a direct
    upstream request or a direct MCP endpoint, and it must be redacted from
    all diagnostics output.

---

### Task 1: `ProxyAuthSource` seam in llm-unified

**Files:**
- Create: `packages/llm-unified/src/proxy-auth.ts`
- Create: `packages/llm-unified/src/proxy-auth.test.ts`
- Modify: `packages/llm-unified/src/index.ts` (add export)

**Interfaces:**
- Produces: `ProxyAuthSource` (interface: `getUrl(): string | null`,
  `getToken(): string | null`, `refreshToken(): Promise<string | null>`),
  `setProxyAuthSource(source: ProxyAuthSource | null): void`,
  `getProxyAuthSource(): ProxyAuthSource | null` — consumed by Tasks 2–6.

- [ ] **Step 1: Write the failing test** (`proxy-auth.test.ts`, Bun runner style — see `transport.test.ts` for the house pattern):

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { afterEach, describe, expect, test } from 'bun:test';
import { getProxyAuthSource, setProxyAuthSource } from './proxy-auth.js';

afterEach(() => setProxyAuthSource(null));

describe('proxy auth source registry', () => {
  test('starts unset and returns the registered source', () => {
    expect(getProxyAuthSource()).toBeNull();
    const source = {
      getUrl: () => 'https://proxy.example',
      getToken: () => 'tok',
      refreshToken: async () => 'tok2',
    };
    setProxyAuthSource(source);
    expect(getProxyAuthSource()).toBe(source);
  });

  test('null clears the registration', () => {
    setProxyAuthSource({ getUrl: () => null, getToken: () => null, refreshToken: async () => null });
    setProxyAuthSource(null);
    expect(getProxyAuthSource()).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails** — `pnpm --filter @chatsundere/llm-unified test -- proxy-auth` → module-not-found failure.

- [ ] **Step 3: Implement** `packages/llm-unified/src/proxy-auth.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only

/**
 * Late-binding credentials for routing through the authenticated proxy.
 * Registered once at app boot; read at request-BUILD time so a long agentic
 * loop always attaches the current token (spec §3). The package stays
 * framework-agnostic — no store imports here.
 */
export interface ProxyAuthSource {
  /** Proxy base URL from discovery, or null when no proxy is available. */
  getUrl(): string | null;
  /** Current account access JWT, or null when no session token exists. */
  getToken(): string | null;
  /** Refresh the access token; resolves to the new token or null on failure. */
  refreshToken(): Promise<string | null>;
}

let source: ProxyAuthSource | null = null;

/** Register the app's proxy auth source (boot); pass null to clear (tests). */
export function setProxyAuthSource(next: ProxyAuthSource | null): void {
  source = next;
}

/** The currently registered source, or null. */
export function getProxyAuthSource(): ProxyAuthSource | null {
  return source;
}
```

Export from `index.ts`:
```ts
export {
  setProxyAuthSource,
  getProxyAuthSource,
  type ProxyAuthSource,
} from './proxy-auth.js';
```

- [ ] **Step 4: Run test → PASS**, `pnpm exec biome check packages/llm-unified/src/proxy-auth.ts packages/llm-unified/src/proxy-auth.test.ts packages/llm-unified/src/index.ts`
- [ ] **Step 5: Commit** — `A: Add ProxyAuthSource seam to llm-unified`

### Task 2: Transport swap to late-binding (llm-unified-wide)

**Files:**
- Modify: `packages/llm-unified/src/transport.ts` (the `cors-proxy` branch, `SECRET_REQUEST_HEADERS`, `BuildRequestArgs`)
- Modify: every llm-unified type/call site that threads `corsProxyUrl`/`corsProxyKey` — enumerate with `rg -n "corsProxy" packages/llm-unified/src -g '!*.test.*'`; expected carriers: `stream-completion.ts`, `one-shot-completion.ts`, `probe.ts`, `tti/generate-images.ts`, `stt/transcribe-audio.ts`, `tts/synthesise-speech.ts`, `tts/voices.ts`, `web-adapters/ollama-web.ts`, `web-adapters/nano-gpt-web.ts` (arg interfaces + `buildRequest({...})` literals)
- Test: `packages/llm-unified/src/transport.test.ts` (rewrite proxy cases), plus the web-adapter tests' `x-cors-proxy-api-key` expectations

**Interfaces:**
- Consumes: Task 1's `getProxyAuthSource`.
- Produces: `BuildRequestArgs` WITHOUT `corsProxyUrl`/`corsProxyKey`; proxied
  Requests carry `x-chatsundere-authorization: Bearer <token>`,
  `x-cors-proxy-target: <provider.baseUrl>`, and `redirect: 'manual'`.

- [ ] **Step 1: Write the failing tests** (replace the old proxy-key cases in `transport.test.ts`):

```ts
test('cors-proxy routing attaches the account token and target', () => {
  setProxyAuthSource({
    getUrl: () => 'https://proxy.example',
    getToken: () => 'jwt-abc',
    refreshToken: async () => null,
  });
  const req = buildRequest({ provider: proxiedProvider, apiKey: 'upstream-key', path: '/v1/chat/completions', method: 'POST', body: {} });
  expect(req.url).toBe('https://proxy.example/v1/chat/completions');
  expect(req.headers.get('x-chatsundere-authorization')).toBe('Bearer jwt-abc');
  expect(req.headers.get('x-cors-proxy-target')).toBe(proxiedProvider.baseUrl);
  expect(req.headers.get('Authorization')).toBe('Bearer upstream-key');
  expect(req.headers.get('x-cors-proxy-api-key')).toBeNull();
  expect(req.redirect).toBe('manual');
});

test('cors-proxy routing throws without a registered source or token', () => {
  setProxyAuthSource(null);
  expect(() => buildRequest({ provider: proxiedProvider, apiKey: 'k', path: '/p', method: 'GET' })).toThrow(/no proxy is available/);
  setProxyAuthSource({ getUrl: () => 'https://proxy.example', getToken: () => null, refreshToken: async () => null });
  expect(() => buildRequest({ provider: proxiedProvider, apiKey: 'k', path: '/p', method: 'GET' })).toThrow(/no account token/);
});

test('redactRequestHeaders strips x-chatsundere-authorization', () => {
  const headers = new Headers({ 'x-chatsundere-authorization': 'Bearer secret', 'content-type': 'application/json' });
  expect('x-chatsundere-authorization' in redactRequestHeaders(headers)).toBe(false);
});

test('direct routing never consults the proxy source', () => {
  setProxyAuthSource({ getUrl: () => 'https://proxy.example', getToken: () => 'jwt', refreshToken: async () => null });
  const req = buildRequest({ provider: directProvider, apiKey: 'k', path: '/p', method: 'GET' });
  expect(req.headers.get('x-chatsundere-authorization')).toBeNull();
  expect(req.redirect).toBe('follow');
});
```

Add `afterEach(() => setProxyAuthSource(null));` to the suite.

- [ ] **Step 2: Run → FAIL** (args still required; headers wrong).

- [ ] **Step 3: Implement.** In `transport.ts`:
  - `SECRET_REQUEST_HEADERS`: replace `'x-cors-proxy-api-key'` with `'x-chatsundere-authorization'`.
  - `BuildRequestArgs`: delete `corsProxyUrl` and `corsProxyKey`.
  - Replace the `cors-proxy` branch of `buildRequest`:

```ts
let url: string;
let redirect: RequestRedirect = 'follow';
if (provider.routing.kind === 'direct') {
  url = joinUrl(provider.baseUrl, path);
} else {
  const source = getProxyAuthSource();
  const proxyUrl = source?.getUrl() ?? null;
  const token = source?.getToken() ?? null;
  if (proxyUrl === null) {
    throw new Error('transport: cors-proxy routing selected but no proxy is available');
  }
  if (token === null) {
    throw new Error('transport: cors-proxy routing selected but no account token is available');
  }
  url = joinUrl(proxyUrl, path);
  headers.set('x-chatsundere-authorization', `Bearer ${token}`);
  headers.set('x-cors-proxy-target', provider.baseUrl);
  // The browser must never chase an upstream redirect off-proxy (spec §5).
  redirect = 'manual';
}
```

  and pass `redirect` into the `new Request(url, { ... })` init.
  - Sweep the package: delete `corsProxyUrl`/`corsProxyKey` from every arg
    interface and every `buildRequest({...})` literal the `rg` enumeration
    finds. Update the web-adapter tests (`ollama-web.test.ts:74`,
    `nano-gpt-web.test.ts:81`) to register a fake source (as in Step 1) and
    assert the new header.

- [ ] **Step 4: Run → PASS**: `pnpm --filter @chatsundere/llm-unified test` and `pnpm --filter @chatsundere/llm-unified typecheck`. Confirm zero hits: `rg -n "corsProxyUrl|corsProxyKey" packages/llm-unified/src`.
- [ ] **Step 5: Commit** — `A: Swap transport to late-binding proxy auth`

### Task 3: 401 refresh-retry and redirect handling (llm-unified)

**Files:**
- Create: `packages/llm-unified/src/proxy-fetch.ts`
- Create: `packages/llm-unified/src/proxy-fetch.test.ts`
- Modify: `packages/llm-unified/src/retry.ts` (`onUnauthorised` hook), `packages/llm-unified/src/retry.test.ts`
- Modify: `packages/llm-unified/src/stream-completion.ts` (wire the hook + opaque-redirect throw)
- Modify: the single-shot fetch sites from Task 2's enumeration (`one-shot-completion.ts:106`, `probe.ts`, `tti/generate-images.ts`, `stt/transcribe-audio.ts`, `tts/synthesise-speech.ts`, `tts/voices.ts`, web adapters) to route through `fetchWithProxyAuth`
- Modify: `packages/llm-unified/src/index.ts` (export `fetchWithProxyAuth`, `ProxyRedirectError`, `isOpaqueRedirect`)

**Interfaces:**
- Consumes: Task 1's source registry; Task 2's arg-free `buildRequest`.
- Produces: `fetchWithProxyAuth(build: () => Request, opts: { proxied: boolean; signal?: AbortSignal; doFetch?: typeof fetch }): Promise<Response>`; `class ProxyRedirectError extends Error`; `StreamingRetryOpts.onUnauthorised?: () => Promise<boolean>` — consumed by Task 6 (MCP).

- [ ] **Step 1: Write the failing tests.** `proxy-fetch.test.ts`:

```ts
test('proxied 401 refreshes once and retries with a rebuilt request', async () => {
  let refreshed = false;
  setProxyAuthSource({
    getUrl: () => 'https://proxy.example',
    getToken: () => (refreshed ? 'new-tok' : 'old-tok'),
    refreshToken: async () => { refreshed = true; return 'new-tok'; },
  });
  const seen: string[] = [];
  const doFetch = (async (req: Request) => {
    seen.push(req.headers.get('x-chatsundere-authorization') ?? '');
    return seen.length === 1 ? new Response('', { status: 401 }) : new Response('ok');
  }) as typeof fetch;
  const build = () => new Request('https://proxy.example/p', { headers: { 'x-chatsundere-authorization': `Bearer ${getProxyAuthSource()?.getToken() ?? ''}` } });
  const res = await fetchWithProxyAuth(build, { proxied: true, doFetch });
  expect(res.status).toBe(200);
  expect(seen).toEqual(['Bearer old-tok', 'Bearer new-tok']);
});

test('failed refresh surfaces the original 401', async () => { /* refreshToken → null; expect final status 401, exactly one fetch retry NOT taken */ });
test('direct requests never refresh on 401', async () => { /* proxied: false, 401 response, refreshToken must not be called */ });
test('opaque redirect throws ProxyRedirectError', async () => {
  const doFetch = (async () => new Response(null, { status: 200 })) as typeof fetch;
  // Simulate: Response.type cannot be forged; use a stub object with type 'opaqueredirect'.
  const opaque = { type: 'opaqueredirect', status: 0 } as unknown as Response;
  const doFetchOpaque = (async () => opaque) as typeof fetch;
  await expect(fetchWithProxyAuth(() => new Request('https://proxy.example/p'), { proxied: true, doFetch: doFetchOpaque })).rejects.toBeInstanceOf(ProxyRedirectError);
  void doFetch;
});
```

`retry.test.ts` additions:

```ts
test('withStreamingRetry: 401 + onUnauthorised(true) retries immediately without consuming a retry', async () => {
  let calls = 0;
  const doFetch = (async () => (++calls === 1 ? new Response('', { status: 401 }) : new Response('ok'))) as typeof fetch;
  const res = await withStreamingRetry({
    buildRequest: () => new Request('https://x'),
    doFetch,
    operation: 'test',
    onUnauthorised: async () => true,
    sleepFn: async () => {},
  });
  expect(res.status).toBe(200);
  expect(calls).toBe(2);
});

test('withStreamingRetry: onUnauthorised fires at most once', async () => { /* always-401 doFetch, hook counter must be 1, final response 401 */ });
test('withStreamingRetry: 401 without hook returns as before', async () => { /* existing behaviour pinned */ });
```

- [ ] **Step 2: Run → FAIL** (missing module / missing option).

- [ ] **Step 3: Implement.** `proxy-fetch.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { getProxyAuthSource } from './proxy-auth.js';

/** Thrown when a proxied upstream replied with a redirect the browser cannot expose (spec §5). */
export class ProxyRedirectError extends Error {
  constructor() {
    super(
      "This provider tried to redirect the request, which can't be followed safely. " +
        'If you set a custom base URL for it, double-check it — otherwise the provider may have moved.',
    );
    this.name = 'ProxyRedirectError';
  }
}

/** True for the opaque husk fetch returns when a manual-redirect request hit a 3xx. */
export function isOpaqueRedirect(response: Response): boolean {
  return response.type === 'opaqueredirect' || response.status === 0;
}

/**
 * Fetch with proxy-auth semantics: when `proxied`, a 401 triggers one token
 * refresh + rebuild (the rebuild re-reads the source, so it carries the fresh
 * token), and an opaque redirect becomes a terminal ProxyRedirectError.
 * `proxied: false` degrades to a plain fetch — a direct upstream's 401 must
 * never spend an account-token refresh.
 */
export async function fetchWithProxyAuth(
  build: () => Request,
  opts: { proxied: boolean; signal?: AbortSignal; doFetch?: typeof fetch },
): Promise<Response> {
  const doFetch = opts.doFetch ?? fetch;
  const init = opts.signal ? { signal: opts.signal } : undefined;
  let response = await doFetch(build(), init);
  if (!opts.proxied) return response;
  if (response.status === 401) {
    const token = await getProxyAuthSource()?.refreshToken();
    if (token !== null && token !== undefined) {
      await response.body?.cancel();
      response = await doFetch(build(), init);
    }
  }
  if (isOpaqueRedirect(response)) throw new ProxyRedirectError();
  return response;
}
```

`retry.ts`: add to `StreamingRetryOpts`:

```ts
/**
 * Called on a 401, at most once per call. Return true after a successful
 * token refresh — the loop retries immediately with a fresh request (which
 * re-reads the auth source) without consuming a retry or backing off.
 */
onUnauthorised?: () => Promise<boolean>;
```

and inside the loop, immediately after the timeout is cleared and before the
`response.ok` check:

```ts
if (response.status === 401 && opts.onUnauthorised && !authRetried) {
  authRetried = true;
  const refreshed = await opts.onUnauthorised();
  if (refreshed) {
    await response.body?.cancel();
    attempt -= 1; // the refreshed attempt does not consume a retry
    continue;
  }
}
```

(`let authRetried = false;` before the loop.)

`stream-completion.ts`: compute `const proxied = args.providerConfig.routing.kind === 'cors-proxy';`, pass

```ts
onUnauthorised: proxied
  ? async () => {
      const token = await getProxyAuthSource()?.refreshToken();
      return token !== null && token !== undefined;
    }
  : undefined,
```

into `withStreamingRetry`, and after it returns add
`if (isOpaqueRedirect(response)) throw new ProxyRedirectError();` before the
`response.ok` check. Single-shot sites: replace each
`await fetch(request, ...)` with
`await fetchWithProxyAuth(() => buildRequest({ ... }), { proxied, signal })`
where `proxied` is that site's `provider.routing.kind === 'cors-proxy'`
(inline the former `const request = buildRequest({...})` into the thunk — the
factory must be fresh per attempt).

- [ ] **Step 4: Run → PASS**: `pnpm --filter @chatsundere/llm-unified test`, package typecheck, Biome on touched files.
- [ ] **Step 5: Commit** — `A: Add 401 refresh-retry and redirect handling for proxied fetches`

### Task 4: User-client auth source + boot registration

**Files:**
- Create: `apps/user-client/src/lib/proxy-auth.ts`
- Create: `apps/user-client/tests/lib/proxy-auth.test.ts`
- Modify: `apps/user-client/src/lib/fetch.ts` (rename `tryRefresh` → exported `refreshAccessToken`; internal caller at `fetch.ts:34` follows)
- Modify: `apps/user-client/src/boot/server-foundation.ts` (register the source)

**Interfaces:**
- Consumes: `setProxyAuthSource`/`ProxyAuthSource` (Task 1); WS-0 stores; `deriveServerGate` (`apps/user-client/src/lib/server-gate.ts`).
- Produces: `proxyAuthSource: ProxyAuthSource`, `isProxyAvailable(): boolean` — consumed by Task 5's non-hook call sites.

- [ ] **Step 1: Write the failing test** (vitest; set store state via `useAccountLinkStore.setState(...)` etc., reset in `afterEach`):

```ts
describe('proxyAuthSource', () => {
  it('yields the discovery proxyUrl only when linked with the proxy feature', () => { /* linked + config {proxyUrl, features:['proxy']} → url; local-only → null; features:[] → null; config null → null */ });
  it('reads the live access token from the session store', () => { /* set session accessToken → token; no session → null */ });
});
describe('isProxyAvailable', () => {
  it('mirrors deriveServerGate enabled-ness for the proxy feature', () => { /* linked+ok+proxy → true; local-only → false; connectivity server_unreachable → false */ });
});
```

- [ ] **Step 2: Run → FAIL** (module not found).

- [ ] **Step 3: Implement** `apps/user-client/src/lib/proxy-auth.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { ProxyAuthSource } from '@chatsundere/llm-unified';
import {
  useAccountLinkStore,
  useConnectivityStore,
  useDiscoveryStore,
  useSessionStore,
} from '@chatsundere/ui-shared';
import { refreshAccessToken } from './fetch.js';
import { deriveServerGate } from './server-gate.js';

function proxyUrl(): string | null {
  if (useAccountLinkStore.getState().linkStatus !== 'linked') return null;
  const config = useDiscoveryStore.getState().config;
  if (config === null || !config.features.includes('proxy')) return null;
  return config.proxyUrl ?? null;
}

/** The app's late-binding proxy credentials (spec §3); registered at boot. */
export const proxyAuthSource: ProxyAuthSource = {
  getUrl: proxyUrl,
  getToken: () => useSessionStore.getState().session?.accessToken ?? null,
  refreshToken: async () => {
    const baseUrl = useAccountLinkStore.getState().baseUrl;
    if (baseUrl === null) return null;
    const ok = await refreshAccessToken(baseUrl);
    return ok ? (useSessionStore.getState().session?.accessToken ?? null) : null;
  },
};

/** Non-hook mirror of useServerGate('proxy').enabled for send-path code. */
export function isProxyAvailable(): boolean {
  return deriveServerGate({
    linkStatus: useAccountLinkStore.getState().linkStatus,
    connectivity: useConnectivityStore.getState().state.kind,
    discoveryStatus: useDiscoveryStore.getState().status,
    config: useDiscoveryStore.getState().config,
    feature: 'proxy',
    // Enabled-ness never depends on the invite URL; it only picks tooltip copy.
    hasInviteUrl: false,
  }).enabled;
}
```

In `fetch.ts`, rename `tryRefresh` to `refreshAccessToken` and export it (same
body, same single internal caller updated). In `server-foundation.ts`:

```ts
import { setProxyAuthSource } from '@chatsundere/llm-unified';
import { proxyAuthSource } from '../lib/proxy-auth.js';
// inside initServerFoundation(), first line:
setProxyAuthSource(proxyAuthSource);
```

- [ ] **Step 4: Run → PASS**: `pnpm --filter @chatsundere/user-client test -- proxy-auth`, Biome.
- [ ] **Step 5: Commit** — `A: Register the user-client proxy auth source at boot`

### Task 5: User-client threading sweep + availability gating

**Files:**
- Modify (drop `corsProxyUrl`/`corsProxyKey` params/fields and their pass-through): `apps/user-client/src/lib/stream-engine.ts`, `data/send-message.ts`, `integrations/build-context.ts`, `integrations/types.ts`, `integrations/web/web-integration.ts`, `integrations/artefact/artefact-integration.ts`, `memory/resolve-args.ts`, `memory/pipeline.ts`, `compaction/runner.ts`, `lib/subagent-base.ts`, `tools/ask-expert.ts`, `lib/resolve-expert-web.ts`, `lib/artefact-author.ts`, `lib/title-generator.ts`, `lib/model-debug.ts`, `lib/voice/resolve-tts.ts`, `lib/voice/voice-transport.ts`, `lib/voice/dictation/resolve-stt.ts`, `components/image-gen/ImageGenerationSection.tsx`, `components/voice/VoicePicker.tsx`, `routes/app/settings/provider.tsx`, `state/stream-manager.store.ts`, `mcp/mcp-tools.ts`, `mcp/build-mcp-context.ts` (MCP files: only the threading here; the endpoint/headers change is Task 6)
- Modify: `apps/user-client/src/lib/usable-providers.ts` (gate-driven `hasProxy`)
- Tests: adjust every fixture that passed the two params; extend `usable-providers` tests for the gate matrix

**Interfaces:**
- Consumes: Task 2's slimmed `BuildRequestArgs`/`StreamCompletionArgs` etc.; Task 4's `isProxyAvailable`; `useServerGate` (existing, WS-0).
- Produces: `useUsableTemplateIds()` gated by the server gate; `usableTemplateIds(providers, hasProxy)` signature unchanged.

- [ ] **Step 1: Write the failing tests** — in the `usable-providers` test file: proxy-required template is usable when the gate is enabled and unusable when local-only/offline (drive via store state, not settings). Keep the pure `usableTemplateIds` cases as-is.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.**
  - `usable-providers.ts` hook body: `const hasProxy = useServerGate('proxy').enabled;` (import from `./server-gate.js`; drop the `useSettings` read).
  - Non-hook resolution sites that computed `hasProxy = settings.corsProxy != null` (e.g. `send-message.ts:155`) use `isProxyAvailable()`.
  - Delete the `openSecret(settings.corsProxy.sharedKey, ...)` resolution (`send-message.ts:150-152`) and every downstream `corsProxyUrl`/`corsProxyKey` parameter, field, and argument through the enumerated files. Where a signature shrinks to zero extra params, tidy the call sites; change nothing else about them.
- [ ] **Step 4: Run → PASS**: `pnpm --filter @chatsundere/user-client test` (mind rule 8's baseline), `pnpm typecheck --force`. Confirm: `rg -n "corsProxyUrl|corsProxyKey" apps/user-client/src` → zero hits.
- [ ] **Step 5: Commit** — `A: Gate proxy availability on the server link and drop key threading`

### Task 6: MCP client swap

**Files:**
- Modify: `apps/user-client/src/mcp/types.ts` (`McpEndpoint`: delete the `corsProxy` field)
- Modify: `apps/user-client/src/mcp/mcp-client.ts` (proxy branch + retry wrapper)
- Modify: `apps/user-client/src/mcp/build-mcp-context.ts`, `mcp/mcp-connectivity.ts` (stop populating `corsProxy`)
- Test: `apps/user-client/tests/mcp/mcp-client.test.ts`

**Interfaces:**
- Consumes: `getProxyAuthSource`, `fetchWithProxyAuth`, `ProxyRedirectError` from llm-unified.
- Produces: proxied MCP requests carrying the §11 wire shape (JWT slot + target origin + unchanged `Mcp-Session-Id`).

- [ ] **Step 1: Write the failing tests** (adapt the existing proxy cases, e.g. `mcp-client.test.ts:132`): proxied init request carries `x-chatsundere-authorization: Bearer <fake>` + `x-cors-proxy-target: <origin>` and NO `x-cors-proxy-api-key`; a 401 then triggers one refresh and a retried request with the new token; `Mcp-Session-Id` survives the retry; direct endpoints get no JWT header. Register a fake source in `beforeEach`, clear in `afterEach`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** In `mcp-client.ts` `buildRequest`, replace the proxy branch:

```ts
if (endpoint.routing === 'proxy') {
  const source = getProxyAuthSource();
  const proxyUrl = source?.getUrl() ?? null;
  const token = source?.getToken() ?? null;
  if (proxyUrl === null || token === null)
    throw new Error('MCP proxy routing selected but the linked server proxy is unavailable');
  const target = new URL(endpoint.url);
  headers.set('x-chatsundere-authorization', `Bearer ${token}`);
  headers.set('x-cors-proxy-target', target.origin);
  url = joinUrl(proxyUrl, target.pathname + target.search);
}
```

with `redirect: 'manual'` on the proxied `Request` init, and route the fetches
through `fetchWithProxyAuth(() => buildRequest(endpoint, body, sessionId), { proxied: endpoint.routing === 'proxy', signal })`.
Remove `corsProxy` from `McpEndpoint` and from the endpoint builders
(`build-mcp-context.ts`, `mcp-connectivity.ts`); the `routing` decision logic
itself is unchanged.

- [ ] **Step 4: Run → PASS**: MCP test file + full user-client suite + typecheck.
- [ ] **Step 5: Commit** — `A: Route MCP proxy calls through the authenticated proxy`

### Task 7: UX surfaces — relay status, stale proxy copy

**Files:**
- Replace: `apps/user-client/src/components/CorsProxyBlock.tsx` → `apps/user-client/src/components/ServerRelayStatus.tsx`
- Modify: `apps/user-client/src/components/AddProviderPicker.tsx` (lines ~81–95: gate copy + linking link; delete the `onNeedProxy` prop), `apps/user-client/src/routes/app/settings/providers.tsx` (`:30` gate-driven, `:47` `statusOf`, `:115` drop `onNeedProxy` wiring, swap the block component)
- Modify: `apps/user-client/src/data/settings.ts` (delete the `:20` URL-normalisation line), `apps/user-client/src/env.ts` (drop `VITE_PROXY_URL`), delete `apps/user-client/src/lib/cors-proxy.ts`, update `.env.example`
- Test: component test for `ServerRelayStatus` (both branches), updated picker/providers tests

**Interfaces:**
- Consumes: `useServerGate('proxy')`, `useAccountLinkStore` (issuer label). **Scope guard reminder: `client-data-db.ts` stays byte-for-byte untouched** — the dead `SettingsRow.corsProxy` field remains.

- [ ] **Step 1: Write the failing tests**: linked+proxy renders "Providers that need a relay are routed via your linked server" with the issuer label; local-only renders the gate tooltip and a link whose `to` is `/app/account/server-linking`; `AddProviderPicker` never renders "CORS proxy" (assert the string is absent) and renders the gate tooltip text for proxy-required templates when the gate is disabled.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** `ServerRelayStatus.tsx` (keep the existing block's container styling from `CorsProxyBlock.tsx`; read-only, no form):

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useAccountLinkStore } from '@chatsundere/ui-shared';
import { Link } from 'react-router-dom';
import { useServerGate } from '../lib/server-gate.js';

/** Read-only relay status: the authenticated proxy rides on the account link (spec §8). */
export function ServerRelayStatus(): JSX.Element {
  const gate = useServerGate('proxy');
  const issuerLabel = useAccountLinkStore((s) => s.issuerLabel);
  return (
    <div className="rounded-md border border-aurora-500/30 bg-aurora-500/[0.04] p-3">
      <div className="mb-1 text-xs font-medium uppercase tracking-widest text-paper-soft">
        Server relay
      </div>
      {gate.enabled ? (
        <p className="text-sm text-paper-soft">
          Providers that need a relay are routed via your linked server
          {issuerLabel ? ` (${issuerLabel})` : ''}.
        </p>
      ) : (
        <p className="text-sm text-paper-soft/70">
          {gate.tooltip}{' '}
          {gate.reason === 'local-only' ? (
            <Link className="underline" to="/app/account/server-linking">
              Open server linking
            </Link>
          ) : null}
        </p>
      )}
    </div>
  );
}
```

(Check how sibling components import the router `Link` — use the same import;
if the repo uses TanStack Router, mirror its `Link` API instead.)
`AddProviderPicker.tsx`: replace the "Needs a CORS proxy" caption with the
gate tooltip (`useServerGate('proxy')`) and the "Set up a CORS proxy →" link
with `Open server linking →` navigating to `/app/account/server-linking`;
remove the `onNeedProxy` prop and its `providers.tsx:115` wiring.
`providers.tsx` `statusOf`: replace the `'✗ Needs proxy'` branch with a
gate-reason map: `local-only` → `'✗ Needs a linked account'`, `offline` →
`'✗ Server unreachable'`, `feature-missing` → `'✗ Server has no relay'`,
anything else → `'✗ Unavailable'`; source it from `useServerGate('proxy')`
instead of `settings.data?.corsProxy`.

- [ ] **Step 4: Run → PASS**: user-client suite, typecheck, Biome.
- [ ] **Step 5: Commit** — `A: Collapse the proxy key UI into a relay status line`

### Task 8: Retirement verification, full battery, STATUS

**Files:**
- Modify: `STATUS-TRANSITION.md` (§6 "Doing now" + §7 ordering), `obsidian/insights/ux-deferrals.md` (model-picker hidden-count deferral, spec §10)

- [ ] **Step 1: Retirement greps — all must return zero hits in code** (docs/specs/plans may still mention them historically):
  - `rg -n "x-cors-proxy-api-key" apps packages` → 0
  - `rg -n "corsProxyUrl|corsProxyKey" apps packages` → 0
  - `rg -n "CORS_PROXY_URL|VITE_PROXY_URL" apps packages` → 0
  - `rg -n "settings.*corsProxy|corsProxy\?\." apps/user-client/src` → only the dormant `SettingsRow` field declaration in `client-data-db.ts` (untouched)
- [ ] **Step 2: Full battery** (rule 7): `pnpm typecheck --force` (14/14, 0 cached), all four test suites, `pnpm build`. Record exact counts in your report; apply rule 8 to the user-client suite.
- [ ] **Step 3: Update STATUS + deferrals.** In `STATUS-TRANSITION.md`: record WS-A as built-pending-audit under §6 (mirror the WS-0 entry's shape). In `obsidian/insights/ux-deferrals.md`: add the spec §10 entry — model picker folds enabled-but-ungated providers' models into the anonymous `hiddenCount`; distinguishing "needs linking" models is deferred.
- [ ] **Step 4: Commit** — `A: Record WS-A proxy client build in transition status [skip ci]` (docs-only commit gets the tag; if any code moved in this task, omit it).

## Final report checklist

State explicitly: per-suite pass/fail/skip counts, the typecheck cache line,
the user-client failure count vs rule 8's baseline, every retirement grep's
hit count, any file you touched that this plan did not name (and why), and
any deviation from a task's specified code (and why).
