# Larissa audit — Block 6C blob transport (built diff, PR #7, `8acf1021^1..8acf1021`)

> Audit of the **built** 6C diff after merge to master. Auditor: Larissa
> (Fable-class for this sprint). Scope: full 51-file diff plus surrounding
> implementation (`authenticate.ts`, `verify-token.ts`, `error.ts`, `dek.ts`,
> record-channel limiter usage). Spec v2 and plan loaded; prior deferrals
> checked — no blob-transport deferrals existed, nothing re-reported. The known
> no-Docker/no-MinIO build-host caveat (skipped S3 live legs) is not re-reported.

**Positive assurance first (the load-bearing checks):**

- **Deterministic SIV sealing matches the signed-off spec exactly.**
  `packages/crypto/src/sync-blob/seal.ts:35-56` — dedicated `nonceKey` context
  (`sync/blobs-nonce-v1`) distinct from the encryption context
  (`sync/blobs-v1`), both domain-separated through HKDF info
  `chatsundere-dek-v1::<context>`; the full 32-byte `SHA-256(plaintext)` enters
  the HMAC input; truncation applies to the HMAC output only; the plaintext
  hash is never returned, exported, or emitted. AAD binds
  `chatsundere-blob-v1 || blobId`. Tests cover determinism, divergence per
  id/plaintext/MK, tamper, foreign-id, foreign-MK, truncation, and a whole-wire
  scan for the plaintext hash (`seal.test.ts:119-136`). No nonce-reuse path
  beyond the accepted identical-`(blobId, plaintext)` case.
- **Account scoping is absolute.** Every DB read/write is keyed
  `(accountId = JWT sub, blobId)`; the S3 key embeds the accountId;
  foreign-account GET/DELETE resolve to 404/204-noop, tested
  (`blob-routes.test.ts:322`). Auth (JWT EdDSA-pinned, issuer-checked,
  deny-listed, fail-closed) runs first on all four routes; blob routes ride the
  existing per-IP/per-user/delete-rate windows, with the delete window sharing
  the record channel's `del:<sub>` key (verified against `changes.ts:128`).
- **Ciphertext-blindness holds.** Metrics carry outcome labels only;
  `onSyncError` returns a static body; routes log nothing; S3 creds are
  pino-redacted and the bootstrap-failure log path is scan-tested with
  distinctive markers (`anonymity.test.ts:162-181`).
- **Quota enforcement is genuinely under the lock** (`store.ts:56-90`), with
  existence-before-quota ordering, floor accounting, shared record+blob
  counter, and concurrency tests at store level. SigV4 key derivation verified
  against the AWS published vector.

## Findings

### Medium

**L6C-M1 — Restore runbook omits the sync-service restart after `re-epoch`;
the served epoch goes stale.**
`apps/sync-service/src/index.ts:27` reads `instance_epoch` once at boot into
`deps.epoch` and echoes that cached value forever. `tools/re-epoch.ts` is
explicitly designed to run against the live database, and the restore runbook
(`obsidian/DEPLOYMENT.md:288-291`) says "run re-epoch **or** exclude
`sync_meta`" — neither the runbook nor the tool's output mentions restarting
the sync-service. Failure scenario: operator restores Postgres
(container-level), leaves sync-service running, runs `re-epoch` — the DB now
holds the new epoch but the service keeps echoing the old one, so no client
watermark is invalidated and the silent divergence the epoch exists to prevent
persists indefinitely. This voids the exact promise §17.7 was added to keep.
Fix direction: add "restart the sync-service" as a mandatory runbook step and
print it from `re-epoch.ts` on success (or have the service re-read the epoch
periodically/on SIGHUP).

**L6C-M2 — `commitBlob`'s idempotent branch ignores a hash mismatch, returning
201 for a divergent racer.**
`apps/sync-service/src/blobs/store.ts:66-70`: if a row already exists at
commit time, the function returns `created` without comparing
`ciphertext_hash`, and the route (`routes/blobs.ts:271-281`) answers `201`.
Two concurrent PUTs of the same `blobId` with **different** bodies (both pass
the unlocked step-3 existence check) each stream to the same S3 key; the
loser's body may be what S3 retains while the winner's hash is what the DB
records — and the loser is told `201 created`. Under deterministic sealing a
different hash for the same id means corruption or foreign plaintext, and the
spec's §12 repair contract depends on that client receiving `409 blob_exists`
to trigger the fresh-id repair; a false `201` means the client believes its
(correct) bytes are stored when they are not — silent, self-inflicted data
loss discoverable only at next GET. Confined to the attacker's/victim's own
account, so no cross-account impact. Fix direction: in the `existing` branch,
compare the stored hash with the incoming one; mismatch → surface `blob_exists`
(the route already has the 409 path), match → keep the idempotent success.

**L6C-M3 — MinIO pinned to RELEASE.2024-01-16T16-07-38Z in both compose files,
including the operator-facing prod example.**
`infra/compose.dev.yml` and `infra/compose.prod.yml.example`. That tag is
~2.5 years stale as of 2026-07 and predates multiple published MinIO security
fixes (including signature-validation hardening releases — pertinent, since
the hand-rolled client uses `UNSIGNED-PAYLOAD`). The internal-only network
bounds the exposure, but the prod example is the durable reference third-party
operators will copy verbatim. Fix direction: bump both pins to the current
stable release before the VPS dry-run and note the "keep MinIO current" duty
in DEPLOYMENT ch. 7 (upgrades) alongside the Watchtower scoping.

### Low

**L6C-L1 — `S3_FORCE_PATH_STYLE` is parsed and documented but never consumed.**
`env.ts:73` defines it; nothing reads it — `s3.ts` is hard-wired path-style
(`objectPath` puts the bucket in the path, `signRequest` signs accordingly).
`.env.example` and `DEPLOYMENT.md:183` promise "`false` for AWS virtual-host
style", which the client cannot do. An operator pointing at an S3 host that
requires vhost addressing gets confusing signature failures with a config knob
that lies. Fix direction: either implement vhost addressing behind the flag or
delete the knob and state "path-style only (MinIO, Garage, Hetzner)" honestly
in both docs.

**L6C-L2 — Commit-time `quota_exceeded` drops the constructive payload.**
`routes/blobs.ts:275-278`: the step-6 (enforcing) 507 goes through `fail()`,
which passes no extras, so `usedBytes`/`quotaBytes` are absent — spec §7.5
requires them, and `commitBlob` already returns both values. Only the
pre-check 507 (`:221-230`) carries them. Fix direction: thread
`commit.usedBytes`/`quotaBytes` into the response.

**L6C-L3 (PLAUSIBLE) — A short body (bytes < Content-Length) likely
misclassifies as `503 blob_backend_unavailable` against the real S3 backend.**
`routes/blobs.ts:251-263`: the underrun is detected by `count !== declared`
*after* `putStream` resolves — but the live `HttpS3Backend` signs
`content-length: declared` (`s3.ts:168`), so MinIO will fail/reset the request
when the stream closes early, `fetch` rejects with a
non-`UploadValidationError`, and the route answers 503 + bumps the
backend-error metric for a client lie. The in-memory `FakeBackend` (which just
drains the stream) is what the passing "byte count ≠ Content-Length → 400"
test exercises. Confirm on the VPS dry-run (it is in the owed S3-probe
family); if confirmed, distinguish stream-side errors from transport errors in
the catch.

**L6C-L4 — Bootstrap and liveness treat any HTTP status < 500 as success;
gauge is never updated after boot.**
`s3.ts:284` (bucket PUT: 403 wrong-credentials → "bootstrap complete",
gauge = 1) and `s3.ts:250` (`healthy()`: 403 → healthy). Misconfigured
credentials are only discovered on the first user PUT as an opaque 503, and
`sync_blob_backend_up` stays 1 throughout — spec §8's "S3 liveness becomes a
metric" is only honoured at boot; `healthy()` is currently unwired dead code
(`index.ts` calls only `bootstrapBucket`). Fix direction: treat 401/403 on
bootstrap as a loud constructive error (creds wrong, retry pointless), and
wire `healthy()` to a periodic gauge refresh or flip the gauge on route-level
backend errors/recoveries.

**L6C-L5 — S3 error strings can embed the object key; one future log line away
from an anonymity leak.**
`s3.ts:181` interpolates up to 200 chars of the S3 error body into the thrown
message; MinIO error XML routinely includes `<Key>accountId/blobId</Key>` and
`<Resource>`. Today every consumer swallows these errors silently (verified:
`routes/blobs.ts` catches, `fail()`/DELETE `.catch(() => {})`, `onSyncError`
static), so no live leak — but the invariant is held by omission, not
construction, and the §18 anonymity test only covers the bootstrap path. Fix
direction: strip or whitelist the detail (status + S3 `Code` element only)
before it enters the Error message, and extend the anonymity scan to a failing
object-leg error.

**L6C-L6 — Spec §18 test gaps beyond the owed S3 legs.**
Not implemented anywhere in the suite: (a) DB row present / S3 object missing
→ 404 + inconsistency counter increments (only the metric's *name* is
asserted, `ops.test.ts:48`); (b) DB-first delete order under a *failing* S3
delete (`FakeBackend.delete` never fails); (c) two concurrent PUTs of one
`blobId` at route level (store-level lock is tested, the route race of L6C-M2
is not); (d) the stalled-body idle timeout (watchdog code is untested). Fix
direction: add (a)–(c) against the fake backend now — they need no MinIO; (d)
can ride the VPS dry-run.

### Info

- **`sub` is only type-checked as a string** (`verify-token.ts:42`) before
  becoming an S3 key prefix and a DB uuid parameter. Trusted issuer + the uuid
  column failing closed make this safe today; a one-line shape check would
  make it safe by construction.
- **Unencrypted internal hop accepted:** `http://minio:9000` +
  `UNSIGNED-PAYLOAD` means the service→S3 hop has no transport
  confidentiality/integrity; on the compose-internal network this is the
  accepted §6 posture, and end-to-end integrity is carried by the ciphertext
  hash + client GCM. DEPLOYMENT could add one line: a *remote* `S3_ENDPOINT`
  must be `https://`.
- **Doc drift:** `probes/README-blobs.md:70-83` still records "use
  Bun.S3Client" and a defensive multipart lifecycle rule as the carried
  decisions; the implementation deviated to the hand-rolled single-shot client
  (`s3.ts:6-15` claims the deviation is recorded in that README — it is not).
  Update the README before the dry-run so the owed probes test the right
  client.
- **GET `Content-Length` trusts the S3 header** (`s3.ts:206`, `?? '0'`) rather
  than the authoritative `row.bytes`; a missing header would advertise a
  zero-length body. Using `row.bytes` is strictly better.
- **Bounded amplification:** a PUT against a dead backend costs one connect
  attempt plus three retried DELETE attempts (~700 ms of backoff) inside the
  request; rate limits bound it.
- **Watchdog misattribution:** the idle timer measures inter-pull gaps, so a
  stalled S3 *consumer* can 400 an innocent client. Cosmetic; the 503-vs-400
  split of L6C-L3 would tidy this too.
- **`seal-cli` takes the MK on argv** (visible in `ps`/shell history).
  Acceptable for the dry-run's throwaway MK; never document it with a real
  account MK.

## Verdict

No Critical or High findings. The zero-knowledge invariants —
sealed-before-wire, no plaintext hash on the wire, absolute account scoping,
label-free metrics, credential redaction — are implemented and tested as
specified.

**Clear after fixes: L6C-M1, L6C-M2, L6C-M3.** M1 is a runbook line plus a CLI
hint, M2 a three-line store change plus one test, M3 a tag bump — all cheap,
all pre-dry-run. The Low findings may be fixed opportunistically or deferred
to `security-deferrals.md` with rationale; L6C-L3 should be explicitly added
to the owed VPS probe list either way.
