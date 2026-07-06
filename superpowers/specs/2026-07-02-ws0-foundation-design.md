# WS-0 Foundation — Backend Discovery, Connectivity, and the Server Gate

**Date:** 2026-07-02
**Status:** approved design, pre-plan
**Sprint:** Full Backend Transition (branch `full-backend-transition`, see `STATUS-TRANSITION.md`)
**Audit gates:** Laura spec-pass PASSED 2026-07-02 (2 hard, 5 soft — all
folded into v2 of this document: `auth-action`/`server-error` reasons, the
touch affordance mandate, copy revisions) — no Larissa gate (no mandatory
path touched)

## 1. Context and goal

The client at `v0.1.3` is local-only. Three backend workstreams (proxy, sync,
blobs) are built and merged server-side; the transition sprint integrates them
into the client. Every later workstream keys off three facts the client cannot
currently answer centrally:

1. **What does my server offer?** — no consumer of `GET /api/v1/config`
   exists; `features` appears nowhere in the client.
2. **Am I actually connected?** — `connectivity.store.ts` is event-driven
   only; `server_unreachable` sticks until some auth flow happens to run.
3. **Do I have a linked account?** — truth lives in the crypto IDB
   (`LinkedAccountRow`), but every screen re-reads it ad hoc
   (e.g. `routes/login/index.tsx:36`).

WS-0 builds the three answers as foundation primitives plus one derivation
hook. **No user-visible flow changes.** Consumers arrive in WS-B/A/C/D.

## 2. Decisions settled with Chris (2026-07-02)

| # | Axis | Decision |
|---|---|---|
| 1 | Discovery lifecycle | Fetch at boot when a linked account exists, **and** expose `probeServer()` for the onboarding URL-entry step (WS-B wires the UI) |
| 2 | Connectivity | Traffic-driven transitions plus a single regain-probe on `online` event and app-foreground; **no heartbeat timer** (mobile-first battery stance; WS-C's pull timer and doorbell add live signals later) |
| 3 | Proxy policy | Account linking is de facto required for proxy egress (server is token-only). Local-only users see proxy-dependent functions **disabled over hidden** with constructive copy plus the invitation pointer (`VITE_INVITE_REQUEST_URL`) |
| 4 | Persistence | Discovery result is **memory-only** (Zustand). No Dexie bump (v33 stays the sync engine's), no crypto-IDB change. Offline, server features are unusable anyway; the only cost is a generic disabled-reason before the first fetch of a session |
| 5 | Cut line | WS-0 is purely foundational. Matrix un-gate and the server-linking badge stay in WS-B; `lib/cors-proxy.ts` stays WS-A's |

## 3. Architecture

Four units. Cross-cutting server-facing state lives in
`packages/ui-shared/src/state/` (the `session.store` / `connectivity.store`
convention); the copy-bearing hook lives in the user-client.

```
packages/shared-types   ServerConfig (wire type)
packages/ui-shared      discovery.store.ts   (new)
                        account-link.store.ts (new)
                        connectivity.store.ts (extended: regain-probe wiring)
apps/user-client        lib/server-gate.ts → useServerGate(feature) + copy
                        boot sequence wiring (main.tsx)
```

## 4. Wire type and validation — `ServerConfig`

`packages/shared-types/src/config.ts` (new, exported from the package index):

```ts
/** Response shape of the public backend-discovery endpoint GET /api/v1/config. */
export interface ServerConfig {
  proxyUrl?: string;
  syncUrl?: string;
  features: string[];
}

/** Feature flags the client understands today; servers may send more. */
export type KnownServerFeature = 'proxy' | 'sync' | 'blobs';
```

Client-side validation (valibot, in `discovery.store.ts`):

- `features`: array of strings, **unknown strings tolerated and preserved**
  (a newer server must not break an older client).
- `proxyUrl` / `syncUrl`: optional; when present, absolute URL, scheme
  `https`, except `http` permitted for `localhost` / `127.0.0.1` (dev).
  A present-but-invalid URL fails validation → the whole response is
  treated as `invalid` (a misconfigured server should be caught loudly at
  probe time, not at first proxy call).
- Extra top-level keys tolerated (forward compatibility).

## 5. `discovery.store.ts` — the config store and `probeServer`

State shape:

```ts
type DiscoveryStatus = 'unknown' | 'probing' | 'ok' | 'unreachable' | 'invalid';

interface DiscoveryState {
  status: DiscoveryStatus;
  config: ServerConfig | null;   // last successful result, kept during re-probe
  baseUrl: string | null;        // the server the config came from
  fetchedAt: number | null;      // Date.now() of last success
}
```

`probeServer(baseUrl: string): Promise<ProbeResult>` — a module-level
function usable outside React (boot, connectivity listener, WS-B onboarding):

```ts
type ProbeResult =
  | { kind: 'ok'; config: ServerConfig }
  | { kind: 'unreachable' }          // network-level failure (DNS, refused, CORS, timeout)
  | { kind: 'invalid' };             // reachable, but not a Chatsundere backend
                                     //  (non-2xx, non-JSON, or schema-invalid)
```

Behaviour:

- Does a plain `fetch` internally (GET, `accept: application/json`, no
  credentials) rather than `apiFetch` — `apiFetch` lives in the user-client
  and `ui-shared` must not import from an app; the discovery call needs none
  of its token/refresh machinery anyway. `joinUrl`'s prefix-preserving
  concatenation is mirrored as a small local helper (sub-path hosting must
  keep working; see the ADR 0023 amendment).
- **Single-flight:** concurrent calls for the same `baseUrl` coalesce into
  one in-flight request. No automatic retry (callers decide; the regain
  events are the retry).
- Updates the store only when probing the **linked** base URL (the
  onboarding probe of a candidate URL returns a result without mutating
  global state — WS-B consumes the return value).
- On `ok`: also calls `useConnectivityStore.getState().onServerOk()`.
  On `unreachable` for the linked URL: `onServerUnreachable()`.
  (`invalid` sets discovery `status: 'invalid'` but leaves connectivity
  alone — the network is fine, the server is wrong; the two stores answer
  different questions.)

## 6. `account-link.store.ts` — the central linked gate

```ts
type LinkStatus = 'unknown' | 'local-only' | 'linked';

interface AccountLinkState {
  linkStatus: LinkStatus;
  baseUrl: string | null;
  issuerLabel: string | null;
  role: 'primary_admin' | 'admin' | 'user' | null;
}
```

- Populated once at boot from `getLinkedAccount(db)`
  (`packages/crypto/src/db/linked-account.ts`) — **read-only use of the
  existing accessor; `packages/crypto` is not modified** (hence no Larissa
  mandatory path).
- Actions: `setLinked(row)` / `setLocalOnly()` — called from boot and, later,
  from the link/unlink flows (WS-B migrates those call sites; WS-0 wires
  boot only).
- Initial state `'unknown'` so gates never briefly claim `enabled` before
  the IDB read resolves.
- Existing ad-hoc reads (login screen, server-linking screen,
  change-passphrase) are **not** migrated in WS-0 — they keep working
  unchanged; migration happens organically as B/A/C touch those screens.

## 7. Connectivity extension — the regain-probe

`connectivity.store.ts` keeps its 5-state union and all existing actions
unchanged. `attachConnectivityListeners()` gains:

- On window `online` **and** on `visibilitychange` → visible: if
  `accountLink.linkStatus === 'linked'`, fire `probeServer(baseUrl)`
  (single-flight makes double events harmless). Its outcome drives
  `onServerOk` / `onServerUnreachable` as per §5.
- On window `offline`: unchanged (existing `onNetworkOffline`).
- **Exactly one probe per regain event** — no polling loop, no backoff
  chain. If the probe fails, the state honestly stays `server_unreachable`
  until the next real traffic or regain event.

Boot (`apps/user-client/src/main.tsx`): after `attachConnectivityListeners()`,
read the linked account → populate `account-link.store` → if `linked` and
`navigator.onLine`, fire the initial `probeServer(baseUrl)`.

## 8. `useServerGate(feature)` — the derivation hook

`apps/user-client/src/lib/server-gate.ts`:

```ts
type GateReason =
  | 'local-only'       // no linked account — link or request an invitation
  | 'offline'          // network down or server unreachable — self-heals
  | 'auth-action'      // server stopped recognising the session — user must act
  | 'server-error'     // server answers, but not like a Chatsundere backend — operator must act
  | 'feature-missing'  // server healthy, feature not offered — operator may act
  | 'unknown';         // still finding out — transient

interface ServerGate {
  enabled: boolean;
  reason: GateReason | null;   // null iff enabled
  tooltip: string | null;      // ready-to-render copy, null iff enabled
}

function useServerGate(feature: KnownServerFeature): ServerGate;
```

The enum is deliberately **isomorphic to the distinct user next-steps**
(Laura spec-pass): a consumer must be able to branch on `reason` alone —
e.g. attach the invitation pointer for `local-only` or an operator hint for
`server-error` — without re-reading the underlying stores.

Derivation, first match wins:

| Condition | Result |
|---|---|
| `linkStatus 'unknown'` (boot IDB read pending) | `unknown`¹ |
| `linkStatus 'local-only'` | `local-only` |
| connectivity `server_auth_failed` | `auth-action`² |
| connectivity `server_unreachable` / `local_offline` | `offline` |
| discovery `'invalid'` | `server-error` |
| discovery `status` `'unknown'` or `'probing'` (no prior config this session) | `unknown` |
| `feature ∉ config.features` | `feature-missing` |
| otherwise | `enabled: true` |

¹ Routed to the neutral checking bucket, **not** `local-only` — a linked
user must never (even for milliseconds) be shown invitation copy (Laura
soft finding; the neutral bucket exists anyway).
² **Not** folded into `offline` (Laura hard finding): auth-failed does not
self-heal by connectivity, and the app already names the real next step
(`copy.ts:138` `serverAuthFailedBanner`). The gate must never claim a
waiting cure for a state that requires user action.

Copy catalogue (`lib/copy.ts`, draft for Laura's pass — British English,
constructive, each names the next step, dere-toned but calm):

| Key (reason) | Draft copy |
|---|---|
| `serverGateLocalOnly` (`local-only`) | "This comes alive once you link an account. Link one under Account → Server linking." — when `VITE_INVITE_REQUEST_URL` is set, " — or request an invitation." is appended and the surface may render it as the invitation link; when unset, the operator clause is dropped entirely (never name a next step the user cannot reach — Laura) |
| `serverGateOffline` (`offline`) | "Your server isn't reachable right now. This wakes up again the moment the connection returns." (connection-neutral — covers both network-down and server-down without asserting who is offline) |
| `serverGateAuthAction` (`auth-action`) | "The server stopped recognising this session. Sync your passphrase under Account → Server linking to restore the link." (mirrors the existing `serverAuthFailedBanner`, `copy.ts:138` — the two surfaces must never contradict) |
| `serverGateServerOdd` (`server-error`) | "Your server is answering unexpectedly. This usually resolves itself — if it keeps happening, your operator will want to know." |
| `serverGateFeatureMissing` (`feature-missing`) | "Your server doesn't offer this yet. Operators can enable it — nothing is missing on your side." |
| `serverGateChecking` (`unknown`) | "Checking what your server offers…" |

**Affordance mandate (Laura hard finding).** The `title` attribute never
fires on touch — at 380 px a title-only tooltip silently mutes the entire
payload of disabled-over-hidden. Consumers MUST surface the returned
`tooltip` through a touch-reachable affordance (press-to-reveal popover,
inline caption beneath the disabled control, or a pressable info dot);
`aria-disabled` + `title` + `opacity-40` remain as the desktop-hover
augmentation, never the sole channel. WS-0 ships the hook and copy only;
this mandate binds every consumer surface (§14).

## 9. URL precedence

- **Discovery is the source of truth** for `proxyUrl` and `syncUrl`.
- `VITE_PROXY_URL` / `VITE_SYNC_URL` (`apps/user-client/src/env.ts`) become
  **dev-only overrides**: honoured only under `import.meta.env.DEV`, so a
  production build can never pin a stale URL. Selector shape:
  `selectEffectiveProxyUrl(state)` = dev override ?? `config.proxyUrl` ?? null.
- `VITE_AUTH_URL` keeps its current meaning (dev convenience for the auth
  base URL; the real base URL comes from onboarding input or
  `LinkedAccountRow.base_url`).
- `lib/cors-proxy.ts` (`CORS_PROXY_URL`) is **untouched** — swapping LLM/MCP
  traffic onto the discovered proxy is WS-A.

## 10. Error handling

- Probe network failure → `ProbeResult 'unreachable'`; for the linked URL
  additionally the connectivity transition. No log noise, no toast — the
  ConnectivityBadge already renders the state.
- Reachable-but-wrong (404 HTML page, non-JSON, schema-invalid, present-but-
  malformed URLs) → `'invalid'`; connectivity untouched (§5).
- No auth involved anywhere; no secrets; nothing persisted; no PII. The
  request is unauthenticated cross-origin GET with no credentials.

## 11. Scope boundary — explicitly OUT

- Onboarding matrix un-gate, server-linking badge, any visible flow change (WS-B)
- `transport.ts` / `mcp-client.ts` / `cors-proxy.ts` proxy swap (WS-A)
- Any Dexie schema change (v33 is owned by WS-C), any `packages/crypto` change
- Step-up interceptor (WS-E), sync worker, doorbell (WS-C), blob anything (WS-D)
- Migrating existing ad-hoc `getLinkedAccount` call sites (organic, B/A/C)

## 12. Testing (Vitest)

1. **Gate derivation matrix** — every combination of
   `linkStatus × connectivity kind × discovery status × feature present/absent`
   asserts `{enabled, reason}` per the §8 table (structural, no copy
   string-matching beyond key identity).
2. **`probeServer`** — mocked `fetch`: valid config → `ok` (+ config
   preserved, unknown features tolerated); non-JSON / non-2xx / bad schema /
   `http://` non-localhost URL → `invalid`; rejected fetch → `unreachable`;
   single-flight (two concurrent calls, one fetch); store mutated only for
   the linked base URL.
3. **Regain wiring** — fake timers/events: `online` event and foreground
   visibility each trigger exactly one probe when linked, none when
   local-only.
4. **Boot init** — `account-link.store` populated from a stubbed
   `getLinkedAccount`; `'unknown'` before resolution, correct state after;
   no probe when local-only.
5. Baseline discipline: expect the environmental 8-failure Node-localStorage
   trio to stay exactly 8 (`project_vitest_baseline_is_node_localstorage`).

## 13. Manual verification (Chris, dev build)

1. Boot with a linked account (dev backend up): network tab shows exactly one
   `GET /api/v1/config`; ConnectivityBadge goes `linked_online`.
2. Stop the backend, toggle DevTools offline→online: exactly one config
   request per regain; badge lands on `server_unreachable` and stays there
   without request spam.
3. Boot local-only: zero config requests.
4. Point `VITE_AUTH_URL` at a non-Chatsundere URL (any static site) and probe
   via console: result `invalid`, badge unchanged.
5. `useServerGate('proxy')` from a scratch component/console: walk the
   reasons through the states (local-only → link → offline → auth-failed →
   feature removed from a doctored config → non-Chatsundere URL for
   `server-error`).

## 14. Consumption contract for later workstreams

- **WS-B:** calls `probeServer(candidateUrl)` in the onboarding URL step for
  constructive pre-join validation; flips matrix cells and badge onto
  `useAccountLinkStore` + `useServerGate`; migrates link/unlink flows to call
  `setLinked`/`setLocalOnly`.
- **WS-A:** reads `selectEffectiveProxyUrl`; gates provider egress UI on
  `useServerGate('proxy')`.
- **WS-C:** reads `syncUrl` the same way; hangs its worker's push/pull
  outcomes onto `onServerOk`/`onServerUnreachable` (the traffic-driven
  signals); gates sync UI on `useServerGate('sync')`.
- **WS-D:** `useServerGate('blobs')` — the blob spec's "disabled is not
  missing; re-probe only when `/api/v1/config` changes" rule is satisfied by
  this store (re-probe happens on regain/foreground/boot only).
- **All consumers:** the §8 affordance mandate applies — the tooltip must be
  reachable by touch, `title` is augmentation only. The `unknown` state is
  rendered calmly (disabled control or skeleton, never a blocking spinner);
  on a cold boot a returning linked user briefly sees "Checking…" by design
  (memory-only discovery, spec decision 4).
