# @chatsundere/proxy-service

An **account-authenticated, SSRF-hardened, transparent CORS forward proxy** for
both LLM and MCP traffic. It is a resource server: it consumes the auth-service
JWT (via JWKS) and forwards any method to any *public* upstream, stripping a
small tested header denylist. It stores nothing, logs no request data (not even
on the error path), and exposes only anonymous Prometheus counters.

The proxy is a man-in-the-middle by construction — a TLS-terminating CORS proxy
necessarily sees the upstream provider key and the request/response bodies in
plaintext. Zero-knowledge is a property of the sync/vault path, **not** the live
inference path. Self-hosting the proxy (AGPLv3) is a first-class path.

## Two ports

| Port | Role |
|---|---|
| `PORT` (default `8080`) | **Public** forward proxy, Traefik-routed. **No reserved paths** — every path is proxied, so an upstream path like `/metrics` reaches the upstream. |
| `OPS_PORT` (default `9090`) | **Internal** ops — `/healthz`, `/readyz`, `/metrics`. **Never** Traefik-routed; mechanical isolation, not a path-exclusion. |

## Request pipeline (public port)

`OPTIONS → CORS preflight` · else, in order: derive the trusted client IP →
per-IP rate limit (pre-auth) → verify the account JWT → per-user rate limit →
per-user concurrency cap → validate the target shape → resolve every A/AAAA
record and block any private/internal range → connect to the pinned IP
(`redirect: 'manual'`) → stream the response back (response denylist + CORS).

## Configuration (env)

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Public forward-proxy port (Traefik-routed) |
| `OPS_PORT` | `9090` | Internal health/metrics port (never Traefik-routed) |
| `REDIS_URL` | — | Rate-limit counters (JWKS is cached in-process by `jose`) |
| `AUTH_JWKS_URL` | — | JWKS endpoint for token verification |
| `JWT_ISSUER` | `chatsundere-auth-v1` | Expected `iss`. `aud` is ignored, so this is the **only** claim binding a token to this domain — must match the auth-service issuer exactly |
| `JWT_AUDIENCE` | `chatsundere-services` | Declared but ignored (variant a) |
| `CORS_ALLOWED_ORIGINS` | `https://app.chatsundere.me` | Comma-separated exact origins (scheme+host+port, lowercased) |
| `TRUST_PROXY_HOPS` | `1` | Trusted front-proxy hops from the right of `X-Forwarded-For` |
| `RATE_LIMIT_USER_PER_MIN` | `120` | Per-user rate limit |
| `RATE_LIMIT_IP_PER_MIN` | `600` | Per-IP rate limit |
| `MAX_BODY_BYTES` | `52428800` | Max request body (50 MiB), enforced on streamed bytes |
| `MAX_CONCURRENT_PER_USER` | `6` | Per-user concurrent connections (in-process, single replica) |
| `PROXY_IDLE_TIMEOUT_S` | `120` | Bun `idleTimeout` (inactivity) |
| `LOG_LEVEL` | `info` | Operational logs only — never request data |

## Wire reference (`curl`)

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
x-cors-proxy-kind: mcp            (optional hint; keeps MCP off the LLM host metric)
Mcp-Session-Id: <unchanged>       MCP-Protocol-Version / Last-Event-ID as needed
```

**Discovery (on the auth-service):**
```
GET https://<backend host>/api/v1/config
200 { "proxyUrl": "https://proxy.chatsundere.me", "features": ["proxy"] }
```

## Run

```bash
cp .env.example .env  # or use scripts/setup-dev.sh from the repository root
pnpm --filter @chatsundere/proxy-service dev
```

## Test

```bash
cd apps/proxy-service && bun test
```

The suite is hermetic except the `target.ts` DNS tests (`resolveAndPin`), which
resolve `example.com`/`localhost` against real DNS.

## Licence

AGPL-3.0-only — see `LICENSE`.
