# Phase 3 — Chat — design spec

**Date:** 2026-05-24.
**Status:** brainstormed; ready for implementation plan.
**Implements:** the chat-side of [`UX-CONCEPT.md`](../../UX-CONCEPT.md) and §6 of the [Block-1 design spec](2026-05-23-client-block-1-design.md) — Reading Mode + Interaction Mode + Cockpit + Streaming + Pills + per-message controls + NSFW Panic + Title-Gen + Partial-Stream Recovery + a Background-Stream Manager that lets chats finish working while the user roams elsewhere. Phase 2.9's brainstorm flagged the NSFW Panic; this spec lands it.
**Lead:** Liz. **Larissa:** skipped — no security-touching code; all changes live in `apps/user-client/**` and `packages/llm-unified/**`. No crypto, no auth, no sync.
**Visual ground truth:** [`chatsundere-prototype.html`](../../chatsundere-prototype.html) Reading + Interaction Mode + Cockpit (`#screen-reading`, `#interaction-topbar`, `#cockpit`). Where the wireframe and this spec disagree the wireframe wins, except where listed in §2.
**Reference (read-only):** `../chatsune/backend/modules/llm/_adapters/_nano_gpt_pair_map.py`, `_capabilities.py`, and the `ReasoningCapability` / `ReasoningEffortSpec` DTOs in `chatsune/shared/dtos/llm.py` — these are ported to TypeScript in `packages/llm-unified`.
**Curated model list:** `FIRST-MODELS.md` (Chris-authored, lives next to this spec in `superpowers/specs/`) — the per-provider shortlist that Phase 3.1 wires up.
**Out of scope:** Artefacts as a distinct content-block kind (Chris explicitly deferred — images, image-variants, attachments live with the Treasury work in a later block). Tool execution. Knowledge-base pills. Image-result pills with real payload. Voice-expression pills. Compact & Continue. Compaction-checkpoint rendering. Incognito chats. Branching. Read/TTS. My-History list and search (Phase 4). Setup-Hints panel (Phase 4). Upload-File stub (the Plus button is disabled with a "Coming with Treasury" tooltip — no stub block lands in `contentBlocks`).

---

## 1. Purpose

Phase 2 (Backbone + Settings + Circle + Persona Editor + Entrance Hall + Mindspace Cards + Adult Mode) closed the configuration surface. Every part of the app the user touches before the first chat now works. What is still missing is the chat itself: the place every other surface ultimately leads to.

Phase 3 delivers the complete chat experience — Reading Mode (sacred bottom edge, tap-to-expand, scroll-pause), Interaction Mode (Cockpit, dim-overlay, pin, capability-gated reasoning menu, dual-action button), streaming against three real upstream providers, pills as in-stream system events, persistence of the conversation, the NSFW Panic kick-out, and the first cross-chat infrastructure Chatsundere will lean on for the rest of its life: a Background Stream Manager that lets the engine finish what the user started even when they walked away.

The deliverable doubles as the surface Chris will hand out to the small-group testers; it must feel finished, not "wireframe-accurate but rough". Polish iterations after the initial Phase-3 squash are expected.

---

## 2. Decisions captured during brainstorm

Each decision is sourced from Chris's answers on 2026-05-24.

1. **Curated model list, not `/models` discovery.** Chris hands a `FIRST-MODELS.md` shortlist next to this spec — the publikumslieblinge available across all three configured providers, plus Gemma 4 as a Google surprise. The shortlist drives `KnownModel[]` per provider in `packages/llm-unified/src/providers/*.ts`. Rationale: leaky-abstraction-free model picking. The user only sees models we have verified work end-to-end with reasoning, streaming, and the three providers' specific quirks.

2. **NSFW Panic: auto-kick on toggle.** When the global Adult-Mode pill flips `nsfw → sfw` while the user is inside a chat with an `adultPersona` (or any such chat has a live stream), all in-flight streams against adult personas are aborted (controller.abort + draft persona-message deleted + user-message preserved), and the user is navigated to the Entrance Hall with a brief toast ("Adult mode off — chat closed"). Chats are not deleted; they vanish from view because the persona is filtered. Toggling back to NSFW restores everything.

3. **New-Chat is lazy.** Tapping "New Chat" from Circle navigates to `/app/chat/new?personaId=<uuid>` and lands the user in Reading Mode with an empty stream, a centred dezenter "<Persona-Name> is listening" greeting (in `persona.font`, `persona.colour`, opacity 0.4), and the Cockpit auto-open + pinned. The ChatRow + ResolvedMindspace snapshot are **not** written to Dexie until the first send. Rationale: no zombie empty chats in My History when the user changes their mind.

4. **Cross-chat background streams are first-class.** Hamburger-navigation away from an active stream does **not** abort it. The engine runs to completion; the final persist + title-gen fire in the background. A `BackgroundStreamBadge` in the global Topbar shows when any stream is alive, and lets the user jump back. Per-card "is streaming" indicators on persona cards are a polish item.

5. **Multi-chat parallel streams allowed.** One stream per chat (max). Across chats, no cap — if Aurum is mid-stream and the user starts a new chat with Verdan and sends, both stream simultaneously. Engine and stream-manager handle multiplexing; UI gates double-send within the same chat (the Cockpit Send button is disabled while a stream is live in this chat — chatbot-style enqueuing is explicitly **not** wanted).

6. **Background jobs follow the active persona.** Title generation, and every future background job (memory extraction, compaction), runs against the active persona's `providerId + modelId`. They always include the global unlocker prompt in their composed system prompt. Reason: chatsune showed that unlock matters even for "small" background jobs — without it models refuse or skew output. See [[background-jobs-prompt-composition]] in Liz's auto-memory.

7. **Reasoning is Cockpit-state, not Persona-state.** No `PersonaRow.reasoningEffort` field. The Cockpit-Menu (the popover behind the `…` button in row 1) carries the reasoning setting. Default at chat-open is `defaultOn ? defaultBucket : 'off'` derived from the model's `KnownModel.reasoning` capability. Changing it in the menu applies to the next send and persists for the lifetime of the in-memory chat session (no Dexie write in Phase 3). Rationale: reasoning is a context-bound decision, not a persona personality trait.

8. **Reasoning UI is capability-gated, not capability-greyed.** When the active model has `reasoning.kind === 'no_reasoning'`, the Menu's Reasoning section is **hidden** (not disabled with tooltip). When `reasoning.kind === 'always_on'` without effort-buckets, also hidden — there is nothing for the user to choose. The exact five-row table lives in §4.2.

9. **`ReasoningCapability` and `ReasoningEffortSpec` ported verbatim from chatsune.** Same discriminated union (`'no_reasoning' | 'optional' | 'always_on'`), same `effort?: { buckets, defaultBucket }`, same `defaultOn`, same `replayReasoning` flag for hard-CoT vs. soft-CoT. The complexity of provider reasoning quirks (nano-gpt pair-map, body-flag vs. slug-swap) is contained in the adapter layer, not leaked to the UI.

10. **Compaction-checkpoint markers from the wireframe do NOT render in Phase 3.** The wireframe shows them as a teaser for future work; the data model never gained a compaction-block kind. Block-1 §6 said "stubs render"; Chris confirmed that line was forward-looking copy, not a Phase-3 deliverable. Plus Button in the Cockpit follows the same logic — disabled with "Coming with Treasury", no stub content-block.

11. **Chat title generation runs asynchronously after the first persona response.** A second one-shot completion is dispatched to the same provider+model. The result is sanitised (strip quotes, trim, max 60 chars) and written to `chat.title`. Failures fall back to `"New chat — DD MMM, HH:mm"` (Date-Format `D MMM, HH:mm` in British convention).

12. **Cockpit input is persistent.** ChatGPT- and Discord-style: the user's in-progress text survives tab-close. For chats with a ChatRow: a `draftInput: string` column, debounced 250 ms autosave. For lazy chats (no ChatRow yet): a `localStorage` entry keyed by `cockpit-draft-new:<personaId>`. Cleared on send. Default is empty string.

13. **NSFW Panic preserves the user's last message.** When the panic kicks, the streaming persona draft-message is deleted (in-memory buffer dropped, Dexie row removed). The user-message preceding it stays. Reason: the user's typed input is consent-based; only the un-consented persona response disappears.

14. **Partial-stream recovery footer lives BELOW the incomplete message.** When the user re-opens a chat whose last message is `streamingState: 'incomplete'`, a two-button card ([Retry] [Discard]) renders below that message. Retry deletes the incomplete row and re-sends the prior user-message; Discard only deletes.

15. **`ContentBlock` schema stays at `text | pill`.** No images, no artefacts, no attachments — those are explicitly later. The `MessageRow.contentBlocks` discriminator is the future hook for adding them; Phase 3 commits to nothing beyond the two existing variants.

16. **Only `tool-call` pills are emitted by Phase 3.** The `PillRow.kind` enum stays at `'tool-call' | 'kb-injection' | 'image-result' | 'voice-expression'` (Block-1 §4.1), but Phase 3 only ever produces `'tool-call'` pills, because we don't run tools, register KB, or have a voice/image pipeline yet. Position defaults to `'inline'`. The ADR "Tool Display Position" (§5.3) freezes this convention.

17. **One spec, three sub-phases in the plan.** The implementation plan tiers the work as 3.1 (Chat-Backbone + single-stream send), 3.2 (Background-Stream + Multi-Chat-Stream + NSFW Panic), 3.3 (Pills + Title-Gen + Partial-Recovery + Polish). Each sub-phase squashes once. Same execution pattern as Phases 2.5–2.9 (subagent-driven per task).

---

## 3. Sub-phase breakdown

The plan splits Phase 3 into three sequenced sub-phases. Each ends in one squash, lefthook + tests must be green at every squash.

### 3.1 Chat-Backbone

- Routes: `/app/chat/:chatId`, `/app/chat/new?personaId=<uuid>`.
- Stores: `current-chat.store.ts` (active chat, expansion exclusivity, autoFollow, pin, isInteractionMode); `stream-manager.store.ts` (global singleton; the full API per §5.2 lands here in 3.1, exercised only for one chat at a time — cross-chat scenarios become manual-verification targets in 3.2).
- `KnownModel` extension in `packages/llm-unified/src/types.ts` — adds `contextWindow`, `reasoning: ReasoningCapability`, `vision: boolean`, `tools: boolean`.
- `FIRST-MODELS.md` ingestion — populates `knownModels: KnownModel[]` for nano-gpt, Novita, Ollama Cloud.
- `packages/llm-unified/src/providers/_nano-gpt-pairs.ts` — adapter-private pair-map; `openai-chat-completions.ts` gets a nano-gpt pre-flight hook that swaps `modelId` and/or sets a body-flag based on switchingMode.
- `apps/user-client/src/lib/stream-engine.ts` — pure orchestration, composition + assembly + reasoning-resolver + adapter call + chunk loop.
- `apps/user-client/src/lib/reasoning-resolver.ts` — maps `(KnownModel.reasoning, ReasoningState) → wire payload extras`.
- `apps/user-client/src/lib/token-estimator.ts` — 4-chars-per-token heuristic.
- ReadingMode + InteractionMode UI components and CSS (per §6).
- End-to-end send-flow: one chat at a time, stream runs to completion, persists.
- Per-message controls (Copy, Bookmark live; Branch and Read disabled-stubs; Regenerate live — see §5.2 for the abort-and-restart sequence).
- Cockpit Reasoning menu (capability-gated, no body-write).
- Cockpit input draft persistence (ChatRow.draftInput + localStorage for lazy).
- Dexie v6 migration (adds `draftInput`, backfills `''`).

**Squash criterion:** the user can complete a full chat-cycle against at least one provider end-to-end, including capability-gated reasoning, with manual-verification items 1–3, 8, 9, 10 from §11.3 passing on Chris's device.

### 3.2 Background-Stream + Multi-Chat + NSFW Panic

- `apps/user-client/src/state/stream-manager.store.ts` — global singleton with `Map<chatId, StreamHandle>`, `start/abortDiscard/abortAllForPersonaDiscard/has/getDraftMessage`.
- Hamburger nav, persona switch, new-chat-into-second-persona all leave the original stream running.
- `BackgroundStreamBadge` global topbar component, hidden when no live streams, count + tap-to-jump.
- Cockpit Send disabled when stream for this chat is live (with "<Persona> antwortet noch…" hint).
- NSFW Panic effect wired to `useAdultMode().setMode` transition `nsfw → sfw`: abort matching streams (discard draft msg, keep user msg), navigate Entrance Hall, fire toast.

**Squash criterion:** Two parallel chats stream cleanly while the user roams between them; NSFW Panic kicks atomically.

### 3.3 Pills + Title-Gen + Partial-Recovery + Polish

- `<Pill />` component with kind-driven icon+label; CSS opacity-gates by `.msg.expanded`.
- Stream-Engine emits PillRow on `tool-call` chunks (kind=tool-call, positionHint='inline', status='completed'); persists with bulk-add on stream finish.
- ADR `obsidian/decisions/0029-tool-display-position.md` (number tentative — confirm at write-time) — see §5.3.
- `apps/user-client/src/lib/title-generator.ts` — async one-shot completion using active persona's provider+model, system-prompt composed with global unlocker; success path writes title, error path writes fallback.
- Partial-stream recovery footer below the incomplete message; Retry replays the last user-message, Discard deletes only.
- BottomAffordance "breathing" tuning, ScrollToEnd micro-animation, Pin-glow polish, dim-overlay easing pass.
- Lazy-chat `localStorage` draft survival.

**Squash criterion:** All §7 (Acceptance) bullets pass on Chris's device.

---

## 4. Data model and llm-unified hardening

### 4.1 Dexie v6 migration (single change)

```ts
this.version(6)
  .stores({
    settings: 'id',
    providers: 'id, templateId, enabled',
    mindspaces: 'id, builtIn, displayName',
    personas: 'id, providerId',
    chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
    messages: 'id, chatId, [chatId+createdAt]',
    pills: 'id, messageId',
  })
  .upgrade(async (tx) => {
    const chats = await tx.table('chats').toArray();
    for (const c of chats) {
      await tx.table('chats').update(c.id, { draftInput: '' });
    }
  });
```

Schema diff:

```ts
interface ChatRow {
  // … all existing fields unchanged
  draftInput: string;                  // NEW — debounced 250 ms autosave, '' default
}
```

`MessageRow.streamingState` (`'complete' | 'incomplete'`) already exists from v1 and is exercised for the first time in Phase 3. `PillRow` is untouched.

### 4.2 `KnownModel` and `ReasoningCapability` (llm-unified)

Ported from chatsune's `ReasoningCapability` / `ReasoningEffortSpec` (`chatsune/shared/dtos/llm.py`):

```ts
// packages/llm-unified/src/types.ts

export interface ReasoningEffortSpec {
  buckets: string[];                   // e.g. ['low','medium','high']
  defaultBucket: string;               // must be in buckets
}

export interface ReasoningCapability {
  kind: 'no_reasoning' | 'optional' | 'always_on';
  effort?: ReasoningEffortSpec;        // undefined → on/off only
  defaultOn: boolean;                  // initial cockpit state
  replayReasoning: boolean;            // hard-CoT (replay thinking blocks in history)
                                       // vs. soft-CoT (DeepSeek/GLM/Kimi style)
}

export interface KnownModel {
  id: string;
  displayName: string;
  notes?: string;
  contextWindow: number;                // RECOMMENDED, not maximum — drives the Context-Gauge
  reasoning: ReasoningCapability;
  vision: boolean;
  tools: boolean;
}
```

`contextWindow` is the **recommended** size from `FIRST-MODELS.md`, not the upstream's hard maximum. DeepSeek V4 Pro/Flash list 200k recommended / 1M maximum; we pin the gauge to 200k so the user sees the "you're getting close" warning before the model degrades. Maximum-context-mode is a future polish concern.

Cockpit-UI table for Reasoning section:

| `reasoning.kind` | `reasoning.effort` | Cockpit-Menu Reasoning section |
|---|---|---|
| `no_reasoning` | — | hidden |
| `always_on` | undefined | hidden (nothing to choose) |
| `always_on` | given | bucket-selector only (no on/off) |
| `optional` | undefined | on/off toggle, initial = `defaultOn` |
| `optional` | given | bucket-selector + "Off" entry, initial = `defaultOn ? defaultBucket : 'off'` |

### 4.3 Nano-GPT pair-map (adapter-private)

```ts
// packages/llm-unified/src/providers/_nano-gpt-pairs.ts

export type SwitchingMode = 'slug' | 'flag' | 'none';

export interface NanoGptPair {
  nonThinkingSlug: string;
  thinkingSlug: string | null;        // null when switchingMode === 'flag' | 'none'
  switchingMode: SwitchingMode;
}

export const NANO_GPT_PAIRS: Record<string, NanoGptPair> = {
  // populated from FIRST-MODELS.md per the curated shortlist
};
```

The `openai-chat-completions` adapter gains a pre-flight hook keyed on `provider.id === 'nano-gpt'`: it looks up the requested `modelId` in `NANO_GPT_PAIRS`, and depending on `switchingMode`:

- `'slug'` → swap `modelId` with `thinkingSlug` when reasoning on, with `nonThinkingSlug` when off.
- `'flag'` → keep `nonThinkingSlug`, add `thinking: bool` (or whatever the provider expects — verify against FIRST-MODELS) to the request body.
- `'none'` → no switch; the model has no reasoning controls.

The hook is one function in the same adapter file; the rest of the wire-shape stays generic. Future providers with similar quirks repeat this pattern in their own pair-map.

### 4.4 What stays unchanged

- `PersonaRow` — no new field. Reasoning is not a persona property.
- `MessageRow`, `PillRow`, `ChatRow` (apart from `draftInput`), `SettingsRow`, `MindspaceRow`, `ProviderRow` — none change.
- `ContentBlock = { type: 'text'; text } | { type: 'pill'; pillId }` — no new variant.
- `PillRow.kind` enum — no new value; Phase 3 emits only `'tool-call'`.

---

## 5. Stream-engine, background-stream-manager, and pills

### 5.1 `stream-engine.ts`

Pure orchestration; no Dexie writes. Async-generator-driven, signal-cancellable.

```ts
export interface StartStreamArgs {
  chat: ChatRow;
  persona: PersonaRow;
  provider: ProviderRow;
  model: KnownModel;
  priorMessages: MessageRow[];        // sorted by createdAt asc
  userMessageText: string;
  reasoning: ReasoningState;          // current-chat.store state
  globalUnlocker: string;             // SettingsRow.globalUnlockerPrompt
  globalAboutMe: string;              // SettingsRow.globalAboutMe
  signal: AbortSignal;
  onChunk: (chunk: StreamChunk) => void;
}

export interface StreamEngineResult {
  finalContentBlocks: ContentBlock[];
  pillRows: PillRow[];                // NOT yet persisted — caller does the bulk write
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'unknown';
}

export async function runStreamEngine(args: StartStreamArgs): Promise<StreamEngineResult>;
```

Steps:

1. `composeSystemPrompt({ globalUnlocker, aboutMe, personaInstructions, projectInstructions: '', memoryContext: '' })`.
2. Build `WireMessage[]` from `priorMessages + new user-turn`. Pill-blocks in `priorMessages` are folded into the surrounding text as plain-text annotations (no tool replay — Phase 3 doesn't execute tools).
3. `reasoning-resolver.ts` maps `(KnownModel.reasoning, ReasoningState) → extras` (e.g. `{ reasoning_effort: 'medium' }` or `{ thinking: true }` or — via nano-gpt pair-map — a `modelId` swap).
4. Call `streamCompletion(...)` from llm-unified with the built request and `signal`.
5. Iterate chunks. For each:
   - `'token'` → append to the tail of `contentBuffer`: extend the last text-block if present, otherwise push a new text-block.
   - `'tool-call'` → push a new pill-block referencing a freshly-uuidv7'd PillRow (kind=tool-call, positionHint='inline', status='completed', payload={name, argumentsJson, toolCallId}).
   - `'finish'` → break, capture `finishReason`.
   - `'error'` → throw `StreamEngineError` with the message; caller decides.
6. Return `{ finalContentBlocks, pillRows, finishReason }`. **Engine never writes Dexie.**

### 5.2 `stream-manager.store.ts`

Global Zustand singleton.

```ts
export interface StreamHandle {
  chatId: string;
  personaId: string;
  draftMessageId: string;
  controller: AbortController;
  status: 'streaming' | 'finalising' | 'done' | 'error';
  contentBuffer: ContentBlock[];      // live, UI subscribes via shallow selector
  pillBuffer: PillRow[];              // live
  startedAt: number;
}

export interface StreamManagerStore {
  streams: Map<string, StreamHandle>;
  start(args: StartArgs): Promise<void>;
  abortDiscard(chatId: string): Promise<void>;
  abortAllForPersonaDiscard(personaId: string): Promise<void>;
  has(chatId: string): boolean;
  getDraftMessage(chatId: string): { id: string; contentBlocks: ContentBlock[] } | null;
}
```

Phase 3 has exactly **one** abort mode: discard. The Phase-3 codepaths that abort are Regenerate and NSFW Panic, both of which discard. There is no "stop and keep partial" surface — that would require a UI affordance we don't ship in Phase 3.

`start()` flow:

1. Open a Dexie write-transaction over `chats`, `messages`. Insert the user-message-row (`role: 'user'`, `streamingState: 'complete'`, `contentBlocks: [{ type: 'text', text }]`). Insert the draft persona-message-row (`role: 'persona'`, `streamingState: 'incomplete'`, `contentBlocks: []`). Update `chat.lastMessageAt`. If lazy (no ChatRow yet, caller has just created it), this is in the same transaction.
2. Construct an `AbortController`. Push a fresh `StreamHandle` into `streams`.
3. Open the API-key with `secrets.openSecret(provider.apiKey, mk)`; if the provider uses `cors-proxy`, also open `settings.corsProxy.sharedKey`.
4. Spawn `runStreamEngine(...)` (do not await within the action — the action returns immediately; the engine resolves later). Pass `onChunk` writing into the handle's `contentBuffer` and `pillBuffer` (Zustand mutation).
5. On engine resolve:
   - `status = 'finalising'`.
   - In one Dexie transaction: `messages.update(draftMessageId, { contentBlocks: finalContentBlocks, streamingState: 'complete' })`, `pills.bulkAdd(pillRows)`, `chats.update(chatId, { lastMessageAt: Date.now() })`.
   - `status = 'done'`. Keep the handle for 200 ms (lets the last UI re-render settle) then delete from the map.
   - If `chat.title === null`, fire `generateTitleAsync(...)` — do not await.
6. On engine reject from a **non-abort error** (network, 4xx, 5xx, parser-throw):
   - `status = 'error'`. Keep the handle in the map. Dexie: `messages.update(draftMessageId, { contentBlocks: contentBuffer, streamingState: 'incomplete' })` — so a fresh-boot recovery footer applies if the user closes the tab without retrying. UI surfaces a retry-footer immediately on the message.

7. On `abortDiscard(chatId)`:
   - `handle.controller.abort()` (engine throws AbortError; ignored).
   - Dexie transaction: delete `messages[draftMessageId]`. PillRows were not persisted yet (in-memory buffer only). User-message is **not** touched.
   - `status = 'done'`. Remove handle.

`abortAllForPersonaDiscard(personaId)` iterates the map and calls `abortDiscard(chatId)` for every handle whose `personaId` matches.

**Regenerate flow (per-message control):**

1. If a stream is live for this chat → `abortDiscard(chatId)` — that deletes the draft persona-message and stops the in-flight stream.
2. If the previous persona-message is complete (no live stream) → delete that completed persona-message row directly.
3. Either way, look up the user-message immediately preceding the deleted persona-message. Call `useSendMessage.mutateAsync({ chatId, text: previousUserMessage.text, reuseUserMessage: true })`. The `reuseUserMessage` flag tells the send-mutation to skip inserting a new user-msg and use the existing one; only the draft persona-msg is freshly inserted.

**Engine completion is the engine's job, not the UI's.** Once `start()` has spawned the engine, the engine runs to completion regardless of navigation, persona switch, or the user starting a stream in another chat. The only valid abort triggers are:

- Per-Message **Regenerate** action (Phase-3 explicit user gesture).
- **NSFW Panic** (`abortAllForPersonaDiscard(personaId)`).
- **Tab-close** (the JS runtime dies with the tab; the engine's promise rejects with an AbortError-like state, but no UI-side cleanup is reachable — see §6.3).

### 5.3 Pills, `<Pill />`, and ADR "Tool Display Position"

The component:

```tsx
<Pill row={pillRow} />
```

renders `<span class="pill"><span class="pill-icon">{icon}</span>{label}</span>`. Icon and label by `kind`:

| kind | icon | label |
|---|---|---|
| `tool-call` | `⚙` | `payload.name` |
| `kb-injection` | `◆` | `"KB" + (payload.kbName ?? "")` |
| `image-result` | `▢` | `"image"` |
| `voice-expression` | `~` | `payload.expression` |

CSS:

- `.msg .pill { opacity: 0.4 }` — Reading Mode default.
- `.msg.expanded .pill { opacity: 1 }` — when the containing message is tap-expanded, or rendered inside Interaction Mode overlay.
- `positionHint === 'above-text'` renders the pill in its own `<div class="pill-above">` block above the surrounding text-block. `'inline'` stays in the text flow.

Phase 3 emits only `tool-call` pills. The other three `kind` values stay in the enum, reserved.

**ADR `obsidian/decisions/0029-tool-display-position.md` (number tentative; confirm against current decisions/ folder at write-time).** Nygard format.

- **Status:** Accepted (2026-05-24).
- **Context:** Pills are in-stream system events. Their position relative to surrounding text is semantically meaningful — `inline` keeps the persona's voice flowing, `above-text` lifts the pill as context the following text refers to. Phase 3 introduces the data field; future blocks introduce the registries that populate it.
- **Decision:**
  1. `PillRow.positionHint: 'inline' | 'above-text'` is mandatory on every PillRow.
  2. **Default for `tool-call` pills in Phase 3** is `'inline'`. Phase 3 hardcodes this in the stream-engine.
  3. When the **Tool Registry** lands (later block), each tool's manifest declares `displayPosition: 'inline' | 'above-text'`. The engine populates `positionHint` from the manifest.
  4. **Other pill kinds** receive their defaults from the block that introduces them — KB pills default `'above-text'`, image-result pills default `'above-text'`, voice-expression pills default `'inline'`. Not this ADR's job.
- **Consequences:** Phase 3 codepath is trivial (one constant). Data model is forward-compatible. No reverse migration required.

---

## 6. Reading Mode + Interaction Mode

### 6.1 Routes and ChatPage layering

```
/app/chat/new?personaId=<uuid>     → ChatPage lazy mode
/app/chat/:chatId                  → ChatPage chat mode
```

`ChatPage` mounts two layers on top of each other in the same React tree:

- `<ReadingMode />` — the persistent layer. Always rendered; behind the Interaction overlay when present.
- `<InteractionMode />` — overlay layer, conditional on `current-chat.store.isInteractionMode`. Composed of Topbar (absolute top), DimOverlay (positioned to cover the stream when input focused), and Cockpit (absolute bottom).

The stream pane in ReadingMode remains visible behind the InteractionMode overlay — Interaction is dimmed-but-visible context, not a route change.

### 6.2 ReadingMode

**Layout.**

- No global topbar (per Block-1 §6.1, the Hamburger lives in InteractionMode topbar only).
- Stream pane = `flex-1`, `overflow-y-auto`, anchored at the bottom edge.
- `<BottomAffordance />` and `<ScrollToEnd />` absolutely positioned, just above safe-area-inset-bottom.

**Stream rendering.**

- Messages sorted by `createdAt asc`.
- `<DateSeparator>` between days; label rule: today → "Today", yesterday → "Yesterday", else "D MMM YYYY".
- `<MessageBlock>` renders user vs. persona variants:
  - **User:** `Settings.displayName` (or fallback via `useDisplayName()`), font = `--font-display` (serif), right-aligned, subtle highlight on expand.
  - **Persona:** `persona.name` in `persona.colour`, font = `persona.font`, left-aligned.
- `contentBlocks` rendered in order. Text-blocks → `<p>` children; pill-blocks → `<Pill>` with positionHint honoured.
- Streaming cursor: a blinking caret at the tail of the draft persona message while a stream is active.

**Tap-to-expand.**

- Tap on `<MessageBlock>` toggles `current-chat.store.expandedMessageId`. Single-expand exclusivity.
- Expanded state reveals timestamp, `<MessageControls>`, highlight border, full-opacity pills.
- Tap outside any message collapses all.

**Sacred bottom edge + auto-follow + pause.**

- `autoFollowEnabled` is true when the user is within 30 px of the bottom.
- New chunks scroll the pane to the new bottom while `autoFollowEnabled`.
- User scrolls > 30 px up → `autoFollowEnabled = false`, Affordance fade-out, ScrollToEnd fade-in.
- User scrolls back into the 30-px zone → `autoFollowEnabled = true`, ScrollToEnd fade-out, Affordance fade-in.

**Per-message controls (Phase 3 scope).**

| Button | Phase 3 | Tooltip when disabled |
|---|---|---|
| Branch | disabled-stub | "Branching arrives later" |
| Regenerate | active (only on the last persona message) | — |
| Copy | active (joins text-blocks of the message into plain text, omits pills) | — |
| Bookmark | active (toggles `messages.bookmarked`, recounts `chats.bookmarkedMessageCount`) | — |
| Read | disabled-stub | "Voice arrives with Block 4" |

### 6.3 InteractionMode

**Trigger:** Tap on `<BottomAffordance />` sets `isInteractionMode = true`.

**Auto-close (when not pinned):** Per Block-1 §2 Decision 16 — three triggers:

- Send-tap with non-empty input (after a brief 100 ms delay so the input clears visually first).
- Tap anywhere outside Topbar + Cockpit (the dimmed stream area, the dim-overlay edges).
- Input blur combined with the next outside-tap — blur alone is not enough.

Pin overrides all three.

**Topbar (absolute, top).**

- **Hamburger** → routes to Entrance Hall. Stream-Manager keeps the handle alive (§5.2).
- Center: "Chat with" label + `persona.name` in `persona.colour`.
- Right:
  - **JournalStub** — sage pulsing dot + counter `0`. Phase 3 stub; data binding to a future memory system is the only future change.
  - **ContextGauge** — golden mini-bar + percentage. Live. Token estimate via `lib/token-estimator.ts` (4 chars/token). Denominator = `model.contextWindow`. Numerator counts composed system prompt + all messages in this chat.

**Cockpit (absolute, bottom).**

Row 1 (controls):

- **Plus** — disabled. Tooltip "Coming with Treasury".
- **Menu** (`…`) — popover containing the Reasoning section (rendered per §4.2 table). Architecture extensible; Phase 3 ships only this section.
- **Live** (`≈`) — disabled. Tooltip "Voice arrives with Block 4".
- spacer.
- **Pin** — toggles `isPinned`. Visual: active = full opacity + subtle glow; inactive = 50% opacity.

Row 2 (input + send):

- **AutoSizeTextarea** — controlled. Value source per §6.4.
- **DualActionBtn**:
  - Mic icon + disabled tooltip when input is empty.
  - Send icon + active when input has text AND no stream is live in this chat.
  - Send icon + disabled with hint "<Persona-Name> antwortet noch…" when a stream is live in this chat.

**DimOverlay.**

- `background: rgba(0,0,0,0.55)`.
- Active when the textarea is focused.
- Blur fades it out, but `isInteractionMode` does not flip — Interaction stays open until one of the three auto-close triggers (or Pin toggle).

### 6.4 Cockpit input draft persistence

**Chat-mode (chatId present):**

- Textarea value sourced from `chat.draftInput`.
- `onChange` debounced 250 ms → `useUpdateChat({ id: chatId, draftInput: value })`.
- On send (`useSendMessage.mutateAsync`): in the same transaction that inserts user-msg + draft-persona-msg, set `chat.draftInput = ''`. Atomic; no race where a sent message also lives in the draft.

**Lazy-mode (chatId === null):**

- Textarea value sourced from `localStorage.getItem(\`cockpit-draft-new:\${personaId}\`)`.
- `onChange` debounced 250 ms → `localStorage.setItem(...)`.
- On send (which calls `useCreateChat()`-then-`useSendMessage()`): right after the ChatRow is created (with its initial `draftInput: ''`), `localStorage.removeItem(\`cockpit-draft-new:\${personaId}\`)`. The user-message and draft-persona-msg are then inserted normally.

### 6.5 Lazy-mode greeting

When `chatId === null` and `messages.length === 0`:

- Stream pane shows a single centred element: `<PersonaGreeting personaName="Aurum" personaFont="serif" personaColour="#…" />`.
- Renders as `<persona.name> is listening` in the persona's font, persona's colour at `opacity: 0.4`.
- Auto-disappears on first message render.
- Interaction Mode is auto-open and Cockpit auto-pinned on mount (so the user can type immediately without affordance-tap).

---

## 7. NSFW Panic Auto-Kick

Triggered when `useAdultMode().setMode('sfw')` flips the value from `nsfw` to `sfw`.

```ts
async function onAdultModeChanged(prev: 'nsfw'|'sfw', next: 'nsfw'|'sfw') {
  if (!(prev === 'nsfw' && next === 'sfw')) return;
  const db = getClientDataDb();
  const adultPersonaIds = (await db.personas
    .where('adultPersona').equals(true).toArray()
  ).map(p => p.id);
  if (adultPersonaIds.length === 0) return;

  for (const pid of adultPersonaIds) {
    await streamManager.abortAllForPersonaDiscard(pid);
  }

  const activeChatId = currentChatStore.getState().chatId;
  if (activeChatId) {
    const activeChat = await db.chats.get(activeChatId);
    if (activeChat && adultPersonaIds.includes(activeChat.personaId)) {
      navigate('/app');
      toast.show('Adult mode off — chat closed', { tone: 'warn', durationMs: 3500 });
    }
  }
}
```

**Discard semantics:**

- The draft persona-message is deleted (Dexie row + in-memory contentBuffer dropped).
- The user-message preceding it is preserved. User consent argument: the user-input survives; the un-consented persona-response disappears.
- The ChatRow stays. The persona is filtered out by `useFilteredPersonas()` (Phase 2.9), so the chat is unreachable until SFW flips back. No data deletion.

**No race:** the `setMode` mutation awaits the abort loop before the toggle persists (rendered states reconcile cleanly).

---

## 8. Title Generation

```ts
export async function generateTitleAsync(args: {
  chat: ChatRow;
  persona: PersonaRow;
  provider: ProviderRow;
  model: KnownModel;
  firstUserMessage: string;
  firstPersonaResponse: string;       // joined text-blocks of the first persona response
  globalUnlocker: string;
  globalAboutMe: string;
}): Promise<void>;
```

Implementation:

1. Compose system prompt via `composeSystemPrompt({ globalUnlocker, aboutMe, personaInstructions, projectInstructions: '', memoryContext: '' })`.
2. Build WireMessage sequence: `system + user(firstUserMessage) + assistant(firstPersonaResponse) + user(titleInstruction)`.
3. titleInstruction = `'Generate a 3-5 word title for this conversation in British English. Respond with ONLY the title, no quotes, no punctuation at end.'`
4. Call `runOneShotCompletion(...)` (a non-streaming helper in `packages/llm-unified`, sibling of `streamCompletion`). Params: `maxTokens: 20`, `temperature: 0.3`.
5. `sanitiseTitle(raw)` — strip surrounding quotes, trim, replace consecutive whitespace with single space, truncate to 60 chars. Empty result → throw.
6. `db.chats.update(chatId, { title: cleaned })`.
7. Catch any failure → `db.chats.update(chatId, { title: fallbackTitle(chat.createdAt) })` where `fallbackTitle(ts)` = `"New chat — D MMM, HH:mm"` in British convention.

Display logic while `chat.title === null`:

- Entrance-Hall Continue-Card shows `fallbackTitle(chat.createdAt)` as a provisional label.
- My History (Phase 4) does the same.
- Once the background promise writes the real title, TanStack Query invalidation re-renders.

Trigger:

- After the **first** persona-message in a chat completes (`chat.title === null && messages.role==='persona'.count === 1`), the stream-manager fires `generateTitleAsync()`. No await; rejections are caught inside.

`runOneShotCompletion` is a new non-streaming helper in `packages/llm-unified`. It reuses `composeSystemPrompt`, `WireMessage`, and the same adapter as streaming, but waits for the full response (no SSE chunking, just the final assistant content). Bun-tested in 3.1.

---

## 9. Partial-stream Recovery

Tab-close-while-streaming path:

1. Stream-manager `start()` already inserted the draft persona-message with `streamingState: 'incomplete'`.
2. A `beforeunload` handler best-effort attempts to write the current `contentBuffer` to Dexie synchronously. IndexedDB is async; this is best-effort. In the realistic case the draft persists with whatever was last persisted (often empty) and `streamingState: 'incomplete'`.
3. JS runtime dies with the tab.

Next boot path:

1. Opening a chat loads its messages via `useChat(id)`.
2. If the **last** message has `streamingState === 'incomplete'`, ReadingMode renders below that message a footer:

   ```
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ⚠  Stream interrupted
   ┃  [ Retry ]    [ Discard ]
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ```

3. **Retry:** delete the incomplete persona-msg row; call `useSendMessage({ chatId, text: <previous user-message text> })` — same user-turn is re-sent (not a new user-turn). Fresh stream, fresh draft.
4. **Discard:** delete only the incomplete persona-msg row.

The footer renders only when the last message is incomplete. A previous incomplete message buried earlier in the history (e.g. user retried successfully later) does not surface a second footer.

Mid-session abort flows (Regenerate, NSFW Panic) do not produce the incomplete-marker — those rows are deleted hard.

Hamburger-nav does not produce the incomplete-marker either — the stream stays alive in the manager and finishes normally.

---

## 10. State management summary

Zustand stores Phase 3 introduces (new in **bold**, existing in *italic*):

- *`session.store.ts`* — unchanged.
- *`mindspace.store.ts`* — unchanged. Chat-page mounts set the resolved palette per current chat (or per pending persona in lazy mode).
- **`current-chat.store.ts`** — `chatId`, `pendingPersonaId`, `expandedMessageId`, `autoFollowEnabled`, `isInteractionMode`, `isPinned`, `reasoning: ReasoningState`.
- **`stream-manager.store.ts`** — global singleton with the `Map<chatId, StreamHandle>` API in §5.2.

TanStack Query hooks introduced:

- `useChat(chatId)` — chatRow + messages (sorted by createdAt) + pills (joined per messageId).
- `useSendMessage()` — mutation; orchestrates user-msg + draft-msg insert, lazy-chat ChatRow create, stream-manager start.
- `useRegenerate()` — mutation; aborts existing stream for the chat, deletes the last persona-msg, re-sends.
- `useToggleBookmark(messageId)` — mutation.
- `useUpdateChat()` — generic, used for `draftInput` debounced autosave.
- `useCreateChat()` — mutation, lazy-mode only.
- `useDeleteIncompleteMessage()` — mutation, partial-recovery Discard.
- `useChats()` — list (used internally for Entrance-Hall Continue-Card / recent persona; My History list is Phase 4).

Pure helper modules introduced:

- `apps/user-client/src/lib/stream-engine.ts`
- `apps/user-client/src/lib/title-generator.ts`
- `apps/user-client/src/lib/token-estimator.ts`
- `apps/user-client/src/lib/reasoning-resolver.ts`

---

## 11. Testing strategy

### 11.1 `packages/llm-unified` — Bun tests

- `KnownModel` discriminator coverage: 6 cases for `ReasoningCapability` (`no_reasoning`, `optional ± effort`, `always_on ± effort`, plus `defaultOn=true/false`).
- `nano-gpt-pairs`: each `switchingMode` (`slug`, `flag`, `none`) produces the expected wire-body via a snapshot test.
- `runOneShotCompletion`: success path (non-streamed full response), error path (4xx, 5xx, network).
- Stream-parser: synthetic SSE bytes with mixed `token` + `tool-call` deltas produce the expected `StreamChunk[]` sequence including order.

### 11.2 `apps/user-client` — Vitest with fake-indexeddb

- **Dexie v6 migration:** existing chats get `draftInput: ''` backfilled; fresh install seeds `draftInput: ''`. 2 cases.
- **Stream-engine (pure):** mocked `streamCompletion`, synthetic chunk-stream → expected `{ finalContentBlocks, pillRows, finishReason }`. Tool-call/text ordering preserved.
- **Stream-manager:**
  - `start` inserts both messages + handle; `engine resolves` → final persist + handle removed + title-gen fired.
  - `abortDiscard(chatId)` deletes draft-msg, keeps user-msg, removes handle.
  - `abortAllForPersonaDiscard(personaId)` iterates all matching handles.
- **ReadingMode:** sacred-bottom-edge tracking, tap-to-expand exclusivity, scroll-up-30 ↔ auto-follow pause, scroll-back resume, BottomAffordance ↔ ScrollToEnd swap, DateSeparator (Today / Yesterday / specific date) label rules.
- **InteractionMode:** Affordance-tap opens; Pin prevents auto-close; Decision-16 triggers fire when unpinned; DimOverlay only on input focus.
- **Cockpit:**
  - Send disabled when stream live for this chat (hint visible).
  - Reasoning menu: 5 capability permutations show the right control (hidden / bucket-only / on-off / bucket+off).
  - Draft input debounced 250 ms persists.
  - Lazy localStorage draft survives mount/unmount; cleared on send.
- **NSFW Panic:**
  - `nsfw→sfw` with active NSFW-chat → abort, draft gone, user-msg preserved, navigate to Entrance Hall, toast shows.
  - `nsfw→sfw` with no adult-persona-chats → no-op.
- **Title-gen:** mock `runOneShotCompletion`, success writes title; failure writes fallback; global unlocker IS in the wire-body.
- **Partial-Recovery:** boot with last-message `streamingState: 'incomplete'` → footer renders; Retry deletes incomplete + re-sends user-msg; Discard deletes only.
- **Background-Stream Badge:** navigate away with live stream → badge appears with count; second concurrent chat increments; tap → routes to first.
- **Lazy-Chat flow:** mount `/app/chat/new?personaId=X`, Cockpit auto-open + pinned, first send creates ChatRow with resolvedMindspaceId snapshot + route-replace to `/app/chat/<newId>`.

**Coverage target:** stream-engine + stream-manager + reasoning-resolver + title-generator: 100% unit-tested. UI components: shallow integration tests; no pixel snapshots.

### 11.3 Manual verification (Chris on his phone)

1. **Lazy-Chat-Flow.** Circle → Persona-Card → New Chat → empty Reading with "<persona> is listening" + Cockpit auto-open. Type something, Hamburger out, come back → draft still there (localStorage).
2. **Reading Mode stream live.** Send first message, watch stream grow live, scroll mid-stream up → ScrollToEnd appears, auto-follow paused.
3. **Tap-to-Expand exclusivity.** Tap user-msg → expanded; tap another → first collapses, second expanded.
4. **Background-Stream.** Send a question, Hamburger out to Entrance Hall while stream live → badge appears in topbar. Return: stream either still live or completed.
5. **Multi-Chat-Stream.** Start stream in chat A, switch to chat B (via Circle → new persona → New Chat), send there. Both badges visible. Both finish cleanly. Both get titles after seconds.
6. **NSFW Panic.** Stream against an NSFW persona is live. Toggle SFW. Immediately: stream gone, persona-card hidden, user back in Entrance Hall, toast "Adult mode off — chat closed".
7. **Pin prevents auto-close.** In Interaction Mode tap Pin. Send a message — Cockpit stays open.
8. **Cockpit Send disabled during live stream.** Send a message. Before the response, try Send again → button disabled with hint "<persona> antwortet noch…".
9. **Reasoning menu capability-gated.** Persona with `no_reasoning` model — Reasoning section in Menu hidden entirely. Persona with `optional` + buckets — bucket selector + Off. Visually guided.
10. **Title after first response.** Send a question, wait for response — chat title (in My History / Continue-Card) flips from fallback to generated title after seconds.
11. **Partial Recovery.** Send a question, mid-stream close tab, reopen → Stream-Interrupted footer appears. Retry works.
12. **Per-Card Background indicator.** Stream in chat A. Entrance Hall: persona-card A carries a subtle pulsing indicator (Polish-Pass — sub-phase 3.3).

---

## 12. Acceptance criteria

Phase 3 is "done" when, from a fresh install onwards:

1. The user can start a lazy chat with any configured persona, type and watch it autosave (tab-close-survivable via localStorage), and send to a real upstream.
2. Streams against all three providers (nano-gpt, Novita, Ollama Cloud) succeed with at least one model from `FIRST-MODELS.md` per provider. The composed system prompt — including the global unlocker — is verifiable via the browser's Network tab.
3. Reading Mode renders the stream with the persona's mindspace background applied; tap-to-expand reveals timestamp + controls + background highlight; affordance ↔ scroll-to-end swap respects the 30-px threshold; date separators render correctly across day boundaries.
4. Interaction Mode opens on affordance-tap; Pin overrides auto-close; the three Decision-16 close triggers fire when unpinned; DimOverlay is on only when the textarea is focused.
5. The Cockpit Reasoning menu reflects `KnownModel.reasoning` per the five-row table in §4.2 — no leaky abstraction; if the model has no reasoning, the section is hidden.
6. Background-stream: Hamburger out while streaming, send in a second chat, both finish, both get titles.
7. NSFW Panic is atomic — no leaked stream chunk renders to the user after the toggle; the draft persona-msg is deleted from Dexie; the user-msg is preserved; the user lands in the Entrance Hall with the toast.
8. Title generation runs against the same provider+model as the active persona, with global unlocker composed, and writes either a sanitised title or the fallback `"New chat — D MMM, HH:mm"`.
9. Partial-stream recovery shows the footer only when the last message of the chat is `streamingState: 'incomplete'`; Retry replays the prior user-message; Discard deletes only.
10. Cockpit input draft autosaves debounced (250 ms) and clears atomically on send for both chat-mode and lazy-mode.
11. All `pnpm typecheck && pnpm lint && pnpm --filter user-client run build && pnpm test --filter user-client && pnpm test --filter @chatsundere/llm-unified` clean across sub-phase squashes.
12. Manual verification §11.3 items 1–12 all pass on Chris's device (item 12 is a polish-pass deliverable inside sub-phase 3.3 and may be moved to a follow-up polish iteration if cost is high — see §14).

---

## 13. Risks

- **Provider quirks discovered late.** nano-gpt's pair-map already took two days in chatsune; Novita and Ollama Cloud may surprise us in the reasoning + streaming combination. Mitigation: each provider gets a sub-phase-3.1 spike against a real key before locking the `FIRST-MODELS.md` entries.
- **Background stream + Dexie write contention.** Two streams persisting at the same instant compete for the IDB write-lock. Realistically rare; Dexie serialises writes. Mitigation: final persist is one transaction per stream; periodic incremental writes are NOT done in Phase 3 (would magnify the contention).
- **Tab-close incomplete-marker reliability.** `beforeunload` synchronous write to IDB is best-effort across browsers. Mitigation: the marker is initialised on draft-insert; if the synchronous write fails, the marker stays "incomplete" with an empty contentBuffer — that still surfaces the recovery footer correctly. Worst case is empty content + retry button, never a silent loss.
- **Title-gen failure cost.** A failed title-gen call still consumes a request quota. Mitigation: fallback is a no-cost local string; the error path does not retry.
- **Reasoning leaky-abstraction temptation.** Future contributors may add an "always-show" toggle for the Reasoning menu thinking it's friendlier. The five-row capability table in §4.2 is canonical; deviation requires an ADR.

---

## 14. Open questions / external dependencies

- **`FIRST-MODELS.md`** — Chris-authored, landed 2026-05-24 at the repo root. Six models per provider (DeepSeek V4 Pro + Flash, GLM 5 + 5.1, Kimi K2.6, Gemma 4 31B). All reasoning + tools; Kimi and Gemma also Vision. The exact `ReasoningCapability` shape per model (`kind`, `effort.buckets`, `defaultBucket`, `defaultOn`, `replayReasoning`, plus any nano-gpt pair-map entries) is a sub-phase-3.1 spike against real API keys — the spec doesn't pre-commit values that may diverge from upstream reality.
- **ADR number for "Tool Display Position".** The current decisions/ folder has 0001–0028 (Block-1 Decisions 17–28 live in the Block-1 spec itself; promoted ADRs may renumber). Confirm number at write-time; `0029` is the tentative assumption.
- **British title-gen consistency.** The titleInstruction asks the model for British English. Models trained primarily on American English may not honour this. Acceptable Phase-3 deviation; not a blocker.
- **Provider-specific reasoning body shapes.** `reasoning_effort` is OpenAI-style; some providers expect `thinking: true|false`; nano-gpt does the pair-map dance. The `reasoning-resolver.ts` and the per-provider adapter hooks cover Phase-3's three providers; new providers in later blocks reproduce the same pattern.
- **Per-card "is streaming" indicator on persona-cards.** Listed as a polish item in §3.3; if cost is too high, it can slip to a Phase-3-polish iteration after the squash.

---

## 15. Sequencing and squash discipline

- Sub-phase 3.1 squashes once, with all 3.1 Vitest + Bun tests green, `pnpm typecheck && pnpm lint && pnpm run build` clean, and Chris's smoke-test pass on items 1–3, 8, 9, 10 from §11.3.
- Sub-phase 3.2 squashes once, adds 4, 5, 6, 7 to the manual checklist.
- Sub-phase 3.3 squashes once, adds 11, 12 to the manual checklist plus the ADR.

Subagent-driven execution per sub-phase, same as Phases 2.5–2.9. Larissa skipped (no security-touching code). STATUS-CLIENT-ONLY.md updated after each squash.
