# Knowledgebase — Chunk C (Lorebooks / phrase-triggered injection) — Design

**Date:** 2026-06-08
**Author:** Liz (with Chris, brainstormed end-to-end)
**Status:** Approved design, ready for implementation plan
**Roadmap:** Block 5 → v0.2.0 (knowledge base). Client-only.

---

## 1. Context & overall feature

The knowledgebase ships as independently valuable chunks on the value ladder
*manage → use → automatic*:

- **Chunk A (shipped, `0ef499f`) — Foundation.** Libraries, on-device ingestion,
  the *My Knowledge* room.
- **Chunk B (shipped, `8d3e496`) — Retrieval.** Model-driven: a
  `query_knowledgebase` tool + a Band-2 awareness segment naming the assigned
  libraries; the model *decides* to search; hits are semantic chunks (topK).
- **Chunk B2 (shipped, `88f5c7d`) — Attach document.** User-driven: attach a
  whole document to a message as a first-class attachment.
- **Chunk C (this spec) — Lorebooks.** The *automatic*, deterministic
  counterpart to retrieval. When a **trigger phrase** appears in the current
  exchange, the document's full content is injected into the prompt — no tool,
  no model decision. SillyTavern world-info, scoped and made transparent.

The three "use" surfaces are deliberately complementary: retrieval is
*model-chosen, semantic, partial*; attach is *user-chosen, explicit, whole*;
lore is *automatic, phrase-exact, whole*.

### Why this is its own chunk

Lore reuses Chunk A's data model wholesale — the `triggerPhrases: string[]`
field was **reserved on `DocumentRow` in Chunk A (v14)**, so there is **no
migration**. It plugs into the same per-send seam as Chunk B
(`buildKnowledgeContext` → a Band-2 prompt segment) and the same effective-library
scope. It is the last knowledge-base feature before v0.2.0.

---

## 2. Mental model — one decision

A lorebook entry **is** a knowledge document with trigger phrases. There is no
separate "lorebook" entity or library type. Any document can be retrieval-able
*and* phrase-triggered at once; a library mixes both freely. Empty
`triggerPhrases` ⇒ the document never fires as lore (retrieval-only). This is
exactly what the reserved field anticipated and keeps the data model lean.

---

## 3. Architectural approach (the one real fork)

Lore mirrors the **Chunk B retrieval seam**, not a tool and not a new subsystem:

- A new **pure module** `knowledge/lore.ts` (matching + budget + formatting),
  the deterministic sibling of `knowledge/retrieval.ts`.
- Built **per send** in the send-path (`data/send-message.ts`), exactly where
  `buildKnowledgeContext` already runs, threading a `loreContext` string + a
  `kb-injection` pill through the existing prompt/stream plumbing.
- **Not a tool** — injection is deterministic, no model decision, so it does not
  belong in `resolveActiveTools`.
- **Not a new scope model** — it shares `computeEffectiveLibraries` with
  retrieval (§6). Two scope models side by side would confuse both the build and
  the user.

Rejected alternatives: a `inject_lore` tool (defeats determinism); a separate
lorebook table/library kind (the reserved field already says otherwise);
retrieval-style chunking of the matched document (defeats the whole-content,
WYSIWYG intent — §5).

---

## 4. Data model (no migration)

- **`DocumentRow.triggerPhrases: string[]`** — already exists (v14). Normalised
  on save by a new `normalisePhrases`: `trim` → `toLowerCase` → collapse `\s+`
  to a single space → drop empties → dedupe (order-preserving). This differs
  from `normaliseTags` (which does **not** collapse internal whitespace) — a
  user typing `"roter  drache"` (double space, or a soft-wrapped newline they
  can't see) must match `"roter drache"`. `normalisePhrases` lives beside
  `normaliseTags` in `lib/treasury-filter.ts` (the single source the `TagEditor`
  already imports its normaliser from) and is reused by both the editor and the
  matcher.
- **`DocumentRow.triggerOnCompanion?: boolean`** — **new, default `false`.**
  Non-indexed → Dexie stores it schemalessly → **no version bump** (same
  technique as `bookmarkLabel` / `triggerPhrases` itself). When `false`, only
  the user's just-sent message is scanned; when `true`, the immediately
  preceding companion message is scanned as well (§5).

---

## 5. Trigger & match semantics (deterministic, per-turn, ephemeral)

**Scan text (per document).** Always the user's just-sent message, normalised.
**Additionally** the *immediately preceding* assistant message (the one turn
before), normalised, **only if** that document's `triggerOnCompanion` is `true`.
No wider window: a phrase that appeared earlier already triggered when *that*
message was the current one, so a window would be redundant. Both normalised
texts are computed once per send; per-document matching just selects which of
the two it may scan.

**Match.** A normalised phrase matches as a **substring bounded by Unicode word
boundaries**: build, per phrase, a regex
`(?<![\p{L}\p{N}])<escaped-phrase>(?![\p{L}\p{N}])` with the `u` flag (and `i`,
though both sides are already lowercased). **Not** ASCII `\b` — that treats
ö/ä/ü as non-word characters and would mis-bound German words. Regex
metacharacters in the phrase are escaped before assembly. Word-boundary (not
plain substring) is a deliberate precision choice: `blume` must **not** fire on
`"blumen"`, and a story's `"blumenwiese e.v."` must **not** fire while the user
discusses *kinds of flowers* — false injection actively derails the companion,
which users hate more than a missed trigger.

**Ephemeral.** Recomputed every generation (including regenerate); the
"activation" is never persisted.

---

## 6. Injection: scope → collect → budget → prompt + pill

**Scope.** `computeEffectiveLibraries(persona.libraryIds ∪ chat.libraryIds, all,
persona.adultPersona)` — **identical to retrieval.** Only documents in an active,
NSFW-permitted library are candidates. The assignment *is* the safety valve
against derailment, so scope is shared, not widened.

**Collect.** Every candidate document with at least one phrase matching its
allowed scan text, in a **stable order**: library order (as returned by
`computeEffectiveLibraries`), then document `createdAt` ascending. Deterministic
so the prompt and pill are reproducible.

**Budget (device-tunable, mirrors `KNOWLEDGE_RETRIEVAL_OPTS`).**
`KNOWLEDGE_LORE_OPTS = { maxEntries: 8, maxTotalChars: 8000 }`. Walk the ordered
matches accumulating content length: include whole entries until the next would
exceed `maxTotalChars`; that overflowing entry is **truncated** to the remaining
budget with a trailing `…` marker; further entries (and anything past
`maxEntries`) are **omitted**. Counts are surfaced in the pill.

**Prompt.** A **new Band-2 segment `lore`** — a `loreContext?: string` added to
`BuildPromptInputs` and a `SegmentSpec` (`band: 2`, `jobs: CHAT_ONLY`), ordered
**after `memories` and before the `knowledgeLibraries` awareness segment** (lore
is concrete injected content; awareness is only a pointer). Re-number the
existing Band-2 orders accordingly (`lore` = 3, `knowledgeLibraries` = 4). Each
entry is a provenance-headed block, analogous to `formatRetrieval`:

```
[Library › Document]
<full (or truncated) content>
```

with a short framing line introducing the set (e.g. "Relevant background from
the user's knowledge:").

**Pill.** One `kb-injection` pill per turn (the reserved `PillRow.kind`),
`status: 'completed'`, with
`payload = { entries: { libraryName, documentTitle, injectedText }[],
omittedCount, truncatedCount }`. `injectedText` is the text **actually**
injected (post-truncation) — honest, WYSIWYG transparency. Tap-to-expand shows
each entry's provenance + injected text. **No match ⇒ no pill.** Transparency is
a core differentiator, and "why does it suddenly know this?" is precisely the
question automatic injection must answer.

---

## 7. UI (My Knowledge → DocumentEditor)

- In the existing `DocumentEditor`: the shared **`TagEditor` in `edit` mode**
  for trigger phrases — Chris's explicit requirement (trigger phrases *are* tags
  structurally; reuse the component, don't rebuild). The component gains an
  **optional `normalise?: (values: string[]) => string[]` prop** (default
  `normaliseTags`); the lore editor passes `normalisePhrases` so the displayed
  chip form matches the stored form. Autocomplete suggestions = distinct phrases
  already used by **other documents in the same library** (lightweight reuse).
- Directly below: a plain toggle **"Let the companion trigger this too"**
  (`triggerOnCompanion`), **disabled-with-tooltip when no phrases are set**
  (disabled-over-hidden) — the toggle is meaningless without phrases.
- **No re-embedding on phrase/toggle change.** Editing `triggerPhrases` or
  `triggerOnCompanion` touches no vectors, so it must **not** enter the
  re-embed path (only `content` edits do, as in Chunk A). This is an explicit
  branch in the editor's save logic.

---

## 8. Edge & empty states (constructive — the *dere* half)

- Document with empty `triggerPhrases` → never fires; companion toggle disabled.
- No effective libraries → lore is inert (same as retrieval returning null); no
  pill.
- A document that both fires as lore *and* is later queried by the model via
  retrieval may surface the same content twice in one turn. Accepted as a minor,
  not engineered around — both paths are honest about what they did, and the
  budget caps total lore size regardless.
- Phrase normalising to empty (all whitespace) → dropped on save.

---

## 9. Testing & verification

- **Unit (`knowledge/lore.ts` + helpers):** `normalisePhrases` (whitespace
  collapse, dedupe, lowercase); word-boundary matching — umlaut words, German
  compounds (`drache` must **not** fire on `drachenblut` under word-boundary;
  add `drachenblut` separately to fire), `blume` ↔ `"blumen"`, the
  `"blumenwiese e.v."` non-match while discussing flowers, regex-metachar
  escaping; companion-scan gating by `triggerOnCompanion`; budget truncation
  (whole/ truncated/omitted partitioning, `maxEntries`, `maxTotalChars`); stable
  ordering.
- **Prompt (`composition.test.ts`):** `lore` segment ordering (after memories,
  before knowledgeLibraries), absent when `loreContext` empty, chat-only.
- **Component:** `DocumentEditor` — TagEditor with `normalisePhrases`, the
  companion toggle's disabled-without-phrases state, no re-embed on phrase edit.
- **Integration (send-path):** a matching phrase produces the Band-2 lore text +
  a `kb-injection` pill with the right entries/counts; no match → no pill.
- **Full suite** before squash (`pnpm typecheck`, user-client vitest, build,
  biome) per the per-task-runs-full-suite rule.

---

## 10. Manual verification (device — Chris)

With a SFW library assigned to a persona, containing a small document
("Roter Drache" lore) whose trigger phrases are `roter drache`, `drachenblut`:

1. In *My Knowledge* → the document editor: add the two phrases via the chip
   editor (confirm `"roter  drache"` with a double space stores as
   `roter drache`); the companion toggle is disabled until a phrase exists, then
   enabled — leave it **off** first.
2. In a chat with that persona, write a message mentioning **"Roter Drache"** →
   send → a `kb-injection` pill appears; expand it → it shows
   *Library › Document* + the injected content; the reply reflects the lore.
3. Write a message about **"Drachen im Allgemeinen"** (no exact phrase, no
   `drachenblut`) → **no** pill, no injection (word-boundary precision).
4. Discuss something where a near-miss exists (e.g. a phrase `blume` and a
   message about "Blumen") → confirm it does **not** fire.
5. Turn the companion toggle **on**. Have the companion mention "Roter Drache"
   in its reply; your next message need not contain the phrase → the lore fires
   from the preceding companion turn.
6. Turn the toggle **off** again → the companion's mention no longer triggers.
7. Add many/large lore docs so the budget is exceeded → the pill shows
   omitted/truncated counts and the injected text is capped.
8. Unassign the library from the persona → lore stops firing entirely (scope is
   the safety valve).
9. Editing a phrase does **not** re-embed (status stays `ready`); editing the
   document **content** does.

---

## 11. Deliberately out of scope

- Library- or persona-level lore defaults (per-document is the chosen grain).
- Recursive/secondary activation (lore entries triggering other lore).
- Probability/weight, priority groups, "constant" always-on entries
  (SillyTavern advanced knobs) — phrase-or-nothing for v0.2.0.
- Token-accurate budgeting — char count is the pragmatic on-device proxy.
- A `tags`-set-membership filter in `packages/embeddings` (separate follow-up).

---

## 12. Files (anticipated)

**New**
- `apps/user-client/src/knowledge/lore.ts` — pure matching + budget + format.
- `apps/user-client/tests/knowledge/lore.test.ts`.

**Changed**
- `apps/user-client/src/boot/client-data-db.ts` — `triggerOnCompanion?: boolean`
  doc comment (no schema/version change).
- `apps/user-client/src/lib/treasury-filter.ts` — `normalisePhrases` (beside
  `normaliseTags`).
- `apps/user-client/src/components/artefact/TagEditor.tsx` — optional
  `normalise` prop.
- `apps/user-client/src/data/send-message.ts` — build `loreContext` + pill per
  send (beside `buildKnowledgeContext`).
- `apps/user-client/src/state/stream-manager.store.ts` /
  `apps/user-client/src/lib/stream-engine.ts` — thread `loreContext` into
  `buildPrompt`; emit the `kb-injection` pill.
- `packages/llm-unified/src/composition.ts` — `loreContext` input + `lore`
  Band-2 segment + re-order.
- `apps/user-client/src/routes/app/knowledge/**` (DocumentEditor) — phrase
  editor + companion toggle + no-re-embed branch.
- Corresponding tests.

**Not a Larissa change** — client-only; no auth/sync/proxy/crypto; no new
network egress (lore rides the existing on-device prompt path).
