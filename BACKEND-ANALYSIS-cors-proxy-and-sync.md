# Backend Analysis — Authenticated CORS Proxy & Client Sync

> **Status:** analysis / planning input, not a brief or ADR yet.
> **Author:** Liz (Claude Code), 2026-06-30, from a brainstorm with Chris.
> **Scope:** Block 6 of the roadmap (→ v0.3.0). The two server-coupled
> workstreams that turn Chatsundere from a local-first client into a
> zero-knowledge, cross-device platform: (1) a real authenticated CORS
> proxy, and (2) encrypted client sync.
> **Language note:** written in British English per CLAUDE.md §3.7. It lives
> at repo root only because Chris asked for it there for visibility; by §6 a
> settled version belongs under `obsidian/briefs/` or `superpowers/specs/`,
> and should migrate there once we cut the real briefs.

---

## 0. Where we actually are (verified, not assumed)

Before any design, the ground truth from reading the code:

### 0.1 Auth-service — built and audited, the foundation both workstreams stand on
- OPAQUE register/login, passkey + PRF, recovery key, JWT refresh, step-up,
  pairing codes, unified `POST /api/v1/join/{start,finish}`. Larissa-approved
  across three squashes (α/β/γ).
- **Access tokens are EdDSA (Ed25519) signed**, claims: `sub`=userId,
  `role`, `jti`=sessionId, `iss`=`chatsundere-auth-v1`,
  `aud`=`${API_BASE_URL}/v1`, short TTL. **A JWKS endpoint already exists at
  `GET /api/v1/jwks`** (`apps/auth-service/src/routes/jwks.ts`). This is the
  single most important enabling fact for the proxy: any other service can
  verify a token independently via the public key, no shared secret.

### 0.2 proxy-service & sync-service — Phase-0 skeletons only
- Both are ~133 LOC: `/healthz`, `/readyz`, `/metrics`, a Valibot env schema,
  a pino logger. **No routes, no auth, no CORS logic, no storage.**
- `proxy-service/.env.example` already declares `JWT_ISSUER`, `JWT_AUDIENCE`,
  `AUTH_JWKS_URL` — wired for exactly the resource-server pattern below, but
  unused today.
- `sync-service/.env.example` declares `DATABASE_URL`, `REDIS_URL`, and
  commented `S3_*` placeholders for "Phase 1 — encrypted vault storage".

### 0.3 The proxy the client uses *today* is a transitional shared-key relay
- Hardwired to `cors-proxy.tidesson.net` (Chris's VPS), overridable via
  `VITE_PROXY_URL`. **Not** the `proxy-service` in this repo.
- The client sends two headers on every proxied call
  (`packages/llm-unified/src/transport.ts`, `apps/user-client/src/mcp/mcp-client.ts`):
  - `x-cors-proxy-api-key: <shared key>` — one key Chris shares on Discord.
  - `x-cors-proxy-target: <upstream origin>` — e.g. `https://api.x.ai`.
  - The upstream provider key rides separately in `Authorization: Bearer …`.
- The shared key is sealed at rest under the MK
  (`sealSecret(key, mk, 'cors-proxy/shared-key')`) and opened per request.
- **Both LLM calls and MCP calls already go through this path.** Routing is
  decided by `provider.corsHint === 'requires-proxy'` (LLM) and
  `buildCandidates(url, hasProxy, allowDirect)` (MCP, direct-first fallback).

**Takeaway:** the wire shape (`x-cors-proxy-*` headers + target-rewrite) is
proven and used in production for both LLM and MCP. The work is to (a) stand up
*our own* proxy-service behind it, and (b) replace the static shared key with
account-bound authorisation. That is a deliberately small, high-value first step.

### 0.4 Crypto — everything sync needs already exists
- Root key **MK** (32 B, random, in-memory only, never rotates). Wrapped under
  four AMK paths (local/recovery/OPAQUE/PRF), AES-256-GCM + HMAC integrity tag,
  scope-bound AAD.
- **`deriveDek(mk, context)` → HKDF-SHA256 per-context DEK** — the exact
  primitive sync needs to key encrypted records by collection.
- **`sealSecret`/`openSecret(blob, mk, slotId)`** — a per-record AEAD helper with
  the `slotId` bound as AAD (anti-swap). Already the pattern for provider keys,
  the proxy key, MCP auth. Sync is "this, applied to every row".
- Device pairing already transfers the *same* MK to a new device
  (`join-by-pairing.ts`), and `link-to-server.ts` exists (relevant to uplevelling, §4).
- A standing `TODO(phase-1)` in `join-by-pairing.ts` already flags the
  "device has pre-existing local data" merge problem and points at ADR 0025.

### 0.5 Client data model — 17 Dexie tables at v30, all uuidv7
- `chatsundere_client_data` v30: settings, providers, mcpServers, mindspaces,
  personas, chats, messages, pills, personaAvatars, attachments, artefacts,
  libraries, documents, memoryJournal, memoryBody, compactionCheckpoints,
  voiceAudio. Plus a separate `chatsundere-knowledge-vectors` DB.
- **Every primary key is uuidv7** (time-ordered → free chronological sort,
  offline-mintable, ADR 0025's "same UUID = same entity" merge rule applies
  across the board).
- Timestamps everywhere (`createdAt`/`updatedAt`/`lastMessageAt`/
  `lastInteractionAt`), in unix-ms.
- "Defaults over delete" is already partly realised: `attachment.state`
  `'active'|'deleted'`, memory journal `archivedByDreamId`. No hard tombstone
  table yet.
- **Already marked device-local, must never sync:** `settings.adultMode`
  (explicit comment), the localStorage lazy-chat drafts, and the `voiceAudio`
  LRU cache (transient, rebuildable).

### 0.6 Prior decisions that are *locked* and constrain everything below
- **Zero-knowledge is non-negotiable** (CLAUDE.md §3.1). The server stores
  ciphertext and proofs; it can never decrypt, never derive keys, never do
  plaintext work. Every merge/extraction/consolidation is client-side, always.
- **UUIDv7 merge semantics** (ADR 0025): same UUID = apply update; same name,
  different UUID = two entities, both kept, user resolves. No merge-by-name.
- **Single-server-per-account** (ADR 0024) + **pre-disconnect-sync-pull
  auto-handover** with three explicit failure modes (ADR 0026). Briefed,
  unimplemented.
- **Memory is sync-shaped already** (ADR 0031): append-only journal = source of
  truth, memory body = re-dreamable projection. Conflict resolution = journal
  set-union then re-dream, never body-merge.
- **Step-up tiers** (ADR 0027): destructive/sensitive ops gate on a fresh
  WebAuthn/OPAQUE proof with Redis grace windows.

**Two terms in Chris's brief are *not* in the vault** (`uplevelling`,
`plausible deniability`) — both are addressed below as new, named requirements
(§3.6, §4), with my interpretation flagged for confirmation.

---

## 1. Workstream A — Authenticated CORS Proxy (do this first)

**Why first** (Chris's call, and I agree): it is the smaller surface, it
delivers value the moment it ships (every proxy-gated provider + most MCP
servers work without Chris hand-sharing a key), and — crucially — **it is the
first time the auth-service JWT is consumed by a second service in a
resource-server role.** We get to see the whole authentication story work
end-to-end against a service far simpler than sync. It introduces *no new
crypto*, so it is not on the zero-knowledge critical path.

### 1.1 The authorisation model: JWT as a resource server
The proxy becomes a **resource server in the auth domain**. It does not issue or
store credentials. On each request it:

1. Reads the account access token from a dedicated header (see 1.2).
2. Verifies the EdDSA signature against the auth-service JWKS
   (`createRemoteJWKSet(AUTH_JWKS_URL)`, cached/rotated by `jose`).
3. Checks `iss` and `exp` (and optionally `jti`-revocation, see 1.6).
4. If valid → the account exists and is active → forward. If not → `401`.

This is precisely what the dormant `AUTH_JWKS_URL`/`JWT_ISSUER`/`JWT_AUDIENCE`
env vars were placed for. **One integration decision to make:** the access
token's `aud` is currently `${API_BASE_URL}/v1` (the auth API itself), not the
proxy. Options, easiest first:
- **(a)** Proxy validates `iss` + signature + `exp` and treats *any* valid
  auth-domain access token as authorisation, ignoring `aud`. Simplest; fine for
  a single-tenant deployment. **Recommended for v1.**
- **(b)** auth-service issues an `aud` *array* that includes a
  `chatsundere-proxy` audience. Cleaner multi-service hygiene; a tiny
  auth-service change.
- **(c)** A token-exchange endpoint. Overkill now.

### 1.2 Header shape — keep the proven wire, swap the credential
The provider/MCP upstream owns `Authorization: Bearer …`, so the *account*
credential must live in its own header. We already have that slot:
`x-cors-proxy-api-key`. The minimal, backward-compatible change is to let that
header carry **a bearer access token** rather than a static shared key. Concretely:

```
POST https://proxy.chatsundere.me/v1/chat/completions
x-cors-proxy-authorization: Bearer <account access JWT>   # NEW: account-bound
x-cors-proxy-target: https://api.x.ai                     # unchanged
Authorization: Bearer <upstream provider key>             # unchanged, forwarded
…provider request body…
```

The proxy **consumes and strips** `x-cors-proxy-authorization` and
`x-cors-proxy-target`, forwards everything else verbatim, and streams the
response back with permissive CORS headers. Client change is ~10 lines in
`transport.ts` + `mcp-client.ts`: when the account is linked and online, attach
the in-memory access token instead of the sealed shared key.

### 1.3 The central security truth: the proxy is **not** zero-knowledge
This must be stated loudly, because Larissa will (correctly) make it the
headline finding. **A CORS proxy is a TLS-terminating man-in-the-middle by
construction.** It necessarily sees, in plaintext:
- the upstream provider API key (`Authorization` header it forwards),
- the full LLM request body — i.e. **the conversation** — and the response.

So the proxy operator (Chris, today) can in principle read chat content and
provider keys. This is already true of the `tidesson.net` relay; making the
proxy account-authenticated does not change it. The zero-knowledge guarantee is
about the **sync/vault** path, not the **live inference** path — these are
different trust domains and we must say so in the user-facing copy.

**Mitigations (design requirements, not nice-to-haves):**
- **No body logging, ever.** Never log request/response bodies.
- **Header redaction at source** — the denylist already exists in
  `transport.ts` (`authorization`, `x-api-key`, `x-cors-proxy-*`, …); the proxy
  must apply the same on its own logs.
- TLS end-to-end; no on-disk buffering of bodies; minimal retention of metadata.
- **Honest UX:** the proxy block should say, in plain language, "requests routed
  through this proxy are visible to its operator; CORS-friendly providers go
  direct; self-host the proxy if you don't want to trust ours." This aligns with
  the existing direct-vs-proxy MCP toggle.
- Long term: users who want zero operator trust use direct providers or run the
  open-source proxy themselves (AGPLv3 makes this a first-class path).

### 1.4 SSRF is the other critical control
A proxy that forwards to an arbitrary `x-cors-proxy-target` is an open SSRF
relay. Authentication limits *who* can abuse it, not *what* they can reach.
Required:
- **Block private/internal ranges** on the resolved target IP: RFC1918,
  loopback, link-local, ULA, and the cloud metadata address `169.254.169.254`.
  Resolve-then-connect with the same IP (guard against DNS-rebinding).
- **LLM targets**: allowlist the known provider origins we ship
  (`packages/llm-unified` already enumerates them via `corsHint`).
- **MCP targets**: user-supplied and arbitrary by nature, so an allowlist is
  impractical. Authenticated public-internet egress with the private-range block
  is the pragmatic boundary, plus per-user rate limits. Note this asymmetry in
  the brief; Larissa will want it explicit.

### 1.5 Streaming, CORS, MCP specifics
- **Streaming passthrough, unbuffered.** Both LLM SSE and MCP `text/event-stream`
  must flow chunk-by-chunk (Hono on Bun via a `ReadableStream` response). The
  model-debugger work already taught us gzip-buffering is observable — preserve
  `content-type`/`content-encoding` and don't re-buffer.
- **CORS preflight**: handle `OPTIONS` with permissive `Access-Control-Allow-*`
  for the app origin(s); echo the requested headers. This is the whole point of
  the service — most MCP servers send no CORS headers.
- **MCP session header**: pass `Mcp-Session-Id` through untouched (the client
  already sets it).

### 1.6 Rate limits, metrics, abuse — now that we have identity
- Per-user (keyed on `sub`/`jti`) and per-IP rate limits in Redis (already in the
  stack). This is the upgrade identity buys us over the shared key.
- Optional `jti` revocation check against the auth-service logout cascade (the
  Redis `step_up:`/session keys already exist) so a logged-out session can't keep
  proxying. Start without it (token TTL is short); add if needed.
- Prometheus from day one (§3.6): `proxy_requests_total{kind=llm|mcp, outcome}`,
  upstream latency, per-tier counts, SSRF-block counter, `401` counter.

### 1.7 Transition: shared key vs account token coexisting
During the alpha, **most users are still local-only with no account** (the
backend is brand new in Block 6). So for a while the proxy should accept **both**:
- a static **shared key** (admin-configured) for the existing local-only cohort,
  and
- **account access tokens** for linked users (the future).

A config flag picks which modes are enabled. The client already stores
`settings.corsProxy`; for linked users the URL is fixed and auth becomes
automatic (no user-entered key), so `CorsProxyBlock` collapses to "active because
you're connected to a server". Retire the shared-key mode once the account cohort
dominates.

### 1.8 Dependencies / open points for Workstream A
- Confirm the `aud` decision (1.1) — recommend (a) for v1.
- Decide proxy hostname / deployment (its own Traefik route; reuse the alpha
  compose pattern).
- Decide whether MCP arbitrary-egress with private-range-block is acceptable for
  v1 (recommend yes, documented).

---

## 2. Workstream B — Client Sync (the big one)

The goal Chris set: **1:1 device equivalence** — a user is "themselves
everywhere", device loss is not data loss — while the server stays
zero-knowledge, and with *plausible deniability* extended to metadata (persona
names, chat titles, **timestamps**, library/document names, settings).

### 2.1 The shape of the system, in one paragraph
Every privacy-critical Dexie row becomes **one AEAD-encrypted record**, keyed on
the server by a **blind index** (so the server can address it without learning
its uuidv7 or its creation time). The server is a dumb **per-account oplog**: it
assigns a monotonic `rev` to each write and lets clients pull "everything since
my last `rev`". All conflict resolution, all plaintext, stays on unlocked
clients. Most mutations are write-through when online; only **appending new chat
messages** is allowed offline, because appends are conflict-free by construction.

### 2.2 The record envelope and the blind index (this is where plausible deniability lives)
Per-record full-row encryption, one blob per Dexie row:

```
ciphertext = AES-256-GCM( key = deriveDek(mk, "sync/<collection>"),
                          plaintext = serialise(row),   # incl. uuid, all timestamps, all names
                          aad = blindId )
```

Server-visible record:
```
{ account_id,                # from the JWT
  blind_id,                  # HMAC-SHA256(deriveDek(mk,"sync/blind-index-v1"), collection || uuid)[:16]
  collection,                # cleartext tag (see leakage note) — or itself blinded
  rev,                       # server-assigned monotonic u64, per account
  base_rev,                  # the rev this write was based on (optimistic concurrency)
  deleted,                   # tombstone flag (soft delete; "defaults over delete")
  blob_hash,                 # for handover sync-down completeness verification (ADR 0026)
  nonce, ciphertext }
```

Why a **blind index** rather than the raw uuidv7 as the server key: **uuidv7
embeds a 48-bit millisecond creation timestamp.** Using it as the server-visible
key would leak the creation time of every persona, chat and message — directly
violating the plausible-deniability ask. The blind index is a deterministic
HMAC, so:
- same entity → same `blind_id` on every device (idempotent upserts, dedup, the
  ADR 0025 merge rule still holds), and
- the server learns no timestamp and no real id, only an opaque 128-bit token.

All parent/child pointers (`chatId` on a message, `personaId` on a chat) live
**inside** the ciphertext, so the server never reconstructs the graph.

### 2.3 What the server can still infer (the leakage budget)
Be honest in the brief. With the above the server still learns:
- that an account exists and roughly **how many** records and of what
  **collection** it has (volume per type), and their **sizes**,
- the **server-receipt order** (`rev`) — *not* the user's content timestamps,
- which records were **deleted**.

Mitigations, all deferrable hardening (note, don't necessarily build for v1):
- **Blind the `collection` too** (HMAC it) if per-type volume is sensitive —
  costs a server-side "I don't know what these are" model, slightly more client
  bookkeeping.
- **Size padding** (pad blobs to buckets) to blunt the 2-message-vs-200-message
  chat inference. Per-record granularity already helps (each message ≈ its own
  similar-sized blob).
- Record-count cover traffic — almost certainly not worth it.

### 2.4 The two write classes — the core simplification
This is the spine of the design and it maps exactly onto what Chris described.

**Class 1 — append-only, offline-capable (conflict-free):**
- new chat **messages** (`messages` rows, immutable once `streamingState:complete`),
- new **memoryJournal** entries from extraction (append-only facts).

These go to a local **outbox** and push opportunistically. Two devices appending
concurrently never conflict — it's a set-union by uuid. **This is the only thing
that works with the backend offline.** Reconciliation = "drain my outbox, then
pull everyone else's appends".

**Class 2 — mutating, online-required:**
- any **edit/delete** of an existing record: chat titles, persona fields,
  settings, knowledge libraries/documents, bindings, message edits, the planned
  context-edits,
- memory **state transitions** (auto-commit, dream/archive) and **memory body**
  creation.

These are **gated on connectivity** — disabled-with-reason when offline, per the
"disabled over hidden" UX principle — and pushed **write-through** with
optimistic concurrency (`base_rev`). This is the "save as a transaction through
the backend" Chris wants: the server is the ordering authority; a Class-2 write
is only *settled* when the server acks the new `rev`. On a `409` (someone moved
the record), reconcile (§2.6).

This split is what makes sync tractable: **the only offline mutation is an
append, and appends can't conflict.** Edits — the things that genuinely
conflict — simply require the backend, which Chris already accepted ("editieren
von messages nur wenn Backend erreichbar"). Memory's background mutations defer
to connectivity too, which is fine: consolidation can wait.

### 2.5 The protocol (incremental, watermark-based)
Following the auth-service two-round house style only where it must; sync is
naturally a long-poll oplog:

- **Pull:** `GET /api/v1/sync/changes?since=<rev>&limit=N` → records with
  `rev > since`, ascending. Client decrypts, upserts local row by the uuid inside
  the blob (or tombstones), advances its high-water `rev`.
- **Push:** `POST /api/v1/sync/changes` with a batch of
  `{ blind_id, collection, base_rev, deleted, nonce, ciphertext, blob_hash }`.
  Per record: if server's current `rev` ≠ `base_rev` → **conflict**, return the
  current record so the client can resolve; else assign a fresh `rev`, store,
  return it. Response carries the new high-water mark.
- **Live updates** (a device sees another device's change promptly): out of scope
  for v1 — periodic pull + pull-on-foreground is enough. A Redis pub/sub +
  WebSocket "poke" is a clean later addition (and the step-up brief already
  imagined WebSocket infra as Phase 1+).

### 2.6 Conflict resolution (always client-side)
- **Append collections** (messages, journal): set-union, no conflict possible.
- **Default for everything else: LWW** on the *content* `updatedAt` decrypted
  from the blob (tie-break by uuid). Because Class-2 edits are online
  write-through, genuine concurrent edits are rare; LWW is sufficient and
  predictable.
- **Memory body:** never LWW-merged. On divergence, discard the losing body and
  **re-dream from the set-unioned journal** (ADR 0031). The journal is the truth;
  the body is a projection.
- **Deletes:** tombstone wins over a concurrent edit by default (deleting is the
  more deliberate act), unless the edit is strictly newer — a per-collection call
  to settle in the brief.

### 2.7 Blobs — avatars, artefacts, images (deferrable, as Chris asked)
- Large binaries (`personaAvatars.blob`, `artefacts.blob`/`thumbBlob`,
  `attachments.blob`) are **encrypted client-side** and uploaded as **separate
  objects** to an object store (the `S3_*` placeholders in
  `sync-service/.env.example` are already there for this). The metadata record
  references the blob by **content hash**; the binary follows on a **deferred
  queue**.
- So: the persona/artefact **record** syncs immediately (small); the **image**
  catches up when the backend/upload is available. A device that pulls a record
  whose blob isn't local yet shows a placeholder until fetched. This is exactly
  the "artefacts/images deferrable if backend down" behaviour.
- **`voiceAudio` does not sync** — transient LRU, rebuilt on demand.

### 2.8 The client sync engine (new local infrastructure)
- New Dexie tables (a v31 migration): **`syncOutbox`** (pending pushes, with
  `base_rev` and a content snapshot) and a **`syncState`** singleton
  (high-water `rev`, per-collection cursors, last-sync time).
- A **single-flight sync worker** (Web Locks, like the memory pipeline's existing
  guard) that, whenever the session is unlocked and the backend reachable:
  drains the outbox (push), then pulls and applies. Mutations enqueue to the
  outbox in the same Dexie transaction as the local write, so a write is never
  lost if the app closes before push.
- Reuses the **integrity-before-decrypt** invariant from `packages/crypto` on
  every pulled blob.

### 2.9 Encryption granularity — settling memory-analysis P10
The 2026-06-01 memory analysis flagged a "genuine fork": seal each tiny journal
entry vs seal the whole per-persona memory as one document. **Recommendation:
per-record** (per journal entry, per message, per row), because it is what makes
incremental sync and set-union merge work, and because the only moment we pay the
"many decrypts" cost is **new-device onboarding / handover sync-down** — a
one-off, batchable, progress-barred operation. Steady state is incremental and
cheap.

### 2.10 What syncs, what doesn't (the inventory, decided)
**Encrypt + sync (per-record):** settings (minus device-local fields), providers
(displayName; apiKey already sealed), mcpServers (name/url; auth already sealed),
user mindspaces, personas (+ avatar blob), chats (title, draftInput), messages,
pills, artefacts (+ blobs), attachments (+ blobs), libraries, documents, the
knowledge **vectors** (the embedding is opaque, but its `tags` carry
document/library ids → encrypt), memoryJournal, memoryBody, compactionCheckpoints
(the summary is conversation-derived → privacy-critical → sync, so a switched
device keeps its compacted context).

**Never sync (device-local):** `settings.adultMode`, the localStorage lazy-chat
drafts, `voiceAudio`. (Vectors *may* alternatively be **re-embedded** per device
instead of synced — cheaper bytes, more CPU; the transfer feature already has a
`resolveVectorStrategy` precedent. Settle in the brief.)

---

## 3. Does the planned set of functions already cover real multi-device life?

Chris asked specifically: with what we have planned, can we model the usual
multi-device interactions — **including "user no longer has the device"**? Here
is the honest matrix.

| Scenario | Covered by | Status |
|---|---|---|
| **Add a 2nd device, still have the 1st** | Pairing code → `join finish kind=pairing` transfers the same MK; then full sync-down | Auth **done**; needs sync engine |
| **Two devices used concurrently** | Incremental pull + LWW/append-union | Needs sync engine; live "poke" deferred |
| **Switch primary device / move server** | Auto-handover, pre-disconnect-sync-pull, 3 failure modes (ADR 0024/0026) | **Briefed, unimplemented**; needs sync engine + client state machine |
| **Re-install on same device** | Log in (OPAQUE/passkey) → unwrap MK from server → full sync-down | Auth **done**; needs sync engine |
| **Lost device, user knows passphrase (or has another paired device)** | New device: OPAQUE login → server hands back OPAQUE-wrapped MK → unwrap → sync-down. **Device loss ≠ data loss.** | Auth **done**; needs sync engine. *This is the headline value of the backend.* |
| **Lost device, passphrase forgotten, has recovery key** | Recovery flow (ADR 0007) → unwrap MK via recovery AMK → sync-down | Auth **done**; needs sync engine |
| **Lost device, passphrase AND recovery key lost** | Nothing — **by design** (ADR 0007, "no-recovery is a feature"). Server is zero-knowledge; it *cannot* help. | Correct & intended; document plainly |

### 3.1 The genuine gap this surfaces: **revoking a lost device**
Logging in elsewhere restores your data, but it does **not** stop the *lost*
device from continuing to sync/decrypt, because:
- the lost device still holds a locally-wrapped MK it can unlock with its own
  biometric/passphrase, and
- there is today **no "Devices / active sessions" surface** to revoke a specific
  device's refresh token or remove its passkey from another device.

What we can and cannot do (be honest):
- **Can:** revoke the lost device's **refresh token** (it already lives in
  Postgres, hashed, with a `familyId`; logout cascade exists) → it loses *server*
  access, so it stops pulling new data and can't push. And remove its passkey
  credential server-side.
- **Cannot:** remote-wipe a PWA. Data already on the lost device stays there.
  MK never rotates, so we can't cryptographically orphan it from already-synced
  blobs it has cached. This is an inherent local-first limitation — state it.

**Recommendation:** add a **device/session management surface** (list active
sessions/refresh-token families with last-seen + user-agent, "sign out this
device", gated at step-up Tier 3). This is *new* work not in any current brief
and it's the main thing missing for a complete "lost device" story. It also
pairs naturally with the proxy's `jti`-revocation (§1.6).

---

## 4. The open topic: "uplevelling"

The term isn't in the vault, so I'm naming what I believe Chris means and
flagging it for confirmation. **My reading: "uplevelling" = promoting an existing
local-only (standalone) account into a server-linked, synced account — carrying
all the data it already has up into the encrypted backend.** This is the natural
seam now that the backend arrives *after* a whole population of local-only alpha
users already exist.

Two cases, very different difficulty:

### 4.1 The clean case — a local-only user creates *their own* account
The local account already has a locally-generated MK and a full dataset encrypted
under it. `link-to-server.ts` already exists to wrap the **existing** MK under
OPAQUE and register it (no new MK, so existing local ciphertext stays valid).
Uplevelling = **link-to-server + an initial full sync-up** (push every local row
through the new sync engine). Clean, and it reuses everything in §2.

### 4.2 The hard case — joining an account that already has data under a *different* MK
The `TODO(phase-1)` in `join-by-pairing.ts` is exactly this: a device with local
data A joins (via pairing) an account whose server data B is under a **different
MK**. You cannot decrypt B with A's MK. Phase-0 behaviour is "replace local —
accepted data loss for an audience of two". The graceful path now exists for
free: **the native transfer feature** (export `chatsundere/persona` +
`chatsundere/knowledge` packs, just shipped) is the bridge — *export A locally →
join the account → import A as fresh entities under the account MK*. New uuids,
no MK conflict, ADR 0025 keeps both. Recommend wiring uplevelling to offer
export-first when it detects pre-existing local data under a foreign MK.

### 4.3 Confirm with Chris
- Is my reading of "uplevelling" right (local-only → linked promotion)?
- For 4.2, is "export-then-import on join" the intended graceful path, or do you
  want a deeper automatic adoption (much harder; needs dual-MK decrypt + re-seal)?

---

## 5. Recommended sequence

Ordered for value-early and risk-down. Each server-touching step is Larissa-gated
(auth/sync/proxy/crypto paths per §9), and the backend gets a full re-audit before
v0.3.0 (ADR 0031).

1. **A — Authenticated CORS proxy** *(first, per Chris)*
   - Stand up `proxy-service`: JWKS verification, header swap (§1.2),
     streaming+CORS passthrough, SSRF/private-range block, per-user rate limits,
     metrics. LLM + MCP. Coexisting shared-key + token modes (§1.7).
   - Client: attach the account token when linked+online; honest proxy-trust copy.
   - **Settle first:** the `aud` decision (§1.1a). **Prereq met:** JWKS exists.
   - *Value:* proves the auth integration in production, immediate utility.

2. **B — Sync foundations** *(no user-visible feature yet)*
   - Lock the record envelope, blind-index derivation, the oplog schema, and the
     `shared-types` wire types. Stand up `sync-service` storage (Postgres oplog +
     object store for blobs). Add client `syncOutbox`/`syncState` (Dexie v31).
   - Write the **two real briefs** this document feeds (a sync brief + a proxy
     brief) and the ADRs the open questions below demand.

3. **C — Sync engine v1 (text/records)**
   - Write-through Class-2 + offline-append Class-1 + incremental pull, for:
     settings, personas, chats, messages, knowledge, memory (journal set-union +
     body re-dream). UI connectivity-gating for edits ("disabled over hidden").
   - First real "log in on a new device, your data appears" moment.

4. **D — Blobs**
   - Deferred encrypted blob upload/download (avatars, artefacts, images) on the
     object store. Placeholder-until-fetched.

5. **E — Account & device lifecycle**
   - Auto-handover state machine (ADR 0026, briefed). `DELETE /api/v1/me/account`
     partial-upload cleanup. **Device/session management surface** (§3.1).
     Uplevelling flow (§4).

6. **Re-audit + v0.3.0.**

### Open questions to settle in the briefs (consolidated)
- **Proxy:** `aud` strategy (1.1); MCP arbitrary-egress acceptance (1.4);
  shared-key sunset timing (1.7); `jti`-revocation now or later (1.6).
- **Sync:** blind the `collection` tag or not (2.3); size-padding for v1 or defer
  (2.3); per-collection delete-vs-edit precedence (2.6); vectors **synced** vs
  **re-embedded per device** (2.10); live-update "poke" in scope or deferred
  (2.5).
- **Lifecycle:** confirm "uplevelling" meaning + the export-on-join path (§4);
  scope of the device-management surface (§3.1).

---

## 6. The one-line summary for the STATUS file
Proxy-service and sync-service are still Phase-0 skeletons, but the hard parts
they depend on are done: EdDSA JWT + JWKS (proxy can authorise) and the full
client crypto + uuidv7 data model (sync can encrypt per-record). Do the **proxy
first** (small, proves auth end-to-end, not zero-knowledge-critical), then build
sync as a **blind-indexed per-account oplog** with **only appends allowed
offline** and everything else **write-through when connected** — which is exactly
the behaviour Chris described, and which keeps the server zero-knowledge while
giving plausible deniability over names and timestamps.
