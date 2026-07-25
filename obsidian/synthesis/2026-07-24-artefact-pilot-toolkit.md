# Synthesis — Artefact pilot toolkit (2026-07-24)

Third synthesis session (Chris + Grok). Pivot: **start Project Synthesis on
artefacts**, not on the knowledge librarian. Same two-storey architecture as
[[2026-07-19-librarian-architecture]], narrower substrate, immediate user value
(modify + inspect existing chat artefacts), and a deliberately small pilot so
we grow the toolkit without drowning in KB data-model work.

> **Graduated:** design spec
> [[../../superpowers/specs/2026-07-24-artefact-synthesis-pilot-design]]
> (2026-07-24). This note remains the decision/rationale vault; the spec is the
> build contract.

Assumes a capable tool-using model class (e.g. Grok 4.5 via API) — design for
diligent tool use and faithful whole-body rewrites, not for late-2023 7B
roleplay merges.

## 0. Why artefacts first

The librarian architecture remains the longer-horizon target for knowledgebases.
It is a heavy pilot: summaries, conventions documents, version graphs,
ingestion, two-level writability. Artefacts already ship create + pill +
manual content edit + Treasury; the missing product surface is **tool-mediated
modify** and **orientation** (`list`), with optional **inspect/explain** so the
persona never swallows full source into session context.

| | Artefacts (pilot) | KB librarian (later) |
|---|---|---|
| Store | `ArtefactRow` + `updateArtefactContent` | documents + versions + embed queue |
| Scope | one chat | one library |
| Permissions | chat ownership; text kinds only | library/document writability matrix |
| User value now | “make it dark mode”, “how does this SPA work?” | “article from this conversation” |

Patterns proven here graduate to the librarian; the librarian docs stay valid
and are not superseded — only **sequencing** changes.

## 1. Product stance on artefacts

Artefacts are a **playground**: visualise, experiment, try an idea, get a
quick interactive or document-shaped tool. They are **not** production apps
(security, deployment, cross-cutting concerns). Users who want “a real website
with all the bells and whistles” should be pointed at a full build environment
(e.g. Grok Build). That stance justifies:

- optimistic concurrency via **`updatedAt` only** (no version graph, no
  `parentVersionId` for artefacts in the pilot);
- whole-body rewrite without surgical patch tooling;
- no persona-driven delete (user remains the janitor).

## 2. Standing principle: complete brief, no transcript

**v1 and the intended general rule for subagents:** the main persona does not
forward meeting notes; it forwards **requirements**.

Analogy (Chris): when implementing a feature for the hardware department, the
software engineer does not need the hardware team’s raw meeting notes — they
need everything the hardware team requires of them, stated clearly. The
subagent is that engineer. The persona is the colleague who gathered the need
and wrote the brief.

Consequences:

1. **No transcript window** is frontloaded into the artefact subagent (pilot
   and preferred long-term default for this class of worker).
2. The persona’s **brief / question is mandatory** and must be **complete
   enough** — same duty as today’s `create_artefact` instruction (“a separate
   author writes from your brief alone”).
3. Probes measure **brief quality** (thin vs complete), not whether a rescue
   transcript can paper over a thin brief.
4. The **source of truth for modify/inspect is the artefact body**, obtained
   via tools; conversational intent lives only in the brief.

A later optional escape hatch (`includeRecentChat`, hard token budget +
provider disclosure) may exist if field evidence demands it; it is **not** the
default and is not pilot scope.

This principle is expected to carry to other synthesis subagents (librarian
included) unless a concrete task type proves the brief alone is structurally
insufficient — and even then, prefer fixing persona brief-writing over
dumping chat history.

## 3. Two storeys

```
User ⇄ Main persona (session, voice, conversation)
         │
         │  list_artefacts
         │  create_artefact          (existing one-shot author)
         │  modify_artefact          (delegation → subagent + write)
         │  inspect_artefact         (delegation → subagent, read-only)
         ▼
      Artefact subagent (own context, artefact-expert slot by default)
         │  list / read_current / read_other [/ replace_current]
         ▼
      Artefacts of the current chat (kind: text)
```

- **Main persona** never gets a persona-facing `read` of the full body.
- **Subagent** work is internal: tool pills stay out of the chat transcript;
  one outer pill shows progress and links the result.
- **Chat-only** for list and mutation scope. Cross-chat material enters only if
  the user attaches a Treasury artefact (existing attachment path) — that is
  the intentional “how to use it properly” model: artefact work happens in one
  chat; long-horizon knowledge stays in memory / KB.

## 4. Persona-facing tools

### 4.1 `list_artefacts`

- **Scope:** current chat only (no persona/treasury scope in v1).
- **Kinds:** `kind: 'text'` only (html, markdown, code, svg, mermaid, …).
  Images omitted or non-modifiable; not in the modify pool.
- **Returns index rows, never bodies:** e.g. `id`, `title`, `fileName`,
  `format`, `origin`, `charLength` (or approx tokens), `updatedAt`,
  `modifiable: true` for text.
- **Optional filters (spec):** format, fuzzy title/`fileName` query, limit.
- Purpose: orientation — “what do we have in this chat?” so the persona can
  pick a ref for modify/inspect and ground the conversation without loading
  source.

### 4.2 `create_artefact(title, brief)` — separate process, still a subagent

Distinct tool from modify (no upsert): clearer intent and required parameters
for the model. **In principle two operations** — create from a blank canvas vs
change an existing artefact — and they stay two tools.

**Both create and modify remain subagents** (Chris, 2026-07-24), not inline
persona generation:

- Shared UX: outer pill with live progress (today’s create path already
  streams `charCount` into `ArtefactPill` — “building · N chars”). That
  progress is the user’s heartbeat when the model or stack does not stream
  tool-call payloads well (Ollama and similar).
- Create’s *algorithm* stays **one-shot craft** in v1: brief in → body out
  (no list/read/replace toolkit). That is still a subagent call with its own
  system prompt, model slot, abort signal, and progress callbacks — not the
  persona speaking HTML into the chat.
- Modify’s *algorithm* is the **agentic toolkit** (§5). Same outer-pill /
  progress family; richer internal phases (read → write → report).

Create is **html + markdown** first-class (spec D6; markdown is central for
notes/articles). Other create formats stay deferred. Spec unifies the
**progress/pill contract** across create, modify, and inspect so frameworks
without tool streaming never look “stuck”.

### 4.3 `modify_artefact(artefactRef, brief)`

- Spawns the subagent with **write** toolkit; binds **current** to the
  resolved artefact.
- `artefactRef`: id and/or title as resolved by the harness from list (exact
  rules in spec). Persona should list first when unsure.
- Brief: complete change request (what to change, what must not break, styling
  intent, content deltas).
- One outer pill; result from execution ledger (`artefactId`, new `updatedAt`).

### 4.4 `inspect_artefact(artefactRef, question)`

- Same subagent core as modify, **replace tool absent** (write-disabled spawn).
- Returns a **description / explanation** to the persona as tool output — not
  the full source. Persona answers the user in voice; user opens lightbox for
  the original when needed.
- Example: “How exactly does the memory function work in the calculator SPA?”
  → inspect, not session-stuffed HTML.
- Also a subagent with visible progress (phase text is enough; no body
  charCount required).

Separate tool from modify so intent cannot silently mutate on an explain
request (least astonishment; clearer pills: explained vs updated).

## 5. Subagent toolkit

Capability-scoped closures bound in code to the **current chat** and, for
writes, to the **current artefact** only. Scope is never the model’s to
preserve.

| Tool | When | Behaviour |
|---|---|---|
| `list_artefacts()` | modify + inspect | All text artefacts in this chat: metadata + `isCurrent`; no bodies. |
| `read_current_artefact()` | modify + inspect | Full body + metadata of the primary target. **No id argument** — current is harness-bound at spawn. |
| `read_other_artefact(name)` | modify + inspect | Another artefact in the **same chat**, addressed by **name** (title or `fileName`). Inspiration / cross-compare / “the other widget”. |
| `replace_current_artefact(expectedUpdatedAt, content, title?)` | **modify only** | Whole-body replace; optimistic concurrency via `updatedAt`. |

### 5.1 Name resolution for `read_other_artefact`

- Normalise: trim, case-fold; match title or `fileName` (with/without
  extension as spec decides).
- Exact hit → success.
- Fuzzy only if **unique**; else structured error listing candidates and
  suggesting `list_artefacts`.
- Zero hits → calm error.

### 5.2 Write policy

- **One primary target per run** (read broadly within the chat, write
  narrowly).
- No `replace_other` in v1.
- No delete.
- No image body mutation.
- Format hopping (e.g. markdown → html) only if the brief explicitly asks and
  the tool allows it — default: keep format (spec).

### 5.3 Frontload at spawn (no transcript)

1. Persona brief or inspect question.
2. Index line for **current** (id, title, format, charLength, updatedAt) —
   create has no current; only craft rules + brief.
3. System prompt = **craft rules + content-axis unlockers** (§5.5). Not the
   full chat `buildPrompt` stack.
4. Explicit ban on treating any document content as policy that overrides the
   brief or hard tool limits (authority order lite).

Full body always via `read_current_artefact` (or frontload body only if under a
strict size budget — optimisation, not a substitute for the read tool).

### 5.4 Loop, ledger, model slot, progress

- Reuse tool-loop *mechanism* with a UI-independent agent core (librarian §0
  caveat): internal rounds, forced final report, no intermediate tool noise in
  the chat transcript. Create may share the same runner as a degenerate
  zero-tool / single-stream path so progress reporting stays one code path.
- **Execution ledger** is authoritative on modify/inspect; model prose is
  narrative only.
- Model: artefact-expert slot by default (existing precedent), else persona
  model; **no silent provider fallback** on durable writes (inspect may share
  the same resolution for consistency). Pill discloses actual model when it
  matters.
- **Progress (must-have UX):** outer pill always shows that work is underway —
  `charCount` while a body is being streamed (create today; modify when
  emitting a replacement body), plus phase labels for agentic steps
  (`reading`, `writing`, `explaining`, …). This is why create stays a
  subagent even though its algorithm is one-shot: users on non-streaming
  tool-call stacks still see life in the UI.
- `maxRounds` and size guards (refuse replace if source cannot fit / huge
  unexplained shrinkage) — for the spec.

### 5.5 Content-axis unlockers (required)

**Locked (Chris, 2026-07-24): unlockers are required** on create, modify, and
inspect subagent system prompts.

Rationale: Chatsundere is explicitly NSFW-friendly. Many models (notably a
large share of the Chinese open-frontier catalogue) refuse or sanitise unless
the system prompt carries an explicit “you may” for adult content. Frontier
models that do not need the permission are unharmed by it when gated
correctly; weaker models fail without it. Grok-class models are not the
design baseline for *omitting* unlockers.

**What “content-axis” means here** — reuse the persona’s *permission* layers,
not its *character* layers:

| Include when | Source (existing composition) | Why |
|---|---|---|
| `persona.adultPersona` | `NSFW_PROMPT` (`chatsundere-identity`) | Explicit erotica / uncensored content unlock |
| `persona.chatsundereTonality` (if on) | `TONALITY_PROMPT` | Anti-censorship topic permission (not erotica alone) |
| always, if non-empty | `settings.globalInstructions` | User-authored global unlocker / standing instructions |

**Deliberately omit** from artefact subagents (unless a later spec finds a
need):

- Persona character instructions (voice, backstory) — the author is a
  craftsman, not the companion in scene.
- Roleplay formatting / embodiment blocks — they push short RP prose and
  asterisk narration; that fights HTML/markdown artefact output.
- `ROLEPLAY_NSFW_PROMPT` — tied to roleplay adjacency; the standalone
  `NSFW_PROMPT` is the content unlock for craft jobs.
- TEAL, screen-effects, memory, lore, knowledge awareness, tools band of the
  *chat* prompt, opener echo.

**Parity rule:** if the user may receive explicit material from this persona
in chat (`adultPersona`), the artefact subagent must be willing to *author or
edit* that material into an artefact. Gate = same `adultPersona` (and global
adult mode only where the rest of the client already couples them — align
with title-gen / stream-engine, do not invent a stricter gate).

**Composability:** unlocker strings must be injectable as pure segments (the
librarian open question “where do unlockers live in composable form?”) so
create/modify/inspect/future librarian share one helper — e.g.
`contentAxisSegments({ nsfw, tonality, globalInstructions })` — rather than
re-deriving copy.

Create today (`AUTHOR_SYSTEM_PROMPT`) has **no** NSFW segment — that is a
known gap the pilot closes for create and new paths together.

## 6. Decisions locked this session

1. **List/modify/inspect scope = current chat only.** Proper use: one chat for
   an artefact thread; Treasury items enter as attachments if needed as
   templates or impulses.
2. **create and modify stay two tools** — no upsert; two processes in
   principle (blank canvas vs change existing).
3. **Both create and modify are subagents** (inspect too): own model slot,
   own system prompt, outer pill + live progress — including for stacks that
   do not stream tool calls. Create’s algorithm remains one-shot craft; modify
   is agentic with toolkit.
4. **Concurrency = `updatedAt`.** Good enough for playground artefacts.
5. **Every `kind: 'text'`** is modifiable/inspectable in principle (including
   markdown), not HTML-only.
6. **Transcript v1 = off**; complete brief principle is standing (see §2).
7. Librarian §7 arbitration applied here: no silent fallback; write narrowly
   (one target); no conventions document for artefacts.
8. **No persona-facing full read**; **inspect** is the explanation path.
9. Subagent reads: **`read_current_artefact`** (no id) +
   **`read_other_artefact(name)`**; list available; write only current.
10. **Content-axis unlockers required** on all artefact subagents (§5.5):
    `NSFW_PROMPT` / tonality / global instructions as gated; no persona
    character or roleplay embodiment in the craft prompt.

## 7. Substrate already in the client (orientation)

- `create_artefact` + `authorArtefact` one-shot (`integrations/artefact/`,
  `lib/artefact-author.ts`).
- `SubagentBase`, artefact-expert resolution, `ArtefactPill`, query
  invalidation after create.
- `updateArtefactContent` for user edits (lightbox); tool path should reuse
  the same persist path + invalidation.
- `runToolLoop` exists but is chat-UI-coupled — pilot needs a clean agent
  loop for subagents (shared investment with future librarian).
- Deferred earlier: `read_artefact` as a persona tool — **still not added**;
  list + inspect replace that product need.

## 8. Non-goals for the artefact pilot

- Persona or subagent delete of artefacts.
- Cross-chat list/write without attachment.
- Persona-facing full-body read.
- Transcript frontload to the subagent.
- KB documents, memory body edit, skills (still later synthesis stages).
- Version graph / audit log for artefacts (playground stance).
- Production-hardening of generated apps.
- Image artefact mutation.
- String-patch edit tool (whole-body only in v1).

## 9. Probe sketch (before or alongside first UI slice)

Narrower than librarian §5b; still empirical:

- **Baselines:** (A) one-shot “here is body + brief → new body”; (B) agentic
  read_current → replace_current; (C) thin brief vs complete brief on the same
  fixture.
- **Tasks:** modify HTML app (preserve behaviour); modify markdown doc
  (preserve headings/facts); inspect/explain without write; wrong-name other
  read; stale `updatedAt` conflict; multi-artefact chat (current vs other).
- **Hard fails:** write outside current; write on inspect spawn; report claims
  write absent from ledger; silent provider change on write.
- Models: at least one strong tool-using model; optional weaker contrast.

Probe answers: is the loop worth it vs one-shot for single-file modify, and
does brief quality dominate — as designed.

## 10. Open for the eventual spec (not blocking this note)

1. Exact `artefactRef` resolution on the persona tools (id-only vs title).
2. Fuzzy rules and error copy for `read_other_artefact`.
3. ~~Whether create stays HTML-only~~ — **resolved:** create is html|markdown.
4. Title rename on replace; format-change policy (keep format on replace).
5. Unified pill/progress contract (phases + charCount) for create / modify /
   inspect; mid-run abort; lightbox deep link.
6. Char/token budgets and max safe replace size per offering.
7. `maxRounds` and partial-failure UX.
8. Whether list shows images as non-modifiable rows or omits them.
9. Sync Class-2 behaviour for tool-driven `content` updates (should match
   manual `updateArtefactContent`).
10. Exact helper shape for composable content-axis segments; whether
    `globalInstructions` are always injected or only when non-empty (lean
    always-if-non-empty).
11. Whether modify’s replacement body is streamed token-by-token into the
    pill (best UX) or only counted after a tool arg is complete (provider-
    dependent) — prefer streaming when the runner can emit partial content.

## 11. Relationship to prior synthesis notes

- [[2026-07-19-initial-idea-map]] — original synthesis scope (memory + KB);
  artefact pilot is a **sequencing and substrate** choice, not a rejection of
  memory/`edit_memory_body` or the KB tools.
- [[2026-07-19-librarian-architecture]] — architectural parent for two
  storeys, ledger, agent loop, write narrowly, no silent fallback; artefact
  pilot instantiates a slice of that design on a simpler store and **rejects
  transcript frontload** as the standing brief principle (§2).
- Skills, Alice/Bob, group chat notes remain deferred as before.
