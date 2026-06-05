# A letter to next-session Liz — implementing the D768_EQ_I4_L codec

Hi, me.

Chris will hand you this letter at the start of a fresh session. We just spent a
long, joyful afternoon on `packages/embeddings`, and it ended in a real product
decision you're now going to implement. Read this, then read **ADR 0030**
(`obsidian/decisions/0030-default-vector-storage-format.md`) — between the two
you have everything. Don't re-derive what we already measured; trust it and build.

## Where we left off

The embeddings engine shipped on `master` with **int8 max-abs** storage (the
elegant one where the per-vector scale cancels in cosine → integer dot product,
no metadata on the hot path). Then, purely out of curiosity, we ran a full
quantisation study — and it turned into something useful. We decided to change
the **default house format** to **`D768_EQ_I4_L`**, because the platform is
**sync-first and self-hostable**, and 37% less E2EE ciphertext per vector over
the wire is genuinely on-mission. The data backs it; it isn't a wish. (And yes —
we measured the scan cost too; it's fine at filtered-subset sizes.)

**Your job this session: build the `D768_EQ_I4_L` codec and swap it into the
store.** No data migration — the `vectors` table isn't wired into any consumer
yet, so you're changing the codec before any data exists. Clean.

## The format, precisely (so you don't reinvent it)

768-dim float vector →
- **48 blocks of 16 dims** (k=16).
- Per block, **zero-point (asymmetric)**: `mn = min(block)`, `mx = max(block)`,
  `scale = (mx - mn) / 15`, `offset = mn`; `code_i = clamp(round((v_i - mn)/scale), 0, 15)`.
- **Codes 4-bit packed**, 2 per byte → 384 B.
- **Metadata quantised to int8 per vector**: the 48 scales → int8 over
  `[0, max(scales)]`; the 48 offsets → int8 over `[min(offsets), max(offsets)]`.
  Store the 48 int8 scales + 48 int8 offsets + the small per-vector ranges
  (scaleMax, offMin, offMax) + a stored **norm** for cosine. ≈ 488 B/vector total.

The encode/dequantise maths is **already implemented and validated** in
`packages/embeddings/dev/experiment.ts` (`quantAsymmetric(..., useMSE=false, metaBits=8)`)
and the scan path in `packages/embeddings/dev/bench.ts` (`scanInt4`). Port those
into clean production modules — don't write the maths from scratch, lift the
verified version.

## What to build

1. A production codec module (probably evolve `src/store/quantise.ts` or a new
   `src/store/codec-i4l.ts`): `encode(Float32Array) → EncodedVector`,
   `decode(EncodedVector) → Float32Array` (for the future "dreaming" merge), and
   the hot path `cosineQuery(queryFp32, queryNorm, encoded) → number` that
   **dequantises each candidate before cosine** (this is the cost we accepted —
   the scale no longer cancels).
2. Update `src/store/schema.ts` — the persisted `VectorRow` shape changes from
   `{ q, scale, norm }` to the int4_L layout. **Add a 1-byte format-version tag**
   to the serialised vector: we learned the hard way that quant schemes can't be
   transcoded in place, so future changes will be a re-embed migration — make
   that detectable. This also matters because the encoded blob is exactly what
   sync will E2EE-encrypt later, so keep the serialisation **stable and versioned**.
3. Rewire `src/store/vector-store.ts` `query()` to score via `cosineQuery`
   (dequant path) instead of the old `cosineFromQuant`. Update `bytesPerVector`/
   `usage()`.
4. Update the tests (`quantise.test.ts`, `vector-store.test.ts`) for the new
   format — TDD it: round-trip fidelity, per-block no-clip, the recall sanity
   (~97% vs fp32), the dequant cosine path, store CRUD still green.

## Don't forget (the house rules that bit us repeatedly)

- **No TypeScript non-null assertions (`x!`)** — Biome ERROR, blocks the commit.
  Use `arr[i] ?? 0` in hot loops, optional chaining in tests. This caught us a
  dozen times; the patterns are all over `experiment.ts`.
- British English, SPDX header on every `.ts`, commit trailer
  `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`.
- `packages/embeddings` touches none of auth/sync/proxy/crypto, so **no Larissa
  gate** — but note that the encoded vector blob *becomes* sync payload later, so
  treat the serialisation format with the seriousness of a wire format.
- Suggested flow: a short brainstorm (most of the design is in ADR 0030 already)
  → `writing-plans` → subagent-driven TDD. Verify with `pnpm --filter
  @chatsundere/embeddings test && typecheck` and Biome throughout.

## The artifacts you have

- **ADR 0030** — the decision, the rationale, the full `D{dim}_EQ_I{bits}_{tier}`
  taxonomy ladder, what we gave up.
- `superpowers/specs/2026-06-05-client-embeddings-engine-design.md` — the engine.
- `packages/embeddings/dev/experiment.ts` — the validated quant maths (your
  reference implementation) + recall numbers.
- `packages/embeddings/dev/bench.ts` — the scan path + the 1.7× latency finding.
- `obsidian/insights/2026-06-05-quant-experiment-results.csv` — the full data.
- The auto-memory `embeddings-engine-quant-decision` — the whole learning arc,
  including the three hypotheses I cheerfully got wrong and corrected.

## One last thing

The reason this is worth doing carefully isn't the bytes — it's that Chris and I
turned a coffee-break "I just want to know" into measured, mission-aligned
engineering, and we had a genuinely good time doing it. Carry that spirit in.
Build it as cleanly as the int8 version, keep the verification honest, and when
you're unsure whether some quant subtlety matters — measure it, don't guess.
That habit served us beautifully all afternoon.

Have fun. We earned this one.

— Liz, 2026-06-05
