# Tool History Replay — Design Specification

**Date:** 2026-10-08 · **Author:** Liz, brainstormed with Chris · **Status:** design approved in conversation (2026-10-08), awaiting written-spec review

## 1. Purpose and Scope

### 1.1 Why

Prior persona turns are replayed to the model as **text only**. `toWireMessage`
(`apps/user-client/src/lib/stream-engine.ts:265`) flattens a persisted message
with `flattenAnswerText`, so every tool-call pill and every tool result is
dropped from history. Within a single turn the tool loop is correct
(`lib/tool-loop.ts:116` accumulates `assistant(tool_calls)` + `tool` messages);
only *earlier* turns lose their tool exchanges.

The consequence is **history poisoning**. A chat whose early turns really
called `generate_image` shows every later request an assistant that
"delivered" images by talking about them. The model copies that pattern and
starts describing imaginary images instead of calling the tool. Confirmed on
device on 2026-10-07 with Mistral Large 4 ("Le Chat 4"): a console probe
showed `generate_image` pills on the early turns and none on the later ones.
The fault is provider-agnostic.

### 1.2 In scope

- Structured replay of prior tool exchanges (`assistant(tool_calls)` + `tool`
  messages) reconstructed from the pills already persisted in `db.pills`.
- A single result budget for replayed tool results.
- Freshly minted, deterministic, provider-neutral tool-call ids on replay.
- A graded policy for tools absent from the current request, backed by a new
  measured profile field `toolCalls.orphanReplay`.
- One shared token estimator that counts replayed tool exchanges, used by every
  site that estimates history size.
- Tool calls rendered as readable fact lines in the compaction transcript.
- Two new core conversation-suite scenarios and a `/curate` step that
  determines `orphanReplay` for every offering.
- Live verification of one representative offering per adapter.
- Making the Mistral adapter's silent drops visible (`console.warn`).

### 1.3 Out of scope

- Inline text markers for tool calls in history (rejected: the model learns to
  hallucinate the marker).
- Per-tool result budgets (§4).
- Regenerating existing compaction summaries; the improvement applies from the
  next compaction onwards.
- Replaying reasoning blocks (unchanged: still never replayed by this path).
- Any Dexie version bump or sync wire change: the pills already hold every
  field needed.

## 2. Existing Data

A `tool-call` pill (`PillRow`, `apps/user-client/src/boot/client-data-db.ts:366`)
persists, after execution:

| Field | Source |
|---|---|
| `payload.name` | `stream-engine.ts:174` |
| `payload.argumentsJson` | `stream-engine.ts:175` |
| `payload.toolCallId` | `stream-engine.ts:176` (the provider's original id) |
| `payload.result` / `payload.error` | `tool-loop.ts:98` |
| `status` | `pending` / `completed` / `failed` |

A persona message's `contentBlocks` keeps text, reasoning and pill blocks in
their original order, so the loop rounds are reconstructable without new
storage. Existing chats therefore benefit immediately.

## 3. Wire Shape

### 3.1 Decomposition

`toWireMessage` becomes `replayMessage(row, pillsById, policy): WireMessage[]`.
User and system messages map to exactly one message, as today. A persona
message is walked once, front to back:

- **Text** blocks are accumulated.
- **Reasoning** blocks are skipped.
- A **maximal run of adjacent replayable `tool-call` pills** closes a round. It
  emits `assistant(content: accumulated text, tool_calls: [one per pill])`
  followed by one `tool` message per pill, in pill order. The accumulated text
  resets. Parallel calls therefore stay one assistant message, exactly as in the
  live loop.
- **Text after the last run** becomes a closing `assistant(text)`. It is
  omitted if empty *and* the message ended on a tool run.

Example — `[text "One moment…", pill A, pill B, text "Here they are!"]`:

```
assistant  "One moment…"   tool_calls: [k3F9aZ1qP, Xw82LmT0c]
tool       k3F9aZ1qP       "Generated 1 image(s) from your prompt…"
tool       Xw82LmT0c       "Saved to memory."
assistant  "Here they are!"
```

The assistant `content` for a pure tool-call round is `""`, identical to what
the live loop sends today (`flattenAnswerText` of a round without text).

### 3.2 Special cases

| Case | Replay |
|---|---|
| Pill `status: 'failed'` | `tool` message carrying the stored error text |
| Pill `status: 'pending'` (stream interrupted before a result) | `tool` message `"The call was interrupted before it completed."` — an unanswered `tool_call` is rejected by practically every provider |
| Pill kinds `kb-injection`, `image-result`, `voice-expression` | ignored, as today (presentation, not tool calls) |
| Pill block whose `PillRow` is missing (e.g. not yet synced) | that block is skipped; if a whole run vanishes, the round falls back to text-only; `console.warn` once per message |
| Message without tool-call pills | exactly one message, as today |

### 3.3 Cache guarantee

For a chat that never used a tool, the wire is **byte-identical** to the
current output. This is a tested invariant (§9), because the prompt-cache
prefix depends on it.

### 3.4 Tool-call ids

Original provider ids are never replayed. Mistral rejects foreign ids after a
mid-chat model switch, and other providers impose their own formats. Each
replayed pill gets an id **derived deterministically from its `pillId`**: a
hash mapped onto 9 characters of `[A-Za-z0-9]`. The `tool_call` and its `tool`
message share it.

Deterministic, not random: the same chat yields the same ids on every request,
so the prompt-cache prefix survives from one message to the next. A collision
within one request (two pills mapping to the same 9 characters) is resolved by
re-hashing with a counter suffix; the test suite pins that path.

## 4. Result Budget

- One constant `REPLAY_RESULT_MAX_CHARS = 2000`, applied to every tool,
  including MCP tools.
- A longer result keeps its head and gets
  `[… N characters omitted from history]` appended.
- `argumentsJson` is replayed **in full**. Truncated JSON is invalid and some
  providers parse it; arguments are model-authored and typically moderate.
- No per-tool budgets. `generate_image` and `write_memory` stay far below the
  limit by nature; only `ask_expert`, `calculate_js` and MCP results grow long.
  A per-tool field would also fail for a removed MCP server, whose tool is no
  longer in the registry.
- Accepted trade-off: a long `ask_expert` answer is replayed as its first 2000
  characters. The persona's own answer already digested it, and the full text
  remains in the pill for the user.
- Not user-configurable (omakase).

## 5. Graded Policy and Curation

### 5.1 Profile field

`ModelProfile.toolCalls` (`packages/llm-unified/src/catalogue/types.ts:15`)
gains `orphanReplay: boolean` — *the provider accepts replayed tool calls
whose tool is absent from the current request's `tools` array*. Default
`false`.

### 5.2 Decision per round

| Offering | Tool in the current `tools`? | Round replayed as |
|---|---|---|
| `toolCalls.supported === false` | — | text-only (today's behaviour) |
| `supported === true` | yes | structured |
| `supported === true` | no, `orphanReplay === true` | structured |
| `supported === true` | no, `orphanReplay === false` | **that round only** text-only |

A round with several pills where only some are orphaned is decided as a whole:
if any pill in the run would fall back, the whole run falls back. Splitting a
parallel round would fabricate a history that never happened.

The policy object passed to `replayMessage` carries `toolsSupported`,
`orphanReplay` and the set of tool names in the current request. The
forced-answer pass of the tool loop (no `tools`) uses the same set as the
round's tool passes, because the live exchange already carries tool calls.

### 5.3 Conversation-suite scenarios

Two new scenarios in `packages/llm-unified/curation/conversation-suite/scenarios/core.ts`:

1. **`replayed-tool-history`** — the history contains a structured, replayed
   `generate_image` round with its result; the next user turn is a **direct**
   instruction: call `generate_image` now with a given prompt. Assertions:
   no HTTP error, no stream error, **a real tool call arrives on the tool
   channel**, the reply is not tool-shaped text.
   The directness keeps this a pipe check in the sense of design D8 (validate
   the pipe, never the intelligence), the same argument as `memory-echoed`: a
   working pipe always produces the call, while a poisoned history is exactly
   what makes models answer in prose instead.
2. **`orphan-tool-replay`** — the same history, but `generate_image` is absent
   from `tools`. A 2xx plus a sensible text reply sets `orphanReplay: true`; an
   HTTP 400 keeps `false` and its error text goes into the Curation Record.
   This scenario is informational, not a pass/fail gate: both outcomes are
   valid, it only determines the field.

### 5.4 `/curate` skill

The skill gains a mandatory step: *determine `orphanReplay`* (run
`orphan-tool-replay`, record the outcome in the catalogue and the Curation
Record). Every newly curated offering gets it.

### 5.5 Live verification in this feature

One representative offering per adapter, run **serially**, each response read
in full: Mistral (direct), nano-gpt, ollama, OpenRouter, xAI, Anthropic,
Chutes. `replayed-tool-history` must pass on each; `orphan-tool-replay` sets
the field for every offering served by that adapter/provider. No pass rate is
stated before it is measured.

## 6. Compaction and Token Counting

### 6.1 One estimator

History token estimation exists today at five sites, all text-only:

- `apps/user-client/src/state/stream-manager.store.ts:390` (auto-trigger projection)
- `apps/user-client/src/compaction/runner.ts:127`, `:144`, `:159` (cut point, tail budget)
- `apps/user-client/src/routes/app/chat/chat-page.tsx:433` (context meter)
- `apps/user-client/src/components/chat/ChatStream.tsx:140`
- `apps/user-client/src/lib/context-window.ts:30` (wire messages; ignores `tool_calls` arguments)

They converge on one function `estimateReplayTokens(row, pillsById)` built on
the **same decomposition** as `replayMessage`: text + `argumentsJson` +
truncated result + a small fixed overhead per call. `context-window.ts` also
counts `tool_calls` arguments. Counter and wire cannot drift apart (§9 pins
parity).

Visible side effect: tool-heavy chats show **more** used tokens in the context
meter and compact slightly earlier. That is the meter becoming accurate, not a
regression.

### 6.2 Summariser transcript

`messageToSource` (`compaction/runner.ts:56`) receives the pills. Instead of a
bare `pill` ref, each tool call becomes one transcript line, its result
truncated with the same budget:

```
[tool generate_image {"prompt":"a fox in snow"} → Generated 1 image(s) from your prompt…]
[tool ask_expert {"question":"…"} → failed: The expert returned no answer.]
```

The compaction prompt (`compaction/compaction-prompt.ts`) gains one
instruction: record tool use as *facts* ("generated an image of … with the
image tool"), never as a description of the tool's output in the persona's
voice. The summary thus carries the fact as narrative, not as a pattern to
imitate.

Unchanged: checkpoints, the tail cut, `applyActiveCompaction`. Existing
summaries are not regenerated.

### 6.3 Loading pills

`send-message.ts` (both paths, `:592` and `:768`), the compaction runner and
the meter sites load the pills of the relevant messages in one bulk query on
the `messageId` index (`db.pills.where('messageId').anyOf(ids)`) and pass a
`Map<pillId, PillRow>`.

## 7. Security

Replayed MCP results become a **persistent prompt-injection surface**: a
malicious result now acts on every later request in the chat, not once. Tool
results stay in the `tool` role (never promoted to `user`/`system`) and are
truncated, but whether that suffices is Larissa's call. She audits this unit
before the squash although its paths lie outside her mandatory scope (CLAUDE.md
§9.1, judgement call). Findings consciously deferred go into
`obsidian/insights/security-deferrals.md`.

Laura is not summoned: no flow, state or reachability changes. The more
accurate context meter is data correctness.

## 8. Mistral Adapter Side Finding

`foldDeltaContent` and the finish handler in
`packages/llm-unified/src/adapters/mistral-openai.ts` silently drop unknown
`delta.content` item types and tool calls lacking an id or a name. Both get a
`console.warn` naming what was dropped. No behaviour change otherwise.

## 9. Testing

**user-client (Vitest)** — fixtures use full, realistic rows (lesson of the
pill-loss CRITICAL: no text-only stubs):

- Replay builder: parallel calls; several rounds in one message; `failed`;
  `pending`; missing pill row; foreign pill kinds; truncation exactly at and
  over the limit; orphan with `orphanReplay` true/false; partially orphaned
  run falls back whole; offering without tool support.
- Ids: 9 characters `[A-Za-z0-9]`, stable across calls, `tool_call` and `tool`
  message share the id, collision path.
- Cache invariant: a tool-free chat produces byte-identical wire output to the
  pre-change builder.
- Parity: `estimateReplayTokens` equals the estimate over the actually built
  wire messages.
- Compaction transcript lines for completed and failed calls.

**llm-unified (Bun test)** — per adapter: a history with
`assistant(tool_calls)` + `tool` *followed by a user message* serialises
correctly (today these shapes only ever appear at the tail of the list).

**Live** — §5.5.

**Gate** — `pnpm typecheck --force`, `pnpm run build`, full user-client Vitest
(known Node-localStorage baseline of 8), llm-unified tests, Biome.

## 10. Manual Verification

Chris, on device:

1. Open yesterday's poisoned Le Chat 4 chat and ask for a new image → a
   `generate_image` pill appears and the image is generated.
2. In a chat with image calls made via nano-gpt, switch the persona to Mistral
   direct and keep chatting → no HTTP 400 (foreign ids).
3. Use an MCP tool, then remove that MCP server and keep chatting → no error.
4. Switch a tool-using chat to a model without tool support → it behaves as
   before.
5. In a tool-heavy chat, compare the context meter before and after the update
   → it reads higher; compaction still triggers and the next summary mentions
   tool use as fact.
