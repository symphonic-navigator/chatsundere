# Architecture Review — The Knowledge Librarian

**Reviewed:** 2026-07-19  
**Subject:** [[2026-07-19-librarian-architecture]]  
**Reviewer:** Codex

> **Merged 2026-07-19 (Liz):** the load-bearing findings of this review are
> folded into [[2026-07-19-librarian-architecture]]; both code-level claims
> (finding 9 loop coupling/call accounting, finding 4 `DocumentRow` shape)
> were verified against the real code and confirmed. Three recommendations
> touching prior decisions await Chris's arbitration there (§7). This file
> stays as the review's source record.

## Executive assessment

The architecture has a strong and coherent core. An agentic librarian is the
right abstraction if synthesis must do more than generate prose: it must decide
whether to create or update, inspect surrounding material, follow library-local
conventions, avoid duplication, and possibly reconcile several documents.

The design is therefore well aligned with the motivating world-building use
case. Its strongest choices are:

- keeping the memory-body editor one-shot while giving only the knowledgebase
  editor an agentic loop;
- frontloading an index, library conventions, a delegation brief, and recent
  conversational source material;
- making every run a visible, user-initiated chat tool call;
- separating persona-facing discovery tools from librarian-only write tools;
- requiring permissions, versions, auditability, direct links, and no delete;
- testing result quality empirically before committing to a product spec.

There is no fatal conceptual contradiction. However, the document currently
understates several trust, concurrency, privacy, and data-model requirements.
It is best classified as:

- **architecture direction:** ready;
- **synthesis probe:** ready after a small probe contract is added;
- **product specification:** not yet ready;
- **implementation:** not yet ready.

The missing work is architectural hardening, not a reason to abandon the
agentic-librarian decision.

## Load-bearing findings and recommendations

### 1. Transcript forwarding and model fallback form a real privacy boundary

The claim that the transcript window is “all local, no privacy surface” is
incorrect. The messages originate in the local database, but the window is then
sent to a model provider. If a dedicated librarian model is configured, that
provider may differ from the provider used for the conversation itself.

The proposed silent background-helper fallback is also a poor fit for this
operation. The existing background resolver falls back silently because it was
designed for invisible, best-effort chores. Synthesis is a visible action that
writes durable user data. A silent provider change would make both provenance
and data disclosure surprising.

#### Actions

1. Define an exact resolution order, for example:
   `explicit librarian slot -> persona model -> visible failure`.
2. Do not silently cross provider boundaries. If fallback is retained, disclose
   the actual model and provider in the running and completed pill.
3. Explain in the librarian-slot UI that the selected transcript slice and
   knowledge documents are sent to that model's provider.
4. Snapshot the transcript at trigger time and define included message types.
   Explicitly decide how whispers, roleplay-only material, tool results,
   attachments, and compacted history are handled.
5. Bound the transcript by a total token budget rather than only by a message
   count.
6. Store the actual model/deployment used in the synthesis run and in every
   resulting document version.

### 2. A per-library mutex is not sufficient to prevent lost updates

A library guard prevents two local librarian runs from overlapping, but it does
not protect against:

- a manual document edit while the run is active;
- another browser tab;
- a synced device editing the same document;
- a pulled remote update arriving after the librarian read the document;
- a user deleting or changing permissions during the run.

This is particularly dangerous with whole-body replacement: a perfectly valid
write based on an old revision can silently erase a newer edit.

#### Actions

1. Make every index and read result include `currentVersionId` or another stable
   revision token.
2. Require it on replacement:

   ```text
   replace_document(
     id,
     expectedVersionId,
     title,
     summary,
     body
   )
   ```

3. Re-check document existence, target-library membership, effective
   writability, and the expected revision inside the same transaction that
   appends the version and updates the live document.
4. Return a calm conflict error so the librarian can re-read and reconsider.
5. Keep the per-library guard for duplicate-run prevention, but do not treat it
   as a correctness mechanism. A Web Lock can extend the guard across tabs.
6. Design version identity for sync. UUID version IDs plus `parentVersionId` are
   safer than locally assigned sequential numbers because simultaneous devices
   can otherwise create colliding version numbers.
7. Preserve both competing version snapshots where practical, even if sync
   conflict resolution chooses only one as the current head.

### 3. The generated index needs identity and revision data

The proposed index currently lists title, hook, writability, and provenance.
That is insufficient for the librarian's own tool surface. Without an ID it
cannot read or replace without spending a list round; without a revision it
cannot write safely.

A useful v1 index row is:

```text
documentId | currentVersionId | title | summary | role | origin |
effectiveWritability | updatedAt
```

“Structurally incapable of going stale” is also too strong. Rebuilding the
index removes a separately maintained, stale index file, but:

- a user-authored summary can be semantically stale;
- the initial snapshot can become stale during the run;
- another tab or synced device can change the library;
- newly created documents make the frontloaded snapshot incomplete.

#### Actions

1. Reword the guarantee to: “The index is reconstructed from current database
   metadata at spawn and is never maintained as a separate artefact.”
2. Include stable IDs and revision tokens.
3. Assemble index, conventions, permissions, and the initial revision set from
   one consistent read transaction where feasible.
4. Require user-side body editing to update the summary, or provide a clearly
   marked deterministic fallback hook derived from the document body.
5. Enforce a summary length limit and normalize whitespace at the data layer.
6. Decide how empty summaries for legacy documents are represented; do not let
   “empty until first librarian touch” make the librarian blind indefinitely.

### 4. The data model and audit model need explicit separation

The current knowledgebase row has no summary, role, origin, permission override,
or version history. This is expected at the idea stage, but it means the feature
is materially larger than “a system prompt plus a few tools.” It requires data
migration, sync semantics, version storage, rollback/diff UI, and new routing
metadata.

The term `authoredBy` should not serve two meanings. Document origin must remain
stable when somebody else later edits it, while every version needs its own
actor provenance.

#### Recommended shape

```text
Document
  id
  libraryId
  title
  summary
  content or currentVersionId
  role: normal | conventions
  origin: user | persona | import | system
  personaWriteOverride: default | allow | deny
  currentVersionId
  createdAt
  updatedAt

DocumentVersion
  id
  documentId
  parentVersionId
  title
  summary
  body
  actorKind: user | persona | import | system
  personaId
  modelRef
  sourceChatId
  sourceMessageId or synthesisRunId
  createdAt
```

#### Actions

1. Version title, summary, and body together so rollback cannot restore a body
   while leaving a mismatched summary or title.
2. Backfill existing documents with a conservative origin, probably `user` or
   `import`, so legacy content is not writable by default.
3. Record the concrete persona ID, not only the generic value `persona`.
4. Decide whether all personas assigned to a shared library may edit any
   persona-origin document or only documents created by the same persona.
5. Make rollback append a new restoration version rather than erasing audit
   history.
6. Let the chat pill link to the exact resulting version or diff, not merely to
   the document's future current state.
7. Decide whether lightweight audit metadata survives pruning of old body
   snapshots.

### 5. Hard policy, conventions, transcript, and documents need an authority order

The librarian will consume potentially instruction-like text from imported
documents and the transcript. The conventions document is intentionally an
instruction source, but it must still be lower authority than the librarian's
hard capability and safety rules.

Recommended authority order:

1. hard system and tool constraints;
2. the explicit delegation brief;
3. the library conventions document;
4. transcript and ordinary knowledge documents as source material.

#### Actions

1. Bind the internal dispatcher to one target `libraryId` in code. Do not rely
   on the model to preserve scope.
2. Reject a document ID from another library even if it is otherwise readable
   by the persona.
3. Treat ordinary and imported documents as untrusted source material, not
   instructions.
4. Make conventions soft domain policy: they can shape style and filing, but
   cannot override permissions, tool limits, target scope, or the user's brief.
5. Prefer a user- or system-created conventions document that is persona
   read-only by default. The user can explicitly grant its document-level write
   override when persona maintenance is desired.
6. Prevent the librarian from modifying the conventions document unless the
   brief explicitly asks for convention maintenance.
7. Decide whether `role: conventions` is excluded from normal semantic RAG and
   phrase-triggered lore injection. A style guide should not compete with world
   facts in ordinary retrieval.

### 6. “Route around” must not mean bypassing a denied write

The design says a denied write is returned to the librarian so it can route
around it. That wording can encourage a model to create a parallel document
when an intended target is read-only, semantically bypassing the user's
protection and producing duplicate knowledge.

#### Actions

1. State explicitly that permission denial is authoritative.
2. Do not create a shadow copy merely to avoid a denied replacement.
3. Permit an alternative document only when the user asked for it or the brief
   makes the alternative independently useful.
4. Include denied attempts in the structured execution report so the final
   user-facing result cannot conceal them.
5. Rename a library-level switch to something like
   `personaWriteDefault` if an explicit document-level `allow` is intended to
   override it. Calling such a library globally “read-only” would be misleading.

### 7. The internal tool surface should include scoped semantic search

The librarian-facing tools currently include list, read, create, and replace,
but not the existing semantic query capability. An index of good summaries may
be enough for a mature library; it is not enough for a legacy library with
missing or weak summaries.

Without search, the model must either guess or read many complete documents,
increasing both cost and context pressure.

#### Actions

1. Offer a target-scoped internal tool such as:

   ```text
   search_documents(query, limit?)
   ```

2. Reuse the existing knowledge retrieval implementation while hard-binding it
   to the target library.
3. Return document ID, title, heading path, revision, and passage provenance.
4. Keep list for orientation, search for candidate discovery, and read for the
   full document before replacement.
5. Never allow a replacement based only on retrieved passages; require a full
   read of the expected current version first.

### 8. Whole-body replacement is reasonable for v1, but not universally robust

Whole-body replacement avoids brittle exact-string patching and is a sensible
prototype choice. Version history makes a bad rewrite recoverable. It does not,
however, detect or prevent content loss.

The complete Markdown document also has to travel inside a JSON tool argument.
For large documents this can stress model tool-call formatting, provider output
limits, context limits, and JSON parsing. Therefore “maximally robust for weaker
models” is stronger than the evidence currently supports.

#### Actions

1. Probe with realistic document sizes, not only short fixtures.
2. Set an explicit maximum safe replacement size per model context budget.
3. Refuse or warn on unexpectedly large shrinkage, missing major headings, or an
   empty body.
4. Enforce body and summary validation in the tool implementation, independent
   of model behavior.
5. Redact write-body previews from console logging; the existing generic loop
   logs the beginning of tool arguments.
6. Describe versioning accurately: it makes loss recoverable; it does not catch
   loss by itself.

### 9. `runToolLoop` is reusable in principle, but is not a drop-in librarian result

The current loop is coupled to chat rendering. It accumulates every intermediate
content block and internal pill, keeps metadata on the individual pills, and
reports token use only from the last round. A librarian needs one outer pill,
an authoritative mutation record, and reliable partial-failure handling.

#### Actions

1. Either extract a UI-independent agent-loop core or wrap the existing loop
   with a librarian-specific result adapter.
2. Return at least:

   ```text
   finalAnswer
   executions[]
   usageTotal
   roundsUsed
   roundLimitReached
   stoppedByAbort
   ```

3. Record every attempted tool execution with operation, target ID, resulting
   version ID, success/failure, and error reason.
4. Build pill links and the authoritative changed-document list from this
   execution ledger, never from the model's prose report.
5. Treat the model's explanation as supplementary narrative only.
6. Catch provider failure, abort, and round exhaustion after partial mutation;
   return the touched versions and a clear partial-completion state.
7. Keep internal tool pills out of the chat transcript while exposing useful
   progress through the one outer pill.
8. Add a distinct final-round instruction for an honest partial report rather
   than merely removing all tools.

There is also a cost-accounting inconsistency in the current document. With
`maxRounds = 6-8`, the present loop can make 7-9 calls because it adds one
tools-free final pass. “2-6 calls” can be a typical range, but not the hard
maximum. A successful mutation requires at least a tool-producing call and a
following report call; a true one-call degenerate case performs no confirmed
write under the current loop protocol.

### 10. Context and output need one model-aware budget

The frontloaded index, full conventions document, transcript window, delegation
brief, read results, tool exchanges, reasoning, and complete replacement bodies
all share the same context window. Each is bounded informally, but the total is
not.

#### Actions

1. Calculate a total synthesis input/output budget from the resolved offering's
   recommended context, not its advertised absolute maximum.
2. Reserve output space for a whole-document write and final report before
   admitting frontloaded context.
3. Cap or paginate a very large index and signal omissions explicitly.
4. Bound conventions and transcript independently within the overall budget.
5. Limit read results and refuse unsafe whole-body editing when the complete
   source document cannot fit.
6. Preserve the exact source snapshot or source version used for every write.
7. Report indexing state after writes; semantic retrieval may temporarily miss
   a new document or still contain an older embedding until re-ingestion
   completes.

## Product-scope recommendation: read broadly, write narrowly

The motivating request is usually singular: “make an article out of what we
just discussed.” Allowing arbitrary multi-document mutation increases the
feature's risk faster than it increases its value.

For v1, the librarian may inspect broadly but should default to one primary
document mutation. Multiple writes remain technically possible when:

- the user explicitly asks for a cross-document reorganization;
- the conventions clearly require a separate supporting document; or
- the librarian explains why more than one mutation is necessary.

This policy preserves the agentic advantage—choosing the right target and
avoiding duplicates—without making a small request unexpectedly rewrite a
library.

## Recommended internal tool contract

The persona-facing surface remains small:

```text
synthesise_knowledge(libraryId, brief)
list_knowledgebase_documents(libraryId)
read_knowledgebase_document(documentId)
query_knowledgebase(query)
```

The librarian receives capability-scoped closures for one target library:

```text
list_documents()
search_documents(query, limit?)
read_document(id)
create_document(title, summary, body)
replace_document(id, expectedVersionId, title, summary, body)
```

Every successful write should return structured metadata similar to:

```json
{
  "operation": "replace",
  "documentId": "...",
  "versionId": "...",
  "parentVersionId": "...",
  "embeddingStatus": "pending"
}
```

The outer `synthesise_knowledge` result should aggregate these records into:

```json
{
  "runId": "...",
  "model": "...",
  "provider": "...",
  "completion": "complete | partial | no-change",
  "touchedDocuments": [],
  "failedAttempts": [],
  "roundsUsed": 0,
  "roundLimitReached": false
}
```

## Assessment of the model-quality premise

The premise that viable freedom-oriented librarian candidates exist is
plausible. Vendor and project evidence supports strong agentic and tool-use
capability in the named model families:

- [GLM-5.2 release](https://z.ai/blog/glm-5.2)
- [Kimi K2.5 technical overview](https://www.kimi.com/blog/kimi-k2-5)
- [DeepSeek tool-call documentation](https://api-docs.deepseek.com/guides/tool_calls)

That evidence is not sufficient to establish librarian quality. Terminal-Bench
measures hard tasks in terminal environments, not faithful prose synthesis,
filing judgment, or preservation during whole-document rewriting. See the
[Terminal-Bench paper](https://arxiv.org/abs/2601.11868).

Model qualification should eventually be attached to the concrete
model/provider/adapter deployment where possible, rather than assumed solely
from the canonical model identity. Tool-call behavior can vary by route.

## Required synthesis-probe contract

Running a probe before the product spec is the correct next step, but “zero
spec” should mean “no product/UI spec,” not “no experimental contract.” Freeze
a short probe protocol first so results are reproducible and comparable.

### Baselines

Compare at least:

1. a frontloaded one-shot writer given the target explicitly;
2. the agentic librarian with list/search/read/write tools;
3. optionally, the persona model without a dedicated librarian slot.

This comparison is load-bearing. If the agentic version does not improve target
selection, duplicate avoidance, convention adherence, or preservation, the
main use case may be better served by the simpler one-shot design.

### Fixtures

Use several task shapes rather than one favorable conversation:

1. **Create:** derive one article from a real conversation containing relevant
   facts, side chatter, corrections, and a library style guide.
2. **Update:** merge new information into an existing document containing
   seeded facts and headings that must be preserved.
3. **Discovery:** choose correctly between creating and updating when several
   similarly named documents exist and some summaries are absent.
4. **Permissions:** encounter a relevant read-only document without bypassing
   the denial through a shadow copy.
5. **Conflict:** receive a revision conflict, re-read, and recover safely.
6. **Adversarial authority:** encounter instruction-like text in an ordinary
   imported document without treating it as policy.
7. **Scale:** operate on a realistically long document whose complete body is a
   substantial tool argument.

### Predeclared evaluation dimensions

- source-fact coverage;
- unsupported claims and invented facts;
- preservation of existing facts and structure;
- correct create-versus-update choice;
- duplicate avoidance;
- compliance with conventions;
- compliance with target scope and permissions;
- correct conflict recovery;
- number of rounds and tool calls;
- input/output token cost and elapsed time;
- agreement between the model report and the authoritative execution ledger;
- quality and usefulness of the resulting diff.

Run each candidate more than once and record the exact model, provider,
adapter, reasoning configuration, system prompt, tool schemas, tool trace, and
fixture version. A single attractive output is evidence of possibility, not
reliability.

### Hard probe gates

Regardless of prose quality, a candidate architecture should fail the probe if
it permits any of the following:

- a cross-library or unauthorized write;
- silent overwrite of a newer revision;
- a final report that claims writes not present in the execution ledger;
- loss of already executed version IDs after a partial failure;
- a silent provider fallback carrying transcript data elsewhere;
- substantial existing-content deletion without recovery evidence or warning.

## Priority action plan

### P0 — amend before running the probe

1. Freeze the capability boundary and authority order.
2. Add IDs and revision tokens to the index/read contract.
3. Add `expectedVersionId` to replacement, even in mocked tools.
4. Define model/provider resolution and transcript disclosure.
5. Define the structured execution ledger and partial-result behavior.
6. Add scoped semantic search to the librarian toolset.
7. Establish the one-shot comparison baseline and evaluation rubric.

### P1 — decide before the product specification is complete

1. Finalize document/version/provenance schemas and legacy backfill.
2. Define sync conflict and version-branch behavior.
3. Set context, summary, and whole-document size budgets.
4. Define conventions-document uniqueness, authority, writability, and RAG
   treatment.
5. Decide multi-persona authorship and permission semantics.
6. Specify exact version/diff deep links and deleted-document fallback.
7. Specify progress, cancellation, round exhaustion, and partial completion UX.

### P2 — implementation and curation hardening

1. Extract or adapt a UI-independent agent-loop core.
2. Add cross-tab locking in addition to transactional revision checks.
3. Add deterministic shrink and structural-loss warnings.
4. Redact large or sensitive tool arguments from logs.
5. Add librarian qualification to the conversation suite for each relevant
   deployment.
6. Filter the librarian model picker by verified tool, context, freedom, and
   synthesis capability.
7. Add telemetry or local diagnostics for rounds, conflicts, permission denials,
   usage, and partial runs without storing source content unnecessarily.

## Final recommendation

Proceed with the agentic-librarian probe. Do not begin the product specification
from the current document unchanged; first add the four core invariants:

1. explicit and visible model/provider routing;
2. capability-scoped access to exactly one target library;
3. optimistic, versioned writes with conflict detection;
4. a harness-owned execution ledger for links, reporting, and partial failure.

If the strengthened probe demonstrates a material advantage over the one-shot
baseline, the architecture is both coherent and well targeted to Chatsundere's
world-building workflow. If it does not, keep the valuable frontloading,
versioning, and visibility ideas while reducing v1 to a simpler writer. The
probe—not general agent benchmarks—should decide that boundary.
