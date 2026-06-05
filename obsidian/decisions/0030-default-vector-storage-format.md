# ADR 0030: Default vector storage format (D768_EQ_I4_L)

## Status

Accepted (2026-06-05). Decision made; codec implementation deferred to a
dedicated session (the store on `master` currently ships the int8 path only —
no consumer wires the `vectors` table yet, so there is no migration burden).

## Context

`packages/embeddings` stores client-local embedding vectors in IndexedDB and —
once sync lands (Phase 1) — will sync them **E2EE-encrypted** to the backend.
The production code as built quantises each 768-dim vector with **symmetric
per-vector max-abs int8** (~772 B/vector): elegant because the per-vector scale
cancels in cosine, so scoring is a plain integer dot product divided by stored
norms, with no metadata read on the hot path (see the original design spec).

The two consumers are **companion memory** (MemGPT/Letta-style, bounded by a
"dreaming" consolidation pass but plausibly thousands of vectors) and
**knowledge-base libraries** (document chunks, plausibly tens of thousands). The
platform is **sync-first and self-hostable at a Proton-grade trust bar**, so the
volume of E2EE ciphertext synced across devices and stored per self-hosted user
is a first-order concern, not an afterthought.

A quantisation study (the throwaway harness `packages/embeddings/dev/experiment.ts`,
results in `obsidian/insights/2026-06-05-quant-experiment-results.csv`, 144-text /
~10 296-pair corpus, recall@10 measured against fp32) characterised the
trade-off space. Key empirical findings:

- **int8 max-abs is near-lossless** (Δ 0.00036, 99.4% recall@10) but the
  largest format at 772 B.
- For int4, **min/max asymmetry (zero-point) is the one big lever (~30%)**;
  block mean is irrelevant; MSE-optimal clipping adds only ~1%; **per-block
  metadata (scale+offset) compresses to int8 essentially for free**.
- **`D768_EQ_I4_L`** — int4 zero-point, k=16 blocks, int8 metadata, **488 B/vector
  (37% smaller than int8), 97.2% recall@10**.
- A scan-latency benchmark (`packages/embeddings/dev/bench.ts`) measured int4_L's
  dequantise-per-candidate cosine at **~1.6–1.8× slower** than int8's integer
  dot: at realistic *filtered* candidate-set sizes (hundreds to ~10k) this is
  ≤12 ms — below perception; felt latency only appears at 100k+ single-query
  scans (a large-scale edge case for personal/companion use).
- Matryoshka truncation to 256 dims keeps ~89.9% recall and enables an extreme
  storage tier; details in the CSV.

## Decision

1. **The default house format is `D768_EQ_I4_L`** — int4, zero-point
   (asymmetric min/max), **k=16 blocks** (48 blocks of 16 dims), per-block
   `scale`+`offset` quantised to **int8** (with a small per-vector
   scale-of-scales + offset-range), 4-bit packed codes, plus a stored vector
   norm. ~488 B/vector, 97.2% recall@10 vs fp32.

2. **One format only — no per-store toggle.** This preserves the Omakase
   discipline (see the original engine spec, which deliberately rejected a
   format toggle). int8 is *not* offered as a runtime "precision mode"; it
   remains a documented taxonomy entry for special cases, not a configurable
   option on the default store.

3. **Naming taxonomy `D{dim}_EQ_I{bits}[_{tier}]`.** The tier knob is block
   size, one algorithm (zero-point + int8 metadata) throughout:

   | Format | scheme | B/vec | recall@10 |
   |---|---|---|---|
   | `D768_EQ_I8` | max-abs global (cancelling) | 772 | 99.4% |
   | `D768_EQ_I4_XS` | zero-point global (fp32 meta) | 392 | 93.8% |
   | `D768_EQ_I4_S` | zero-point k=64, int8 meta | 416 | 95.9% |
   | `D768_EQ_I4_M` | zero-point k=32, int8 meta | 440 | 96.7% |
   | **`D768_EQ_I4_L`** | **zero-point k=16, int8 meta** | **488** | **97.2%** |
   | `D256_EQ_I8` | 256-dim max-abs (MRL) | 260 | 89.7% |
   | `D256_EQ_I4_M` | 256-dim zero-point k=64 int8 | 144 | 88.8% |
   | `D256_EQ_I4_L` | 256-dim zero-point k=16 int8 | 168 | 89.1% |

   (`recall@10` for 256 rows is end-to-end against the true 768 ranking.)

4. **Brute-force retrieval stays.** Filter-then-rank over a metadata-narrowed
   candidate subset is the natural fit; ANN indexes (HNSW, or the simpler
   Annoy / random-projection-forest / sign-LSH family) fight arbitrary metadata
   pre-filters and are unnecessary until a single filtered query must scan
   hundreds of thousands of vectors. **int4 + ANN is the documented large-scale
   co-evolution** — format and index flip together, not separately.

## Consequences

- **We give up the cosine-scale cancellation.** Any k-block scheme has per-block
  scales that do not factor out of the cosine sum, so scoring requires
  **dequantising each candidate to fp32 before cosine** — measured ~1.7× slower
  than int8's integer dot, which is immaterial at filtered-subset sizes but real
  for large unfiltered scans.
- **We gain ~37% on every stored and synced vector** — less IndexedDB/OPFS
  footprint locally and, more importantly, ~37% less E2EE ciphertext over the
  wire and at rest on self-hosted servers. On-mission for a sync-first,
  self-hostable platform.
- **Implementation is a new codec** (4-bit pack/unpack, k=16 zero-point encode,
  int8 metadata two-pass, dequantise-on-read, a dequant cosine path), built
  test-first in a dedicated session. No data migration is needed because no
  consumer has created the `vectors` table yet.
- **97.2% vs 99.4% recall@10** is an accepted, deliberate quality trade for
  companion-grade fuzzy semantic recall — not exact retrieval.
- The full ladder and the `D256_*` MRL tiers stay characterised in the CSV for
  future extreme-storage scenarios.

## Correction (2026-06-05, implementation)

Two numbers in this ADR were refined when the codec was actually built (see the
implementation spec `superpowers/specs/2026-06-05-int4l-codec-design.md` and the
landed `packages/embeddings/src/store/codec.ts`):

- **Per-vector size is ~497 B, not 488 B.** The 488 B figure (from
  `dev/bench.ts`) omitted the stored `norm` (4 B) and the 1-byte format-version
  tag, and counted the per-vector metadata ranges as 8 B rather than the actual
  12 B (`scaleMax`, `offMin`, `offMax` — three fp32 values). The honest
  serialised blob is 1 + 4 (norm) + 12 (ranges) + 48 (scales) + 48 (offsets) +
  384 (codes) = **497 B**. Still ~36% below int8's 772 B; the mission claim
  holds, just exact rather than rounded.
- **The per-block metadata is unsigned 8-bit, not signed int8.** The validated
  maths (`experiment.ts` `int8RoundArray`, clamping to `[0, 255]`) quantises
  scales over `[0, scaleMax]` and offsets over `[offMin, offMax]` as
  `Uint8Array` indices (the signed range endpoints live in the fp32 ranges).
  Unsigned gives the non-negative scale its full 8-bit resolution.

The measured end-to-end **recall@10 against the committed fixture is 0.9729**,
confirming the 97.2% study figure.

## References

- Engine design spec: `superpowers/specs/2026-06-05-client-embeddings-engine-design.md`
- Quant study harness: `packages/embeddings/dev/experiment.ts`
- Scan benchmark: `packages/embeddings/dev/bench.ts`
- Results: `obsidian/insights/2026-06-05-quant-experiment-results.csv`
