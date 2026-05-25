# Phase 4 — Chain-of-Thought Display + Reasoning-OFF Translation — design spec

**Date:** 2026-05-25.
**Status:** brainstormed; ready for implementation plan.
**Implements:** the "Thinking display during stream" follow-up flagged in
[`obsidian/STATUS-CLIENT-ONLY.md`](../../obsidian/STATUS-CLIENT-ONLY.md) under
*Known follow-ups*, and the "Reasoning-OFF translation for non-nano-gpt
providers" item. Promotes both from polish-block to the first deliverable of
Phase 4 — landed ahead of the My-History page (still gated on Lyra's
wireframe).
**Lead:** Liz. **Larissa:** skipped — no security-touching code; all changes
live in `apps/user-client/**` and `packages/llm-unified/**`. No crypto, no
auth, no sync.
**Visual ground truth:** the visual companion mockups landed in
`.superpowers/brainstorm/756933-1779737397/content/` during this brainstorm
(`dots-animation.html`, `saturation.html`). Animation A (sequential pulse)
and 18 % accent saturation are the locked styling choices.
**Reference (read-only):** `../chatsune/backend/modules/llm/_adapters/_nano_gpt_http.py`,
`_novita_http.py`, `_ollama_http.py` — the reasoning-body composition and
the SSE-delta reasoning-field parsing translate from these.
**Out of scope:** interleaved-thinking *device verification* (deferred to
Block 3 with the tool-execution work — `calculate_js` and friends will be
the natural smoke surface). Per-pill copy button. A "skip reasoning"
mid-stream button. Reasoning-token cost display in the context-gauge.
Hard-CoT (`replayReasoning: true`) replay of past reasoning back to the
model — all `KnownModel`s ship with `replayReasoning: false` and stay there
in Phase 4.

---

## 1. Purpose

Phase 3 closed the chat-surface loop end-to-end against three providers.
Reasoning works wire-side — DeepSeek V4 Pro thinks before answering, GLM 5.1
thinks, Kimi K2.6 thinks — but the user sees nothing of it. The thinking
tokens flow into the void, the user waits for an answer that takes longer
than they expect, and nothing tells them the model is doing the slow careful
work they actually asked for. The product reads as "occasionally laggy",
not "thoughtful".

Phase 4 surfaces the thinking. A small unobtrusive pill appears wherever
the model thinks; tapping it streams the trace into a calm, mindspace-tinted
body in the persona's font. The pill is by default closed — the user opts
in to watch. Closed, it carries three softly pulsing dots (no "thinking"
label) and a chevron. Open, it streams the trace in like normal text with
formatting and blank lines preserved. The closing of the loop also forces
us to finish the Reasoning-OFF translation across all three providers,
because the pill's "appear only when there's something to show" rule
demands that "off" actually means off — not "still streaming, just hidden".

---

## 2. Decisions captured during brainstorm

Each decision is sourced from Chris's answers on 2026-05-25.

1. **CoT trace persists with the message.** Reasoning is part of the
   `MessageRow.contentBlocks` array; on Dexie write, on reload, on retry —
   the trace travels with its message. The user can open the pill any time
   later and re-read what the model thought. Ephemeral-only ("live stream
   only, gone after finalise") was rejected.

2. **Pill renders only when a trace exists.** No empty pill, no
   disabled-with-tooltip stub. Reasoning-OFF → no pill. No-reasoning model
   → no pill. Clean information-hiding semantics; saves the user from
   parsing a dead control.

3. **Reasoning-OFF translation lands with Phase 4.** Decision 2's "only
   when there's a trace" rule requires the off-toggle to actually suppress
   the upstream reasoning stream. Novita and Ollama-Cloud reasoning-off
   currently does nothing (Phase 3.1 known-follow-up). All three provider
   reasoning-body builders are completed in Phase 4. The intent rolled into
   the request body is unified (`ReasoningIntent`), per-provider translation
   sits in a new adapter module.

4. **Reasoning lives as a discriminated `ContentBlock` variant, not as a
   separate field on `MessageRow`.** Reason: future `interleaved-thinking`
   models can emit `reasoning → text → reasoning → text`; the time order
   must be preserved alongside text and tool-call blocks. The block array
   is the canonical timeline. Also forward-compatible with `tool-call`,
   `image`, `artefact` etc. — same future-proofing as the Phase-3 §15
   decision predicted.

5. **One pill per maximal run of adjacent reasoning blocks.** Adjacent
   `reasoning` blocks coalesce visually into a single pill. A text block
   between two reasoning blocks separates them into two pills. Same rule
   for pill-class blocks (tool-call, future image, etc.) — adjacent pills
   form a visual cluster.

6. **Pill clusters get vertical breathing room.** Reasoning pills and
   tool-call pills both carry `margin-block: 0.75rem`. Vertical
   margin-collapsing keeps adjacent pills tightly grouped (`max = 0.75rem`)
   while still giving the cluster a paragraph of space against surrounding
   text. A solo pill also gets the same breathing room.

7. **Animation A — sequential pulse — is the closed-state idiom.** Three
   dots, each pulsing with a 180 ms phase offset (`0s / 0.18s / 0.36s`),
   1.2 s cycle, opacity 0.3 → 1 → 0.3 + 1 px vertical lift at the peak.
   Reduced-motion turns it into a static dot row. No "thinking" text.
   Selected during the visual-companion pass against alternatives B
   (travelling wave) and C (simultaneous breathing) — A read as
   thoughtful-not-busy.

8. **18 % accent saturation against ink background.** Closed pill
   background `color-mix(in srgb, accent 18 %, ink 82 %)`, border
   `color-mix(in srgb, accent 35 %, transparent)`. Open-pill body
   `color-mix(in srgb, accent 8 %, ink 92 %)`. Both tones derive from the
   active `ResolvedMindspace.palette.accent`. 12 % read as ghostly, 25 %
   as overbearing — 18 % was visibly the right neighbourhood in the
   companion mockup.

9. **Pill-body inherits the persona font, slightly smaller.**
   `font-family: FONT_VAR[persona.font]`; `font-size: 0.85rem` (versus
   `.msg-text` default `1rem`); `line-height: 1.55`; `white-space: pre-wrap`
   to preserve blank lines and indentation from the trace verbatim — the
   chatsune lesson explicitly named here.

10. **Token-fade-in extends to reasoning chunks during live stream.** The
    no-coalesce buffer behaviour from Phase 3.3 polish-iter 3 is generalised:
    `appendStreamChunk(buf, { kind: 'text' | 'reasoning', text })` pushes
    every upstream chunk as its own sub-block. Token-fade plays once per
    new mount. At stream finalise the engine coalesces adjacent same-type
    sub-blocks into one block per kind. `pill` blocks never coalesce.

11. **Reasoning excluded from copy, replay, and token-budget.** A new
    `flattenAnswerText(blocks)` helper in `apps/user-client/src/lib/content-blocks.ts`
    is the single source of truth: filters reasoning, joins text, ignores
    pills (no plaintext). Used by `copyMessageText`, `toWireMessage`, and
    `contextUtilisation`. Three legacy `filter+map+join` call-sites collapse
    into one helper as side-effect hygiene.

12. **Reasoning-pill open/closed state is per-pill-local, not coupled to
    `expandedMessageId`.** Two different concepts; the user can have a
    persona-message expanded *and* a reasoning pill open in another
    message simultaneously. Local `useState` in `<ReasoningPill>`.

13. **Title-gen drops reasoning chunks silently.** Title-generator's
    one-shot completion ignores `{type: 'reasoning'}` chunks at the
    consumer side. No UI involvement, no body-side gating — the model
    may think, we just don't keep the trace.

14. **NSFW Panic correction lives in a separate pre-Phase-4 hotfix.**
    Phase 3.2's panic deletes the draft persona-message; Chris's sollwert
    is "abort + close chat + flip SFW, but leave the draft as an
    incomplete message". Fixed in a tiny squashed commit *before* Phase 4
    lands, so Phase 4's diff stays reasoning-thematically clean. Scope:
    `stream-manager.store.ts:abortAllForPersonaDiscard` — split into a new
    `abortAllForPersonaPreserve` that only aborts + cleans the handle map.

15. **Dexie version bumps to v7 as a code-capability marker, despite no
    schema-structural change.** The `contentBlocks` column is already
    non-indexed and accepts arbitrary block shapes. The bump documents
    "this code knows about reasoning blocks", and preserves the repo's
    invariant of one Dexie-version per data-model-evolution step.

16. **Hard-CoT replay stays off everywhere.** All current `KnownModel`s
    carry `replayReasoning: false`. We do *not* feed reasoning blocks back
    to the model in subsequent turns. Future ADR may revisit, but Phase 4
    locks the conservative choice in.

---

## 3. Architecture overview

Changes ripple across two packages and one app, on these layers:

**`packages/llm-unified`**
- `types.ts` — extends `StreamChunk` union with `{ type: 'reasoning'; text: string }`.
- `streaming.ts` — SSE-delta parser reads `delta.reasoning` (modern),
  `delta.reasoning_content` (legacy), `delta.message.thinking`
  (Ollama-shape), and Anthropic-style `reasoning_details: [{type:'thinking',thinking}]`.
- New module `_reasoning-body.ts` — pure body-builder
  `applyReasoningToBody(providerId, modelId, intent, body)` returning
  `{ modelId, body }`. Encapsulates the per-provider quirk grid (nano-gpt
  pair-map slug-swap vs flag-body; Novita unified `{reasoning:{enabled,effort}}`;
  Ollama `{think: bool}`).
- `stream-completion.ts` — `buildBody` delegates reasoning composition to
  `_reasoning-body.applyReasoningToBody`. The current `extras.thinking:
  boolean` special-path is removed; the engine now passes
  `extras.reasoning: ReasoningIntent`.

**`apps/user-client/src/boot/client-data-db.ts`**
- `ContentBlock` discriminated union adds `{ type: 'reasoning'; text: string }`.
- Dexie version bumps to v7 (code-marker; no `.upgrade` body needed —
  schema-structurally unchanged).

**`apps/user-client/src/lib/` (new)**
- `content-blocks.ts` — pure helpers `flattenAnswerText(blocks)`,
  `coalesceAdjacent(blocks)`, `groupAdjacent(blocks)`. The single source of
  truth for rendering and reading the block array.

**`apps/user-client/src/state/stream-manager.store.ts`**
- `appendTextBlock` generalises to `appendStreamChunk(buf, { kind, text })`.
- Live-buffer rotation logic unchanged in shape; the polymorphic write
  preserves token-fade semantics for reasoning chunks too.

**`apps/user-client/src/lib/stream-engine.ts`**
- Chunk-loop branch for `case 'reasoning'`; routes to the new
  `appendStreamChunk` polymorph.
- `composeReasoningExtras(model, mode, effort)` builds the
  `ReasoningIntent` from cockpit state + model capability and passes it
  as `extras.reasoning` into `streamCompletion`.

**`apps/user-client/src/components/chat/`**
- New `ReasoningPill.tsx` — closed/open states, isLive flag, animated
  dots (Animation A), local expand state, body with persona-font + smaller
  size + pre-wrap.
- `MessageBlock.tsx` — renderer routes `reasoning`-groups through
  `<ReasoningPill>`. Uses `groupAdjacent` from `lib/content-blocks.ts`.
- `ChatStream.tsx` — propagates the existing `isStreamingDraft` flag down
  to MessageBlock; the renderer marks the *last* reasoning group of the
  *last* persona message as `isLive` only while the stream is still active.

**`apps/user-client/src/index.css`**
- `.reasoning-pill`, `.reasoning-pill-dots`, `.reasoning-pill-body`,
  `@keyframes reasoning-dots-pulse`, reduced-motion overrides,
  `margin-block` rule on `.reasoning-pill, .pill`.

**`apps/user-client/src/lib/title-generator.ts`**
- Stream-loop branch ignores `{type: 'reasoning'}` chunks.

---

## 4. Data model

### 4.1 `ContentBlock` extension

```ts
// apps/user-client/src/boot/client-data-db.ts
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'pill'; pillId: string }
  | { type: 'reasoning'; text: string };  // NEW
```

`MessageRow.contentBlocks: ContentBlock[]` unchanged in shape; the
discriminator union widens. No `MessageRow` schema change.

### 4.2 `StreamChunk` extension

```ts
// packages/llm-unified/src/types.ts
export type StreamChunk =
  | { type: 'token'; text: string }
  | { type: 'reasoning'; text: string }   // NEW
  | { type: 'tool-call'; toolCallId: string; name: string; argumentsJson: string }
  | { type: 'finish'; reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'unknown' }
  | { type: 'error'; message: string };
```

### 4.3 `ReasoningIntent`

```ts
// packages/llm-unified/src/types.ts
export type ReasoningIntent =
  | { enabled: false }
  | { enabled: true; effort?: 'low' | 'medium' | 'high' };
```

Engine produces it; adapter consumes it; cockpit ignorant of provider
quirks.

### 4.4 Dexie v7

```ts
this.version(7).stores({
  // identical to v6 — non-indexed contentBlocks column accepts the
  // widened ContentBlock union without schema-structural change. The
  // version bump is a code-capability marker so callers can rely on
  // "this build knows about reasoning blocks".
});
```

No `.upgrade()` body. Existing v6 rows remain valid (they happen to
contain only `text` / `pill` blocks, which are still valid v7 values).

### 4.5 Block-order semantics

- During live stream: literal upstream order, no coalescing. Multiple
  adjacent reasoning sub-blocks possible — the renderer groups them
  visually into one pill.
- After finalise: `coalesceAdjacent(blocks)` merges adjacent same-type
  blocks (`text+text`, `reasoning+reasoning`). `pill` blocks are never
  merged. Result is `result.finalContentBlocks`, persisted to Dexie.
- On the catch / incomplete path: the segmented buffer is persisted
  verbatim. `flattenAnswerText` reads both shapes correctly because it
  filters by `type === 'text'` and joins.

---

## 5. Stream pipeline

### 5.1 SSE-delta parsing

`openAiPayloadToChunks` in `streaming.ts` reads, per event:

```ts
const reasoning =
  (delta.reasoning ?? '') +
  (delta.reasoning_content ?? '');
if (reasoning) out.push({ type: 'reasoning', text: reasoning });

// Anthropic-via-OpenRouter shape:
const details = delta.reasoning_details ?? [];
for (const d of details) {
  if (d.type === 'thinking' && d.thinking)
    out.push({ type: 'reasoning', text: d.thinking });
}

// Ollama non-OpenAI shape (sits under message.thinking):
if (delta.message?.thinking)
  out.push({ type: 'reasoning', text: delta.message.thinking });
```

Reasoning chunks emit *before* any text chunk in the same event (matches
upstream temporal ordering — providers stream reasoning ahead of content).

### 5.2 Reasoning-body builder

Per-provider rules in `_reasoning-body.ts`:

| Provider     | Capability `kind` | Body translation                                       |
|--------------|-------------------|--------------------------------------------------------|
| nano-gpt     | `optional` slug   | swap `modelId` between `nonThinkingSlug` / `thinkingSlug`; no body field |
| nano-gpt     | `optional` flag   | `body.reasoning = { enabled, effort? }`                |
| nano-gpt     | `none`            | no body field; capability-gated UI ensures no toggle   |
| Novita       | `optional`        | `body.reasoning = { enabled, effort? }`                |
| Novita       | `always_on`       | no body field                                          |
| Novita       | `no_reasoning`    | no body field                                          |
| Ollama-Cloud | `optional`        | `body.think = enabled`; `effort` silently dropped      |
| Ollama-Cloud | other             | no body field                                          |

`applyReasoningToBody(providerId, modelId, intent, body)` returns the
post-translation `{ modelId, body }`. Pure function, fully test-covered.

### 5.3 Engine routing

```ts
// apps/user-client/src/lib/stream-engine.ts
for await (const chunk of streamCompletion(args)) {
  switch (chunk.type) {
    case 'token':
      appendStreamChunk(buf, { kind: 'text', text: chunk.text });
      break;
    case 'reasoning':
      appendStreamChunk(buf, { kind: 'reasoning', text: chunk.text });
      break;
    case 'tool-call': /* unchanged */ break;
    case 'finish':    /* unchanged */ break;
    case 'error':     /* unchanged */ break;
  }
  onChunk?.();
}
```

Single handle rotation per chunk regardless of kind. Token-fade infra
remains identical.

### 5.4 Replay suppression

`toWireMessage(message)` in the engine's composition step calls
`flattenAnswerText(message.contentBlocks)` for the `content` field —
reasoning blocks never reach the wire. Matches existing
`replayReasoning: false` on all `KnownModel`s. Engine does not branch on
`KnownModel.replayReasoning` in Phase 4 (the flag is honoured only when
its semantics change later).

### 5.5 Title-gen suppression

`apps/user-client/src/lib/title-generator.ts`:

```ts
for await (const chunk of streamCompletion(titleArgs)) {
  if (chunk.type === 'reasoning') continue;   // NEW
  if (chunk.type === 'token') accum += chunk.text;
  if (chunk.type === 'finish') break;
}
```

Title-gen's system prompt already composes the global unlocker (per
existing `background-jobs-prompt-composition` rule); reasoning chunks are
just data we drop.

---

## 6. Stream-manager + live buffer

### 6.1 `appendStreamChunk`

```ts
function appendStreamChunk(
  buf: ContentBlock[],
  chunk: { kind: 'text' | 'reasoning'; text: string },
): void {
  buf.push(
    chunk.kind === 'reasoning'
      ? { type: 'reasoning', text: chunk.text }
      : { type: 'text',      text: chunk.text },
  );
}
```

No coalescing during live — Phase 3.3 polish-iter 3 token-fade contract.

### 6.2 Coalesce phase

```ts
function coalesceAdjacent(blocks: ContentBlock[]): ContentBlock[] {
  const out: ContentBlock[] = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    if (last && last.type === b.type && b.type !== 'pill') {
      out[out.length - 1] =
        b.type === 'text'      ? { type: 'text',      text: last.text + b.text } :
                                  { type: 'reasoning', text: last.text + b.text };
    } else {
      out.push(b);
    }
  }
  return out;
}
```

Engine calls this once at stream finalise to produce
`result.finalContentBlocks` for Dexie write.

### 6.3 Incomplete / abort paths

Live-buffer is persisted verbatim on the catch path
(`streamingState = 'incomplete'`). The segmented shape is downstream-safe
because `flattenAnswerText` filters and joins. The user re-opens the chat,
sees the partial reasoning trace in the (still openable) pill, and
chooses Retry or Discard via the existing `StreamInterruptedFooter`.

User-initiated `abortDiscard` (Cockpit Stop, Phase-3.2 behaviour) keeps
deleting the draft. Distinct from the panic path (see §2 Decision 14 —
preserved by the pre-Phase-4 hotfix).

### 6.4 Live-state propagation

`MessageBlock` infers `isLive` per reasoning group as:

```
isStreamingDraft === true
  && message === lastPersonaMessage
  && this is the last reasoning-group in the message
```

When the stream finalises (`streamingState !== 'streaming'`), `isLive`
flips to false on every pill, ending the dot-pulse animation.

---

## 7. UI components

### 7.1 `<ReasoningPill>`

```ts
// apps/user-client/src/components/chat/ReasoningPill.tsx
interface ReasoningPillProps {
  text: string;
  isLive: boolean;
  isStreamingDraft: boolean;
  mindspace: ResolvedMindspace;
  font: PersonaFont;
}
```

Local `useState<boolean>(false)` for open/closed. Click on the closed
handle (or the handle of an open pill) toggles state.

Markup:

```html
<button class="reasoning-pill" data-state="closed" aria-expanded="false">
  <span class="reasoning-pill-dots" aria-hidden="true">
    <span class="dot">·</span><span class="dot">·</span><span class="dot">·</span>
  </span>
  <svg class="reasoning-pill-chevron" aria-hidden="true">▸</svg>
</button>
```

Open variant wraps the handle and a body in a column:

```html
<div class="reasoning-pill-open">
  <button class="reasoning-pill" data-state="open" aria-expanded="true">…</button>
  <div class="reasoning-pill-body" role="region" aria-label="Reasoning trace">
    {text}
  </div>
</div>
```

`prefers-reduced-motion` query: dots become static; chevron rotation is
instantaneous; body content does not token-fade.

Screen-reader hint while `isLive`: a single sibling
`<span class="sr-only" aria-live="polite">Model is thinking</span>` —
single utterance, not per chunk.

### 7.2 CSS additions to `index.css`

```css
.reasoning-pill,
.pill {
  margin-block: 0.75rem;
}

.reasoning-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 0.78rem;
  cursor: pointer;
  user-select: none;
  background: color-mix(in srgb, var(--mindspace-accent) 18%, var(--color-ink) 82%);
  border: 1px solid color-mix(in srgb, var(--mindspace-accent) 35%, transparent);
}

.reasoning-pill-dots .dot {
  display: inline-block;
  line-height: 1;
  animation: reasoning-dots-pulse 1.2s ease-in-out infinite;
}
.reasoning-pill-dots .dot:nth-child(1) { animation-delay: 0s;    }
.reasoning-pill-dots .dot:nth-child(2) { animation-delay: 0.18s; }
.reasoning-pill-dots .dot:nth-child(3) { animation-delay: 0.36s; }

@keyframes reasoning-dots-pulse {
  0%, 100% { opacity: 0.3; transform: translateY(0); }
  50%      { opacity: 1;   transform: translateY(-1px); }
}

.reasoning-pill[data-state="open"] .reasoning-pill-chevron {
  transform: rotate(90deg);
  transition: transform 200ms ease;
}

.reasoning-pill-body {
  padding: 0.6rem 0.85rem;
  font-size: 0.85rem;
  line-height: 1.55;
  white-space: pre-wrap;
  background: color-mix(in srgb, var(--mindspace-accent) 8%, var(--color-ink) 92%);
  border: 1px solid color-mix(in srgb, var(--mindspace-accent) 25%, transparent);
  border-top: 0;
  border-radius: 0 0 14px 14px;
}

/* The pill itself takes the same persona-font as .msg-text when open;
   handled via inline style from React (FONT_VAR[persona.font]). */

@media (prefers-reduced-motion: reduce) {
  .reasoning-pill-dots .dot { animation: none; }
  .reasoning-pill[data-state="open"] .reasoning-pill-chevron { transition: none; }
}
```

### 7.3 `MessageBlock` render-changes

`renderBlocks` calls `groupAdjacent(contentBlocks)` and dispatches:

```ts
groups.map(g => {
  switch (g.type) {
    case 'text':
      return <span className="msg-text">{g.blocks.map(textSpan)}</span>;
    case 'reasoning':
      return <ReasoningPill
        text={g.blocks.map(b => b.text).join('')}
        isLive={…}
        isStreamingDraft={isStreamingDraft}
        mindspace={mindspace}
        font={persona.font}
      />;
    case 'pill':
      return <Pill … />;
  }
});
```

`token-fade` class on text spans uses the existing rule from
polish-iter 3 — unchanged.

---

## 8. Edge cases

| Case | Behaviour |
|---|---|
| Regenerate | Old persona-message + its reasoning blocks deleted by existing logic. New stream produces fresh trace. |
| User Stop (cockpit abort) | `abortDiscard` deletes draft including reasoning. Phase-3.2 behaviour preserved. |
| NSFW Panic | After pre-Phase-4 hotfix: stream aborted, handle cleaned, chat closed, mode flipped — draft + reasoning preserved as `incomplete`. User sees StreamInterruptedFooter on re-visit. |
| StreamInterrupted (network) | Reasoning + text persisted segmented. Pill openable; Retry/Discard via footer. |
| Background-stream multi-chat | Pills in other chats stream live independently; same buffer rotation contract. |
| Title-gen | `{type: 'reasoning'}` chunks dropped; title accumulates only `token` chunks. |
| NSFW pre-filter | Reasoning of an adult-persona message is already gated by `useFilteredPersonas` — no extra filter needed. |
| Context-gauge | `lib/token-estimator.ts` consumes `flattenAnswerText`; reasoning contributes 0 to input estimate. |
| Copy | `copyMessageText` uses `flattenAnswerText` — reasoning never in clipboard. No separate trace-copy button (YAGNI). |
| Reasoning-disabled / no-reasoning model | Adapter sends `enabled: false` or no field; no reasoning chunks; no pill renders. |
| `always_on` capability | Reasoning always comes; pill always renders; cockpit reasoning toggle is hidden (existing Phase-3.1 capability-gating). |
| Effort levels | nano-gpt-flag + Novita honour `effort`; Ollama-Cloud silently ignores. |
| Pill margin against persona-name | Padding on `.msg-text` parent prevents margin-collapse with header; gives clean 0.75rem breathing room above. |
| Interleaved-thinking model | Multiple separate pills at time-correct positions. Mechanism tested with mocked SSE in this phase; device verification deferred to Block 3 tool work. |

---

## 9. Testing

### 9.1 `packages/llm-unified` (Bun)

Parser:
- `delta.reasoning` → reasoning chunk yielded
- `delta.reasoning_content` (legacy) → reasoning chunk yielded
- Both fields populated → single chunk with concatenated text
- `reasoning_details: [{type:'thinking',thinking}]` → reasoning chunk yielded
- `delta.message?.thinking` (Ollama-shape) → reasoning chunk yielded
- Reasoning + token in same event → reasoning emitted before token
- Empty / null reasoning → no chunk

Reasoning-body builder:
- nano-gpt slug-mode + intent.enabled=true → swap to thinkingSlug; body clean
- nano-gpt slug-mode + intent.enabled=false → nonThinkingSlug; body clean
- nano-gpt flag-mode → body carries `reasoning: { enabled, effort? }`
- nano-gpt none-mode → body clean regardless of intent
- Novita optional → body carries `reasoning: { enabled, effort? }`
- Novita always_on / no_reasoning → no field
- Ollama-cloud optional → body carries `think: <bool>`; effort dropped
- Ollama-cloud other → no field

`stream-completion.buildBody`:
- `extras.reasoning: ReasoningIntent` end-to-end produces correct
  provider-specific body
- `extras.thinking` (legacy boolean) treated as undefined — explicit
  migration assertion

Estimate: ~12 new cases, ~3 adjusted.

### 9.2 `apps/user-client` (Vitest)

`lib/content-blocks.ts`:
- `flattenAnswerText` filters reasoning, joins text, ignores pill
- `coalesceAdjacent` merges adjacent same-type; never merges pill
- `groupAdjacent` returns ordered groups with correct kind

`stream-manager.store.ts`:
- `appendStreamChunk(kind: 'reasoning')` pushes reasoning sub-block
- Multiple reasoning chunks consecutive → multiple sub-blocks (non-coalescing)
- Reasoning-then-text → buffer correctly ordered
- Handle reference rotates per chunk regardless of kind

`stream-engine`:
- `{type: 'reasoning'}` routes to `appendStreamChunk` with `kind: 'reasoning'`
- Title-gen loop discards reasoning, accumulates token only
- Final coalesce merges adjacent reasoning chunks into one block; respects boundaries

Renderer (`MessageBlock` + `ReasoningPill`):
- Closed + isLive → animation class active, `aria-expanded="false"`
- Closed + !isLive → no animation class
- Open → body rendered, persona font + 0.85rem + pre-wrap
- `prefers-reduced-motion` → no animation class
- Interleaved blocks → two pills at correct positions, two text groups between
- Pill-cluster CSS → margin rules apply via class presence assertion
- `isStreamingDraft` && last group reasoning → that pill `isLive=true`; earlier pills `isLive=false`

Copy:
- `copyMessageText` filters reasoning from clipboard

Context-gauge:
- Reasoning contributes 0 to token estimate; text counts normally

Dexie v7:
- v6 → v7 open succeeds; reads existing rows
- Writes a message with reasoning block, reads it back, type matches

Estimate: ~25 new cases, ~5 adjusted.

### 9.3 Integration

In `apps/user-client/tests/integration/`:
- Mock SSE source: reasoning chunks → token chunks → finish
- ChatPage renders, send flow executes, pill appears with dots, then text
- Stream finalises, pill flips to static, open reveals trace
- DB persist reflects coalesced reasoning + text

Plus interleaved variant: `reasoning → text → reasoning → text → finish`.

### 9.4 Manual verification

Items Chris runs himself (per CLAUDE.md §10):

1. DeepSeek V4 Pro via Novita — pill with pulsing dots, opens and streams trace correctly
2. Gemma 4 31B — no pill (model has no reasoning capability)
3. Cockpit reasoning toggle OFF on a Novita reasoning-capable model → no pill (Reasoning-OFF translation verified end-to-end)
4. Cockpit reasoning toggle OFF on a nano-gpt-flag-mode model → no pill (`reasoning: { enabled: false }` honoured)
5. Tab-close mid-reasoning → refresh → StreamInterruptedFooter with preserved trace visible after opening pill
6. Reasoning pill background follows mindspace accent when switching personas / mindspaces
7. System reduced-motion setting → dots static
8. Copy a message with a reasoning trace → only the answer in clipboard
9. Regenerate a message → new pill, old trace gone
10. Interleaved-thinking model: deferred to Block 3 (tool execution work) — no current `KnownModel` is interleaved-thinking; mechanism-correctness covered by §9.3 mocked tests

---

## 10. Implementation sub-phases

Spec is small enough for a single squashed Phase-4 commit (plus the
pre-phase NSFW-Panic hotfix). The implementation plan from the
writing-plans skill will sequence:

- Pre-Phase-4 hotfix: NSFW Panic preserves draft (Phase-3.2 correction)
- Phase 4 — single squash:
  1. `packages/llm-unified` — parser + types + `_reasoning-body.ts` + `buildBody` refactor (TDD)
  2. `apps/user-client/src/lib/content-blocks.ts` (new helpers, TDD)
  3. Dexie v7 bump + `ContentBlock` extension
  4. `stream-manager.store.ts` polymorph
  5. `stream-engine.ts` routing + title-gen suppression
  6. `ReasoningPill.tsx` + CSS additions
  7. `MessageBlock.tsx` renderer integration
  8. Integration test + manual smoke

Each step TDD-paired per CLAUDE.md §10.

---

## 11. Open follow-ups (post-Phase-4)

- Per-pill copy-trace button — defer until requested.
- Reasoning-token count surfaced in context-gauge — defer; requires
  `usage.completion_tokens_details.reasoning_tokens` from provider
  responses (Novita + nano-gpt expose, Ollama doesn't).
- Hard-CoT replay (`replayReasoning: true`) — future ADR if/when a model
  is added that needs continuity-of-thought across turns.
- ADR-isation of the "reasoning is not persisted to wire, only to UI"
  rule — currently encoded in `flattenAnswerText` + `toWireMessage`. An
  ADR would make it discoverable for future tool/agentic work that may
  question the convention.
