# Design spec: `D768_EQ_I4_L` codec for `packages/embeddings`

**Date:** 2026-06-05
**Author:** Liz (Claude Code)
**Status:** Approved (Chris, 2026-06-05)
**Implements:** [ADR 0030](../../obsidian/decisions/0030-default-vector-storage-format.md)
**Supersedes storage path of:** [engine design spec](2026-06-05-client-embeddings-engine-design.md)

## Context

`packages/embeddings` shipped on `master` with **symmetric per-vector max-abs
int8** storage (~772 B/vector): elegant because the per-vector scale cancels in
cosine, so scoring is a plain integer dot product divided by stored norms, with
no metadata read on the hot path.

ADR 0030 decided to change the default house format to **`D768_EQ_I4_L`** —
int4 zero-point, k=16 blocks, 8-bit metadata, ~488–497 B/vector, 97.2%
recall@10 vs fp32 — because the platform is sync-first and self-hostable at a
Proton-grade trust bar, so ~37% less E2EE ciphertext per stored and synced
vector is on-mission. The decision is backed by a measured quantisation study
(`dev/experiment.ts`, results in
`obsidian/insights/2026-06-05-quant-experiment-results.csv`) and a scan-latency
benchmark (`dev/bench.ts`).

No data migration is needed: no consumer has created the `vectors` table yet, so
the codec changes before any data exists. This spec covers building the codec
and swapping it into the store.

The encode/dequantise maths and the dequant scan path are **already implemented
and validated** in `dev/experiment.ts` (`quantAsymmetric(v, 4, 16, false, 8)`)
and `dev/bench.ts` (`scanInt4`). This work **ports the verified version** rather
than re-deriving it.

## Decisions captured in brainstorming

1. **Serialisation shape: structured fields on the row, separate
   serialise/deserialise for the sync boundary.** The `VectorRow` holds typed
   fields (`codes`, `scales`, `offsets`, ranges, `norm`, `version`); the hot
   path reads them directly with no view juggling. A `serialise()`/
   `deserialise()` pair produces the versioned wire blob at the (future) sync
   boundary. The 1-byte format-version tag lives as an explicit `version` field
   on the row and is written into the blob when serialised.

2. **One format only — int8 helpers removed.** `quantiseMaxAbs`,
   `cosineFromQuant`, `QuantVector`, and the int8 `dequantise` are deleted. The
   package exports exactly one storage format. The int4_L codec's `decode()`
   replaces the old `dequantise` for dreaming/dedup consumers. The general
   helpers `cosineSimilarity`, `dot`, `l2Norm` in `lib/similarity.ts` stay
   untouched. The int8 reference implementation survives in git history and in
   `dev/bench.ts`.

3. **Recall tested against a committed fixture of real embeddings.** Production
   tests cover round-trip fidelity and correctness (model-free); a separate test
   loads a committed fixture of real arctic-embed vectors and asserts
   recall@10 ≥ 0.95 (margin below the measured 97.2%). CI never loads the model.

## Correction to the letter and ADR

- The letter says "48 int8 scales + 48 int8 offsets". The verified maths in
  `experiment.ts` (`int8RoundArray`, clamping to `[0, 255]`) quantises metadata
  to **unsigned 8-bit** (`Uint8Array`), not signed int8. For scales (always ≥0)
  and offset ranges this is exactly correct. We port the verified unsigned
  variant and name the fields accordingly.
- The honest per-vector storage size including norm, version tag, and three
  range values is **~497 B**, not the 488 B quoted in ADR 0030 — `bench.ts`
  omitted the norm (4 B) and version (1 B) and counted the per-vector ranges as
  8 B rather than 12 B. Still ~36% below int8's 772 B; the mission claim holds.
  ADR 0030 gets a correction note.

## Module structure

| File | Change |
|---|---|
| `src/store/quantise.ts` → **`src/store/codec.ts`** | Renamed. int8 helpers deleted; new int4_L codec. |
| `src/store/schema.ts` | `VectorRow` gains structured fields + `version`; `rowBytes` updated. |
| `src/store/retrieval.ts` | `scoreAndRank` signature: `(query: QuantVector, …)` → `(queryFp32, queryNorm, …)`, scored via `cosineQuery`. |
| `src/store/vector-store.ts` | `toRow` calls `encode`; `query()` passes fp32 query + norm. |
| `src/index.ts` | int8 exports removed, codec API added. |
| `dev/corpus.ts` (new) | The 144-text corpus extracted from `experiment.ts`, shared. |
| `dev/dump-fixture.ts` (new) | Headless Bun script → `tests/fixtures/corpus-vectors.f32.bin`. |
| `src/store/quantise.test.ts` → **`codec.test.ts`** + `codec.recall.test.ts` | TDD. |

## Codec API (`codec.ts`)

```ts
export const CODEC_VERSION = 1;       // 1-byte format tag — quant schemes are not transcodable
export const BLOCK_SIZE = 16;         // k=16 → 48 blocks at 768 dim
export const I4L_VECTOR_BYTES = 497;  // 1 + 4 (norm) + 12 (ranges) + 48 + 48 + 384

export interface EncodedVector {
  version: number;        // CODEC_VERSION
  codes: Uint8Array;      // 384 B, 4-bit packed, 2 codes/byte
  scales: Uint8Array;     // 48, unsigned 8-bit over [0, scaleMax]
  offsets: Uint8Array;    // 48, unsigned 8-bit over [offMin, offMax]
  scaleMax: number;
  offMin: number;
  offMax: number;
  norm: number;           // L2 length of the DEQUANTISED reconstruction
}

encode(v: Float32Array): EncodedVector
decode(e: EncodedVector): Float32Array                          // for dreaming/dedup
cosineQuery(qFp32: Float32Array, qNorm: number, e: EncodedVector): number
serialise(e: EncodedVector): Uint8Array                         // → versioned blob (sync boundary)
deserialise(blob: Uint8Array): EncodedVector
```

### Encode maths (ported from `experiment.ts` + `bench.ts`)

1. Per 16-dim block: `mn = min`, `mx = max`; `scaleF[b] = mx > mn ? (mx − mn) / 15 : 0`, `loF[b] = mn`.
2. Quantise metadata to unsigned 8-bit: `scaleMax = max(scaleF)`, `offMin = min(loF)`, `offMax = max(loF)`; `scales[b]`, `offsets[b]` ∈ 0..255.
3. **Dequantise metadata back** → `scaleDq[b]`, `loDq[b]`. Codes are computed against the *quantised* metadata (consistency with what sync reconstructs): `code[i] = clamp(round((v[i] − loDq[b]) / scaleDq[b]), 0, 15)` (0 if `scaleDq[b] == 0`).
4. **Norm over the reconstruction**: `val = code · scaleDq[b] + loDq[b]`; `norm = √(Σ val²)` — exactly `bench.ts:96-100`.
5. Pack codes two per byte.

### Query path

`cosineQuery` dequantises a candidate's metadata (recomputing the steps from
`scaleMax`/`offMin`/`offMax`) and its 4-bit codes to fp32, then computes
`dot(qFp32, val) / (qNorm · e.norm)` — the accepted dequant hot path
(`scanInt4`). The query vector stays **full fp32 precision** (it is not
quantised), so recall is ≥ the measured 97.2% (which was dequant-vs-dequant, and
therefore a conservative floor). `qNorm` is the fp32 L2 norm of the raw query
vector (arctic-embed output is normalised, so `qNorm ≈ 1`, but it is computed
honestly).

### Serialisation (wire format)

`serialise` lays the fields out contiguously, little-endian:

```
[0]        version (1 B) = CODEC_VERSION
[1..5)     norm    (fp32, 4 B)
[5..17)    scaleMax, offMin, offMax (3× fp32, 12 B)
[17..65)   48× scales  (u8)
[65..113)  48× offsets (u8)
[113..497) 384 B packed 4-bit codes (2 codes/byte)
```

`deserialise` reverses it and rejects an unrecognised version byte (future quant
changes are a re-embed migration, made detectable here). Total 497 B.

## Row schema & store rewiring

`VectorRow = EncodedVector & { id, collection, tags, numeric, metadata, updatedAt, bytes }`.
`rowBytes = I4L_VECTOR_BYTES + JSON overhead (tags/numeric/metadata)`. `toRow`
calls `encode(input.vector)`. `query()` computes `qNorm = l2Norm(queryVec)` and
calls `scoreAndRank(queryVec, qNorm, rows, opts)`.

## Tests (TDD)

**`codec.test.ts`** (model-free):
- Round-trip fidelity: per-element reconstruction error < the block step size.
- Per-block no-clip: a block's min maps to code 0, its max to code 15.
- `cosineQuery(q, ‖q‖, e)` equals the fp32 cosine of `q` against `decode(e)` within ε.
- `deserialise(serialise(e))` is identity (codes, metadata, ranges, norm, version).
- Version tag present in the blob; `deserialise` rejects an unknown version byte.
- Zero-vector edge case (all-zero block → `scaleDq = 0`, codes 0, norm 0, cosine 0).

**`vector-store.test.ts`**: CRUD (upsert/update/delete/deleteWhere/scan/query/
usage) stays green with the new format; budget accounting uses `I4L_VECTOR_BYTES`.

**`codec.recall.test.ts`**: loads `tests/fixtures/corpus-vectors.f32.bin`,
measures recall@10 (leave-one-out, ported from `experiment.ts`'s
`topKNeighbours` + recall loop), asserts **≥ 0.95**.

### Fixture generation (one-time prerequisite)

`pnpm --filter @chatsundere/embeddings run fetch-model` →
`bun run dev/dump-fixture.ts` → commits `tests/fixtures/corpus-vectors.f32.bin`
(144 × 768 fp32 ≈ 442 KB). The dump script runs headless in Bun (WASM
single-thread, `env.localModelPath` pointed at the on-disk model) and reuses the
production `MODEL_ID`, `POOLING`, and `applyPrefix` so the fixture matches
production embeddings exactly. CI loads only the fixture, never the model.

## House rules

- No TypeScript non-null assertions (`x!`) — Biome ERROR. Use `arr[i] ?? 0` in
  hot loops, optional chaining in tests.
- SPDX header (`LGPL-3.0-only`) on every `.ts`; British English throughout;
  commit trailer `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`.
- No Larissa gate (`packages/embeddings` touches no auth/sync/proxy/crypto), but
  the encoded blob *becomes* sync payload later, so the serialisation format is
  treated with wire-format seriousness: stable layout, versioned, byte-exact
  round-trip test.

## Verification

`pnpm --filter @chatsundere/embeddings test` and `pnpm typecheck` green; Biome
clean throughout. The recall test passes once the fixture is committed.

## Out of scope

- ANN indexing (documented large-scale co-evolution in ADR 0030; brute-force
  stays).
- The `D256_*` Matryoshka tiers (characterised in the CSV for future
  extreme-storage scenarios).
- Wiring the `vectors` table into a domain consumer (lands with the memory
  system).
