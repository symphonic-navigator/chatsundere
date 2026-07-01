# Authenticated CORS Proxy — `proxy-service` (design)

**Date:** 2026-07-01
**Author:** Liz (with Chris)
**Status:** Draft — **Larissa spec-pass + Fable cross-review complete
(2026-07-01); all findings folded in.** Awaiting Chris's spec review, then
implementation plan. Built by overnight remote execution; **Larissa re-audits the
built diff before squash** (touches `apps/proxy-service` + a `apps/auth-service`
addition). **Scope:** `apps/proxy-service` (new implementation over the Phase-0
skeleton) and one new public read-only endpoint in `apps/auth-service`. **Larissa
path.** The *client* consumption (header swap in
`packages/llm-unified`/`apps/user-client`, discovery consumption, `CorsProxyBlock`
collapse, onboarding) is **out of scope here** — a separate client-session
workstream with Chris + Laura (§12).

This spec consolidates the settled decisions in
`BACKEND-ANALYSIS-cors-proxy-and-sync.md` (§1, §5), four refinements agreed with
Chris on 2026-07-01 (**token-only**, the **header rule**, a **single egress
policy**, **backend self-description**), and two rounds of adversarial review:
Larissa (security) and Fable (protocol/functional). Requirements are tagged `[L]`
or `[F]` where they exist specifically because of a finding.

---

## 1. Why

The proxy the client uses today (`cors-proxy.tidesson.net`) is a transitional
**shared-key relay**: one static key (`CORS_PROXY_API_KEY`) that Chris hands out
on Discord. It shipped the alpha fast and earned real feedback — its job is done.
It has two structural problems we now retire:

1. **A shared static secret.** If it leaks, it is an open relay onto the
   whitelist. That contradicts the Proton-grade bar we hold ourselves to.
2. **It represents nothing of what Chatsundere should be** — no account binding,
   no per-user control, no self-hosting story, and it does not solve the MCP
   egress problem cleanly.

This spec stands up **our own** `proxy-service` as an **account-authenticated**
CORS forward proxy for both LLM and MCP traffic. It is the first time the
auth-service JWT is consumed by a second service in a **resource-server** role —
so it proves the whole authentication story end-to-end against a service far
simpler than sync, and it introduces **no new crypto** (not on the
zero-knowledge critical path).

The old proxy is retired in a **coordinated cut** at the 0.2.0 deploy (Discord
announcement + a constructive in-client message; the old container is *stopped,
not deleted*, for a 60-second rollback). That transition is a client + release
concern, tracked separately; this spec covers the new server only.

## 2. Guiding principles (settled with Chris)

1. **Account-authenticated, token-only.** Every request carries a Chatsundere
   account access token (the same JWT used for sync). No shared-key mode exists
   in the new proxy — the coordinated cut makes it dead weight, and dropping it
   shrinks both the config surface and the Larissa surface.
2. **The proxy is a man-in-the-middle by construction — say so, mitigate hard.**
   A TLS-terminating CORS proxy necessarily sees the upstream provider key and
   the full request/response bodies (i.e. the conversation) in plaintext.
   Zero-knowledge is a property of the **sync/vault** path, not the **live
   inference** path. Stated plainly in spec, in user copy, and is why
   self-hosting the proxy (AGPLv3) is a first-class path.
3. **Transient by design — spurlos durch.** Requests leave **no trace**: no
   request logging of any kind (not bodies, headers, target, user), holding
   **even on the error path** `[L]`. The single exception is **anonymous**
   Prometheus counters (§8).
4. **Transparent forwarding, freedom-oriented.** No LLM allow-list as an egress
   gate; the boundary is the SSRF private-range block + rate limits. The proxy
   forwards **any method and any header** except a small, tested set that must
   never leak or must be rewritten (§6.1) — a user with their own provider,
   their own custom headers, or a self-hosted MCP server is never gate-kept `[F]`.
5. **The backend describes itself.** The client does not hard-code the proxy URL;
   it *asks* the backend (§7). Self-hosting is first-class — a foreign operator
   runs their own backend + proxy at their own URLs, and the client learns the
   topology rather than assuming it.

## 3. Architecture overview

A stateless Hono-on-Bun service listening on **two ports** `[F]`:

- **`PORT` (public, Traefik-routed):** *only* the forward proxy. **No reserved
  paths** — every path is proxied — so a legitimate upstream path like `/metrics`
  or `/healthz` is reachable, and the ops endpoints cannot be hit from outside.
- **`OPS_PORT` (internal only, never Traefik-routed):** `/healthz`, `/readyz`,
  `/metrics`. The internal/external split is **mechanical, not a fragile Traefik
  path-exclusion** `[F]`/`[L]`.

Per public request, in this **exact order** `[L]` (load-bearing, see §5.4):

```
client ──▶ proxy-service ──▶ upstream (LLM provider or MCP server)
             │
             ├─ 0. OPTIONS?  → CORS preflight, done (§6.3)
             ├─ 1. derive client IP from the trusted-proxy hop (§5.4)
             ├─ 2. per-IP rate limit  (PRE-AUTH)              → 429
             ├─ 3. verify account JWT (JWKS, cached)          → 401
             ├─ 4. per-user rate limit (keyed on sub)         → 429
             ├─ 5. parse+validate target, resolve, block private ranges → 400/403
             ├─ 6. forward: denylist headers, Host-rewrite, ANY method,
             │      redirect:'manual', connect to the pre-checked IP  (§5,§6)
             └─ 7. stream response back (response denylist, CORS)  (§6)
```

Stateless but for **Redis** (transient rate-limit counters, TTL). The `jose`
JWKS key set is cached **in-process**, not in Redis. Never touches Postgres.
Never writes request data anywhere.

New source layout (over the skeleton `env.ts`/`metrics.ts`/`logger.ts`/
`server.ts`/`routes/health.ts`):

- `src/auth/verify-token.ts` — JWKS verification (`[L]` pinned `algorithms`,
  pinned `jose` fetch options).
- `src/egress/target.ts` — target parse+validate (§5.6), **resolve-then-connect**
  private-range block over **every** resolved address, **pinned-IP fetch** (§5.2),
  redirect handling.
- `src/egress/blocked-ranges.ts` — the private/blocked IP range set (§5.1).
- `src/egress/known-hosts.ts` — known LLM host set (metric label only, exact match).
- `src/net/client-ip.ts` — client-IP from the trusted hop `[L]`.
- `src/ratelimit/limiter.ts` — Redis per-user + per-IP window, **fail closed** `[L]`.
- `src/proxy/headers.ts` — the request/response **header denylists** + Host
  rewrite (`[F]` transparent forward; the account token can never be a member,
  invariant-tested §13).
- `src/routes/proxy.ts` — the method-agnostic forward handler + streaming.
- `src/cors.ts` — exact-origin match, request-header echo, `Vary: Origin` (§6.3).
- `src/error.ts` — custom `onError`, generic, never interpolates request context `[L]`.
- `src/ops.ts` — the second-port server for health/metrics `[F]`.

## 4. Authentication — JWT as a resource server

The proxy is a **resource server**; it issues and stores no credentials. After
the pre-auth per-IP limit (§3 step 2) it:

1. Reads the account token from **`x-chatsundere-authorization: Bearer <jwt>`**
   (the proxy-specific slot — §6.1).
2. Verifies via `jwtVerify(token, jwks, opts)`, `jwks =
   createRemoteJWKSet(AUTH_JWKS_URL, …)`:
   - **`algorithms: ['EdDSA']` pinned** `[L]` (matches `auth-service …/jwt/verify.ts:27`);
     never infer the algorithm from the token header.
   - **`issuer: JWT_ISSUER` by exact string equality.** Because **`aud` is
     ignored** (variant *a*), the issuer is the **only** claim binding a token to
     this domain — load-bearing `[L]`. Value **must be `chatsundere-auth-v1`**
     (`issue.ts:65`), not the skeleton's wrong default `chatsundere-auth` (§10).
   - **`exp` enforced**; **clock tolerance pinned to 5 s** `[F]`.
3. Valid → forward. Invalid/absent → **`401`**, generic body.

**`jose` fetch hardening** `[L]`: explicit `timeoutDuration` (5 s),
`cooldownDuration` (30 s), `cacheMaxAge` (10 min) so a bogus-`kid` flood cannot
hammer the audited JWKS and a hung fetch cannot stall the proxy. JWKS-fetch
failure → `401` (fail closed).

**Deliberately deferred: `jti` revocation + no Postgres user-existence check.**
The proxy verifies cryptographically and forwards; it does **not** confirm the
user is unsuspended (unlike `auth-service/src/middleware/auth.ts:43`).
Consequence, owned `[L]`: with **ACCESS_TTL = 15 minutes** (`issue.ts:27`), a
**logged-out or suspended/banned** user keeps full proxy egress for **up to 15
minutes** with no kill switch. Accepted because the proper fix (a Redis
`jti`/suspension check) lands with the device/session-management surface later.

**Forward-guard on `aud`-ignore** `[L]`: today there is exactly one `SignJWT`
site (`issue.ts:61`). **If the auth-service ever mints another EdDSA token under
the same issuer/key**, the proxy would accept it as full authorisation — revisit
this decision the moment such a token appears.

## 5. Egress policy & SSRF — the one hard control

No per-target allow-list as an egress gate. Any **public** target is permitted;
integrity rests on the details below.

**5.1 Blocked ranges** (refuse `403`, count `proxy_ssrf_blocked_total`). The check
runs on the **resolved numeric IP** from `getaddrinfo` — never the hostname
string — so decimal/octal/hex encodings normalise automatically `[L]`.

- **IPv4:** `0.0.0.0/8`, `10/8`, `127/8`, `169.254/16` (link-local incl. metadata
  `169.254.169.254`), `172.16/12`, `192.168/16`, `100.64/10` (CGNAT),
  `192.0.0.0/24`, `198.18.0.0/15` (benchmark), `224.0.0.0/4` (multicast),
  `240.0.0.0/4` (reserved), `255.255.255.255` `[L]`/`[F]`.
- **IPv6:** `::` (unspecified), `::1` (loopback), `fc00::/7` (ULA), `fe80::/10`
  (link-local), `fec0::/10` (site-local), `ff00::/8` (multicast) `[L]`.
- **IPv4-embedding IPv6 forms — unwrap and re-check against IPv4 rules** `[L]`/`[F]`:
  `::ffff:0:0/96` (v4-mapped), `::/96` (v4-compat), **`64:ff9b::/96` (NAT64)**
  (`64:ff9b::7f00:1` = `127.0.0.1`), and **`2002::/16` (6to4)** — extract the
  embedded IPv4 (bits 16–48) and re-check.

**5.2 Resolve-then-connect over every address (DNS-rebinding defence)** `[L]`.
Every resolved A/AAAA record is checked; the exact address that passes is the one
connected to — **empirically verified in Bun** (2026-07-01 probe):
```
fetch(`https://<checked-IP><path>`, {
  tls: { serverName: <host> },        // SNI + cert validation against the real host
  headers: { Host: <host>, … },       // upstream routing correct
  redirect: 'manual',
})
```
TCP connects to the pre-checked IP; SNI/cert validate against the hostname; **no
second lookup** → no TOCTOU. `[F]` **Named fallback, in priority order, if the
above ever regresses:** `node:https.Agent({ lookup })` pinning the IP (also
probe-verified under Bun) → `Bun.connect` raw TLS with `serverName`. The fallback
is **never** resolve→check→refetch-by-hostname.

**5.3 Redirects do not bypass the block** `[L]`. Upstream `fetch` uses
**`redirect: 'manual'`**; a 3xx is passed back to the client **unfollowed** (with
its `Location` — see §6.2 `[F]`), so the client re-issues through the proxy and
the new target is re-checked from scratch. The proxy never follows
`302 → http://169.254.169.254/…`.

**5.4 Rate limits (Redis, sliding window).**
- **Client IP from the trusted-proxy hop, never a client-settable header** `[L]`.
  Behind Traefik, from a fixed boundary (`TRUST_PROXY_HOPS`/`TRUSTED_PROXY_CIDR`,
  §10); raw `X-Forwarded-For` from untrusted clients discarded. Else a per-request
  spoof defeats the ceiling **and** mints unbounded Redis keys (memory DoS).
- **Per-IP limit runs pre-authentication** (§3 step 2), gating the verifier; the
  **per-user limit** (keyed on `sub`) runs post-verify `[L]`.
- Counters TTL-expire, **never labelled or logged** (§8.3). Defaults
  (env-configurable): **per-user 120/min, per-IP 600/min** → `429` + `Retry-After`.
- **Redis outage → fail closed** `[L]` (never an unlimited authenticated relay; a
  conservative in-process fallback limit is acceptable).

**5.5 The MCP asymmetry, for Larissa.** LLM targets are a small known set; MCP
targets are user-supplied and arbitrary, so the *same* uniform policy applies to
both. The private-range block is what stops an authenticated user turning the
proxy into an internal scanner.

**5.6 Target-shape validation** `[F]` (`x-cors-proxy-target`). Refuse `400` unless:
absolute URL; scheme ∈ **{`https`, `http`}** (`http` allowed for self-hosted MCP,
plaintext is the user's informed choice — still private-range-blocked); **no
userinfo** (`https://user:pass@host` → `400`); **origin only** — a path or query
in the target header → `400`. Arbitrary ports are allowed (only public IPs are
reachable). The forwarded URL is `target-origin` + the **request's** path+query.

## 6. Forwarding, streaming, CORS, MCP

**6.1 Transparent forward with a tested denylist** `[F]`/`[L]`. A proxied request
carries **two** credentials: the **account token** (authorises *us*) and the
**upstream provider key** (authorises the *upstream*). Upstreams expect their key
in `Authorization: Bearer …`, so the account token rides in
**`x-chatsundere-authorization`**.

The proxy is **method-agnostic** (GET, POST, DELETE, PUT, PATCH, … all forwarded)
`[F]` — MCP Streamable HTTP uses GET (server SSE stream) and DELETE (session
terminate), not only POST. Request headers are forwarded **verbatim except a
small, explicit, tested denylist**:

- **Stripped, never forwarded** (a named constant, invariant-tested §13 so the
  account token can never leak upstream even as new headers appear): any
  `x-chatsundere-*`, any `x-cors-proxy-*`, and the hop-by-hop set (`connection`,
  `keep-alive`, `upgrade`, `te`, `transfer-encoding`, `proxy-authorization`,
  `proxy-connection`).
- **`Host` is rewritten** to the target host — never the incoming Host `[L]`.
- **Everything else is forwarded verbatim** — `Authorization` (upstream key), the
  body, `Content-Type`, `Accept`, provider headers (`x-api-key`,
  `anthropic-version`, `OpenAI-Beta`), adapter `extraHeaders` (`Wafer-ZDR`),
  arbitrary user custom headers (`X-Title`, gateway headers), and MCP's
  `Mcp-Session-Id`, `Last-Event-ID`, `MCP-Protocol-Version` `[F]`. This is why a
  custom provider is never gate-kept and MCP survives reconnects + session
  cleanup, not just the happy path.

**6.2 Streaming passthrough, unbuffered.** LLM SSE and MCP `text/event-stream`
flow chunk-by-chunk via a Hono `ReadableStream`. **Response headers** use a
symmetric **denylist** `[F]`: **dropped** are `Set-Cookie`/`Set-Cookie2` (a
malicious upstream must not set cookies on the app origin), any upstream
`Access-Control-*` (the proxy sets CORS exclusively), and hop-by-hop headers;
**everything else forwarded**, including `Content-Type`, `Content-Encoding`,
**`Location`** (so §5.3's client re-issue works `[F]` — its absence from
`transport.ts`'s allow-list is exactly the trap), `Retry-After`, `Cache-Control`.
No re-buffering; no on-disk buffering, ever.

**6.3 CORS.** `OPTIONS` preflight against the configured origin allow-list
(`CORS_ALLOWED_ORIGINS`, default `https://app.chatsundere.me`; dev adds
`http://localhost:<port>`):
- **Full-origin exact string equality** (scheme+host+port, lowercased) — never
  `startsWith`/suffix (else `https://app.chatsundere.me.evil.com` passes) `[L]`.
- **`Origin: null` never allowlisted; missing `Origin` gets no CORS** and is not
  treated as authorised — CORS is **browser-only defence-in-depth, never an auth
  layer** (curl/native clients ignore it; token + SSRF + rate-limit are the real
  controls) `[L]`.
- `Access-Control-Allow-Origin` reflects the **specific** matched origin (never
  `*`); **`Vary: Origin`** always set (anti CORS-cache-poisoning) `[F]`. **No**
  `Access-Control-Allow-Credentials` (auth is a header, not a cookie).
- **`Access-Control-Allow-Methods`** covers the method-agnostic surface
  (`GET, POST, DELETE, OPTIONS`, incl. MCP) and **`Access-Control-Allow-Headers`
  echoes the requested `Access-Control-Request-Headers`** `[F]` (not a fixed
  short list — §13 tests the echo, consistent with transparent forward); expose
  `Mcp-Session-Id`.

**6.4 Resource ceilings** `[L]`/`[F]`. Enforce a **max request-body size on the
streamed bytes** (not just `Content-Length` — chunked bodies bypass that),
default **50 MiB** (Vision requests carry several base64 images; generous but
bounded; `413` over cap). Per-user **concurrent-connection cap** (default 6,
**in-process — valid for a single replica; noted as such** `[F]`). Request-read +
**idle** timeouts (Bun `idleTimeout`, aimed at inactivity so long legitimate
streams survive) against slowloris/exhaustion.

## 7. Backend discovery — `GET /api/v1/config`

So the client never hard-codes topology, the **auth-service** gains one new
**public, read-only** endpoint:

```
GET /api/v1/config
200 { "proxyUrl": "https://proxy.chatsundere.me", "features": ["proxy"] }
```

- **Unauthenticated** — URLs are not secrets, and the client needs them *before*
  login. **CORS: served with the app-origin CORS headers** `[F]` (the app fetches
  this cross-origin pre-login when the backend host ≠ app host; the auth-service
  `middleware/cors.ts` must cover this route).
- **No state, no secret, no DB read, no reflection** — from config
  (`PROXY_PUBLIC_URL`). **Validated at env-load as an absolute `https` URL**
  (Valibot) `[L]` so a misconfigured operator can't emit a value the client
  mis-joins.
- **Extensible** — `syncUrl` joins in Workstream B; `features` later drives
  "disabled over hidden". v1: `proxyUrl` + `features: ["proxy"]` only.

The single change to the audited auth-service; maximally low-risk (public,
read-only, config-sourced) but a **Larissa path**, so called out explicitly.

## 8. Hardening & observability — anonymous and transient only

**8.1 No request logging, at all — including the error path** `[L]`. No per-request
log line. A **custom Hono `onError`** logs a generic message with **no
`error.message` interpolation and no request context** — a failed upstream
`fetch` throws a message embedding the full target URL+path
(`TypeError: fetch failed … https://mcp.chris-homelab…/…`), which would
deanonymise exactly what §8.2 forbids. Upstream connection failures → `502`
**without logging the URL**. Diagnostic-path header redaction as belt-and-braces
(extends `transport.ts:10-16`: `authorization`, `proxy-authorization`, `x-api-key`,
`api-key`, `x-chatsundere-*`, `x-cors-proxy-*`).

**8.2 Prometheus is the only aggregation, and it is anonymous.**
- **Never a user label.** No `sub`/`jti` on any metric, ever.
- `proxy_requests_total{kind, outcome}` — `kind ∈ {llm, mcp}`,
  `outcome ∈ {ok, upstream_error, unauthorized, blocked, rate_limited}`.
- **LLM target:** `proxy_llm_requests_total{host, outcome}` where `host` is the
  **base host only** (no path, no query) matched by **exact host equality
  (lowercased)** `[L]` against the known set (never suffix — `api.x.ai.evil.com`
  must not fall into `api.x.ai`); unknown → **`other`**.
- **MCP has no target label** — self-hosted URLs are deanonymising; the MCP path
  **never computes a host label**.
- `proxy_ssrf_blocked_total`, `proxy_unauthorized_total`,
  `proxy_rate_limited_total`, upstream latency (no target label on the MCP path).

**8.3 Transient rate-limit state.** Redis counters (§5.4) use identity *flüchtig*
(TTL, keyed on `sub`/IP) but appear in **no** metric label and **no** log.

**8.4 Ops endpoints internal-only, by a second port** `[F]`/`[L]`. `/healthz`,
`/readyz`, `/metrics` live on `OPS_PORT`, which is **not** Traefik-routed —
mechanical isolation, not a path-exclusion. The public port has no reserved
paths, so an upstream MCP path of `/metrics` proxies correctly.

## 9. Error handling

All error responses are **generic** (no internal detail, no target echo, no
`error.message` leak — §8.1):

| Condition | Status | Notes |
|---|---|---|
| Per-IP rate limit exceeded (pre-auth) | `429` + `Retry-After` | before the verifier |
| Missing/invalid/expired token; JWKS-fetch failure | `401` | generic; fail closed |
| Per-user rate limit exceeded | `429` + `Retry-After` | |
| Redis outage | `503`/`429` | fail closed, never unlimited |
| Bad target shape (§5.6) / missing target | `400` | scheme, userinfo, path-in-target |
| Target resolves to a blocked range | `403` | counted |
| Origin not in allow-list | no CORS headers | preflight not honoured |
| Request body over the size cap (streamed bytes) | `413` | |
| Upstream 3xx | passed through **unfollowed** + `Location` | client re-issues (§5.3) |
| Upstream error status | passed through unchanged | streamed, not logged |
| Upstream connection failure | `502` | URL never logged |

## 10. Configuration (env)

The skeleton's **`JWT_ISSUER` default is wrong** (`chatsundere-auth`; must be
`chatsundere-auth-v1`, `env.ts:11` vs `issue.ts:65`) — correct it `[L]`.

| Var | Service | Meaning |
|---|---|---|
| `AUTH_JWKS_URL` | proxy | JWKS endpoint for verification |
| `JWT_ISSUER` | proxy | expected `iss`; **default corrected to `chatsundere-auth-v1`** |
| `JWT_AUDIENCE` | proxy | **unused (variant a)**; kept declared, explicitly ignored |
| `REDIS_URL` | proxy | rate-limit counters (JWKS cached in-process by `jose`) |
| `CORS_ALLOWED_ORIGINS` | proxy | comma-separated exact origins; default `https://app.chatsundere.me` |
| `TRUST_PROXY_HOPS` / `TRUSTED_PROXY_CIDR` | proxy | trusted front boundary for client-IP `[L]` |
| `RATE_LIMIT_USER_PER_MIN` | proxy | default `120` |
| `RATE_LIMIT_IP_PER_MIN` | proxy | default `600` |
| `MAX_BODY_BYTES` | proxy | default `52428800` (50 MiB); enforced on streamed bytes |
| `MAX_CONCURRENT_PER_USER` | proxy | default `6` (in-process, single-replica) |
| `PROXY_IDLE_TIMEOUT_S` | proxy | Bun `idleTimeout` (inactivity) |
| `PORT` | proxy | public forward port, default `8080` |
| `OPS_PORT` | proxy | internal health/metrics port `[F]`; never Traefik-routed |
| `PROXY_PUBLIC_URL` | auth-service | value for `GET /api/v1/config`; validated absolute `https` URL |

`.env.example` updated for both services.

## 11. Wire reference (concrete shapes for `curl` verification)

**LLM (streaming):**
```
POST https://proxy.chatsundere.me/v1/chat/completions
x-chatsundere-authorization: Bearer <account access JWT>
x-cors-proxy-target: https://api.x.ai
Authorization: Bearer <upstream provider key>
Content-Type: application/json
{ "model": "...", "stream": true, "messages": [...] }
```

**MCP (POST + the GET/DELETE the transport also uses):**
```
POST   https://proxy.chatsundere.me/<mcp path>   (initialize, tools/call, …)
GET    https://proxy.chatsundere.me/<mcp path>   (server SSE stream)
DELETE https://proxy.chatsundere.me/<mcp path>   (session terminate)
x-chatsundere-authorization: Bearer <account access JWT>
x-cors-proxy-target: https://mcp.example.org
Mcp-Session-Id: <unchanged>        MCP-Protocol-Version / Last-Event-ID as needed
```

**Discovery:**
```
GET https://<backend host>/api/v1/config
200 { "proxyUrl": "https://proxy.chatsundere.me", "features": ["proxy"] }
```

## 12. Scope boundary — the seam

**IN (this spec, overnight remote execution, server-only):**
- Full `proxy-service` (auth, egress/SSRF, rate limits, streaming, CORS, header
  denylists, anonymous metrics, resource ceilings, two-port split).
- The `GET /api/v1/config` endpoint on the auth-service.
- Fully server-side testable + `curl`-able — Chris's dry-run (`docker compose ps`
  green, then §11 against the VPS). **Larissa re-audits the built diff before squash.**

**OUT (a later client session with Chris + Laura):**
- Client header swap in `packages/llm-unified/src/transport.ts` +
  `apps/user-client/src/mcp/mcp-client.ts` (attach the account token when
  linked+online instead of the sealed shared key).
- Consuming `GET /api/v1/config`, storing `proxyUrl`; the client's **3xx
  re-issue** handling (§5.3).
- `CorsProxyBlock` collapsing to "active because you're connected".
- Honest proxy-trust copy + onboarding overhaul.

UX-bearing, Laura-gated, device-verified — deliberately not in the unseen overnight run.

## 13. Testing (Bun runner)

- **Auth:** valid → forwarded; expired, wrong-issuer, tampered-signature,
  wrong-algorithm, absent → `401`; JWKS-fetch failure → `401`;
  `algorithms:['EdDSA']` + 5 s clock tolerance pinned.
- **SSRF (`[L]`/`[F]`):** targets resolving to `127.0.0.1`, `10.x`,
  `169.254.169.254`, `0.0.0.0`, multicast/broadcast, `::1`, `::ffff:127.0.0.1`,
  `::7f00:1`, **NAT64 `64:ff9b::7f00:1`**, **6to4 `2002:7f00:1::`**, and
  decimal/octal loopback (`2130706433`, `0177.0.0.1`) each → `403`; a
  **multi-record** host `[public, 127.0.0.1]` → blocked; a **`302`-to-private**
  upstream → not followed (returned with `Location`).
- **Target shape (`[F]`):** userinfo, a path/query in the target header, and a
  disallowed scheme each → `400`.
- **Client-IP / rate limit (`[L]`):** spoofed `X-Forwarded-For` does **not**
  change the key; per-IP trips **pre-auth**, per-user post-auth; `429` +
  `Retry-After`; TTL-expire; **Redis outage → fail closed**.
- **Header invariants (`[F]`/`[L]`):** `x-chatsundere-authorization` and
  `x-cors-proxy-*` **never** in the forward (even as new headers appear);
  `Authorization`, `Mcp-Session-Id`, `Last-Event-ID`, `MCP-Protocol-Version`,
  `x-api-key`, and an arbitrary custom header **do**; `Host` rewritten; hop-by-hop
  stripped. Response `Set-Cookie` + upstream `Access-Control-*` dropped;
  **`Location` preserved**.
- **Method-agnostic (`[F]`):** GET and DELETE to a target are proxied, not rejected.
- **CORS:** allowed origin → reflected origin, **`Vary: Origin`**, echoed
  request-headers, **no** `Allow-Credentials`; `…evil.com`, `Origin: null`,
  missing-Origin → no permissive CORS.
- **Streaming:** chunked upstream relayed unbuffered, `content-encoding` preserved.
- **Metrics/log anonymity (`[L]` invariant):** no `sub`/`jti` label; MCP emits no
  host label; unknown/suffix LLM host → `other`; **no metric or log line —
  including `onError` on a failed fetch — contains a target host or URL path.**
- **Ceilings:** over-size streamed body → `413`; concurrency cap enforced.
- **Ops split (`[F]`):** `/metrics` is served on `OPS_PORT`, not on the public
  port; a request to `/metrics` on the public port is **proxied** (treated as a
  target path), not served locally.
- **Discovery:** returns `proxyUrl` + `features:["proxy"]`, unauth, no DB read,
  with app-origin CORS headers; a malformed `PROXY_PUBLIC_URL` fails env-load.

## 14. Manual verification (Chris, on the VPS dry-run)

1. `docker compose up` (auth + proxy + postgres + redis) → `docker compose ps`
   healthy; `/healthz`/`/readyz`/`/metrics` reachable **only** on the internal
   ops port, not on the public proxy route.
2. `bootstrap-admin` → invitation → register → obtain an access token.
3. `curl` an LLM streaming call (§11) with the token → tokens stream.
4. Same without / with an expired token → `401`.
5. `x-cors-proxy-target: http://169.254.169.254/…` → `403`; a host that
   302-redirects to a private IP → not followed (you get the 3xx + `Location`).
6. `curl -X OPTIONS` from a disallowed `Origin` → no permissive CORS.
7. `GET /api/v1/config` → the configured `proxyUrl`.
8. `curl /metrics` (internal) → counters exist, **no user label, no path, no MCP host**.

## 15. Open points / deferred

- **`jti`/suspension revocation** — deferred to the device/session-management
  workstream (§4); window is **15 min** (ACCESS_TTL) until then.
- **Residual abuse is owned, not implied** `[F]`: "any public target" + auth
  means a malicious account can drive up to 120 req/min at arbitrary third
  parties **from the operator's IP** — a Hetzner-AUP concern (abuse reports land
  with the operator), not an SSRF one. Bounded by the rate limits and the
  invitation-only model, and consciously accepted for v1; the `jti`-revocation
  work is the lever if a specific account misbehaves.
- **Rate-limit / ceiling values** — 120/user·min, 600/IP·min, 50 MiB body, 6
  concurrent; tune against real usage (chat + tool loops burst).
- **`aud`-ignore forward-guard** — revisit when the auth-service mints any second
  EdDSA token type under the same issuer (§4).
- **Old proxy retirement** — the coordinated cut is a client + release concern
  with the 0.2.0 deploy, not here.
- **`features`-driven client gating** — the array grows (`sync`, `web-search`);
  only `proxy` in v1.
