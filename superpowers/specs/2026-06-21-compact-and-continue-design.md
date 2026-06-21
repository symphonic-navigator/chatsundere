# Compact and Continue — Design Spec

**Date:** 2026-06-21
**Author:** Liz (with Chris)
**Status:** Approved for planning
**Side:** Client-only (`apps/user-client`)
**Audit gates:** Laura spec-pass + pre-squash (new user-reachable flow). **No Larissa** — no auth/sync/proxy/crypto path.

---

## 1. Motivation

Long conversations suffer three well-known, legitimate complaints:

- **(a)** Conversations eventually die when the context window fills up.
- **(b)** LLMs get measurably *less* capable as the context fills — a structural property, not a bug.
- **(c)** Conversations get *more expensive* the more they carry (5 × 200 K context sent is already 1 M input tokens — even with caching, easily ~50 cents on premium models).

The enabling insight: **what matters is *what* was discussed and *how it went*, not the verbatim detail** — because we keep the last *N* messages 1:1, which preserves tone, register, and recent specifics. Tool-call results (`web_search`, `web_fetch`) are throwaway raw material: what matters is the *conclusion* drawn from them, not the raw thousands of tokens. (A GitHub file shown mid-chat is a few thousand tokens; often the only thing that mattered was "the README describes how the deployment actually works".)

A second, decisive enabler is **modern context windows**. When windows were 4–8 K, "summary *plus* the last N messages" was a zero-sum fight for tokens. At 131 K (which is *small* by today's standards) the tail costs only a few K tokens and the summary is tiny. We no longer fight for tokens — we keep the tail generously, purely for smoothness. This is the combination of *doing it cleverly* and *using what the present makes possible*.

### 1.1 The reframing — from silent loss to intelligent summary

chatsundere **already** discards old messages: `truncateToWindow` (`apps/user-client/src/lib/context-window.ts`) silently drops the oldest wire messages once the context exceeds budget. Today the user loses that information **without comment**. Compact-and-continue is therefore not merely a new feature — it is an **upgrade from silent data loss to an intelligent summary**. It is chatsundere's *dere* philosophy (constructive error-handling) applied to context overflow.

### 1.2 What we port from chatsune

The feature exists, proven, in chatsune (server-side). We port its **substance** 1:1, adapting only what changes because we are client-side / local-first. chatsune reference: `~/workspace/chatsune/backend/modules/chat/_compaction.py`, `_orchestrator.py`, `jobs/handlers/_chat_compaction.py`, and `frontend/src/features/chat/compaction/*`.

**Dropped** because we are client-side: daily-budget enforcement (SG-002), the server job queue, the Mongo session document. This makes the port *smaller*, not larger.

---

## 2. Infrastructure reuse

Almost every piece chatsune built server-side already exists client-side from the memory work:

| Need | Existing chatsundere mechanism |
|---|---|
| LLM call for the summary | `runOneShotCompletion` (`packages/llm-unified/src/one-shot-completion.ts:153`) — the **same per-model adapter path** as memory's `callModel` (`apps/user-client/src/memory/pipeline.ts:50–73`), so reasoning translation and provider headers are applied correctly |
| Token estimation | `estimateTokens` + `contextUtilisation` (`apps/user-client/src/lib/token-estimator.ts`) — 4-chars-per-token heuristic |
| Tail truncation primitive | `truncateToWindow` + `resolveContextWindow` (`apps/user-client/src/lib/context-window.ts`) |
| Inject summary into the prompt | the `memoryContext` slot in `buildPrompt` + the `assembleMemoryContext` XML pattern (`apps/user-client/src/memory/assembly.ts`) |
| Cursor / checkpoint pointer | `ChatRow.lastExtractedMessageId` is exactly this pattern (`client-data-db.ts`) — we add a sibling pointer + a checkpoint table |
| Background job after a send | `fireMemoryPipeline` (fire-and-forget, per-persona mutex; `state/stream-manager.store.ts:147–187`) |

**Reasoning must be disabled** on the summary call, exactly as memory's `callModel` does (`reasoning: { enabled: false }`), so the summary lands in `content`, not the reasoning channel. This is the recurring "background jobs need the adapter path" lesson.

---

## 3. Trigger model — three layers (hybrid)

The central decision: compaction is **lossy and visible**, so the deliberate cut belongs to the *user* (agency); but the *fallback* must no longer be today's silent loss. Three layers achieve both.

### Layer 1 — Manual (the normal path)

There is **no separate ✨ button** (a deliberate departure from chatsune's progressive-button ladder — chatsundere has no chat header, and the cockpit controls row is already nine icons at 380 px). Instead the manual path has two surfaces that *already* fit the architecture:

**(1) The context-fill gauge *is* the trigger.** The cockpit already shows a fill indicator (`InteractionTopbar`, the `{pct}%` gauge). We make that gauge **tappable** → confirm card → compact. Co-locating the action with the signal the user already reads is the least-astonishing home ("don't make me think"). The gauge is always present when the cockpit is visible, so the capability is **never hidden** (honours CLAUDE.md §11). Below the precondition (**> 12 messages AND > 4000 tokens**, mirrors chatsune — tiny chats can't usefully compact), tapping the gauge is **disabled-with-tooltip** ("Nothing to compact yet — the conversation is still short"), exactly as the cockpit already greys ≈/🔈 with a reason.

**(2) An actionable toast at the warning threshold.** When fill crosses **≈ 80 %** *after a response completes*, a toast appears with a **"Compact" action button** — the active nudge. **Once per chat**, auto-dismissing, non-blocking, suppressed during live voice. The toast is **mode-independent** (it shows over Reading or Interaction Mode), which is what resolves "the gauge only exists when the cockpit is visible" — the nudge reaches the user wherever they are.

The 80 % toast threshold lives in `compaction/config.ts` and is tunable.

**Confirm card.** Either surface opens a small confirm card before compacting. It carries a **calming reassurance line** — "Your full conversation stays in Reading Mode" — so the confirm *reassures* rather than merely gates (the action is non-destructive: raw messages are never deleted, §5). Then compaction runs in the foreground with a visible progress state (§3.4).

### Layer 2 — Background safety valve

When fill reaches **≥ 90 %** and the user has *not* manually compacted (e.g. dismissed or ignored the 80 % toast), compaction runs **in the background after the send completes** — fire-and-forget, per-chat mutex, exactly like `fireMemoryPipeline`. No blocking, no latency: the *next* turn is already compacted. The arc is: 80 % actionable toast (you *can*) → 90 % "I'll do it myself" (the net). The only visible result is the new marker pill appearing in the timeline (§8) — which gets a one-time gentle settle so the user notices the "it tidied itself" moment once, without nagging.

The 90 % threshold lives in `compaction/config.ts` and is **tunable after device testing** (like the memory thresholds), in case felt behaviour ≠ the number.

### Layer 3 — Hard failsafe (block-and-compact)

`truncateToWindow` remains as a purely mathematical safety belt, but in practice it **never fires**, because Layer 2 pre-empts it. The only residual case: a *single huge* message (a large paste) jumps from < 90 % over the real limit in one step, before the background ever ran.

For that case we **block-and-compact, visibly** (decision (A), not silent truncation): show a brief "Compacting the conversation…" state, compact synchronously, *then* send. A one-off small wait in the rare extreme — but the promise **"context is never lost without comment" stays absolute**. `truncateToWindow` is reduced to maths that, in practice, never engages. This mirrors Claude web / Claude Code's own block-and-compact UX, which Chris confirms relieves rather than annoys: control through transparency.

**No-freeze + failure recovery (required).** Because this is the one *blocking* path, two guarantees are mandatory so it never becomes a dead-end:

- The "Compacting the conversation…" state has **live motion** (a breathing/progress indicator, not a frozen label) so it never reads as a hang.
- If the blocking summary call **fails** (after the one retry, §4.4), the user's **typed/pasted message is preserved** and a constructive next step is offered — "Couldn't compact just now" with **Retry** and **Send anyway** (the latter falls back to the silent-truncation maths *this once*, with a note). Per the constructive-error-handling tenet, no wall without a next move.

### 3.4 Foreground vs background

- **Manual (Layer 1)** and **block-and-compact (Layer 3)** run in the **foreground** with a visible "Compacting…" state.
- **Safety valve (Layer 2)** runs in the **background** after the send, fire-and-forget, refreshing the UI via `invalidateQueries` on completion (the memory pattern). A per-chat mutex prevents a manual click and the background valve from racing.

---

## 4. The summary / checkpoint

### 4.1 Tail rule (what is preserved verbatim)

Ported 1:1 from chatsune (`_compaction.py:10–54`). Walking newest → oldest, the tail boundary is chosen by three rules in priority order:

```
MIN_TAIL_MESSAGES   = 12   // 6 turns — coherence floor
MAX_TAIL_MESSAGES   = 36   // 18 turns — hard cap
TAIL_TOKEN_FRACTION = 0.20 // ≥ 20 % of the model context window
```

Stop when *(count ≥ 12 AND tokens ≥ 20 % of context)* OR *(count ≥ 36)*. Everything **before** the tail boundary is compressed into the summary.

**Note on the 36-cap:** it is a *quality* judgement ("older than this, the summary represents it better than the raw text"), **not** a token-budget limit. The argument holds even at huge windows: we *could* keep more, but we *don't want* to, because beyond that point the summary is the better representation.

### 4.2 What is summarised vs discarded

- **Tool-call results are discarded entirely** (the `tool` role; empty-content assistant messages). They were only the raw basis for what was actually discussed.
- **Attachment / image / artefact *references* are preserved** as metadata hints (`[Attachments: …]`, `[Generated: …]`, `[Artefacts: …]`) — the "the file was 3000 tokens, only the conclusion mattered" point. The next assistant knows they existed by name without their content.
- **User / text-bearing assistant messages** are passed through to the summariser.

### 4.3 Summary structure — six fixed sections

Ported verbatim from chatsune. The summariser system prompt:

```
You are a conversation-compaction assistant. Below is a transcript of a
conversation between a user and an AI assistant. Your job is to extract a
structured briefing that allows another AI to seamlessly continue this
conversation in a new context window.

Output rules:
- Output Markdown only. No preamble, no "I have summarised", no meta-commentary.
- Use the exact section headings shown below, in order.
- Be terse but complete. Aim for 5–10 % of the original token count.
- Preserve the user's language preferences, name, and any established facts
  about them.
- Quote critical user phrasings verbatim if they carry intent
  (e.g. preferences, decisions).
- Do not invent information. If a section has no content, write "_(none)_".

Required sections:

## Topic & Goal
What is this conversation about? What is the user trying to achieve?

## Established Facts
Concrete facts, decisions, names, numbers, conclusions reached. Bullet list.

## Open Threads
Questions left unanswered, things the user said they would come back to.

## User Preferences Observed
Communication style, expertise level, language preferences, anything that
should shape how the next AI responds.

## Pending References
Files, URLs, artefacts, tools that the user mentioned and that the next
assistant should know about. Do not paste their content — just reference
them by name.

## Tone & Persona Adherence
One sentence on how the persona has been speaking (formal/informal, etc.).
```

Compression target: 5–10 % of source tokens (floor ~500 tokens). Budgets: system prompt ≈ 380 tokens, max output 2000 tokens, safety margin 1000.

We keep **all six sections** (decision (a)). The `User Preferences Observed` section overlaps conceptually with the memory system, but the summary stays **self-contained** so that even when memory is off (it is per-persona toggleable) the summary still carries the thread's preferences. The small duplication costs a few dozen tokens at a huge window — not worth the dependency.

### 4.4 Validation and retry

The output must contain all six headings (case-insensitive, tolerant of heading-style variants) with balanced code fences. On validation failure, retry once with temperature bumped 0.3 → 0.5 and a reminder appended:

```
IMPORTANT: The previous attempt was missing required sections. Output MUST
contain all six headings exactly as specified, in the order shown.
```

### 4.5 Source truncation (extreme source)

If the source range itself exceeds ~70 % of the model context (so even the summarisation call would not fit), drop the oldest source messages until it fits, and **tell the user**: "Note: the N oldest messages didn't fit into the briefing." (This is itself non-silent — consistent with the no-silent-loss promise.)

### 4.6 Which model

The conversation's own model — `chat.modelId` if set, otherwise the persona's model — mirroring memory-consolidation and the "one model per persona" guideline. Routed through `runOneShotCompletion` with reasoning disabled.

---

## 5. Relationship to Memory — orthogonal by construction

Compaction and memory both digest the conversation, but they are orthogonal **at the data layer already**:

- **Memory** = *across all chats*, durable, per-persona ("Chris is a C# developer, prefers British English"). Lives forever, persona-wide.
- **Compaction summary** = *within this one chat*, continuity for the thread ("in *this* chat we debugged the deployment script and concluded X"). Dies with the chat.

**Raw messages are never deleted from Dexie.** Compaction only changes *what is sent to the model* (summary + tail), exactly as chatsune keeps the originals and merely slices from `tail_start`. Three consequences:

1. **Reading Mode stays complete** — the user scrolls through *everything* ever said (Reading Mode is central, ~80 % of usage). Only the *model's working memory* is compacted, not the *human's archive*.
2. **Memory extraction runs undisturbed** — it reads raw messages from `db.messages` via its own `lastExtractedMessageId` cursor, **not** from the sent context. Compaction cannot pull the rug from under it. Nothing durable is lost even when a message falls out of the *sent* window.
3. **Branching still works**, because the originals are present.

Conceptual overlap (the user tells you about their cat for the 5th time; already-discussed things get rehashed) is *organic* and accepted — intervening would cost complexity and gain little. "Jo mei."

---

## 6. Continue mechanics — injection and slicing

On each send, if `chat.activeCompactionId` is set:

1. Load that checkpoint.
2. Inject `summaryMarkdown` into the prompt via the existing `memoryContext` slot pathway, wrapped in a dedicated block (e.g. `<conversation_compact>…</conversation_compact>`) so it is distinct from the `<usermemory>` block. Both can be present simultaneously.
3. Slice the wire history to messages **from `tailStartMessageId` onwards** (by `createdAt`), before the existing `truncateToWindow` pass runs. The summary replaces the compressed prefix; the tail flows verbatim.

`truncateToWindow` still runs *after* slicing as the Layer-3 maths, but on the already-compacted message set it has nothing to do in normal operation.

### Re-compaction

A second compaction appends a **new** checkpoint and folds the previous summary in as a "Previous Story (from earlier checkpoint)" preamble to the transcript, so no information is lost across multiple compactions. `prevCheckpointId` links the chain. The new checkpoint becomes `chat.activeCompactionId`.

---

## 7. Data model

A new Dexie table, parallel to `memoryJournal` / `memoryBody`, keeping `ChatRow` lean:

```ts
interface CompactionCheckpointRow {
  id: string;
  chatId: string;                 // indexed
  createdAt: number;
  modelId: string;                // which offering produced the summary
  summaryMarkdown: string;        // the six-section briefing
  lastMessageIdBefore: string;    // end of the compressed range
  tailStartMessageId: string;     // boundary: first preserved tail message
  tokensBefore: number;           // for the "87k → 4k" pill
  tokensAfter: number;
  tailTokenCount: number;
  prevCheckpointId: string | null; // re-compact chain ("Previous Story")
  trigger: 'manual' | 'auto' | 'overflow'; // which layer fired
}
```

Plus two slim fields on `ChatRow`:

- `activeCompactionId: string | null` — the send path reads only this → loads the active checkpoint → injects + slices.
- `compactionToastShown?: boolean` — persists the once-per-chat 80 % toast flag (§3.1). It must survive reload, so it lives on the row, not in memory — otherwise the toast would re-nag on every app open of a ≥ 80 % chat (an ND-unfriendly failure).

The timeline marker pills come from querying all checkpoints for a chat.

**Dexie schema index string:** `compactionCheckpoints: 'id, chatId, createdAt'` (query checkpoints by chat ordered by time). `activeCompactionId` and `compactionToastShown` are non-indexed fields on `ChatRow`.

### 7.1 Dexie version bump — v28 → v29

Required (new table). This triggers the known pain: ~24 hard-coded `expect(db.verno).toBe(28)` assertions across the test suite (there is no central `verno` constant). **The verno sweep is planned into the first implementation task** so it does not cost a separate fix round. We are on `master` with no parallel feature branches, so v29 belongs unambiguously to this feature.

---

## 8. UI (minimal-functional now; design-language pass later)

Following the memory-page precedent: **minimal functional CSS only**; the beauty arrives in the forthcoming UI/UX block. Surfaces — all on real, already-existing chat architecture (no phantom "header"):

- **Trigger = the context-fill gauge** (`InteractionTopbar` `{pct}%`), made tappable → confirm card. Disabled-with-tooltip below the precondition (§3.1). No standalone button.
- **Actionable 80 % toast** — mode-independent, once per chat, with a "Compact" action (§3.1).
- **Compaction marker pill** — inline in the message timeline at each checkpoint boundary, e.g. `✨ Compacted · 14:23 · 87k → 4k tokens`. **Rendered through (or visually matching) the existing `Pill` component** (`components/chat/Pill.tsx` — a real `<button>` with `aria-expanded`, the affordance users already know from tool-call/Lore pills) so tappability is inherited. It **opens a drawer** rather than expanding inline, so it carries a distinct cue (chevron / "tap to read") to avoid astonishing users trained by inline-expand pills. An auto-valve-inserted pill gets a one-time gentle settle/fade (the "it tidied itself" moment, §3.2).
- **Snapshot drawer** — **read-only**, renders `summaryMarkdown` through the existing Markdown renderer. The transparency guarantee: the user can always read exactly what the persona now carries of the thread. **Not editable** (decision (1)); editing is deferred (decision (3) — see §10). It carries one calm line naming the real escape from a wrong summary: **"This briefing is generated from the conversation. To refresh it, compact again."** — turning a silent wall into a signposted path.

"Compacting…" foreground state (with **live motion**, never a frozen label) for manual + block-and-compact (Layer 1 / Layer 3). Background valve (Layer 2) is silent until done, then refreshes via `invalidateQueries` (the memory pattern). A per-chat mutex prevents a manual tap and the background valve from racing.

---

## 9. Code home

A new `apps/user-client/src/compaction/` directory, parallel to `src/memory/`:

- `config.ts` — thresholds (90 % valve, tail rule constants, token budgets), all "tunable after device testing".
- `compaction-prompt.ts` — the system prompt + transcript builder (tool-result stripping, attachment-reference surfacing, "Previous Story" folding).
- `runner.ts` — orchestrates: select source/tail boundary, build transcript, call `runOneShotCompletion` (reasoning off), validate + retry, write the checkpoint + update `chat.activeCompactionId`, under the per-chat mutex.
- `repo.ts` — Dexie reads/writes for checkpoints.
- Wire-up in the send path (`data/send-message.ts` / `state/stream-manager.store.ts`) for the three layers, and in `lib/stream-engine.ts` for injection + slicing.

---

## 10. Deferred (door deliberately left open)

- **Editable summary** (decision (3)) — the data model (a Markdown field on the checkpoint) is already edit-ready; only the UI would need adding. Build *if real users miss it*.
- **Edit chat messages later** — **coupled** with editable checkpoints (if one comes, the other is nearly free). Logged in [`obsidian/insights/future-feature-couplings.md`](../../obsidian/insights/future-feature-couplings.md). Reference point for "where message-edit was genuinely useful": Spicy-Writer (story generation). Both are post-alpha, demand-driven, per the feature-inclusion filter.

---

## 11. Testing

- **Pure functions** (unit, Vitest): tail-boundary selection (the three-rule priority), transcript builder (tool-result stripping, attachment-reference surfacing, "Previous Story" folding), six-section validation (accept/reject + retry-reminder), token accounting for the pill.
- **Repo / Dexie**: checkpoint write + `activeCompactionId` update; re-compact chain; v29 migration.
- **Injection / slicing**: given an active checkpoint, the wire history slices from `tailStartMessageId` and the summary is injected as `<conversation_compact>`; co-existence with `<usermemory>`.
- **Trigger layers**: gauge enabled/disabled-with-tooltip by precondition; 80 % toast fires once per chat (persisted flag survives reload); 90 % background valve fires once post-send; block-and-compact path on a single oversized turn + its failure recovery (typed message preserved, Retry / Send-anyway).
- Suite baseline: full user-client vitest at the **8 Node-localStorage baseline**; `pnpm typecheck --force` green (the verno sweep must keep typecheck + suite green).

Per CLAUDE.md, the model-call behaviour is **device-verified**, never asserted only via mock — the multi-turn "summary actually used on the next turn" loop is a manual-verification item, not a single-turn mock.

---

## 12. Manual verification (Chris, on device)

1. Hold a long conversation; at ≈ 80 % an actionable "Compact" toast appears once (and not again on reload of the same chat).
2. Tap the context-fill gauge (or the toast action) → confirm card (with the "stays in Reading Mode" reassurance) → "Compacting…" (visibly moving) → a marker pill appears; the conversation continues smoothly, tone and recent detail intact. On a tiny chat, the gauge is disabled-with-tooltip.
3. Open the pill → read the six-section briefing in the drawer (read-only).
4. Keep going past 90 % *without* clicking → the background valve compacts after a send; the next turn is already compacted (no blocking).
5. Paste a huge message into a near-full chat → visible block-and-compact ("Compacting the conversation…"), then the send proceeds; nothing lost silently.
6. Compact a second time → "Previous Story" is folded in; no earlier information is lost.
7. Scroll back in Reading Mode → *all* original messages are still present (only the model's working context was compacted).
8. With a tool-using turn (web_search) earlier in the thread → after compaction the raw results are gone but the conclusion survives in the briefing, and any attachment/file is referenced by name.

---

## 13. Audit gates

- **Laura** — spec-pass **done (2026-06-21)**: 2 HARD defects + 6 soft, all folded into this revision (HARD: phantom "chat header" → gauge-as-trigger + mode-independent toast; "hidden below 30 %" → disabled-with-tooltip per §11. Soft: drawer refresh-line, block-and-compact no-freeze + failure recovery, marker via `Pill`, toast once-per-chat persisted, auto-valve settle, calming confirm card). **No hard defects remain.** A pre-squash pass follows after build. Authority per CLAUDE.md §9.2.
- **Larissa** — **not required**; client-only, no auth/sync/proxy/crypto path.

---

## 14. Open items

None. All design decisions resolved in the 2026-06-21 brainstorm with Chris,
plus Laura's spec-pass folded in: hybrid trigger (gauge-as-trigger + 80 %
mode-independent toast + 90 % background valve + block-and-compact failsafe with
recovery); orthogonal to memory; all six summary sections; read-only transparent
drawer with a refresh-line (edit deferred); separate Dexie table + two `ChatRow`
fields; v29 bump with verno sweep folded in. No standalone ✨ button (the gauge
is the trigger); nothing hidden (disabled-with-tooltip per §11).
