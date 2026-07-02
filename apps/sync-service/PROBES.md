# sync-service probes (plan Task 1)

Empirical runtime checks run before the tasks were locked (spec §20). Bun
`1.3.11`, Postgres 16, Redis 7, run 2026-07-01.

## Probe A — Bun.serve + WebSocket + Hono composition — PASS

`probes/ws-idle.ts`. A `Bun.serve({ fetch(req, server) { … server.upgrade(req, …) … return app.fetch(req) }, websocket })`
wrapper composes cleanly with a plain Hono `app`:

```
Probe A — Hono route on non-/ws: hono-ok
Probe A — first WS frame: hello
```

**Decision:** the wrapper-in-`fetch` pattern is the canonical composition for
Tasks 13/14 (doorbell upgrade behind the ticket check, everything else → Hono).

## Probe B — Bun WS idleTimeout maximum — 255 s (NOT 960)

```
Probe B — accepted idleTimeout=120
Probe B — accepted idleTimeout=255
Probe B — REJECTED idleTimeout=480: Bun.serve expects idleTimeout to be 255 or less
Probe B — REJECTED idleTimeout=960: Bun.serve expects idleTimeout to be 255 or less
Probe B — REJECTED idleTimeout=1200: Bun.serve expects idleTimeout to be 255 or less
```

The spec §14 default of `960` is **rejected** by this Bun version — the hard
maximum is **255 s**.

**Decision (matrix branch "max lower than 960 but > 60"):** `WS_IDLE_TIMEOUT_S`
default = **255**. Liveness is carried by the hub's `ws.ping()` every
`WS_PING_INTERVAL_S` (30 s), which resets the idle timer well within the 255 s
window; the socket is force-closed at token expiry (≤ 15 min) by the hub's own
timer regardless of the socket idle timeout. The staleness bound is therefore
the ping interval, not the idle timeout.

## Probe C — Drizzle + postgres-js bytea (2 MiB) + FOR UPDATE — PASS

```
Probe C — bytea 2 MiB round-trip byte-identical: true (type: Uint8Array)
Probe C — FOR UPDATE serialised (2nd acquired after 1st released): true
```

**Decision:** Task 7 proceeds as written — the auth-service `bytea` customType
(`toDriver: Buffer.from`, `fromDriver: new Uint8Array`) round-trips a 2 MiB
payload byte-identically, and `SELECT … FOR UPDATE` inside `db.transaction`
serialises two connections. No `fromDriver` adjustment needed.

## Probes D–G — deferred to their durable test forms

- **D (batch transaction latency)** — informational; observed within the Task 10
  store integration tests (100-record in-order batch), no decision gate.
- **E (ioredis subscriber churn)** — exercised durably by the Task 13 doorbell
  test (dynamic SUBSCRIBE/UNSUBSCRIBE, per-channel delivery isolation).
- **F (24 MiB JSON body)** — exercised durably by the Task 11 push route test
  (`bodyLimit` → `413` over `MAX_BODY_BYTES`).
- **G (WebCrypto parity)** — the Task 5 seal/open tests ARE the durable form;
  they run the exact HMAC-SHA256 / AES-GCM-with-AAD / SHA-256 call shapes under
  `bun test`, and the same vectors run under Node in the crypto vitest layout.

## Deferred to manual (Chris, on the VPS)

- **Traefik WSS idle behaviour** (spec §20.3) — a 14-minute quiet `wscat`
  through the real Traefik front with 30 s pings. Cannot run headless; listed in
  the spec §18 manual verification.
