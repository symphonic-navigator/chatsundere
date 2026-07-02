# WS-A — Proxy Client (design)

**Date:** 2026-07-02 · **Workstream:** A of the Full Backend Transition (STATUS-TRANSITION §4)
**Depends on:** WS-0 Foundation (discovery/account-link/connectivity stores, `useServerGate`), WS-B (linked accounts to test against)
**Audit:** Laura (spec-pass + pre-squash) · Larissa light on the token-attach path (`[L]` markers)
**Server counterpart:** `superpowers/specs/2026-07-01-authenticated-cors-proxy-design.md` (§4 auth, §7 discovery, §11 wire shapes, §12 seam)

## 1. Why

The client still speaks the retired protocol: a static, MK-sealed shared key in
`x-cors-proxy-api-key` against a hard-coded `CORS_PROXY_URL`
(`packages/llm-unified/src/transport.ts:94`, `apps/user-client/src/mcp/mcp-client.ts:43`).
The built `proxy-service` is **token-only**: it verifies the account access JWT
from `x-chatsundere-authorization: Bearer <jwt>` and forwards; shared-key mode is
gone. This workstream swaps the client onto the new protocol, sources the proxy
URL from discovery instead of build-time constants, and collapses the
key-management UI. Turnkey on the branch — nothing deploys until the go-live event.

## 2. Decisions settled with Chris (2026-07-02)

1. **Linking is a prerequisite for proxy egress** (STATUS-TRANSITION open
   decision 1, resolved). A local-only user gets proxy-required providers
   **disabled over hidden** with the WS-0 gate copy pointing at account linking.
   Direct providers are untouched. Self-hosters get proxy egress by linking
   against their own backend. No legacy escape hatch; the shared-key path is
   removed entirely.
2. **Late-binding auth source** over threading the credential. The access token
   has a 15-minute TTL; a long agentic loop outlives any token resolved once at
   send time. Credentials are therefore read **at request-build time** from an
   injected source, and the existing `corsProxyUrl`/`corsProxyKey` plumbing
   (~20 files) is deleted rather than repurposed.

## 3. Architecture — the `ProxyAuthSource`

One new seam in `packages/llm-unified`:

```ts
/** Late-binding credentials for routing through the authenticated proxy. */
export interface ProxyAuthSource {
  /** The proxy base URL from discovery, or null when no proxy is available. */
  getUrl(): string | null;
  /** The current account access JWT, or null when no session token exists. */
  getToken(): string | null;
  /** Refresh the access token; resolves to the new token or null on failure. */
  refreshToken(): Promise<string | null>;
}

export function setProxyAuthSource(source: ProxyAuthSource | null): void;
export function getProxyAuthSource(): ProxyAuthSource | null;
```

- Module-level registration keeps `llm-unified` framework-agnostic (no
  `ui-shared`/Zustand import; LGPL package stays reusable). Tests register fakes.
- The user-client implements the source once, in a new
  `apps/user-client/src/lib/proxy-auth.ts`:
  - `getUrl()` → `useDiscoveryStore.getState().config?.proxyUrl ?? null`,
    additionally gated on `features.includes('proxy')` and
    `linkStatus === 'linked'`.
  - `getToken()` → `useSessionStore.getState().session?.accessToken ?? null`.
  - `refreshToken()` → wraps the existing refresh flow (`fetch.ts:79
    tryRefresh` against the linked `baseUrl`), returning the new token.
- Registered once at boot alongside the WS-0 wiring. No deregistration on
  logout is needed — `getToken()` reads live state, so a closed session
  naturally yields null.

`[L]` **Attach-scope invariant:** the JWT is attached in exactly two places —
the `cors-proxy` branch of `llm-unified` `buildRequest` and the proxy branch of
the MCP client — and always together with `getUrl()` as the request host. The
token never rides on a direct-to-upstream request, never on a direct MCP
endpoint, and never appears in diagnostics (§6).

## 4. Transport changes (`packages/llm-unified/src/transport.ts`)

- `BuildRequestArgs` loses `corsProxyUrl`/`corsProxyKey`. The `cors-proxy`
  branch reads the registered source:
  - no source, or `getUrl()` null → throw the existing "proxy routing selected
    but unavailable" error shape (call sites are gated per §7, so this is a
    programming-error guard, not a user path);
  - `getToken()` null → throw likewise (gates guarantee a session);
  - else `url = joinUrl(source.getUrl(), path)`, set
    `x-chatsundere-authorization` to `Bearer <token>`, keep
    `x-cors-proxy-target: provider.baseUrl` **unchanged**, and leave the
    upstream key in `Authorization` **unchanged**.
- `SECRET_REQUEST_HEADERS` gains `'x-chatsundere-authorization'` `[L]` so the
  account JWT can never leak through `redactRequestHeaders` into the model
  debugger or diagnostics sinks.
- `x-cors-proxy-api-key` disappears entirely — the header-set site, the test
  expectations, and its `SECRET_REQUEST_HEADERS` entry (nothing sets it any
  more).

## 5. Retry and error behaviour

New shared helper in `llm-unified` (used by the streaming engine and reusable
by the MCP client):

```ts
/** Fetch a proxied request; on 401, refresh the token once and rebuild. */
export async function fetchWithProxyAuth(
  build: () => Request,
  init?: Pick<RequestInit, 'signal'>,
): Promise<Response>;
```

(The `signal` passthrough exists because call sites pass abort signals to
`fetch` rather than baking them into the `Request` — see the cross-realm note
in `mcp-client.ts`.)

- First attempt with the current token. On **401** (whether the proxy rejected
  the token or the upstream rejected its own key — indistinguishable by
  design, the proxy passes upstream statuses through): call
  `source.refreshToken()`; if it yields a token, rebuild the request (the
  rebuild re-reads the source, so it picks up the fresh token) and retry
  **exactly once**. A genuine upstream 401 costs one redundant attempt and then
  surfaces through the normal error path. Mirrors `apiFetch`'s pattern
  (`apps/user-client/src/lib/fetch.ts:33`).
- Applied only to proxied requests; direct requests keep plain `fetch`.
- Streaming is unaffected: the proxy verifies at request start only; an
  established SSE stream never re-authenticates.
- **Upstream 3xx — no client re-issue.** The server spec §5.3 assumed the
  client could read the passed-through `Location`; browser `fetch` forbids
  this (`redirect: 'manual'` yields an opaque-redirect response with status 0
  and no headers; `redirect: 'follow'` would chase the Location directly,
  off-proxy, into a CORS wall). The client therefore treats an opaque-redirect
  response (`response.type === 'opaqueredirect'` / status 0) as a terminal,
  constructive error: *"The provider redirected the request; the proxy does not
  follow redirects. Check the provider's base URL."* A server-side follow-up
  (map upstream 3xx to a readable JSON envelope) is logged in §10 for the
  go-live backlog; proxy requests set `redirect: 'manual'` so the browser can
  never wander off-proxy `[L]`.
- Other statuses pass through unchanged into the existing per-surface error
  handling (constructive-error principle already lives there).

## 6. MCP client (`apps/user-client/src/mcp/mcp-client.ts`)

- `McpEndpoint.corsProxy: { url: string; key: string } | null` collapses to the
  existing `routing: 'direct' | 'proxy'` discriminator; URL and token resolve
  late from the same registered source (imported from `llm-unified`).
- The proxy branch sets `x-chatsundere-authorization` + `x-cors-proxy-target`
  exactly as §4; `Mcp-Session-Id`, protocol headers and the SSE `GET` /
  `DELETE` verbs are untouched (server spec §11 keeps them pass-through).
- 401-refresh-retry via the same helper. MCP responses already flow through
  `readJsonRpcResponse`; only the request construction and the retry wrapper
  change.
- `build-mcp-context.ts` / `mcp-tools.ts` stop threading proxy config; the
  routing decision (which endpoints need the proxy) is unchanged.

## 7. Availability gating (`usable-providers`, send paths)

- `usableTemplateIds(providers, hasProxy)` keeps its shape; the **source of
  `hasProxy` changes** from `!!settings.corsProxy` to the server gate:
  - Hook form: `deriveServerGate(..., feature: 'proxy').enabled`.
  - Non-hook call sites (`send-message.ts`, memory, compaction, subagents,
    title generation, voice, image generation): a new non-hook
    `isProxyAvailable(): boolean` beside `proxy-auth.ts`, reading the same
    stores via `getState()` — one derivation, two entry points.
- Effect: for a local-only user, proxy-required providers vanish from the
  *usable* set (models unpickable, summaries honest) and their configuration
  surfaces render disabled-over-hidden with the WS-0 gate tooltip
  (`copy.serverGate.localOnly` / `localOnlyWithInvite`). Linked-but-offline
  yields the `offline` reason; linked against a proxy-less server yields
  `feature-missing`. No new copy category is required; Laura judges the fit at
  spec-pass.
- Mid-conversation loss (linked user goes offline mid-chat): the send path
  fails through the existing constructive error surfaces; no new modal.

## 8. UX surfaces (Laura)

- **`CorsProxyBlock` collapses to a status line.** The key-entry form, seal
  flow, edit/clear affordances and the "providers will become unavailable"
  confirm dialogue are deleted. Replacement, same location (settings →
  providers): a read-only row —
  - linked + `proxy` feature: *"Routed via your linked server"* + issuer label;
  - otherwise: the `useServerGate('proxy')` tooltip, disabled-over-hidden.
- No new screens, no new navigation. Provider cards and model pickers reuse
  the existing disabled affordances.
- Copy is British English, calm, one intent per line (ND audience).

## 9. Retirement sweep

- `apps/user-client/src/lib/cors-proxy.ts` (`CORS_PROXY_URL`) deleted;
  `VITE_PROXY_URL` removed from `env.ts` and `.env.example`.
- `settings.corsProxy` is no longer read or written anywhere. The field stays
  on the `SettingsRow` type as deprecated-documented dead weight (stale sealed
  keys in existing rows are harmless ciphertext `[L]`); **no Dexie change —
  `client-data-db.ts` stays untouched, its next version belongs to WS-C.**
  The `settings.ts:20` URL-normalisation line goes.
- The `corsProxyUrl`/`corsProxyKey` threading is deleted across all carriers:
  `stream-engine`, `send-message`, `build-context`, integration types +
  web/artefact integrations, `memory/resolve-args` + `pipeline`,
  `compaction/runner`, `subagent-base`, `ask-expert`, `resolve-expert-web`,
  `artefact-author`, `title-generator`, `model-debug`, voice
  (`resolve-tts`, `voice-transport`, `dictation/resolve-stt`), image
  generation, `VoicePicker`, provider settings routes, `stream-manager.store`.
- Test fixtures move from `x-cors-proxy-api-key` expectations to
  `x-chatsundere-authorization` with a fake registered source.

## 10. Out of scope / follow-ups

- **Server follow-up (go-live backlog, STATUS-BACKEND):** map upstream 3xx to
  a readable JSON envelope so a browser client can re-issue through the proxy;
  until then redirects are terminal (§5).
- The go-live cut itself (old `cors-proxy.tidesson.net` container, in-client
  cut message) — a deploy-time event, not client code on this branch.
- Admin-client: no LLM egress, no changes.
- `jti` revocation / suspension checks: server-side deferral, unchanged here.

## 11. Testing

- `transport.test.ts`: proxy branch header shapes (JWT slot, target, upstream
  `Authorization` untouched), missing-source/missing-token throws, redaction
  of `x-chatsundere-authorization`.
- `fetchWithProxyAuth`: 401 → refresh → single retry with the *new* token;
  refresh failure → original 401 surfaces; non-401 passes through; opaque
  redirect → constructive error.
- `mcp-client.test.ts`: proxy branch parity (headers, session id preserved,
  retry once).
- `usable-providers` + gate: local-only/offline/feature-missing matrices.
- Full battery at the end: `pnpm typecheck --force` (14/14 uncached), both
  vitest suites, `pnpm build`, Biome on touched files.

## 12. Manual verification (Chris, dev stack)

1. `docker compose -f infra/docker-compose.dev.yml up` (auth + proxy + deps);
   link the client to the local backend (WS-B flow).
2. Enable a proxy-required provider (e.g. xAI), send a message — response
   streams through the local proxy; the model debugger shows
   `x-chatsundere-authorization` **redacted**.
3. Wait past the access TTL (or set a short `ACCESS_TTL` in dev), send again —
   transparent refresh, no visible interruption.
4. Add a remote MCP server routed via proxy; tools list and a call succeed.
5. Log out to local-only: the provider's models leave the pickers; its
   settings card shows the disabled state with the linking tooltip.
6. Stop the proxy container: linked-but-unreachable shows the offline gate;
   restart recovers after the regain probe.
