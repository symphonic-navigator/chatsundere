# Design — `ask_expert` tool (expert uplink for small models)

**Date:** 2026-06-08
**Author:** Liz (with Chris)
**Status:** Approved design — ready for implementation plan
**Block:** Inserted experimental feature, client-only. Built in an isolated
worktree (`worktree-ask-expert-tool`) in parallel with Chris's knowledgebase
work on `master`; merged on Chris's word.

---

## 1. Summary

Small (and, later, local) models are often the right choice for *conversation*
— calm, private, fast — but they are not the sharpest tool for hard technical
reasoning. `ask_expert` gives such a model an **uplink**: a tool that forwards a
single, self-contained technical question to a larger "expert for everything"
model the user picks once, globally, in My Settings. The expert answers; the
small companion weaves that answer back into its own voice.

It is a deliberate, *consensual breaking* of the product's privacy / anti-censorship
stance for specific questions — an omakase "uplink", not a roll-your-own knob.
Crucially, the break is **structural and minimal**: only the question text the
small model writes ever leaves the device, never the conversation, persona, or
the user's personal context.

This is client-only. It touches no `auth-service` / `sync-service` /
`proxy-service` / `packages/crypto` — **not a Larissa change** — but it does
realise a new outbound egress, logged in `obsidian/insights/security-deferrals.md`.

---

## 2. Decisions (settled with Chris during brainstorming)

1. **Structural isolation, not instruction-based stripping.** The expert sees
   *only* the `question` string the companion writes — no conversation history,
   no persona, no about-me, no companion system prompt. "Strip personal info"
   becomes a harmless *phrasing* task ("write a clean technical question"), not a
   risky filtering task performed by the weakest model in the loop. Even if the
   small model is sloppy, nothing personal can leak beyond what it deliberately
   types into the question field.
2. **Neutral expert, no censorship.** The expert receives a neutral
   subject-matter system prompt. We impose **no** family-friendly clause (anti-censorship
   stance). A clean technical query rarely is NSFW; if a response happens to
   contain adult content it is not suppressed. **No NSFW flag is threaded.**
3. **Single global expert model**, chosen in My Settings, mirroring
   `substituteVisionModel`. The omakase uplink: most users will pick the
   sharpest model on the market (or their favourite expert), once.
4. **Purely manual, no "smartness" gating.** Chatsundere does not try to detect
   whether a model is "small enough" to benefit. The user decides.
5. **The tool is always available** (in the wire `toolDefs` and the system
   prompt) whenever a global expert model is configured — independent of the
   per-chat runtime toggle. This keeps the cached prompt prefix **stable**.
6. **Three control layers** (mirrors the reasoning toggle exactly):
   - *Global model* — `SettingsRow.expertModel` (My Settings): **which** model.
   - *Persona default* — `PersonaRow.askExpertDefault`: the **default on/off**
     state the runtime toggle starts at for **new chats** of that persona.
     A freshly created persona ships **`false`** (off): the uplink breaks the
     core privacy stance, so it is opt-in, not opt-out. The cockpit chip makes
     turning it on a one-tap act.
   - *Cockpit runtime* — `useCurrentChatStore.askExpert`: ad-hoc on/off **per
     chat**, initialised from the persona default.
7. **Runtime-off does not remove the tool** (cache-prefix stability). Instead the
   tool's `execute` returns a constructive error so the companion answers itself.
8. **Maximum reasoning, streamed live.** The expert runs at the strongest
   reasoning effort its model supports (Chris's call — a "Lie groups" question
   deserves the model's full depth). The call **streams**, and the pill shows the
   model working live (thinking-chars, then answering-chars), mirroring the
   subagent-driven artefact-generation pill so the user sees *what is happening*.

---

## 3. Architecture overview

```
My Settings ──pick──▶ SettingsRow.expertModel ("templateId:upstreamSlug")
                              │
                  resolvePersonaContext (send path, holds MasterKey)
                              │ resolveExpert → { oneShotBase, modelLabel } | null
                              ▼
Persona editor ──▶ PersonaRow.askExpertDefault ──init──▶ useCurrentChatStore.askExpert
                                                                   │ (snapshot at send)
                              ┌────────────────────────────────────┘
                              ▼
stream-manager.runIntoDraft:
   expert = oneShotBase ? { oneShotBase, modelLabel, runtimeEnabled: askExpert } : null
   activeTools = resolveActiveTools(integrationCtx, knowledge, expert)
                              │
                              ▼  (always present when expert!=null → cache stable)
   ask_expert tool ── execute ── runtimeEnabled? ──no──▶ constructive error
                                              └──yes──▶ streamCompletion(           ← live pill
                                                          base, reasoning = MAX,
                                                          messages = [system(EXPERT_PROMPT),
                                                                      user(question)])  ← ONLY the question
```

Two precedents are copied wholesale:
- **Substitute-vision** (`data/send-message.ts:125` `resolveSubstituteVision`,
  `boot/client-data-db.ts:24` `substituteVisionModel`,
  `routes/app/settings.tsx:68` `SubstituteVisionSetting`) — the global one-shot
  model pattern.
- **Reasoning toggle** (`state/current-chat.store.ts:22,44,84`,
  `routes/app/chat/chat-page.tsx:193` init effect,
  `components/chat/CockpitMenu.tsx` UI) — the per-chat runtime control.
- **Knowledge context tool** (`knowledge/query-tool.ts:36`
  `contributeKnowledgeTools`) — the conditional context-tool family added to
  `resolveActiveTools`.
- **Artefact author** (`lib/artefact-author.ts:48`) — streaming from inside a tool
  handler via `streamCompletion`, accumulating, and reporting `onProgress`
  (charCount) into the pill payload (`tool-loop.ts:80` → `ArtefactPill.tsx:48`).

---

## 4. Data model — Dexie v16

Current head is `this.version(15)` (`boot/client-data-db.ts:522`). Add
`this.version(16)` with an upgrade that backfills both new fields. No index
changes are needed (both fields are non-indexed), but a version bump is still
required so the upgrade callback runs on existing installs.

### 4.1 `SettingsRow` (`boot/client-data-db.ts:12`)
Add:
```ts
/** Global expert model — an offering ref "templateId:upstreamSlug"; null = none.
 *  Forwards a single sanitised question via the ask_expert tool. */
expertModel: string | null;
```
- **Upgrade:** `if (row.expertModel === undefined) row.expertModel = null;`
  (mirror the `substituteVisionModel` backfill at `:500`).
- **Seed:** add `expertModel: null` to the settings seed (`:650` region).

### 4.2 `PersonaRow` (`boot/client-data-db.ts:70`)
Add:
```ts
/** Default on/off state of the per-chat ask_expert runtime toggle for new
 *  chats of this persona. false = off (opt-in uplink). */
askExpertDefault: boolean;
```
- **Upgrade:** backfill `false` on every existing persona row.
- **Creation:** persona creation (`data/personas.ts` add path) sets
  `askExpertDefault: false`. The persona editor reads/writes it via the existing
  `useUpdatePersona` mutation.

---

## 5. Resolution & structural isolation (`data/send-message.ts`)

### 5.1 `resolveExpert`
A near-clone of `resolveSubstituteVision` (`:125`), added to the **shared**
`resolvePersonaContext` helper (`:48`) so **both** `useSendMessage` and
`useRegenerate` carry the expert — substitute-vision is resolved only in
`useSendMessage` and so is absent on regenerate; we deliberately do better here,
otherwise a regenerated turn would have a different (smaller) tool set and a
different cached prefix.

```ts
// The base is the shared subset of StreamCompletionArgs (and OneShotArgs):
//   provider, providerConfig, apiKey, corsProxyUrl, corsProxyKey, target.
type ExpertBase = Omit<
  StreamCompletionArgs,
  'messages' | 'bodyExtras' | 'tools' | 'cacheKey' | 'signal' | 'onRetry' | 'initialResponseTimeoutMs'
>;
async function resolveExpert(
  ref: string | null,             // settings.expertModel
  mk: MasterKey,
  corsProxyUrl: string | null,
  corsProxyKey: string | null,
): Promise<{ base: ExpertBase; modelLabel: string; reasoning: ReasoningIntent } | null>
```
- Same parse (`"templateId:upstreamSlug"`), same `getProvider` / `getOffering`
  resolution, same enabled-provider-row lookup, same `openSecret` decryption with
  the same **degrade-to-null on corrupt ciphertext** guard. Returns `null` when
  unconfigured or unresolvable → the tool is simply not offered.
- `modelLabel` is derived from the resolved `Offering` (its display name) for the
  pill header.
- `reasoning` is the **maximum** reasoning intent the resolved offering supports,
  derived from `offering.profile.reasoning` via a new `maxReasoningIntent(control)`
  helper (§5.3). Captured at resolution time so the tool runs the expert at full
  effort.
- Added to `PersonaContext` as `expertBase` + `expertModelLabel` + `expertReasoning`
  and threaded into **both** `start(...)` and `regenerate(...)` `StartArgs`.

### 5.2 The isolation guarantee (the security heart)
The tool's `execute` builds the expert call's `messages` array as **exactly**:
```ts
[ { role: 'system', content: EXPERT_SYSTEM_PROMPT },
  { role: 'user',   content: question } ]
```
Nothing else. No `toolExchange`, no prior messages, no persona instructions, no
about-me, no `tools`. This is the single most important invariant and is
**directly asserted** in tests (§12).

`bodyExtras: { reasoning: <max intent> }` — the expert runs at the **maximum**
reasoning effort its model supports (Chris's call; §5.3). The call **streams**
(`streamCompletion`, not `runOneShotCompletion`) so the pill can show live
progress (§9) and so a long reasoning phase is not cut off by the one-shot's
fixed 30 s timeout — `streamCompletion`'s `initialResponseTimeoutMs` (15 s) caps
only time-to-first-byte; once headers arrive the body streams for as long as the
expert needs.

### 5.3 `maxReasoningIntent(control)` (`lib/reasoning-resolver.ts`)
A new pure helper beside `resolveReasoningBodyExtras`, mapping a
`ReasoningControl` to the strongest `ReasoningIntent` it allows:
```ts
export function maxReasoningIntent(control: ReasoningControl): ReasoningIntent {
  switch (control.mode) {
    case 'none':     return { enabled: false };
    case 'fixed-on': return { enabled: true };
    case 'toggle':   return { enabled: true };
    case 'steps': {
      const max = control.steps.filter((s) => s !== control.offStep).at(-1);
      return max === 'low' || max === 'medium' || max === 'high'
        ? { enabled: true, effort: max }
        : { enabled: true };
    }
  }
}
```
(`ReasoningControl` / `ReasoningIntent` from `@chatsundere/llm-unified`,
`catalogue/types.ts:4` / `types.ts:103`.) The per-provider wire translation
(`applyReasoningToBody`) is reused unchanged by `streamCompletion`.

---

## 6. The tool (`tools/ask-expert.ts`)

A factory (the tool closes over the resolved expert context), following the
`Tool` shape (`tools/types.ts:21`):

```ts
export function createAskExpertTool(
  base: ExpertBase,              // resolved stream-completion base (§5.1)
  modelLabel: string,
  reasoning: ReasoningIntent,    // the max intent (§5.3)
  runtimeEnabled: boolean,
  streamFn = streamCompletion,   // injectable for tests
): Tool
```

- `name: 'ask_expert'`
- `parameters`: a single required `question: string` (the only field).
- `description`: short, model-facing — "Forward one self-contained technical
  question to a more capable expert model and return its answer."
- `systemPromptInstruction` (Band-3, injected into the **companion's** prompt):

  > An `ask_expert` tool forwards a single self-contained question to a more
  > capable expert model. Reach for it when a maths, science, or engineering
  > question is genuinely beyond what you can answer confidently on your own.
  > Write the question as a clean, standalone technical query: include every fact
  > needed to answer it, but strip names, personal details, and any emotional or
  > relational context — only the question text travels to the expert, nothing
  > else from this conversation. Then weave the expert's answer into your own
  > reply, in your own voice.

- `execute(args, signal, onProgress)`:
  1. `runtimeEnabled === false` → return
     `{ ok: false, output: '', error: 'The expert is switched off for this chat. Answer the question yourself as best you can; do not call ask_expert again this turn.' }`.
     (No expert call. Tool stays in `toolDefs` → prefix unchanged.)
  2. `question` empty/blank → `{ ok: false, output: '', error: 'No question provided.' }`.
  3. Otherwise **stream** the expert and report live progress:
     ```ts
     const messages = [system(EXPERT_SYSTEM_PROMPT), user(question)];  // only this
     let answer = '', reasoningChars = 0;
     try {
       for await (const chunk of streamFn({ ...base, messages,
                                            bodyExtras: { reasoning }, signal })) {
         if (chunk.type === 'reasoning') {
           reasoningChars += chunk.text.length;
           onProgress?.({ charCount: reasoningChars, phase: 'reasoning' });
         } else if (chunk.type === 'token') {
           answer += chunk.text;
           onProgress?.({ charCount: answer.length, phase: 'answer' });
         } else if (chunk.type === 'error') {
           throw new Error(chunk.message);
         }
       }
     } catch (e) {
       return { ok: false, output: '', error: e instanceof Error ? e.message : 'Expert call failed.' };
     }
     if (answer.trim().length === 0)
       return { ok: false, output: '', error: 'The expert returned no answer.' };
     return { ok: true, output: answer, error: null, meta: { question, model: modelLabel } };
     ```
     A network/key failure (or an `error` chunk) → `{ ok:false, error }` so the
     companion relays a constructive next step (the *dere* half).

**The expert's system prompt** (the one-shot system message):

> You are a subject-matter expert consulted on a single, self-contained technical
> question — typically mathematics, science, software engineering, or another
> rigorous domain. Answer it precisely, rigorously, and completely; show the key
> steps where they aid correctness. You have no access to any prior conversation,
> so treat the question as wholly standalone and do not ask for clarification —
> state any assumptions you must make. Answer the question as asked, without
> moralising or adding unsolicited caveats.

---

## 7. Wiring

### 7.1 `resolveActiveTools` (`tools/registry.ts:14`)
Add a third optional parameter:
```ts
export function resolveActiveTools(
  ctx: IntegrationContext,
  knowledge: KnowledgeContext | null = null,
  expert: { base: ExpertBase; modelLabel: string; reasoning: ReasoningIntent; runtimeEnabled: boolean } | null = null,
): Tool[] {
  return [
    ...STATIC_TOOLS,
    ...INTEGRATIONS.flatMap((i) => i.contributesTools(ctx)),
    ...(knowledge ? contributeKnowledgeTools(knowledge) : []),
    ...(expert ? [createAskExpertTool(expert.base, expert.modelLabel, expert.reasoning, expert.runtimeEnabled)] : []),
  ];
}
```
The tool's presence (and thus the cached prefix) depends only on
`expert !== null` — i.e. a configured, resolvable global model. The cockpit
runtime toggle rides inside the closure and never changes the tool set.

### 7.2 `stream-manager.store.ts` (`runIntoDraft`, `:306`)
- `StartArgs` gains `expertBase?` + `expertModelLabel?` + `expertReasoning?`
  (threaded from `resolvePersonaContext` via `send-message`, both `start` and
  `regenerate`).
- At the tool-assembly point (`:354`), build the expert context and pass it:
  ```ts
  const expert = args.expertBase
    ? {
        base: args.expertBase,
        modelLabel: args.expertModelLabel ?? 'expert',
        reasoning: args.expertReasoning ?? { enabled: true },
        runtimeEnabled: useCurrentChatStore.getState().askExpert,   // snapshot, like webSearchTierId at :342
      }
    : null;
  const activeTools = toolsActive ? resolveActiveTools(integrationCtx, knowledge, expert) : [];
  ```
- `toolsInstruction` (`:356`) already picks up the tool's `systemPromptInstruction`
  via `systemPromptSegment` — no extra work. The instruction is present whenever
  the tool is (i.e. whenever a global model is configured), regardless of the
  cockpit toggle → stable prefix.

### 7.3 `current-chat.store.ts`
- Add `askExpert: boolean` to the store interface (`:5`), the `InitialState`
  omit list (`:56`), `initial` (`:75`, value `false`), the `reset` (`:119`,
  resets to `false`), and a setter `setAskExpert(on: boolean)`.

### 7.4 `chat-page.tsx` init effect
- Mirror the reasoning init effect (`:193`): when the active persona changes,
  `setAskExpert(persona.askExpertDefault)`. `reset()` on chat change clears it to
  `false`, then this effect seeds it from the persona default — exactly the
  reasoning lifecycle.

---

## 8. UI

### 8.1 My Settings — expert model picker
A new `ExpertModelSetting()` component beside `SubstituteVisionSetting`
(`routes/app/settings.tsx:68`), in its own `AccordionCard`
(icon/label TBD by the implementer; suggest `↑`/"Expert uplink",
meta "Ask a stronger model for hard questions").
- A `<select>` of **all** offerings across registered providers (no vision
  filter — any model can be an expert), value bound to
  `settings.expertModel`, written via `update.mutate({ expertModel: e.target.value || null })`.
- **Disabled-over-hidden** when no providers/offerings are registered, with a
  tooltip ("Add a provider first").
- Explanatory copy + a **zero-knowledge note**: "Only the sanitised question you
  see in the pill leaves your device — never your conversation, persona, or
  personal details."

### 8.2 Persona editor — Behaviour toggle
In the Behaviour accordion (`routes/app/persona-editor.tsx`, alongside the
Tonality toggle ~`:570`): an "Ask an expert by default" toggle bound to
`persona.askExpertDefault`.
- **Disabled-over-hidden** when no global expert model is configured, tooltip:
  "Choose a global expert model in Settings first."
- A subtitle explaining it sets the default for *new chats*; the cockpit chip
  overrides per chat.
- The behaviour-accordion `meta` line (`:289`) may optionally surface a small
  "Expert" badge when on (low priority).

### 8.3 Cockpit — runtime on/off chip
In `CockpitMenu.tsx`, a new section beside reasoning / web-depth: "Ask expert"
with On/Off chips bound to `useCurrentChatStore.askExpert` /
`setAskExpert` (threaded through `Cockpit.tsx` like reasoning/web-tier).
- **Disabled-over-hidden** when no global expert model is configured (tooltip as
  above) — the runtime toggle is meaningless without a model.

---

## 9. Pill / reading flow

The streamed `ask_expert` call surfaces as a normal tool-call pill (existing
machinery: `runToolLoop` → `onPillUpdate` → pill buffer; status
`pending → completed/failed`). **Live progress** mirrors the artefact-author
precedent (`artefact-author.ts:70` → `tool-loop.ts:80` spreads `ToolProgress`
into the pill payload → `ArtefactPill.tsx:48` renders it): the `execute` loop
calls `onProgress({ charCount, phase })` per chunk.

`ToolProgress` (`tools/types.ts:4`) gains an **optional** `phase?: 'reasoning' | 'answer'`
(back-compatible — artefact-author keeps passing only `charCount`). The
`ask_expert` pill, while `pending`, reads `charCount` + `phase` from the payload
and shows the model *working*:
- phase `reasoning` → "*{meta.model}* thinking · {charCount} chars"
- phase `answer` → "*{meta.model}* answering · {charCount} chars"

so a long max-effort reasoning phase looks alive, not frozen.

The tool-call pill renderer (the component that today renders the expandable
`calculate_js` code+result pill — the plan locates it) gains an `ask_expert`
branch:
- **Header (settled):** "Asked expert · *{meta.model}*".
- **Expanded body:** the forwarded `question` (from args/`meta.question`) and the
  expert's answer (the tool `output`). On failure, the error.

The expert's answer returns to the companion as the `tool` message; the companion
then produces its **final answer in persona voice** — knowledge from the expert,
warmth from the companion. Persistence boundary is unchanged (the result lives in
the pill payload; cross-turn replay of the tool exchange stays deferred, like
every other tool).

---

## 10. Error handling (constructive)

| Condition | Behaviour |
|---|---|
| No global expert model | Tool not offered; persona toggle + cockpit chip disabled-with-tooltip. |
| Global model set but unresolvable (no enabled provider row / unknown offering / corrupt key) | `resolveExpert → null` → tool not offered (graceful, never blocks a send). |
| Cockpit runtime toggle off | Tool present; `execute` returns the "switched off — answer yourself, don't retry" error. |
| Empty `question` arg | `execute` returns "No question provided." |
| Expert stream network / status / `error`-chunk failure | `execute` returns `{ ok:false, error }`; companion relays a constructive next step. |
| Expert streamed no answer text (only reasoning, or empty) | `execute` returns "The expert returned no answer." |
| Companion model lacks tool-call support | Whole tools layer is gated on `offering.profile.toolCalls.supported` (`stream-manager:334`); ask_expert is inherently unavailable there. Precondition, consistent with all tools. |

---

## 11. Out of scope / deferred

- **Per-persona expert model.** Single global model only (Decision 3).
- **NSFW flag to the expert.** Not threaded (Decision 2).
- **Local-model expert.** The mechanism is model-agnostic; a local expert is a
  future provider, no design change here.
- **Cross-turn replay** of the expert exchange to the companion — deferred like
  every other tool.

---

## 12. Testing strategy (TDD, subagent-driven)

Backend-style unit + component tests; **full** `vitest` run per task (not just
the touched dir — per the per-task-review lesson). Key tests:

1. **Structural isolation (the load-bearing test).** `createAskExpertTool(...)`
   with an injected fake `streamFn`: assert the `messages` passed are exactly
   `[system(EXPERT_PROMPT), user(question)]` — no history, no persona, no `tools`,
   nothing else; assert the question string is forwarded verbatim and is the
   *only* user-supplied content; assert `bodyExtras.reasoning` is the intent
   passed to the factory.
2. **Runtime-off mute.** `runtimeEnabled: false` → `execute` returns the
   constructive error and **does not** call `streamFn`.
3. **Empty question** → "No question provided", no call.
4. **Streaming + live progress.** A fake `streamFn` yielding `reasoning` then
   `token` chunks: assert `onProgress` is called with `phase:'reasoning'` then
   `phase:'answer'` and monotonically growing `charCount`; assert the final
   `output` is the concatenated `token` text and `meta` carries `{ question, model }`.
5. **Stream failure** → an `error` chunk (or a throwing `streamFn`) yields
   `{ ok:false, error }` (not thrown); an empty answer → "The expert returned no
   answer."
6. **`maxReasoningIntent`** — `none`→`{enabled:false}`; `fixed-on`/`toggle`→
   `{enabled:true}`; `steps` with `['low','medium','high']`→`{enabled:true,effort:'high'}`;
   `steps` with non-standard labels→`{enabled:true}`; `offStep` excluded from the max.
7. **`resolveExpert`** — happy path returns `{ base, modelLabel, reasoning }` with
   `reasoning` = the offering's max intent; unconfigured / unknown-offering /
   no-enabled-provider / corrupt-key all return `null`.
8. **`resolveActiveTools`** includes `ask_expert` iff `expert !== null`;
   excludes it when `expert` is null; the cockpit toggle never changes inclusion.
9. **Dexie v16 migration** — existing settings backfill `expertModel: null`;
   existing personas backfill `askExpertDefault: false`; fresh open seeds both.
10. **current-chat store** — `setAskExpert` / `reset` semantics; chat-page init
    effect seeds from `persona.askExpertDefault`.
11. **UI** — settings picker writes `expertModel`; persona toggle writes
    `askExpertDefault` and is disabled-with-tooltip when no global model; cockpit
    chip reads/writes `askExpert` and is disabled without a global model.

Gates: `pnpm typecheck` (covers tests), `pnpm run build` (full TS pipeline),
full user-client `vitest`, `biome` clean. Final **opus** holistic review (the
cross-cutting wiring: prefix stability, the isolation invariant end-to-end, the
three-layer lifecycle). No live provider probe in CI; the expert call is verified
on device.

---

## 13. Merge coordination (parallel knowledgebase work)

This worktree touches files Chris's knowledgebase work also touches. Expect
merge conflicts at:
- **Dexie version number** — both want the "next" `this.version(N)`. If
  knowledgebase lands a v16 first, this becomes v17; renumber + re-test the
  migration.
- `tools/registry.ts` — `resolveActiveTools` signature (knowledge added the
  second param; we add the third).
- `state/stream-manager.store.ts` — the tool-assembly block (`:354`).
- `data/send-message.ts` — `resolvePersonaContext` / `StartArgs` threading.
- `routes/app/persona-editor.tsx` — the persona editor.
- `routes/app/settings.tsx` — My Settings accordions.
- `state/current-chat.store.ts`, `components/chat/CockpitMenu.tsx`,
  `routes/app/chat/chat-page.tsx` — the runtime-toggle trio.

Squash hygiene: verify full-tree capture (`git diff master..branch` empty,
file-count match) + `pnpm typecheck` on the merge result before worktree cleanup.

---

## 14. Security note

Client-only; no `auth/sync/proxy/crypto`. **Not a Larissa change.** It realises a
**new outbound egress**: a sanitised question to a cloud model. Logged in
`obsidian/insights/security-deferrals.md`, documenting the structural-isolation
guarantee (only `question` travels) and the consensual, opt-in, anti-paternalistic
nature of the uplink. The api-key reuses the existing per-provider encrypted
secret and the same MasterKey-gated `openSecret` path as the active model.

---

## 15. Manual verification (device — Chris)

1. With **no** global expert model: persona Behaviour "Ask an expert" toggle and
   the cockpit "Ask expert" chip are **disabled with a tooltip**; the model is
   never offered the tool.
2. Set a global expert model in My Settings (e.g. a strong cloud model). The
   toggles enable.
3. New chat with a **small** model persona (toggle off by default): ask a hard
   maths/physics question → no expert pill; the small model answers alone.
4. Flip the cockpit "Ask expert" chip on → ask the same hard question → an
   "Asked expert · *{model}*" pill appears and shows **live** progress while the
   expert works (thinking-chars during the reasoning phase, then answering-chars)
   — it must look alive during a long max-effort reasoning phase, not frozen.
   Expand the finished pill: the forwarded question is a clean technical query (no
   personal/relational content), and the expert's answer is shown; the
   companion's final reply uses the expert's answer in its own voice.
5. Set the persona's Behaviour default on → a **new** chat with that persona
   starts with the cockpit chip already on.
6. Turn the cockpit chip off mid-chat → ask a hard question → the model either
   answers itself or, if it tries the tool, gets the "switched off" message and
   then answers directly (no retry loop).
7. Regenerate an expert-assisted answer → the tool is still available (parity
   with send).
8. Provoke a failure (e.g. a bad expert key) → the companion surfaces a
   constructive fallback, the send is never blocked.
