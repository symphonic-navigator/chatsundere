# Client-side memory — architecture analysis, problems & pitfalls

**Date:** 2026-06-01
**Author:** Liz
**Status:** Pre-brainstorm analysis (no decisions yet). Feeds a later spec.
**Scope:** Block-1 memory (the chatsune port), client-only / standalone mode.

> Chris asked for the bird's-eye view before we build: where a flat 1:1 port of
> chatsune's memory would hurt us, and what "we're trapped in the client" really
> costs. This document is the map of the minefield, not the route through it.
> Pitfalls are catalogued **P1…P17** so the brainstorm can reference them.

---

## 0. How to read this

chatsune's memory was a **server** feature: a persistent backend with Redis job
queues and four always-on async loops did extraction, consolidation, decay and
re-ranking in the background — repeatedly, even while the user was asleep. We are
porting that into a **browser tab**. The algorithm ports well; the *runtime*,
the *cost model*, the *encryption*, and the *trust surface* do not. Most pitfalls
below are not "chatsune did X badly" — they are "X was free on a server and is
expensive or impossible in a client".

---

## 1. The central reframe — the backend can never help, ever

The instinct is "we lack a backend *for now*; sync lands at Block 6 and some of
this moves server-side." **That instinct is wrong and it is the most important
thing in this document.**

Hard Rule §3.1 makes the server zero-knowledge: it stores ciphertext and can
never see plaintext, derive keys, or read passphrases. Therefore the server can
**never** — not now, not after sync — read a conversation to extract a memory,
read memories to consolidate them, embed them, or rank them. Every one of those
operations needs plaintext, and plaintext exists only on an unlocked client.

**Consequence:** memory intelligence is a *permanent* client responsibility.
There is no "later we move the worker to the backend". The only compute that will
ever touch memory plaintext is an open, unlocked browser tab — today on one
device, after Block 6 on several, but always the client. Design for that as a
law, not a limitation.

The one bright side: chatsune already chose a design that fits this law. It uses
**no embeddings and no vector search for memory** (`backend/modules/memory/**`
has zero embedding imports; the embedding model serves the *separate* knowledge
base). Memory is string facts + an LLM-consolidated prose "body". Pure functions
over text port to the client almost verbatim. What does *not* port is everything
that made them run *by themselves, repeatedly*.

---

## 2. What chatsune actually does (the thing we're porting)

Compressed from the recon, so the pitfalls have a referent.

- **Two tiers, per-persona** (`_models.py:8-29`): a **journal** of atomic facts
  (`content`, `category`, `state ∈ {uncommitted, committed, archived}`,
  `is_correction`) and a single consolidated **memory body** (free prose,
  monotonic `version`, max 5 kept).
- **Extraction** (`_orchestrator.py:1429-1556`): triggered by **5-min idle
  debounce**, on **WebSocket disconnect**, and a **15-min periodic sweep**. A
  background job calls the persona's model (`temp 0.3`, reasoning off, tools off),
  fed the existing body+journal as dedup context, returns a JSON array of facts.
  String-dedup (normalise + substring) at write time.
- **Injection** (`_assembly.py`): **no relevance ranking** — inject the body +
  *all* journal entries (committed before pending), greedy under a **6000-token**
  budget, recency-ordered, as an XML `<usermemory>` block, last in the system
  prompt. Per-persona `use_memory` toggle.
- **"Dreaming" = consolidation** (`_consolidation.py`): a background job, gated on
  committed-entry counts (**≥25 immediately, ≥10 if ≥6h since last**), asks the
  LLM to merge/dedup/drop and rewrite the body under **3000 tokens**, then
  archives the processed entries.
- **Decay**: uncommitted→committed **auto-commit after 48h**; a **50-entry** cap on
  uncommitted (oldest discarded). No importance scoring; the body never decays.
- **Surface**: a full per-persona CRUD UI (uncommitted / committed / body+versions)
  plus manual "extract now" / "dream now".

The whole maintenance story — auto-commit, dream-trigger, periodic-extraction,
job-consumer — is **four long-lived server loops** (`backend/main.py:251-488`) on
a Redis queue with cross-device in-flight slots and Mongo-transaction atomicity.
That block is exactly what we cannot have.

---

## 3. What the client already gives us (scaffolding — the good news)

- **The memory slot exists.** `composeSystemPrompt` has an ordered
  `memoryContext` layer, **last** position, just a `string`
  (`packages/llm-unified/src/composition.ts:11-36`). It's hard-wired `''` at three
  sites — live send (`stream-engine.ts:54-60`), title-gen
  (`title-generator.ts:91-97`), and the context-gauge estimate
  (`chat-page.tsx:198-204`). Wiring injection = flip those literals.
- **The token gauge auto-counts memories** once they enter `composeSystemPrompt`
  — provided we mirror the same string into the gauge's call (`chat-page.tsx:194-212`).
- **title-gen is the precedent background job** and a near-perfect template
  (`title-generator.ts` + `stream-manager.store.ts:276-286`): fire-and-forget
  after a stream finalises, **race-guarded** (re-read, bail if user already set
  a title), and **adapter-safe** via `runOneShotCompletion` /
  `composeOneShotWire` — the path our [[project_background_jobs_need_adapter_path]]
  lesson mandates (a raw body silently breaks reasoning models). Secrets are
  opened up-front on the user gesture and threaded in; the MK is never put into
  the background task.
- **Sealing is ready.** `sealSecret`/`openSecret` with `slotId`-as-AAD
  (`lib/secrets.ts`); `EncryptedBlob` is Dexie-safe. A memory body would seal
  under a slot like `memory/<rowId>/body`, mirroring the credential pattern.
- **A clean Dexie `version(9)` migration is low-risk** (v7/v8 are no-op capability
  bumps; `client-data-db.ts:262-283`). No `memories` table exists yet — greenfield.
- **The conceptual home is clear.** Memory is the AI-extracted, evolving sibling
  of the user-authored `aboutMe` layer, naturally **per-persona** (the
  `aboutMeOverride` field already implies persona-level personalisation).

---

## 4. The pitfalls

### Theme A — "Background work" does not exist in a client

> The recon confirmed **zero** `visibilitychange` / `beforeunload` / `pagehide`
> handlers in the app; the Service Worker runs no app logic and holds no MK; there
> is no Web Worker; a backgrounded mobile tab drops in-flight `fetch`es.

- **P1 — chatsune's primary trigger is the worst possible one for us.** It extracts
  after **5 minutes of silence**. That is precisely the moment the user has
  switched tabs, locked the phone, or closed the app — i.e. exactly when the client
  *cannot* run. Porting the idle-debounce 1:1 means extraction almost never fires.
- **P2 — "extract on close" is essentially unavailable.** `pagehide`/`beforeunload`
  give a tiny, unreliable window (worst on mobile) and you cannot await an LLM call
  in it. chatsune's disconnect trigger has no working client analogue.
- **P3 — the periodic sweep has no home.** Nothing wakes a closed tab. Background
  Sync / Periodic Background Sync are dead ends here: they cannot hold the MK and
  are effectively absent on iOS.
- **Direction (analysis, not decision):** invert the trigger. Extract **while the
  user is present**, piggybacking the live, unlocked session like title-gen does
  (right after a persona message finalises), gated by **message count, not
  wall-clock idle**. Treat the session-start / unlock event as the client's only
  reliable recurring tick — the substitute for chatsune's loops. Make every job
  idempotent + race-guarded + re-triggerable, and persist a **durable watermark**
  ("extracted up to message X") in Dexie so a missed extraction is caught next
  session rather than lost. Trade-off acknowledged up front: this adds cost and a
  little latency to *active* use, and we forfeit the "process during a quiet
  moment" luxury.

### Theme B — Cost: every memory op is billed to the user

> chatsune held the provider key server-side with generous daily budgets. Here the
> user's own key pays for every extraction and every dream, and they feel each token.

- **P4 — extraction frequency = direct user spend.** If we extract after every
  persona message, a chatty user pays a *second* call per turn plus periodic dream
  calls — potentially rivalling the cost of the chat itself.
- **P5 — which model?** chatsune used the persona's (possibly expensive) model. Using
  Opus to distil "user likes oat milk" is wasteful — but we cannot assume a cheap
  model is configured; the user may have exactly one provider. And the job **must**
  route through `runOneShotCompletion` or reasoning models return empty `content`
  ([[project_background_jobs_need_adapter_path]]).
- **Direction:** batch extraction on a count threshold (not per-message); make the
  extraction model a cheap-by-default omakase choice with a sensible fallback to the
  persona's model; keep dreaming infrequent and count-gated; consider surfacing cost
  ("memory used ~N tokens this session") for the Proton-trust bar. **Open product
  question:** is auto-extraction on by default or opt-in? Cost makes this real, and
  it intersects [[project_anti_censorship_stance]] / privacy framing.

### Theme C — Retrieval, and the no-embeddings reality

- **P6 — "inject everything" only scales *because of* dreaming.** chatsune's
  no-ranking, inject-all-under-budget approach is correct and ports — but it stays
  cheap only because the dream pass keeps the body < 3000 tokens and bounds the
  journal. If consolidation is unreliable client-side (Theme A), the journal grows,
  the budget greedily truncates, and retrieval **silently** drops memories. The
  weakest link (background maintenance) directly degrades recall. Retrieval quality
  is a function of whether maintenance actually runs.
- **P7 — no DB-level top-k.** Sealed bodies are opaque bytes; IndexedDB cannot
  filter/search/rank them (recon §6). Selection must **decrypt-all-then-filter in
  JS**. Fine for a small per-persona store; a latency/perf cost on every send (esp.
  mobile) if memory ever grows large or becomes global-across-personas.
- **P8 — embeddings are mostly a trap here.** Provider embeddings APIs aren't
  offered by all freedom-providers, leak memory content as an extra call, and cost.
  A local WASM model (transformers.js MiniLM, ~tens of MB) is fully private but a
  heavy download and slow on mobile. chatsune's lesson — *you don't need embeddings
  if you consolidate well* — is the escape hatch. Lead string+LLM; treat embeddings
  as a far-future optional enhancement, not a v0.2 dependency.
- **Direction:** keep inject-body+bounded-journal-under-budget; invest in making
  consolidation robust *precisely because* retrieval leans on it; **decrypt once per
  unlock into an in-session cache**, not once per send; scope per-persona to keep
  each store small.

### Theme D — Encryption, indexing & the data-model fork

- **P9 — you cannot query encrypted memory.** Only plaintext index columns
  (`personaId`, `state`, `createdAt`, `version`) can be Dexie indexes; anything
  semantic must be decrypted to be used (recon §6). Row shape = plaintext metadata +
  sealed body blob, mirroring the provider-key pattern.
- **P10 — the two-tier model multiplies the encryption surface.** Sealing each tiny
  journal entry individually means many `openSecret` calls per send. Sealing the
  whole per-persona memory (journal + body) as **one** sealed document is cheaper to
  read but coarser to sync/merge. **This is a genuine fork** — granularity for future
  conflict-resolution vs decrypt cost today.
- **P11 — sync-awareness must be designed in NOW, though sync is Block 6.** Per
  [[project_sync_critical_edits_two_phase_commit]] and the "defaults over delete"
  lesson: stable UUIDv7 IDs, `updatedAt`, conceptual-delete-as-update from day one.
  Because the server is zero-knowledge, future sync is **ciphertext-blob sync with
  client-side conflict resolution** — LWW or merge happens on-device. chatsune's
  versioned body (monotonic `version`, 5 kept) is a nice fit for this; the journal's
  per-entry hard-delete is less so. Retro-fitting sync-awareness onto a naïve model
  later will be expensive.

### Theme E — Trust, hallucination & the curation surface (mandatory, not optional)

- **P12 — auto-extraction hallucinates, and a bad memory poisons every future
  prompt.** A wrong "fact" injected every turn compounds. This is *more* dangerous
  here than in chatsune because we have weaker background validation budget (every
  validation pass is another billed call).
- **P13 — the uncommitted→committed→archived state machine assumes background
  promoters we don't have.** Auto-commit-after-48h and dream-archival are server
  loops; client-side, entries pile in "uncommitted" forever unless promotion runs as
  session-start catch-up. The 48h "review window" semantics change meaning when the
  timer only ticks while the app is open.
- **Direction:** a visible per-persona memory surface is **essential** here, not a
  nice-to-have — it is simultaneously the only safety valve against hallucination and
  the central trust signal ("see exactly what the AI knows about you; edit or delete
  anything"), squarely on the Proton bar and our [[project_anti_censorship_stance]] /
  [[project_constructive_error_handling]] ethos, and it fits neurodivergent-calm
  ([[project_neurodivergent_audience]], one intent per screen). Strongly consider
  **simplifying the state machine** to what the client can actually run — e.g. plain
  "active" memories the user edits/deletes, with extraction *proposing* additions
  (dismiss-able), or auto-accept with trivial undo (omakase). The "persona authors
  its own memory via a tool" feature depends on the tool-loop, which is deferred.

### Theme F — Concurrency without Redis (single device, multi-tab)

- **P14 — multi-tab duplicate extraction / dream races.** A user can open several
  tabs (each unlocks the MK independently, in its own memory). Two tabs firing
  extraction over overlapping messages → duplicate memories; two simultaneous dreams
  → clobbered body version. chatsune's Redis in-flight slots prevented this; we have
  nothing by default.
- **Direction:** a client-side lock — the **Web Locks API** (`navigator.locks`) for a
  per-persona "memory-maintenance" lease, plus the Dexie watermark as the durable
  idempotency anchor and the monotonic body `version` as the lost-update guard.

### Theme G — Determinism & testing

- **P15 — opportunistic, lock-gated, lifecycle-driven glue is the hardest thing to
  test**, and our lessons warn against brittle retry/phrase tests and favour manual
  verification for UX ([[feedback_test_eagerness_vs_spec_rigour]]). Keep the pipeline
  (extract-prompt → parse → dedup → store; assemble → inject) **pure and unit-tested**;
  keep the triggers/locks/lifecycle thin. Extraction *quality* is a `/curate`-style
  live-eval concern, **never CI** (provider keys never enter CI; CLAUDE.md §10).

### Theme H — Pre-existing gaps memory will inherit

- **P16 — `aboutMeOverride` is wired in the editor but dead at send-time.**
  `send-message.ts:81` passes `settings.globalAboutMe` unconditionally; the
  per-persona override (`PersonaRow.aboutMeOverride`) has no read site outside the
  editor. If memory adopts the same global/per-persona split (it should), this
  resolution must be fixed or consciously mirrored — otherwise per-persona memory
  scoping will silently behave like `aboutMeOverride` does (i.e. ignored).
- **P17 — `projectInstructions` is a pure stub** (`composition.ts:7`, hard-wired
  `''`; no entity/table/field). Memory and "projects" are adjacent layers; deciding
  memory's scope (persona vs global vs project) should not paint the future Project
  feature into a corner.

---

## 5. The shape of the data model fork (for the brainstorm)

Two ends of a spectrum, both legal:

- **Coarse — one sealed memory document per persona** (body + embedded journal as
  structured JSON, sealed as a single blob; plaintext metadata = `personaId`,
  `updatedAt`, `version`). Cheapest to read (one `openSecret` per send, cache per
  unlock), simplest LWW sync unit. Weaker for fine-grained multi-device merge and
  for indexing individual entries.
- **Fine — journal entries + body as separate sealed rows** (closer to chatsune).
  Better future merge granularity and per-entry UI operations; pays many decrypts
  per send and a fiddlier sync story.

My instinct (analysis, not a decision): **start coarse**, because retrieval
decrypts everything anyway (P7), the per-persona store is small, and the body is the
natural sync/LWW unit — but only if the curation UX doesn't demand per-entry
addressing. This is exactly the kind of call to settle with Chris in the brainstorm.

---

## 6. A "go slow" sequencing (Chris's explicit ask)

Do **not** port two-tier + dreaming + state-machine + CRUD in one sprint. Sequence so
each step ships value and answers the hard empirical questions before we commit to
the expensive ones. One scope per session.

1. **Injection + manual memory first.** A `memories` table (sync-aware IDs, sealed
   body), a visible per-persona memory surface, explicit "remember this" + a
   hand-editable body, wired into `composeSystemPrompt` (flip the three `''`). **No
   LLM extraction yet.** This delivers real value, locks in the data model /
   encryption / injection / gauge / sync-awareness, and is fully
   deterministic/testable. It also builds the trust surface (Theme E) before any
   hallucination risk exists.
2. **Auto-extraction second.** The title-gen-pattern background job — count-gated,
   adapter-safe (`runOneShotCompletion`), cheap-model default, watermark + Web-Locks
   idempotent. Now extraction *quality* is observable and tunable via live probes.
3. **Consolidation ("dreaming") third** — only once the journal actually grows and we
   can see whether inject-all-under-budget needs it, with the maintenance running as
   session-start catch-up + an in-tab interval while open (never assumed when away).

This staging matches [[feedback_test_eagerness_vs_spec_rigour]] ("Quality 10 over
100", spec/plan/audit discipline) and keeps every milestone device-verifiable.

---

## 7. Open questions for the brainstorm (Chris decides)

1. **Auto-extraction: default-on or opt-in?** (P4/P5 — it spends the user's money.)
2. **Extraction model:** cheap-omakase-default, persona's model, or a user setting?
3. **Trigger:** post-message count threshold? on every Nth turn? on unlock catch-up?
   never-while-away is a given.
4. **Scope:** per-persona only, global, or both (mirroring the aboutMe global/override
   split — and then we must fix P16)?
5. **Data-model granularity:** coarse single sealed doc vs fine per-entry (§5).
6. **Curation UX:** propose-and-confirm vs auto-accept-with-undo; how much of
   chatsune's three-tier UI survives client simplification (P13).
7. **Embeddings:** confirm we explicitly defer them (P8) — string+LLM only for v0.2.
8. **Cost transparency:** do we surface memory token spend to the user?

---

## 8. Bottom line

The good news is real: chatsune's memory is string + LLM, no embeddings, so the
*intelligence* ports cleanly. The hard news is structural and permanent: there is no
background runtime and there never will be a server-side one (§1). Every pitfall of
weight — P1 (the idle trigger inverts), P4/P5 (the user pays), P6 (retrieval depends
on maintenance that can't be guaranteed), P9–P11 (encrypted, un-indexable,
sync-someday data) and P12/P13 (hallucination needs a trust surface) — traces back to
that one law. The winning move is almost certainly **not** to fight it with Service
Workers and background-sync hacks, but to lean into the session as the unit of work,
keep the store small and per-persona, make the curation surface a first-class trust
feature, and stage the build so cost and quality are measured before they are
committed to.

---

### Appendix — key anchors

- chatsune: `_models.py:8-29`, `_extraction.py:89-127`, `_extraction_core.py:83-356`,
  `_assembly.py:4-48`, `_consolidation.py:4-48`, `_repository.py:147-270`,
  `backend/main.py:251-488`, `_orchestrator.py:1429-1556`, `frontend/src/features/memory/`.
- chatsundere: `composition.ts:3-36`, `stream-engine.ts:54-60`,
  `title-generator.ts:91-132`, `one-shot-completion.ts:45-143`,
  `stream-manager.store.ts:128-338`, `client-data-db.ts:86-283`, `lib/secrets.ts`,
  `session.store.ts:5-52`, `send-message.ts:35-83`, `token-estimator.ts`,
  `chat-page.tsx:194-212`, `sw/register.ts:4-10`, `persona-editor.tsx:471-472`.
