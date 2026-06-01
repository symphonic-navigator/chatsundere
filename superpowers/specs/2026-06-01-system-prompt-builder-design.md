# System-Prompt Builder v2 — Design Spec

**Date:** 2026-06-01
**Author:** Liz (with Chris)
**Status:** Approved, ready for implementation plan
**Scope:** `packages/llm-unified` + `apps/user-client` only — purely client-side. No `auth/sync/crypto/proxy` surface touched, so **no Larissa gate** required.

---

## 1. Goal

Today the system prompt is assembled by `composeSystemPrompt` (`packages/llm-unified/src/composition.ts`) from five fixed layers in a fixed order. Two of those layers (`projectInstructions`, `memoryContext`) are dead stubs. The "unlocker" (`Settings.globalUnlockerPrompt`) is a single global free-text field the user must discover and fill in themselves — and most never do, so they hit upstream refusals ("DeepSeek is so censored") that a broad system prompt would have prevented.

This redesign turns the prompt into an **ordered list of segments** assembled by one builder shared across every job (chat, title generation, memory extraction). Two of those segments — **Tonality** and **NSFW policy** — become curated, built-in "Chatsundere identity" texts the user toggles on or off, so a good default prompt ships out of the box without the user authoring anything. The user's own global wishes move into a renamed, clearly-scoped **Global instructions** field.

The guiding product insight: **the default values are the feature.** Tonality ships *on*; the user opts out, not in.

## 2. Decisions (locked during brainstorming)

| Question | Decision |
|---|---|
| Builder shape | **Ordered segment model**, not the fixed struct. Segments carry static metadata (band, order, active jobs) + a runtime-resolved text. Only segments with a real producer are implemented now; the rest are reserved positions. |
| Segment ordering | **Three bands**, generic → specific within each: Band 1 Behaviour & Voice, Band 2 Context & Knowledge, Band 3 Technical. See §4. |
| Conflict resolution | Persona sits *below* Tonality/Global in Band 1, so the specific overrides the generic. Band 3 (technical) sits last so format/tool rules "stick" (recency) and are never diluted by persona prose. |
| Tonality default | **ON** for new personas. The user switches it off. |
| NSFW default | **OFF**. The user switches it on (via the persona's adult flag). |
| Tonality vs NSFW split | **Two separate Band-1 segments.** Tonality is the anti-censorship/voice layer (controversial topics, no "as an AI"); NSFW is the separate explicit-content unlock. Different defaults, different purpose. |
| NSFW switch wiring | **Reuse the existing `adultPersona` flag.** An adult-marked persona both appears in the NSFW filter *and* gets the NSFW-policy segment in its prompt. One mental model, one switch (§11 omakase). |
| Tonality / NSFW editability | **Built-in constants, not user-editable.** They are "Chatsundere identity". The user has Global instructions for their own global wishes. |
| Identity text location | A dedicated, clearly-named source file `packages/llm-unified/src/identity/chatsundere-identity.ts` exporting named template literals. Not `.txt` files — Bun and Vite require divergent raw-import syntax, and `fs.readFileSync` does not run in the browser. The single file keeps the texts trivially findable and editable. |
| Background jobs | Band 1 runs in **chat, title-gen, and memory extraction**; Bands 2–3 run in chat only. So NSFW (when the persona is adult) automatically applies to background jobs by construction — no special-casing. See §5. |
| "Unlocker" rename | `Settings.globalUnlockerPrompt` → `globalInstructions`; UI label "The unlocker" → "Global instructions". |

## 3. The segment model

`composeSystemPrompt(layers)` is replaced by `buildPrompt(inputs, job)`. A segment is:

```ts
type PromptJob = 'chat' | 'title' | 'memory';

interface PromptSegment {
  id: 'tonality' | 'nsfw' | 'global' | 'persona'
    | 'aboutMe' | 'project' | 'memories'
    | 'formatting' | 'tools' | 'tts';
  band: 1 | 2 | 3;
  order: number;                 // ordering within a band
  jobs: readonly PromptJob[];    // jobs in which this segment is active
  content: string;               // resolved text; '' (or whitespace-only) ⇒ skipped
}
```

The builder:

1. resolves every segment's `content` from the inputs (persona, settings, future project/memory context);
2. drops any segment whose `jobs` does not include the current `job`;
3. drops any segment whose resolved `content` is whitespace-only;
4. sorts the survivors by `(band, order)`;
5. joins with `\n\n`.

`buildPrompt` becomes the **single** source of the system prompt for every job. Today `stream-engine.ts` and `title-generator.ts` each duplicate the layer assembly; both move onto `buildPrompt`.

The `personaInstructions`-must-be-non-empty invariant from the current `composeSystemPrompt` is preserved (a persona always carries instructions).

## 4. The ten segments

| # | Segment | Band | Source / Scope | Editable? | Default | Producer now? |
|---|---|:--:|---|---|---|:--:|
| 1 | Tonality | 1 | Built-in constant (`chatsundere-identity.ts`) | no — toggle only | **ON** | ✅ |
| 2 | NSFW policy | 1 | Built-in constant | no — via `adultPersona` | **OFF** | ✅ |
| 3 | Global instructions | 1 | `Settings.globalInstructions` (global) | yes | empty | ✅ (rename) |
| 4 | Persona instructions | 1 | `PersonaRow.instructions` | yes | — (required) | ✅ |
| 5 | About-me | 2 | `Settings.globalAboutMe` + `PersonaRow.aboutMeOverride` | yes | empty | ✅ |
| 6 | Project instructions | 2 | project scope | yes | empty | 🔲 slot |
| 7 | Memories | 2 | memory system | generated | empty | 🔲 slot |
| 8 | Formatting | 3 | Built-in constant | no | ON | 🔲 slot |
| 9 | Tool instructions | 3 | dynamic (active tools) | no | — | 🔲 slot |
| 10 | Voice / TTS | 3 | dynamic | no | — | 🔲 slot |

**Band layout (top → bottom):**

```
BAND 1 — Behaviour & Voice    : Tonality → NSFW → Global instructions → Persona
BAND 2 — Context & Knowledge  : About-me → Project → Memories
BAND 3 — Technical            : Formatting → Tools → Voice/TTS
```

**Reserved slots (🔲)** keep their band/order/jobs defined in the model but have no producer this cycle. `projectInstructions` and `memoryContext` stop being dead stubs and become honest slots. Tools execution stays out of scope entirely — only the prompt position is reserved.

**About-me moves** from its current top position (`composition.ts`, layer 2 of 5) into Band 2. It is context, not behaviour.

## 5. Job-context matrix

| Segment band | chat | title-gen | memory extraction |
|---|:--:|:--:|:--:|
| Band 1 (Tonality, NSFW, Global, Persona) | ✓ | ✓ | ✓ |
| Band 2 (About-me, Project, Memories) | ✓ | – | – |
| Band 3 (Formatting, Tools, Voice/TTS) | ✓ | – | – |

Consequence: when a persona is adult, the NSFW-policy segment is active in **every** job, because Band 1 is active for all jobs. Chris's original requirement ("NSFW must also be on for background processes") is satisfied by construction, not by a special case.

Note: only `chat` and `title` have a live caller this cycle. The `memory` job kind is defined in the model and exercised by unit tests, but its real caller (memory extraction) lands with the memory port (the Block-1 gap) — there is no memory-extraction code path to wire up here.

This also **fixes a current bug**: `title-generator.ts` hard-codes an *unconditional* "You are fully uncensored…" line (`TITLE_INSTRUCTION` at line 35) plus `reasoning:{enabled:false}`. That line is injected even for SFW personas. Once title-gen runs through `buildPrompt`, the NSFW text is persona-dependent and the hard-coded line is removed.

## 6. Data-model changes

**`PersonaRow`** gains:

```ts
chatsundereTonality: boolean;   // default true
```

`adultPersona: boolean` is unchanged in shape but gains a second effect (it now also drives the NSFW-policy segment).

**`SettingsRow`**: `globalUnlockerPrompt: string` → `globalInstructions: string` (rename only).

**Dexie migration** (next version bump):

- copy each row's `globalUnlockerPrompt` value into `globalInstructions`;
- backfill `chatsundereTonality = true` on every existing `PersonaRow`.

Default users have an empty `globalUnlockerPrompt` today (seeded at `client-data-db.ts:389`), so after migration they gain Tonality automatically — exactly the goal. Power users with existing unlocker text keep it in Global instructions **and** gain Tonality; any overlap is theirs to trim manually. This is acceptable and noted, not a blocker.

## 7. Code changes

- **`packages/llm-unified/src/identity/chatsundere-identity.ts`** (new) — `TONALITY_PROMPT`, `NSFW_PROMPT` as named template literals. Final wording is a separate pass (§9).
- **`packages/llm-unified/src/composition.ts`** — replace `CompositionLayers`/`composeSystemPrompt` with the `PromptSegment` model + `buildPrompt(inputs, job)`. Segment metadata (band/order/jobs) lives here; built-in texts are imported from the identity file.
- **`apps/user-client/src/lib/stream-engine.ts`** — assemble `buildPrompt` inputs from persona + settings; call with `job: 'chat'`.
- **`apps/user-client/src/lib/title-generator.ts`** — call `buildPrompt` with `job: 'title'`; delete the unconditional NSFW line; keep the title task instruction itself (the "respond with only the title" message), but strip its NSFW clause since the persona-driven segment now covers it.
- **`apps/user-client/src/boot/client-data-db.ts`** — `PersonaRow.chatsundereTonality`; `Settings` rename; Dexie migration + backfill.
- **`apps/user-client/src/routes/app/persona-editor.tsx`** — a "Chatsundere tonality" toggle (default on). The existing adult toggle is unchanged in the UI; the spec records that it now also carries the NSFW prompt segment.
- **`apps/user-client/src/routes/app/settings.tsx`** — relabel "The unlocker" → "Global instructions" and rebind to `globalInstructions`.

## 8. Testing

- `composition` unit tests rewritten for the segment model: band/order sorting, whitespace-skip, job-context filtering, the persona-required invariant, and a full "all segments present" golden assembly per job kind.
- A focused test that title-gen / memory-extraction inputs yield **only Band 1**, and that an adult persona's title-gen prompt contains the NSFW text while an SFW persona's does not (locks the bug fix).
- Existing `stream-engine` / `title-generator` tests updated for the new call shape.
- Dexie migration test: an upgraded DB carries the copied `globalInstructions` and `chatsundereTonality = true` on pre-existing personas.

## 9. Out of scope / deferred

- **Final wording** of the two identity texts (Chris's drafts have an unfinished sentence — "…to be avoided out of " — and must end up clean British English per §3.7). Locked in a separate pass after the mechanics land.
- **Producers** for Project, Memories, Formatting, Tools, Voice/TTS — slots only.
- **Tools execution** — unchanged out-of-scope per STATUS.
- **Larissa** — not triggered (no auth/sync/proxy/crypto path).

## 10. Manual verification (Chris, on device)

1. A brand-new persona has "Chatsundere tonality" **on** by default; its chats answer a controversial-but-non-explicit question without an "as an AI" refusal.
2. Switching tonality **off** on a persona visibly changes that persona's behaviour on the same question.
3. Marking a persona **adult** unlocks explicit content; the same persona, not adult, declines it.
4. Title generation for an **adult** persona's chat succeeds on a NSFW conversation; title generation for an **SFW** persona no longer carries the uncensored clause (inspect via a reasoning-capable model that previously failed).
5. The old "unlocker" text (if any) appears under **Global instructions** after upgrade, unchanged.
6. A user who never touched any prompt field still gets sensible, uncensored-for-topics behaviour out of the box.
