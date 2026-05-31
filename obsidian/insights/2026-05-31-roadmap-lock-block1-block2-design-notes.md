# Roadmap lock — design notes for Block 1 (memory) and Block 2 (search)

**Date:** 2026-05-31. Captured during the roadmap-lock brainstorm with
Chris ([ADR 0031](../decisions/0031-eight-block-roadmap-to-beta.md)).
These are *not yet locked designs* — they are the thinking to carry into
the proper Block-1 and Block-2 brainstorms so it is not lost.

---

## Block 1 — Memory (chatsune port)

The chatsune memory model, as it stands today:

1. **Extraction** writes journal entries.
2. The user **commits** journal entries.
3. Every ~6 hours, when enough committed entries exist, the system
   **"dreams"**: committed journal entries are folded into the **memory
   body**, resolving contradictions.

No embeddings today. Embeddings-based "progressive discovery" (topic
circles / Anthropic-style per-chunk frontmatter for retrieval) is a
*much later* feature for a mature Chatsundere — explicitly out of Block 1
and out of Block 5's initial scope.

### Decisions / principles agreed

- **The persona's driving model performs all persona operations**,
  including dreaming. No separate "utility model", no second key. This
  also means dreaming introduces **no new trust boundary** — the memory
  goes to the same upstream the persona already uses.
- **Dream triggers (compromise):** on app open + a periodic check every
  2-3 hours while the app is open + a threshold trigger when enough
  committed journal entries have accumulated. Run-on-open covers the gap
  left by having no always-on server in local-only mode.
- **Server-side enclaves for dreaming are rejected** — even a TEE would
  process plaintext memory server-side, breaking the §3 zero-knowledge
  rule. (TEE stays interesting for *inference*, e.g. chutes, not for
  dream orchestration.)

### The memory-sync crux (matters for Block 6, decided in Block 1)

Two devices dreaming offline produce two divergent memory bodies that are
not trivially mergeable. Resolution:

> **Committed journal entries are the source of truth (append-only,
> stable IDs, grow-only set → conflict-free set-union merge). The memory
> body is a derived, re-dreamable projection — a cache, not authoritative
> state.** On sync conflict, discard divergent bodies, union the journal,
> re-dream.

Cost-free in Block 1 (local-only, no sync); makes Block-6 memory-sync
tractable. Fits the "Defaults over delete" chatsune lesson.

**Open question for the Block-1 brainstorm:** may the user edit the memory
body *directly*? If yes, the body holds authoritative content not derivable
from the journal → true merge conflict returns. If all corrections flow
through the journal (as a "user-committed correction" entry), the body
stays purely derived and the architecture holds. Lean strongly toward
journal-only edits.

**Token/cost note:** dreaming is an LLM call on the persona's model.
A heavy reasoning model dreams expensively; worth surfacing the cost
characteristic in the UI. Memory consolidation also ships accumulated
personal memory to the upstream — same boundary as the persona, but be
transparent about it.

---

## Block 2 — Web search

Every search provider is BYO-key, exactly like the LLM providers. Same
pattern: a unified `web_search` tool, an adapter per provider, capabilities
diverge per adapter, a config sheet per provider (mirrors `ProviderSheet`).

### Omakase tiering

- **Tier 1 — default, no proxy: nano-gpt web search.** Widest key coverage,
  AI-oriented (good for tool-use), and CORS-friendly → no proxy needed.
  The natural pre-selected default. nano-gpt's ~10 sub-providers are **not**
  exposed initially — use their default AI search as one clean tool; the
  sub-provider zoo is a later power-feature.
- **Tier 2 — popular: ollama-cloud** (fast, reliable, widely held). Verify
  CORS behaviour.
- **Tier 3 — power-user, likely proxy-gated: brave + kagi.** Both excellent
  but probably no CORS headers → shown disabled-with-tooltip until the
  transition proxy is configured (disabled-over-hidden binds availability
  to the proxy cleanly).

### brave + location

Location is a **capability of the brave adapter**, visible only when brave
is active. Because the user's location goes to a search provider, the field
is **explicit, opt-in, default off** — never silently attached. The
"location headache" dissolves into a privacy-respecting setting.
