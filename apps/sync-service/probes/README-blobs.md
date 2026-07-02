# Blob-transport probes — results & decision record (spec §21)

Run date: 2026-07-02, on the headless implementation host for `feat/backend-03-blobs`
(branch `claude/blob-transport-impl-xtpius`).

## Environment caveat — read first

This host has **no Docker daemon and no MinIO binary**, and the MinIO release
download is blocked by the outbound proxy (HTTP 403). The S3-dependent probes
(1, 3, 5) therefore **could not be run against a live object store**. They are
written to run and skip loudly (`S3_TEST_ENDPOINT` unset), so Chris — or any
operator with MinIO — can execute them unchanged:

```
docker run --rm -p 9000:9000 minio/minio server /data   # or a MinIO binary
S3_TEST_ENDPOINT=http://localhost:9000 bun probes/s3-client.ts
```

The decisions below that depend on the S3 legs are marked **OWED** and were
made conservatively so that a later empirical result can only *relax* them, not
force a rewrite. This is the spec §10 deviation rule applied honestly:
the contradiction (probe infra unavailable) is recorded here, the smallest
spec-consistent resolution chosen, and the flag carried into the hand-off.

## Probe 6 — WebCrypto AES-256-GCM single-shot at 32 MiB (RAN)

| metric | value |
|---|---|
| seal (encrypt) | 80 ms |
| open (decrypt) | 41 ms |
| round-trip correct | yes |
| RSS before / after | 32.5 → 192.9 MiB (includes the 32 MiB plaintext + 32 MiB ciphertext + input buffers, in-process) |

**Decision:** well under the 5 s pathological threshold. **`MAX_BLOB_BYTES`
stays at 32 MiB (33554432).** Realistic payloads are single-digit MiB; the cap
is comfortably covered. No chunked client-side encryption needed.

## Probe 2 — request-body streaming at 32 MiB (RAN)

- `c.req.raw.body` is consumed chunk-wise via a `ReadableStream` reader loop;
  the handler never buffers the whole body.
- Incremental hashing with **`new Bun.CryptoHasher('sha256')`** + `.update()`
  per chunk + `.digest()` at the end produces the correct hash. (`crypto.subtle.digest`
  on accumulated chunks would be wrong/expensive — confirmed the streaming
  hasher is the right tool, as the plan anticipated.)
- Byte counting per chunk works; an **overrun past the declared
  `Content-Length` is observable** and abortable via `reader.cancel()`.
- The ~80 MiB RSS delta is inflated by the in-process test client also holding
  the 32 MiB payload; the server-side reader loop itself does not accumulate.

**Decision:** pipeline the Task 7 upload as planned — stream → hash (CryptoHasher)
→ count → abort on over-length/hash-mismatch. No full buffering.

**Stall detection:** Bun/Hono give no built-in per-chunk inactivity timeout, so
Task 7 implements `BLOB_UPLOAD_IDLE_TIMEOUT_S` as a **manual watchdog reset on
each `reader.read()`** (the plan's Probe-2 decision-matrix branch).

## Probe 4 — Content-Length surfacing (RAN)

- `c.req.header('content-length')` is present pre-body for a normal PUT.
- A request with no `Content-Length` (streamed/chunked body) is distinguishable
  (header absent) → the handler returns **411**. Confirmed.

**Decision:** the §7.1 step-2 `411` guard is implementable exactly as specced.

## Probe 1 — S3 client choice (OWED — not run; implementation deviated)

**Provisional decision at plan time was Bun's native `Bun.S3Client`. The
implementation deviated** (recorded here per the spec §10 deviation rule; the
header of `src/blobs/s3.ts` points at this section): what shipped is a
**hand-rolled single-shot SigV4 client over `fetch`** —

- streaming PUT with `UNSIGNED-PAYLOAD` and a signed, known `Content-Length`
  (no full buffering, no chunked signing);
- **no multipart, by construction** — a single-shot PUT means the §8
  `AbortIncompleteMultipartUpload` lifecycle rule is unnecessary and was
  **dropped**, not implemented defensively;
- bucket-admin operations (create, versioning check) that `Bun.S3Client` does
  not expose but the bootstrap (§8) requires;
- SigV4 signing verified offline against AWS's published test vector.

**The owed probes below must therefore exercise this hand-rolled client, not
`Bun.S3Client`.** The multipart leg of this probe is superseded — there is no
multipart path to observe.

## Probe 3 — GET passthrough S3 → client (OWED — not run)

Written into `s3-client.ts`; runs under `S3_TEST_ENDPOINT`. Task 5's
`getStream` returns the S3 object stream straight into Hono's `c.body(stream)`
for backpressure; confirm memory under a slow reader on a MinIO host.

## Probe 5 — MinIO bootstrap (OWED — not run)

Bucket create idempotency, versioning status read (`GetBucketVersioning`), and
the `/minio/health/live` healthcheck endpoint are all used by Task 5 /
compose but unverified here. The compose healthcheck uses
`/minio/health/live`; if the image lacks `curl`, fall back to `mc ready local`.

## Probe L6C-L3 — short-body PUT classification (OWED — from the Larissa audit)

Audit finding L6C-L3 (`obsidian/insights/2026-07-02-larissa-audit-6c-built-diff.md`):
a body that closes **short** of the declared `Content-Length` is detected by
the route only *after* `putStream` resolves, but the live client signs
`content-length: declared` — real MinIO will likely fail/reset the request on
early close, `fetch` rejects with a non-`UploadValidationError`, and the route
answers `503 blob_backend_unavailable` (+ backend-error metric) for what is a
client lie that should be a `400`. The in-memory fake (which merely drains the
stream) cannot show this. **Run against real MinIO:** PUT with
`Content-Length: N`, stream `N - k` bytes, close. If the 503 misclassification
is confirmed, distinguish stream-side errors from transport errors in the PUT
catch (this would also tidy the watchdog's stalled-consumer misattribution).

## Summary of decisions carried into the plan

1. `MAX_BLOB_BYTES` = 32 MiB (Probe 6 — confirmed safe).
2. Stream + `Bun.CryptoHasher` upload pipeline; manual idle watchdog (Probe 2).
3. `411` on absent `Content-Length` (Probe 4).
4. Hand-rolled single-shot SigV4 client behind the `BlobBackend` interface
   (Probe 1 — **deviation from the provisional `Bun.S3Client` pick**, recorded
   above; object legs still **OWED** against real MinIO).
5. ~~Defensive multipart-abort lifecycle rule~~ — dropped: the single-shot
   client never does multipart, so the rule is unnecessary by construction
   (Probe 1, superseded).
6. Short-body classification against real MinIO (Probe L6C-L3 — **OWED**).
