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

### Sync engine (WS-C) follow-up couplings — OPEN 2026-07-03

Registered from the WS-C sync engine build (spec
`superpowers/specs/2026-07-02-ws-c-sync-engine-design.md` §13).

- **Trash restore UI.** The sync engine keeps *pulled* tombstones in a `trash`
  table for 30 days (Larissa M-3 tombstone-flood bound). v1 has NO restore
  surface — trash is internal-only (Chris's call). **When a restore UI is
  built**, it reads `trash` (id `${collection}:${key}`, the plaintext `row`,
  `deletedAt`/`purgeAt`) and re-inserts as a *fresh* uuid (the old key is dead —
  an honest server tombstoned it, and the H-1 trash-anchored terminality guard
  will inertly reject any upsert onto the dead key). Do NOT resurrect under the
  old key.

- **Offline bookmarking — post-alpha revisit (decision 5).** Message
  bookmarking is Class-2 and disabled offline with the gentlest catalogue copy
  (`syncCopy` offline-bookmark). **If alpha testers report friction**, revisit
  making bookmarks a local-first Class-1 append that reconciles on reconnect —
  a deliberate exception to the two-class discipline, weighed against its
  convergence cost. Spec §11.2 / decision 5.

- **Uplevelling MUST re-seal `EncryptedBlob` secrets (Larissa, verified-clean).**
  Provider `apiKey` and MCP-server keys are `EncryptedBlob`s sealed under the
  LOCAL master key's secrets DEK. Sync ships those rows to other devices as
  ciphertext. **When local→linked uplevelling (foreign-MK adoption) is built**,
  every synced `EncryptedBlob` secret MUST be re-sealed under the account MK's
  secrets DEK in the dual-MK join window — a local→linked MK change WITHOUT the
  re-seal silently kills every synced provider/MCP key on every other device
  (they cannot decrypt a blob sealed under the origin device's key). This is the
  single most dangerous uplevelling coupling; it has no runtime guard yet.

- **Strip-list checklist (§10 named property).** New fields on non-`settings`
  synced collections **sync by default** (deny-list polarity). Adding a
  device-local/secret/derived field to any synced collection (`chats`,
  `mcpServers`, …) REQUIRES a conscious entry in
  `apps/user-client/src/sync/strip.ts`'s `DENY_LISTS` (or the
  `SETTINGS_SYNC_ALLOWLIST` for `settings`, which is allowlist polarity). Forget
  it and the field leaks to other devices. Treat a new synced-collection field
  as a strip-list review trigger.

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
