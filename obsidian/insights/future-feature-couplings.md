# Future-Feature Couplings

> "When you build **X**, you must also do **Y**." A deliberate register for
> cross-feature obligations that a future feature must honour — distinct from
> [[follow-ups-index]] (tech debt) and the STATUS files (current state).
> Add an entry whenever shipping feature A leaves a standing duty on
> not-yet-built feature B.

## Open couplings

### Edit chat messages ⇔ Edit compaction checkpoint — OPEN 2026-06-21

Compact-and-continue ships the compaction summary as **read-only** (transparent
drawer). The data model is already edit-ready (a Markdown field on the
checkpoint row). Editability is deferred until real demand.

**When "edit chat messages later" is built, you (almost) get "edit compaction
checkpoint" for free, and vice-versa** — they are the same agency primitive
(let the user correct what the model carries forward). Build them together. An
edited checkpoint must survive re-compaction (it folds into the next
"Previous Story"). Reference point for where message-edit was genuinely useful:
Spicy-Writer (story generation). Both are post-alpha, demand-driven (feature-
inclusion filter). Spec: `superpowers/specs/2026-06-21-compact-and-continue-design.md` §10.

## Closed couplings

### Memory system ⇒ Chatsune importer memory import — CLOSED 2026-06-20

Resolved: `importChatsuneMemory` (`src/data/chatsune-import.ts`) imports
`memory.json` (`journal_entries` non-archived + `memory_bodies`) on persona-import
Save, content-deduped for idempotency. Plan: `superpowers/plans/2026-06-20-memory-import.md`.

[original block text retained below for the record]

The Chatsune persona importer (`apps/user-client/src/lib/chatsune-import/`) lands
chats + persona core but **defers memories** — Chatsundere has no memory system
yet. The persona parser counts `memory.json` entries (`memoryCount`) and the
import control shows the user a "memories arrive in a future update — re-import
then" note (see the `FUTURE:` comment in `persona-parse.ts`).

**When the memory system is built, you must:** import `memory.json`
(`journal_entries[]` + `memory_bodies[]`) in the persona importer. The chat-merge
idempotency (`importedFrom` dedup) already makes re-import lossless — chats are
skipped, only memories flow in. Spec: `superpowers/specs/2026-06-18-chatsune-import-design.md` §8.
