# Artefact synthesis pilot — design

**Date:** 2026-07-24  
**Author:** Grok (with Chris)  
**Branch:** `migrate-to-grok`  
**Status:** Design draft — pending Chris approval + Laura spec-pass  
**Surface:** `apps/user-client` primarily; small shared helper in
`packages/llm-unified` if content-axis segments are exported cleanly.  
**Not a Larissa path** (no auth/sync/proxy/crypto). Sync Class-2 writes reuse
existing artefact mutate paths. Log any new egress nuance only if the
artefact-expert privacy copy needs a modify/inspect line.

> **Upstream brainstorming (idea vault):**  
> [[../../obsidian/synthesis/2026-07-24-artefact-pilot-toolkit]] — locked
> product calls.  
> [[../../obsidian/synthesis/2026-07-19-librarian-architecture]] — architectural
> parent (two storeys, ledger, agent loop); this pilot instantiates a slice on
> the artefact store.  
> Prior artefact chunks: [[2026-06-06-artefact-kern-design]],
> [[2026-07-06-artefact-expert-design]], [[../../obsidian/ARTEFACTS-FEATURE-STATUS]].

---

## 1. Purpose

Give personas **tool-mediated orientation and iteration** over chat artefacts —
list what exists, **modify** text artefacts via a dedicated subagent, and
**inspect** (explain) them without dumping full source into the main session —
while upgrading **create** so it shares the same subagent progress contract and
**content-axis unlockers**.

This is the **first Project Synthesis pilot**: two-storey delegation (main
persona vs craft subagent), complete-brief / no-transcript principle, and a
UI-independent agent loop that later knowledge-librarian work can reuse. Artefacts
are the playground substrate; KB synthesis stays later.

**User value**

- “Make the calculator dark mode” without hand-editing source or spawning a
  duplicate artefact.
- “How does the memory function in that SPA work?” without stuffing HTML into
  the persona context.
- “What have we built in this chat?” via an explicit list tool.
- Live pill progress even when the model stack does not stream tool-call
  payloads well (e.g. some Ollama setups).

**Product stance**

Artefacts remain a **playground** (visualise, experiment, quick tools) — not
production apps. No version graph; concurrency via `updatedAt`; users who want
full productisation are pointed at a real build environment. See synthesis
note §1.

---

## 2. Goals / non-goals

### Goals

1. Persona tools: `list_artefacts`, `modify_artefact`, `inspect_artefact`;
   evolve `create_artefact` (unlockers + shared progress contract).
2. Subagent toolkit (modify/inspect): `list_artefacts`, `read_current_artefact`,
   `read_other_artefact(name)`, and on modify only
   `replace_current_artefact(...)`.
3. **Chat-only** scope for list and all subagent I/O.
4. **Complete brief, no transcript** — standing subagent principle.
5. **Content-axis unlockers** on create, modify, and inspect.
6. One outer pill per delegation with live progress; internal tool noise never
   appears in the chat transcript.
7. Persist modifies through the existing Class-2 content update path; invalidate
   chat-artefact queries.
8. Extract a **UI-independent agent-loop core** usable by the artefact craft
   subagent (and later the knowledge librarian).

### Non-goals

- Persona- or subagent-driven **delete**.
- Persona-facing **full-body read** (`read_artefact` stays deferred).
- Cross-chat list/write (Treasury → attachment remains the import path).
- Transcript frontload to any artefact subagent.
- Image artefact mutation (`kind: 'image'`).
- String-patch / surgical edit tools (whole-body only).
- Version history / audit log for artefacts.
- Knowledgebase / memory synthesis / skills.
- Production hardening of generated HTML beyond existing sandboxed preview.
- Changing the artefact-expert **slot UI** (already shipped); only consume it.

---

## 3. Decisions (locked with Chris, 2026-07-24)

| # | Decision |
|---|---|
| D1 | Scope of list/modify/inspect = **current chat only**. |
| D2 | **Two tools** for write paths: `create_artefact` and `modify_artefact` — no upsert. |
| D3 | Create and modify are **separate processes** but **both subagents** (inspect too), for pill progress and non-streaming tool-call stacks. |
| D4 | Create algorithm v1 = **one-shot craft**; modify = **agentic toolkit**. |
| D5 | Concurrency token = **`updatedAt`** (no version graph). |
| D6 | Modify/inspect apply to every **`kind: 'text'`** format (html, markdown, code, svg, mermaid, …). **Create** supports **`html` and `markdown`** as first-class formats (Chris, 2026-07-24 — markdown is central for many use cases). Other create formats (code, svg, mermaid, …) stay deferred. |
| D7 | **No transcript** in the subagent; persona brief/question must be complete enough. Standing principle for this class of worker. |
| D8 | **No persona-facing full read**; **inspect** is the explanation path. |
| D9 | Subagent reads: `read_current_artefact()` (no id) + `read_other_artefact(name)`; write only current. |
| D10 | Content-axis unlockers required: `NSFW_PROMPT` / `TONALITY_PROMPT` / non-empty `globalInstructions` as gated; **no** persona character, roleplay embodiment, TEAL, memory, lore. |
| D11 | No silent provider fallback on durable writes (artefact-expert resolution rules unchanged: expert when set and enabled, else persona; failure is visible). |
| D12 | One primary write target per modify run. |
| D13 | List **omits** image artefacts entirely (not shown as disabled rows). |
| D14 | Format on replace: **keep** the artefact’s existing format/mime/fileName extension; no tool-driven format hopping in v1. Optional **title** rename only. |
| D15 | `globalInstructions` inject when non-empty only. |

---

## 4. Architecture overview

```
User ⇄ Main persona (session, voice, conversation)
         │
         │  list_artefacts()                    → index JSON (no bodies)
         │  create_artefact(title, brief, format?) → one-shot craft (html|markdown)
         │  modify_artefact(artefactId, brief)  → agentic craft subagent + write
         │  inspect_artefact(artefactId, question) → agentic craft subagent, read-only
         ▼
      Craft subagent
         system = craft rules + contentAxisSegments(...)
         NO chat transcript, NO persona character
         model = artefact expert (if configured & chat opted in) else persona
         │
         │  [modify/inspect internal tools — not chat pills]
         │  list_artefacts / read_current / read_other
         │  replace_current (modify only)
         ▼
      Dexie artefacts (chatId-scoped, kind text)
```

**Complete brief principle:** the main persona is the requirements author; the
subagent is the implementer. Meeting notes stay in the chat; only the brief
(or inspect question) crosses the storey boundary.

---

## 5. Data & persistence

### 5.1 Schema

**No Dexie migration.** `ArtefactRow` already carries `content`, `title`,
`fileName`, `format`, `kind`, `updatedAt`, etc.

### 5.2 Writes

| Operation | API |
|---|---|
| Create (generated html/markdown) | `addGeneratedArtefact` extended with `format: 'html' \| 'markdown'` (mime + `fileName` extension derived) |
| Replace body | existing `updateArtefactContent(id, content)` — Class-2 `mutateSynced` |
| Optional title on replace | existing `renameArtefact` **in the same logical turn** after a successful content write (or a small combined helper that updates content + optional title with one `updatedAt`) |

**Optimistic concurrency:** `replace_current_artefact` requires
`expectedUpdatedAt`. Implementation:

1. Load row; verify `chatId`, `kind === 'text'`, id is the bound current.
2. If `row.updatedAt !== expectedUpdatedAt` → tool error: conflict; include
   current `updatedAt` and a short “re-read and retry” hint.
3. Else write content (and optional title) with a **new** `updatedAt`.

Race with lightbox manual edit or another tab is acceptable playground
behaviour; the token prevents silent clobber without forcing a version graph.

### 5.3 Query invalidation

After every successful create/replace: `queryClient.invalidateQueries` for
`QK.chatArtefacts(chatId)` (create already does this). If a single-artefact
query key exists for the lightbox, invalidate it too.

### 5.4 Sync

Tool-driven content updates must use the same Class-2 path as manual
`updateArtefactContent` so linked devices see edits. No new collection.

---

## 6. Persona-facing tools

Contributed by the existing artefact integration (`contributesTools`), always
on when the persona model supports tools (existing gating).

### 6.1 `list_artefacts`

**Parameters:** none required. Optional (all optional):

| Param | Type | Default | Notes |
|---|---|---|---|
| `query` | string | — | Case-insensitive substring on `title` or `fileName` |
| `format` | string | — | Exact `ArtefactFormat` filter |
| `limit` | number | 50 | Cap 100 |

**Behaviour**

- Load all artefacts for `ctx.chatId` with `kind === 'text'`.
- Apply filters; sort by `updatedAt` descending.
- Return compact JSON (or structured text the model can parse) — **never
  bodies**:

```ts
{
  artefacts: Array<{
    id: string;
    title: string;
    fileName: string;
    format: ArtefactFormat;
    origin: ArtefactOrigin;
    charLength: number;
    updatedAt: number;
  }>;
  total: number; // before limit, after filters
}
```

- Empty chat → `{ artefacts: [], total: 0 }` with a calm line that none exist
  yet (not an error).

**System-prompt instruction (persona):** use this to see what text artefacts
exist in the current chat before modify/inspect; pass `id` into those tools;
do not invent ids.

### 6.2 `create_artefact(title, brief, format?)` — evolved

| Param | Required | Notes |
|---|---|---|
| `title` | yes | Short human-readable title |
| `brief` | yes | Complete, self-contained author brief |
| `format` | no | `'html'` \| `'markdown'`. **Default `html`** when omitted (backward-compatible with today’s tool calls and model habits). Invalid values → constructive tool error listing the two allowed values. |

**When to pick which (persona instruction)**

- **`html`** — interactive UI, widgets, demos, single-file web apps (existing
  playground strength).
- **`markdown`** — notes, articles, checklists, world-building pages, specs,
  any durable prose document the user will read rather than “run”. **Central
  product path**, not a side format.

**Changes vs today**

1. System prompt = **format-specific** craft rules (§7.4) **+** content-axis
   segments (§9).
2. Progress/pill contract unified (§10); pill format badge shows `HTML` or
   `MD` (not hardcoded HTML).
3. Still one-shot: stream body → strip fences (``` / ```html / ```markdown /
   ```md) → persist via extended `addGeneratedArtefact`.
4. Persistence: `format: 'html'` → `mime: text/html`, `.html`; `format:
   'markdown'` → `mime: text/markdown`, `.md` (align with existing
   save-as-artefact / `detectFormat` conventions where they already map
   markdown).
5. Model resolution: existing artefact-expert path.

**Instruction to persona:** brief must be complete and self-contained; a
separate author writes the file from the brief alone; choose `format`
deliberately — default html is for apps, not for long-form notes.

### 6.3 `modify_artefact(artefactId, brief)`

| Param | Required | Notes |
|---|---|---|
| `artefactId` | yes | Must be a text artefact in this chat |
| `brief` | yes | Complete change request |

**Pre-flight (harness, before spawn)**

1. Resolve row by id; fail constructively if missing, wrong chat, or not text.
2. Spawn subagent with `current = row`, write toolkit enabled.
3. On success: tool result string for the persona + `meta: { artefactId, title,
   updatedAt, format, complete: true | partial | no-change }` from ledger.
4. Outer pill links to artefact (existing `ArtefactPill` pattern, extended).

**Do not** accept title-only refs on the persona tool in v1 — ids from
`list_artefacts` only. Names are for the **subagent’s** `read_other_artefact`.

### 6.4 `inspect_artefact(artefactId, question)`

| Param | Required | Notes |
|---|---|---|
| `artefactId` | yes | Same pre-flight as modify |
| `question` | yes | What to explain / describe |

Spawn with **write toolkit absent**. Final subagent answer is the tool
`output` to the persona (explanation, not full source). `meta: { artefactId,
title }` for pill; pill state is “explained” / ready, not “updated”. Tap may
still open the artefact in the lightbox for user verification.

---

## 7. Craft subagent

### 7.1 Shared spawn inputs

| Input | Create | Modify | Inspect |
|---|---|---|---|
| Brief / question | brief | brief | question |
| Current artefact binding | — | required | required |
| Internal tools | none (one-shot stream) | list, read_current, read_other, replace_current | list, read_current, read_other |
| Content-axis unlockers | yes | yes | yes |
| Craft system rules | html **or** markdown author rules | multi-format editor rules | multi-format analyst rules |
| Transcript | never | never | never |
| Model | artefact expert resolution | same | same |
| AbortSignal | yes | yes | yes |
| Progress callbacks | charCount (+ phase) | phase + charCount when writing | phase |

### 7.2 Internal tools (modify / inspect)

All closures hard-bound to `chatId` and, for current ops, `currentId`.

#### `list_artefacts()`

Same shape as persona list (no query params required; optional internal
limit). Include `isCurrent: boolean` per row.

#### `read_current_artefact()`

No parameters. Returns:

```ts
{
  id, title, fileName, format, mime, origin,
  updatedAt, charLength,
  content: string  // full body
}
```

Error if current was deleted mid-run.

#### `read_other_artefact(name: string)`

**Name resolution**

1. Normalise: trim; Unicode case-fold.
2. Candidate set: text artefacts in this chat **excluding** current.
3. Exact match on normalised `title` or `fileName` or `fileName` without
   extension.
4. Else unique substring match on title/fileName (case-insensitive).
5. Zero hits → error with hint to call `list_artefacts`.
6. Multiple hits → error listing up to 5 candidate titles + ids (ids for the
   model’s orientation only; it still cannot replace non-current).

Returns same shape as `read_current_artefact` (full body). Bodies of “other”
artefacts are allowed in the **subagent** context only.

#### `replace_current_artefact(expectedUpdatedAt, content, title?)`

Modify spawn only. Harness rejects this tool on inspect spawns even if the
model hallucinates the name.

| Param | Required | Notes |
|---|---|---|
| `expectedUpdatedAt` | yes | Number from last read |
| `content` | yes | Full new body; non-empty after trim |
| `title` | no | If set, rename display title; `fileName` re-slug only if title changes and existing fileName was auto-slug-shaped — **prefer:** update `title` only, leave `fileName` unless empty |

**Guards (deterministic, independent of model quality)**

- Empty body → refuse.
- `content.length` exceeds offering-derived max safe size → refuse with reason.
- Shrinkage: if new length < 40% of previous length **and** previous length >
  500 chars → refuse once with warning unless a second replace in the same run
  includes `confirmLargeShrink: true` **or** simpler v1: refuse and ask the
  model to confirm by re-calling with a `force: true` boolean param.  
  **v1 pick:** require `force?: boolean`; without `force`, refuse shrinks
  below 40% of prior length when prior ≥ 500 chars.
- Format/mime/kind unchanged.
- Expected `updatedAt` check as §5.2.

On success: return `{ ok: true, id, updatedAt, title, charLength }` and append
to execution ledger.

### 7.3 Agent loop (modify / inspect)

Extract a **headless** agent loop (new module, e.g.
`lib/agent-loop.ts` or `lib/subagent-tool-loop.ts`) that:

- Accepts: `streamOnce`, `dispatch`, `toolDefs`, `maxRounds`, `signal`,
  `onProgress`, optional `onRound`.
- Does **not** accumulate chat `ContentBlock`s / chat pills for intermediate
  internal tools.
- Returns: `{ finalText, ledger, roundsUsed, roundLimitReached, usageTotal?,
  stoppedByAbort }`.
- On round limit: one forced tools-free pass with instruction to report
  honestly what was done / left undone (`complete | partial | no-change`).

**Suggested caps**

| Spawn | `maxRounds` (tool-executing) |
|---|---|
| modify | 6 |
| inspect | 4 |

Create does not use the multi-round loop; it uses the existing (or shared)
single streaming completion with progress.

**Ledger entries:** `{ op, targetId?, success, error?, resultingUpdatedAt?,
at }`. Denied replace attempts are logged. Outer tool `meta` and pill links
derive from the ledger, not from model claims alone.

**Authority order (subagent)**

1. Hard tool/harness constraints.  
2. Explicit brief/question.  
3. Craft system rules.  
4. Artefact bodies as **untrusted source material**, never policy.

### 7.4 Craft system prompts (substance, final copy in plan)

**Create · `html`** — evolve `AUTHOR_SYSTEM_PROMPT`: single self-contained HTML
file; no external resources; mobile-first 380px; output only the file; then
append content-axis segments.

**Create · `markdown`** — you are a document author: output **exactly one**
Markdown document and nothing else (no wrapping commentary). Use clear
headings, lists, and structure appropriate to the brief. No HTML shell unless
the brief explicitly asks for embedded HTML snippets inside Markdown. Output
only the document body; fence-stripping still applies if the model wraps
anyway. Then append content-axis segments.

Implementation: two craft-rule constants (or one factory
`authorCraftRules(format)`), selected at spawn from the tool’s `format` arg.
Shared: content-axis, streaming, fence strip, progress.

**Modify** — you are an artefact editor for one bound file; use tools; prefer
read_current before replace; preserve behaviour and structure except where the
brief asks; whole-body replace only; report what changed; do not delete or
touch other artefacts’ contents except reading for inspiration. Honour the
bound file’s format (HTML vs Markdown craft instincts).

**Inspect** — you are an artefact analyst; answer the question from
read_current (and other only if needed); no writes; answer in clear prose for
the companion persona to relay; do not dump the entire source unless the
question truly requires a short cited excerpt (prefer explanation).

All paths: British English in platform strings; model output language follows
the brief/user content.

---

## 8. Model resolution

Reuse `defaultResolveBase` / artefact-expert wiring from
[[2026-07-06-artefact-expert-design]]:

1. If `ctx.artefactExpert` resolved and key available → use it.  
2. Else persona offering + key.  
3. Missing key / unresolvable expert when expert was expected → existing
   constructive `artefactExpertUnavailable` result (extend copy slightly so
   modify/inspect share the same discriminant if useful).

**No silent fallback** to a third “background helper” model.  
Privacy: brief/question + (for modify/inspect) artefact bodies and any
read_other bodies go to the chosen model’s provider — same family of
disclosure as create today; settings copy already warns about the brief;
optional follow-up to mention modify/inspect send file contents (honest).

---

## 9. Content-axis unlockers

### 9.1 Helper

New pure helper (preferred home: `packages/llm-unified` next to identity
prompts, or `apps/user-client/src/lib/content-axis.ts` re-exporting identity
strings):

```ts
function buildContentAxisPrompt(parts: {
  nsfwEnabled: boolean;
  tonalityEnabled: boolean;
  globalInstructions: string;
}): string
```

Joins non-empty segments with blank lines, order: tonality → nsfw → global
(mirrors Band-1 ordering without pulling the full `buildPrompt` registry).

Sources:

- `nsfwEnabled` ← `persona.adultPersona` (same gate as stream-engine /
  title-gen; do not invent a stricter adult-mode double gate unless those
  paths already require both — match title-gen).
- `tonalityEnabled` ← `persona.chatsundereTonality`.
- `globalInstructions` ← settings row, trim; omit if empty.

### 9.2 Composition

```
craftRules
+ buildContentAxisPrompt(...)
```

**Not included:** persona instructions, roleplay blocks, `ROLEPLAY_NSFW_PROMPT`,
TEAL, screen effects, model-instructions-for-chat-voice, memory, lore,
knowledge awareness, chat tools band, about-me, opener.

### 9.3 Create gap

Today’s author has no NSFW segment. This pilot **closes** that gap for create
in the same change set as modify/inspect.

---

## 10. Pills & progress UX

### 10.1 Outer pills only

Persona-visible tool-call pills: `create_artefact`, `modify_artefact`,
`inspect_artefact`, `list_artefacts` (list may use a lightweight generic tool
pill or a quiet completed state — prefer a short “listed N artefacts” result
without heavy chrome).

Internal subagent tool calls **never** create chat pills.

### 10.2 Progress payload (unified)

Extend tool progress / pill payload:

```ts
{
  phase?: 'starting' | 'reading' | 'writing' | 'explaining' | 'building' | 'done';
  charCount?: number;
  title?: string;
  artefactId?: string;
  // existing fields retained
}
```

| Tool | Pending subtitle examples |
|---|---|
| create | `building · 12,480 chars` (+ format badge `HTML` / `MD`) |
| modify | `reading` → `writing · 8,102 chars` → … |
| inspect | `reading` → `explaining` |
| list | optional brief pending; usually instant |

### 10.3 Completed states

| Tool | Ready presentation |
|---|---|
| create | tap to open; **dynamic** format badge (`HTML` / `MD` from `meta.format` or row — not hardcoded `HTML`) |
| modify | tap to open; subtitle e.g. `updated`; badge from row format |
| inspect | tap to open source; subtitle e.g. `explained` (persona already has the answer in tool result) |
| list | no durable link required |

Tombstones: failed; or artefact deleted after create/modify (existing missing
check).

### 10.4 Abort

User cancel of the in-flight persona turn aborts the subagent via the same
`AbortSignal` path as create today. Partial modify: if a replace already
committed, leave it (playground); ledger/`partial` in meta; persona result
states honesty.

---

## 11. Integration wiring

1. **`artefactIntegration.contributesTools`** returns  
   `[list, create, modify, inspect]` (order stable for prompt cache when
   possible).
2. **`IntegrationContext`** already has `chatId`, `personaId`,
   `personaOffering`, `artefactExpert`, `getKey`. Extend if needed with:
   - `adultPersona` / `tonalityEnabled` / `globalInstructions` **or** read
     them inside tool factories from closures built in `buildIntegrationContext`
     (prefer **pre-resolve on context** like other capability flags — one
     send-path read).
3. **Registry / stream-manager:** no special case beyond existing tool
   dispatch; meta discriminants for expert-unavailable reuse.
4. **`ArtefactPill`:** branch on tool name or payload `kind:
   'create'|'modify'|'inspect'` for subtitles; keep one component family.
5. **Redact** large `content` from console `tool-call` arg logging for
   replace (librarian review lesson) — log op + lengths, not body prefix of
   full HTML.

---

## 12. Budgets

| Concern | Rule |
|---|---|
| Create max tokens | Keep current reasoning-aware caps (8k / 16k) unless offering profile says otherwise. |
| Replace body size | Refuse if body cannot fit remaining context budget with margin for tools + report; compute from offering recommended context. |
| List | Default limit 50; hard max 100. |
| Index frontload | Current row metadata only at spawn; full body via read. |
| Optional optimise | If `charLength` of current < 8_000, spawn may frontload body **and** still expose `read_current` for freshness — not required for v1. |

---

## 13. Security & privacy

- Client-only; sandboxed HTML preview unchanged.  
- No new network surface beyond existing model provider calls (artefact expert
  or persona).  
- Bodies + brief go to that provider on modify/inspect — document in settings
  copy if create’s warning is brief-only today.  
- NSFW parity: adult persona ⇒ subagent unlocked; not a bypass of global adult
  mode UI filtering for *which personas the user sees*.  
- Log in `security-deferrals` only if reviewers want an explicit line for
  “modify sends full artefact body to expert provider” (likely already covered
  by create’s brief/privacy note + expert slot).

**Not Larissa.**

---

## 14. Testing strategy

**Unit**

- Content-axis helper composition (nsfw on/off, tonality, empty global).
- Name resolution for `read_other` (exact, unique fuzzy, ambiguous, none).
- Replace guards: conflict `updatedAt`, empty body, shrink+force, wrong chat id.
- List filters and image omission.
- Ledger vs model claim: meta built from ledger.

**Integration / component**

- Pill progress phases for modify/inspect.
- Query invalidation after replace.
- Expert unavailable constructive path for modify.

**Manual verification (Chris device)** — §16.

Automated quality of prose is out of scope (user is the reviewer via lightbox).

---

## 15. Implementation sequence (for the plan)

Suggested feature units (may become plan tasks):

1. `buildContentAxisPrompt` + wire into create author path (closes NSFW gap).
2. Create **`format: html | markdown`**: craft rules factory, extend
   `addGeneratedArtefact`, tool schema + persona instruction, pill badge.
3. Headless agent-loop module + tests.
4. Subagent internal tools + replace with `updatedAt` concurrency.
5. Persona tools `list_artefacts`, `modify_artefact`, `inspect_artefact` +
   integration context fields.
6. Pill UX unification + logging redaction.
7. Vitest coverage + typecheck/build/biome.

Optional parallel: settings copy tweak for modify/inspect body disclosure.

---

## 16. Manual verification

Device / browser, adult and non-adult persona, with and without artefact expert.

1. **List:** In a chat with several text artefacts (+ one image if any), persona
   lists titles/ids; image absent from list.
2. **Create HTML + unlocker:** Adult persona, explicit brief → HTML still
   builds; pill charCount moves; badge `HTML`; open in lightbox. (Regression.)
3. **Create markdown:** Ask for a structured note/article with
   `format: 'markdown'` (or equivalent persona choice) → `.md` artefact,
   badge `MD`, readable in lightbox; content is Markdown not an HTML shell.
4. **Modify HTML:** Create calculator → “add dark mode” with complete brief →
   same id updated; behaviour preserved; pill shows reading/writing.
5. **Modify markdown:** Create or use a markdown artefact → edit via modify →
   headings/facts preserved except requested changes.
6. **Inspect:** Ask how a feature in the SPA works → persona answers from
   tool output; full HTML not pasted into the chat stream as a dump.
7. **Conflict:** Open lightbox, edit source, save; in parallel (or after) run
   modify with stale token → subagent surfaces conflict and recovers via
   re-read (or user retries).
8. **Other read:** Two widgets in chat; modify A with brief that references B
   by title → subagent can read B; only A’s content changes.
9. **Expert off / missing key:** Constructive error; no silent other model.
10. **Abort:** Start modify; stop generation → no hang; partial state honest.
11. **Ollama / non-streaming tool path (if available):** pill still shows phase
    or char progress so the UI does not look frozen.

---

## 17. Laura notes (for spec-pass)

- **Reachability:** modify/inspect only via persona tools in chat — no buried
  settings path required; list prevents “invisible artefacts”.
- **Disabled over hidden:** N/A for missing tools; image omission is scope
  (not a greyed control). Conflict/errors must be constructive in tool results
  the persona can relay.
- **Pills:** distinct pending/ready copy for create vs modify vs inspect;
  tap targets open lightbox (inspect included).
- **Least astonishment:** inspect must not mutate; separate tool.
- **Mobile 380px:** pill chrome stays compact (existing artefact pill family).

---

## 18. Open items deferred past this pilot

- Create formats beyond **html** and **markdown** (code, svg, mermaid, …)
  via tool — those remain save-as / other paths for now.
- Format conversion tools (e.g. markdown → html) on modify/create.
- Persona title-based refs (id-only on persona tools).
- Transcript escape hatch.
- Knowledge librarian (reuses agent loop + content-axis helper).
- `edit_memory_body` synthesis.
- Streaming partial JSON tool-args for replace (provider-dependent); prefer
  streaming model content into replace when architecture allows — if tool-arg
  streaming is unavailable, phase=`writing` without live charCount is
  acceptable fallback.

---

## 19. Success criteria

- Chris can **create and iterate** an HTML playground artefact and a
  **markdown** note entirely from chat tools (create + modify) without opening
  the source editor for the happy path.
- Persona can explain an artefact without context bloat.
- Adult personas get uncensored craft output on models that require unlockers.
- No intermediate subagent tool spam in the transcript.
- `pnpm typecheck`, user-client vitest, `pnpm run build`, Biome clean on the
  implementation branch before squash.

---

## 20. References

- Idea vault: `obsidian/synthesis/2026-07-24-artefact-pilot-toolkit.md`  
- Librarian parent: `obsidian/synthesis/2026-07-19-librarian-architecture.md`  
- Kern: `superpowers/specs/2026-06-06-artefact-kern-design.md`  
- Artefact expert: `superpowers/specs/2026-07-06-artefact-expert-design.md`  
- Tool loop today: `apps/user-client/src/lib/tool-loop.ts`  
- Author: `apps/user-client/src/lib/artefact-author.ts`  
- Integration: `apps/user-client/src/integrations/artefact/artefact-integration.ts`  
- Identity unlockers: `packages/llm-unified/src/identity/chatsundere-identity.ts`
