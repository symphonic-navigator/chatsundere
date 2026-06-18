# Future-Feature Couplings

> "When you build **X**, you must also do **Y**." A deliberate register for
> cross-feature obligations that a future feature must honour — distinct from
> [[follow-ups-index]] (tech debt) and the STATUS files (current state).
> Add an entry whenever shipping feature A leaves a standing duty on
> not-yet-built feature B.

## Open couplings

### Memory system ⇒ extend the Chatsune importer with memory import

The Chatsune persona importer (`apps/user-client/src/lib/chatsune-import/`) lands
chats + persona core but **defers memories** — Chatsundere has no memory system
yet. The persona parser counts `memory.json` entries (`memoryCount`) and the
import control shows the user a "memories arrive in a future update — re-import
then" note (see the `FUTURE:` comment in `persona-parse.ts`).

**When the memory system is built, you must:** import `memory.json`
(`journal_entries[]` + `memory_bodies[]`) in the persona importer. The chat-merge
idempotency (`importedFrom` dedup) already makes re-import lossless — chats are
skipped, only memories flow in. Spec: `superpowers/specs/2026-06-18-chatsune-import-design.md` §8.
