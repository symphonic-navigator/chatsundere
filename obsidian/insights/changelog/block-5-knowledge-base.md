# Changelog — Block 5 · Knowledge base

> Archived from `STATUS-CLIENT-ONLY.md` on 2026-06-18 (STATUS reorg).
> Reverse-chronological. Chapter index: [[README]].


## Session log

**Earlier 2026-06-08 (lore cooldown) — Lore re-injection cooldown gate added**
(squashed on master `a77dd5c`, **NOT pushed**) — Chris's first post-device-test
refinement, after confirming Chunk C works "erstklassig". **The problem:** a chat
that keeps mentioning an entity (his example: "Farbkraft") re-injected the **same**
document every turn → repetition that bloats context. **The gate:** a lore
document injected in the last `KNOWLEDGE_LORE_OPTS.cooldownRounds` (**8**,
device-tunable) **rounds** is not re-injected; after 8 rounds without a
(re-)injection it's eligible again. **Dedup by document id** — each `kb-injection`
pill entry now carries its `documentId`, so the **pills are the injection
history** (single source of truth, no separate tracking, graceful on old pills
that predate the field). The send path collects the doc ids from the last 8
**persona-turn** pills (`injectedDocIdsFromPills`) and `selectLore` excludes those
documents **before** the budget stage (so a cooled-down doc never consumes budget
nor counts as omitted). **Suppression is silent** (Chris's call — no pill noise; a
turn where everything matched is on cooldown produces no pill at all, consistent
with "nothing fired"). **Regenerate is correct:** the cooldown scan uses the
re-roll's `priorMessages` (which excludes the discarded target turn), so a re-roll
may re-inject what the abandoned attempt had. Built **subagent-driven** in an
isolated worktree (2 TDD tasks, per-task spec+quality review; the end-to-end loop
— `selectLore` emits `documentId` → store persists it in the pill payload
unchanged → `injectedDocIdsFromPills` reads it back next turn — traced + verified).
**Not a Larissa change** (client-only; no new egress). Verification (on master):
`pnpm typecheck` **14/14**; llm-unified `bun test` **283/0**; user-client vitest
**1147 pass / 8 fail** (the unchanged `cockpit-draft`/`chat-page`/`chat-route`
localStorage-jsdom baseline); biome clean; `git diff master..branch` empty
(full-tree capture). **DEVICE-CONFIRMED by Chris 2026-06-08** ("das funktioniert! großartig
sogar!") — both Chunk C and the cooldown work on device. **Next:** **Chris pushes
the master backlog himself** (now **11 ahead** — backlog + ask_expert + Chunk C +
cooldown; Liz must NOT push). Knowledge base (Block 5) is feature-complete; next
per [[ROADMAP]] is the v0.2.0 gate. See the Chunk C entry below for the base
feature.
**Earlier 2026-06-08 (later) — Knowledgebase Chunk C (Lorebooks /
phrase-triggered injection) landed** (squashed on master `015bda6`, **NOT
pushed**; merged cleanly with the parallel **ask_expert** feature on master
`6d91bd5`). The last Block-5 knowledge-base feature before v0.2.0. Brainstormed
end-to-end with Chris, built **subagent-driven** in an isolated worktree (12 TDD
tasks, per-task spec+quality review + a final **opus** holistic review = READY TO
SQUASH, no critical/important). **What it does:** when a normalised trigger phrase
appears in the current exchange, the matching knowledge document's **full**
content is injected into the prompt (budget-capped) and surfaced as a transparent
**`kb-injection` pill** — the deterministic, per-turn, **ephemeral** counterpart
to retrieval (no tool, no model decision). **Design (Chris's calls):** (1) a
lorebook entry **is** a knowledge document with `triggerPhrases` (the field
reserved in Chunk A → **no Dexie migration**); any document can be retrieval-able
*and* phrase-triggered. (2) Phrases + scanned text both normalised
(`trim`→`toLowerCase`→collapse whitespace; `normalisePhrases`/`normalisePhraseText`)
— Chris makes accidental double-spaces. (3) **Word-boundary** match via Unicode
lookarounds `(?<![\p{L}\p{N}])…(?![\p{L}\p{N}])` (NOT ASCII `\b` — umlauts):
`blume` doesn't fire on `blumen`, a story's `blumenwiese e.v.` doesn't derail a
flowers chat — precision over wild injection, Chris's explicit ask. (4) Scan = the
just-sent user message always; a per-document **`triggerOnCompanion`** toggle
(default off, non-indexed → no migration) also scans the *immediately preceding*
companion message **independently** (a cross-join false-positive was caught & fixed
— no match spans the user/companion boundary); no wider window (a phrase that fell
earlier already triggered then). (5) **Same scope as retrieval**
(`computeEffectiveLibraries`, persona ∪ chat, NSFW-gated) — assignment is the
safety valve against derailment. (6) Budget `KNOWLEDGE_LORE_OPTS = { maxEntries:
8, maxTotalChars: 8000 }` (device-tunable): whole entries until the cap, overflow
truncated with `…`, rest omitted, counts shown in the pill. (7) Band-2 **`lore`**
prompt segment (after `memories`, before retrieval-awareness); pill persisted on
success **and** on stream failure (a dangling-pointer bug the quality review
caught). UI: shared **`TagEditor`** in `edit` mode (Chris's ask — trigger phrases
ARE tags) with `normalisePhrases`, plus the companion toggle
disabled-until-a-phrase-exists, in `DocumentEditor`; phrase/toggle edits do **not**
re-embed. **Not a Larissa change** (client-only; no auth/sync/proxy/crypto; **no new
network egress** — lore rides the on-device prompt path; opus-confirmed).
**Integration with ask_expert (Chris's Dexie heads-up):** both features touched
`client-data-db.ts`/`Pill.tsx`/`send-message.ts`/`stream-manager.store.ts`; the
merge was **clean/additive** (3 trivial both-keep conflicts in StartArgs + the
send-path arg objects). **No Dexie collision** — ask_expert owns **v16**, Chunk C
bumps no version (only a non-indexed field). Merge verified green before squash.
**Squash hygiene:** staged diff = exactly the 23 Chunk-C files (no ask_expert
files); `git diff master..branch` empty (full-tree capture); typecheck on master
before worktree cleanup ([[feedback_verify_worktree_squash_captured_full_tree]]).
Verification (on master, integrated with ask_expert): `pnpm typecheck` **14/14**;
llm-unified `bun test` **283/0**; user-client vitest **1140 pass / 8 fail** (the
unchanged `cockpit-draft`/`chat-page`/`chat-route` localStorage-jsdom baseline —
the failing files are exactly those three, verified); `pnpm run build` **9/9**;
biome clean. Spec/plan:
[[../../../superpowers/specs/2026-06-08-knowledgebase-chunk-c-lorebooks-design]],
[[../../../superpowers/plans/2026-06-08-knowledgebase-chunk-c-lorebooks]]. **Device test
(spec §10):** give a small SFW document (assigned to a persona) the phrases `red
dragon`, `dragonblood`; in a chat mention "Red Dragon" → a `kb-injection` pill
appears (expand → library › doc + injected content), reply reflects the lore; a
near-miss ("dragons" in general, no exact phrase) does **not** fire; flip the
companion toggle on, have the companion mention the phrase → fires next turn; flip
off → stops; overflow the budget → pill shows omitted/truncated counts; unassign
the library → lore stops entirely; editing a phrase does **not** re-embed.
**Next:** Chris device-tests Chunk C → Liz pushes the master backlog (now **8
ahead**, incl. ask_expert + Chunk C) on his word. **Block 5 (knowledge base) is now
feature-complete** through Chunk C — next per [[ROADMAP]] is the v0.2.0 gate.
**Earlier 2026-06-07 — Knowledgebase Chunk B (Retrieval) landed**
(squashed on master `8d3e496`, **pushed** 2026-06-07 with the Chunk-A backlog
`3548f87..7026899`; **device-tested by Chris** — Firsavaai/
Farbkraft retrieval, the pill, locking, cockpit temporary (un)assignment, and delete
all confirmed working; **one device-fix folded in** `0b7800f`: NSFW gating layer 1
was incomplete — `KnowledgeSection`/`KnowledgeSheet` filtered on the *global*
adult-mode, not the persona's `adultPersona`, so a SFW persona was offered NSFW
libraries while global mode is NSFW; both now gate on `adultPersona || !nsfw`.
Retrieval-time gating was already correct, so there was never a content leak — only
a wrong *assignment* surface).
Block-5 feature (v0.2.0), brainstormed end-to-end with Chris, built
**subagent-driven** in an isolated worktree (16 TDD tasks, per-task spec+quality
review + a final **opus** holistic review = READY TO SQUASH; the opus review
confirmed end-to-end wiring, scoping, and NSFW gating, flagging only two cosmetic
minors). A companion can now **use** the knowledgebase: the **`query_knowledgebase`**
tool searches **only the libraries assigned to the persona** (∪ ad-hoc chat
libraries), NSFW-filtered, and the model is told what's available via a **Band-2
awareness segment** (the answer to "the tool gets called too rarely" — the model
*sees* its libraries). **What landed:** (1) a **third tool category — context
tools** in `resolveActiveTools(ctx, knowledge)`, beside static tools and provider
integrations; `query_knowledgebase` is **purely local** (no offering/credential/
`ServiceKind`), so it deliberately does NOT fit the `Integration` abstraction.
(2) **Dexie v15**: `libraryIds: string[]` on personas + chats; `deleteLibraryCascade`
prunes dangling bindings; `useBranchChat` inherits the parent's libraries. (3)
**Retrieval is fully on-device** (`knowledge/retrieval.ts` + `knowledge-context.ts`):
embed the query once (`kind:'query'`), one **filtered** `store.query` per assigned
library (`tags.libraryId` — never the whole collection), merge → global topK
(defaults topK 6 / minScore 0.35 / candidateK 24, device-tunable), provenance-headed
passages (library › document › heading). **No new network egress.** (4) The
send-path (`send-message.ts`) builds a `KnowledgeContext` per send; the stream-manager
derives the tool + awareness **gated on `toolsActive && knowledge`** and threads both
into `buildPrompt`. (5) UI: a **Knowledge** section in the persona-editor (assign
libraries, NSFW-filtered) + a **cockpit knowledge sheet** (persona libraries
**locked-on** for transparency, chat additions toggleable, **disabled-with-tooltip
until the chat exists** per disabled-over-hidden); retrieval surfaces in the tool
pill (query + passages). **Not a Larissa change** (client-only + one `llm-unified`
prompt segment; no auth/sync/proxy/crypto, no new egress — confirmed by the opus
review). **Process note worth keeping:** the **full** vitest (T16) caught a real
regression the per-task UI review missed — T14 only ran `tests/components/chat/`, so
two `tests/unit/cockpit-*` files (persona fixtures predating `libraryIds`,
cast-hidden so typecheck stayed green) crashed the Cockpit via
`computeEffectiveLibraries(undefined)`; fixed with a `?? []` guard + fixture updates
before squash. Reinforces [[feedback_per_task_review_runs_full_suite]]. **Squash
hygiene note:** during the run master's ref drifted to carry the 15 individual
task-commits (an EnterWorktree/amend interaction); reset master to the clean
base `4eb72e7` and re-squashed from the verified branch tip, confirming
`git diff master..branch` empty (full-tree capture) + typecheck before worktree
cleanup ([[feedback_verify_worktree_squash_captured_full_tree]]). Verification
(on master after squash): `pnpm typecheck` **14/14**; user-client vitest **1041
pass / 8 fail** (the unchanged `cockpit-draft`/`chat-page`/`chat-route`
localStorage-jsdom baseline, **verified identical on master**); llm-unified
`bun test` **280/0**; `pnpm run build` **9/9**; biome clean. Spec/plan:
[[../../../superpowers/specs/2026-06-07-knowledgebase-chunk-b-retrieval-design]],
[[../../../superpowers/plans/2026-06-07-knowledgebase-chunk-b-retrieval]]. **Deferred
(logged):** *attach document* (its own UX session — Chris has ideas), Lorebooks /
phrase-triggered injection (**Chunk C**), a `tags`-set-membership filter in
`packages/embeddings` (replace per-library queries with one scored scan), and the
cockpit effective-count double-NSFW-filter display nuance
([[insights/follow-ups-index]]). **Device-test reuses the Chunk-A model** already
provisioned at `/model/` (no new setup). **Next:** Chris device-tests (assign a
library to a persona → ask a covered question → the model calls `query_knowledgebase`,
a pill appears, it answers from the passage; expand the pill; cockpit ad-hoc toggle;
SFW hides NSFW libraries; delete a bound library) → Liz pushes the master backlog on
Chris's word; then *attach document* or Chunk C per [[ROADMAP]].
**Earlier 2026-06-07 — Knowledgebase foundation (Chunk A) landed +
DEVICE-CONFIRMED by Chris** (squashed on master `0ef499f`, NOT pushed; embed +
retrieval both working on device). **Device test surfaced four integration gaps
the plan/spec/holistic-review all missed — only a real run finds these** (fixes
on master, not pushed): (1) `de26fe5` exclude `@huggingface/transformers` from
Vite's dep optimiser + `worker.format:'es'` — pre-bundling mangles its
`new URL('ort-wasm…', import.meta.url)` asset refs; (2) `6b68ccf` provision the
~310 MB int8 weights at `/model/` (`pnpm --filter @chatsundere/user-client
fetch-model`, gitignored) + console/tooltip surfacing of embedding errors;
(3) `32d2a6b` exclude `/model/` from the SW `navigateFallback` denylist;
(4) **the real final boss — poisoned Cache Storage:** an early-attempt SW had
written `index.html` into transformers' browser cache, so every later attempt
read that HTML back (`JSON.parse('<!DOCTYPE…')` — "No backend available"),
**surviving SW-unregister, dev restarts, and "Disable cache"** (that toggle only
affects the HTTP cache, not the Cache-Storage API). Fix: clear Cache Storage once
(DevTools → Application → Cache Storage); the `/model/` SW denylist prevents
re-poisoning. **Retrieval smoke-test PASS** (console, against the live int4
store): query "farbkraft" → top hit **0.571** (the matching chunk) vs **~0.10**
for everything else — clean semantic separation; the int4 layout verified by
Chris from raw bytes (768 dim → 384 B codes + 48 scales + 48 offsets, k=16, ADR
0030). **Open Zero-Knowledge gap (honest):** the **ORT WASM runtime** still loads
from the **jsdelivr CDN** at runtime (default `wasmPaths`) — the *model* is
self-hosted, the *runtime* is not yet; self-host it too ([[insights/follow-ups-index]],
[[insights/security-deferrals]]).
Block-5 feature (v0.2.0), brainstormed end-to-end with Chris, built
**subagent-driven** in an isolated worktree (15 plan tasks, per-task review +
a final **opus** holistic review that caught two real gaps the per-task reviews
missed — missing library edit/delete UI and `position:absolute` sheets — both
fixed pre-squash). **First real consumer of the dormant `packages/embeddings`**
(arctic-embed-m-v2.0, int4 store, ADR 0030); only a Markdown **chunker** was
missing and is now ported (hierarchical heading→paragraph→sentence→word). **What
landed:** (1) Dexie **v14** `libraries` + `documents` tables; chunk vectors live
in a **separate** embeddings IndexedDB (domain/vectors split = spec Approach 1),
cascade-deleted via `data/knowledge.ts`. (2) A **background ingestion queue**
(`knowledge/ingestion-queue.ts` + `start-ingestion.ts`): pending→embedding→ready/
failed, idempotent re-embed (delete old chunk vectors before writing), mid-flight
deletion discard, reload-resume (interrupted `embedding`→`pending`); started at
boot in `main.tsx` after `openDb()` (race-free, StrictMode-safe, no model load on
a docs-empty install). (3) The **My Knowledge room** (`/app/knowledge` +
`/:libraryId`): library list + detail, **upload (.md/.txt) + paste** add, per-doc
status badges with Retry, document editor (content edit re-embeds, title-only does
not), library edit/delete with inline confirm, **NSFW gating** via
`useFilteredLibraries` (mirrors personas); the entrance-hall **My Knowledge tile is
live**. Everything is **Markdown** (no mediaType); **no refresh/cooldown** ("haben
wir schon" dropped — its effect is Chunk C). **Not a Larissa change** (client-only;
the engine is **self-hosted** — `env.allowRemoteModels=false`, `localModelPath='/model/'`
— so the runtime **never** calls HuggingFace; confirmation in [[insights/security-deferrals]]).
Verification: `pnpm typecheck` **14/14**; embeddings vitest **59/59**; user-client
vitest **994 pass / 8 fail** (the unchanged `cockpit-draft`/`chat-page`/`chat-route`
localStorage-jsdom baseline, verified identical on master); `pnpm run build`
**9/9**; biome clean. Spec/plan:
[[../../../superpowers/specs/2026-06-07-knowledgebase-chunk-a-foundation-design]],
[[../../../superpowers/plans/2026-06-07-knowledgebase-chunk-a-foundation]]. **Device-test PREREQUISITE
(spec §8):** the ~310 MB int8 weights must be provisioned at `/model/` — run
**`pnpm --filter @chatsundere/user-client fetch-model`** once (gitignored under
`apps/user-client/public/model/`; fetches from HF **at setup time** on the operator's
machine, never at runtime), then **restart `pnpm dev`** (packages/embeddings changed —
Vite HMR ignores `packages/*`). *(This blocker surfaced in Chris's first device test:
without the weights, `/model/...` 404s → SPA index.html → "Unexpected token '<'… No
backend available".)* Steps: create library → add `.md` by upload (banner +
pending→embedding→ready) → add by paste → edit content (re-embed) → edit title only
(stays ready) → NSFW library hidden in SFW → delete document & library → reload
mid-embed (resumes). **Deferred (logged):** NSFW deep-link gating of the detail
route (consistent with the persona-editor precedent; real retrieval gating is Chunk
B), a `NewLibrarySheet` alias cleanup, **prod deployment must serve `/model/`**, and
**pin SHA256s in fetch-model.mjs** ([[insights/follow-ups-index]]). **Next:** Chris
device-tests → push the master backlog; then Knowledgebase **Chunk B**
(query_knowledgebase tool + persona/chat binding + attach-document) per [[ROADMAP]].
**Earlier 2026-06-05 — Parallel `packages/embeddings` line merged in.**
The client-local semantic-search engine (feat/embeddings-engine) and its
`D768_EQ_I4_L` int4-codec storage swap (feat/int4l-codec, [ADR 0030](../../decisions/0030-default-vector-storage-format.md))
were built on a separate master line and are now merged with the web-interfacing
/ pinned-cockpit work below — see the top two **Done** entries. Still **not
wired** to any GUI or domain consumer; that lands with the memory system.

## Done

- **`packages/embeddings` — default storage format swapped to
  `D768_EQ_I4_L` (2026-06-05, feat/int4l-codec)**. Per [ADR 0030](../../decisions/0030-default-vector-storage-format.md),
  the store now uses an int4 zero-point codec (k=16 blocks, unsigned-8-bit
  per-block metadata, ~497 B/vector — ~36% below the old int8's 772 B) instead
  of int8 max-abs. New `src/store/codec.ts` exports `encode` / `decode` /
  `cosineQuery` (full-precision fp32 query vs dequantised candidate — the
  per-block scales no longer cancel) plus a versioned, length-checked,
  byte-exact `serialise` / `deserialise` wire format (the blob is the future
  E2EE sync payload, so it carries a 1-byte format-version tag). The int8 path
  (`quantise.ts`, `quantiseMaxAbs`, `cosineFromQuant`, `QuantVector`) was
  removed entirely — one format only, no runtime toggle (Omakase). No data
  migration (no consumer had created the `vectors` table yet). A committed
  fixture of 144 real arctic-embed vectors guards **recall@10 = 0.9729** vs the
  fp32 ranking in CI (model run only at fixture-generation time, via
  `bun run dev/dump-fixture.ts`). 51 Vitest tests, typecheck + Biome clean.
  Spec: [`superpowers/specs/2026-06-05-int4l-codec-design.md`](../../../superpowers/specs/2026-06-05-int4l-codec-design.md).
  Plan: [`superpowers/plans/2026-06-05-int4l-codec.md`](../../../superpowers/plans/2026-06-05-int4l-codec.md).
- **`packages/embeddings` — client-local semantic-search foundation
  (2026-06-05, feat/embeddings-engine)**. 35 Vitest tests, full
  typecheck, Biome clean. What landed:
  - `EmbeddingEngine` — runs `snowflake-arctic-embed-m-v2.0` int8 via
    transformers.js/ONNX-WASM inside a Web Worker. Three-tier capability
    discovery: WebGPU → WASM multi-thread (requires `crossOriginIsolated`)
    → WASM single-thread. `ResolvedBackend` surfaces the chosen path,
    thread count, and fallback trail. `createEmbeddingEngine(opts?)` is
    the public factory; `embed(texts, { kind: 'query' | 'document' })`
    auto-applies the arctic-embed v2.0 query prefix; `dispose()` terminates
    the worker.
  - `VectorStore` — persists quantised vectors in a caller-owned Dexie table
    (transactional unity with domain rows; required for future E2EE sync).
    Storage format originally per-vector max-abs int8; **superseded by the
    `D768_EQ_I4_L` int4 codec — see the entry above.** CRUD: `upsert`,
    `update`, `delete`, `deleteWhere`,
    `scan`. Query pipeline: filter by collection → tag / numeric predicates
    in-memory → cosine score → `minScore` floor → sort → `candidateK`
    over-fetch → optional `rerank` hook → `topK`. Optional storage budget
    (`maxCount` + `maxBytes`) with an `EvictionHook` or default
    `BudgetExceededError`.
  - `VECTORS_STORE_SCHEMA` — the Dexie store string to add to the
    consumer's own schema migration (primary key `id`, indexes
    `collection` and `[collection+updatedAt]`).
  - Helper exports (since superseded by the codec API — `encode`, `decode`,
    `cosineQuery`, `serialise`, `deserialise`): the general
    `cosineSimilarity`, `dot`, `l2Norm` remain (for dreaming / dedup consumers).

  **Not yet wired:** no GUI or chat surface; no Dexie v7 `vectors`
  migration in `apps/user-client` — that lands with the first domain
  consumer (memory system). Model fetch (`pnpm --filter
  @chatsundere/embeddings run fetch-model`) and browser smoke test are
  manual steps for Chris.

  Spec: [`superpowers/specs/2026-06-05-client-embeddings-engine-design.md`](../../../superpowers/specs/2026-06-05-client-embeddings-engine-design.md).
  Plan: [`superpowers/plans/2026-06-05-client-embeddings-engine.md`](../../../superpowers/plans/2026-06-05-client-embeddings-engine.md).
