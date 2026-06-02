# calculate_js + Tool-Execution Spine — Design Spec

**Date:** 2026-06-02
**Author:** Liz (brainstormed end-to-end with Chris)
**Status:** Approved — ready for implementation plan
**Branch:** isolated worktree (main checkout stays on master)
**Larissa:** not required — client-only, no `auth-/sync-/proxy-service` or `crypto` path. The
client-side JavaScript-eval sandbox is logged as a security-sensitive surface in the journal
(see §10).

## 1. Summary

This cycle delivers the **tool-execution spine** — the round-trip loop that lets a model call
a client-side tool, receive its result, and continue reasoning — plus **`calculate_js`** as its
first rider. The wire layer is already tool-ready (`ToolDef`, `WireToolCall`,
`CanonicalRequest.tools`, fragmented-tool-call reassembly in adapters); what is missing is the
*head* (tool definitions are never sent to the model) and the *tail* (a streamed tool-call
becomes an inert pill — never executed, never fed back). We build both.

`calculate_js` is small in itself; the spine is the substantial, reusable piece. Every future
client-executed tool (an eventual `web_fetch`, MCP tools, integration tools) rides the same
spine. **Provider-side web-search integrations** (nano-gpt, 0..n keyed by the user's API keys)
are a deliberately separate axis and out of scope here.

Tools are **always on**. Chatsune's tool toggle is not ported: omakase says the tools are simply
*there*, and any model that misbehaves with reasoning+tools is a curation exclusion, not a
product feature. There is no toggle in Chatsundere to remove — we simply never add one.

## 2. Background & constraints

- **No execution loop exists today.** When a model streams a tool call, `stream-engine.ts:108`
  turns it into a `PillRow` with `status: 'completed'` and an inline pill block — then nothing.
  The result is never computed or returned. Tool definitions are never populated into
  `args.tools`, so in practice no model ever emits a call.
- **The wire layer is ready.** `ToolDef` (`packages/llm-unified/src/adapter-contract.ts:8`),
  `WireToolCall` + `tool_calls`/`tool_call_id` (`types.ts:39,70,72`), `CanonicalRequest.tools`
  threaded through `buildWire` (`stream-completion.ts:152`, injected only when non-empty), and a
  `tool-call` `StreamChunk` variant (`types.ts:93`). Adapters already reassemble fragmented
  streamed tool calls.
- **Single-pass engine + orchestrator manager.** `runStreamEngine(args)`
  (`apps/user-client/src/lib/stream-engine.ts:54`) does one pass and is pure (no Dexie). The
  orchestrator is the Zustand store `apps/user-client/src/state/stream-manager.store.ts`, which
  owns persistence and the `start` / `regenerate` paths.
- **Prompt builder has a reserved tools slot.** `packages/llm-unified/src/composition.ts:43`
  documents a Band-3 "tools" segment with no producer this cycle. This spec gives it one.
- **The pill is a minimal inline marker.** `Pill.tsx:25` renders `⚙ <tool-name>` with
  `data-pill-status`. `PillRow.payload` is typed `unknown`
  (`apps/user-client/src/boot/client-data-db.ts:125`) — fields can be added with **no Dexie
  migration**.
- **chatsune reference.** `calculate_js` ran arbitrary JS in a fresh Web Worker per call,
  dangerous globals nulled, output captured into a 4 KB buffer, worker terminated after the
  reply (`chatsune/frontend/src/features/code-execution/sandbox.worker.ts` + `sandboxHost.ts`).
  chatsune was server-orchestrated over WebSockets; Chatsundere is local-first, so the
  orchestration loop lives **client-side**.

## 3. The tool abstraction & registry

New directory `apps/user-client/src/tools/`. It lives in the user-client (not `llm-unified`)
because an executor needs the Web Worker; the instruction text is plain data and flows into the
`llm-unified` prompt builder as an input.

```ts
export interface ToolResult {
  ok: boolean;
  output: string;        // returned to the model as the `tool` message content
  error: string | null;  // present when ok === false
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;      // JSON Schema → projected to ToolDef
  systemPromptInstruction: string | null;    // null for trivial tools
  execute(args: Record<string, unknown>, signal: AbortSignal): Promise<ToolResult>;
}
```

A `registry.ts` holds the registered tools and exposes three pure helpers plus one dispatch:

- `toolDefs(): ToolDef[]` — projects each `Tool` to its wire `ToolDef` (`{name, description,
  parameters}`). Fed into `runStreamEngine` → `streamCompletion`'s `args.tools`.
- `systemPromptSegment(): string | null` — joins every non-null `systemPromptInstruction` with
  blank lines; `null` when nothing to add. Fed into the prompt builder's Band-3 tools slot.
- `dispatch(name, args, signal): Promise<ToolResult>` — looks up the tool by name and runs it;
  an unknown name returns `{ok:false, output:'', error:'Unknown tool: <name>'}` (defensive — a
  model could hallucinate a name).

**Always-on:** every registered tool is always offered. This cycle the registry contains exactly
one entry, `calculate_js`. As a defensive safety net, the manager injects `toolDefs()` only when
the active offering supports tools (`offering.profile.tools.supported`); curated models all do,
so this never bites in practice — and it is *not* a user toggle.

## 4. calculate_js

Two files: `apps/user-client/src/tools/calculate-js.ts` (the `Tool` + host) and
`apps/user-client/src/tools/sandbox.worker.ts` (ported from chatsune).

### 4.1 Wire shape

```jsonc
{
  "name": "calculate_js",
  "description": "Execute JavaScript and return its output. Use for arithmetic, counting, and string manipulation.",
  "parameters": {
    "type": "object",
    "properties": {
      "code": { "type": "string", "description": "JavaScript to execute. The value of the final expression is returned; console.* output is captured too." }
    },
    "required": ["code"]
  }
}
```

### 4.2 Execution contract — console + final-expression value

The sandbox returns **both** the captured `console.*` output **and** the completion value of the
final statement. This is achieved with indirect `eval(code)` inside the worker, whose return
value *is* the completion value (`eval("var x=1; x+1")` → `2`), while a `console` mock captures
`log/error/warn/info/debug`. This kills chatsune's empty-output trap (where the model forgot to
`console.log`).

Result assembly (the `output` string handed back to the model):
- console output present → that, followed by the final value on its own line if the value is not
  `undefined`;
- console output absent → `String(value)` when not `undefined`, else an empty string.

### 4.3 Sandbox (ported, hardened)

- Fresh `Worker` per call, `terminate()` after the reply — strongest state isolation, negligible
  overhead.
- Dangerous globals nulled before any user code runs (`fetch`, `XMLHttpRequest`, `WebSocket`,
  `importScripts`, timers, `Worker`, `indexedDB`, `caches`, …) — both stripped from the worker
  scope and shadowed as `var … = undefined` declarations prepended to the user code.
- **Output cap: 4 KB** (chatsune value), with a `… (output truncated)` marker.
- **Timeout: 10 s** (interactive; chatsune used 60 s under server dispatch). Chosen over a tighter
  5 s because the sandbox has been observed to take a moment to spin up in chatsune and the targets
  are mobile devices, which are slower. On expiry the worker is terminated and the result is an
  error. *Tuning knob.*
- Threat model: the sandbox runs **model-generated** JS (delivered over the provider stream), not
  arbitrary attacker input, but a hostile provider response could inject code — hence the Worker
  isolation + nulled network/storage globals. Pure compute only (no DOM, no network); a Worker is
  the appropriate boundary. An iframe/origin boundary is unnecessary while there is no DOM access.

### 4.4 System-prompt instruction (British English)

> A `calculate_js` tool runs JavaScript and returns its output. Prefer it for any arithmetic,
> counting, or string manipulation rather than computing in your head — even simple sums. It
> eliminates slips such as miscounting the letters in a word.

*Tuning knob — wording may be revised.*

## 5. The execution loop (Approach A)

The loop lives in `stream-manager.store.ts`. `runStreamEngine` stays single-pass; it learns two
things:

1. Accept `tools?: ToolDef[]` and pass them to `streamCompletion` (`args.tools`).
2. Accept an optional `toolExchange: WireMessage[]` — the accumulated
   `assistant(tool_calls)` / `tool(tool_call_id, content)` pairs from prior rounds — and append
   it after the active user turn before streaming.

The manager owns the loop:

```
const MAX_TOOL_ROUNDS = 5
round = 0                       // tool-executing rounds completed
toolExchange = []
loop:
  forceAnswer = (round >= MAX_TOOL_ROUNDS)
  result = runStreamEngine({ ...args, tools: forceAnswer ? [] : toolDefs(), toolExchange })
  accumulate result.contentBlocks / pillRows / reasoning into the final message (in order)
  toolCalls = pills in result with kind 'tool-call'
  if toolCalls is empty OR forceAnswer: break
  for each toolCall (possibly several in one turn):
      set pill status 'running'
      r = registry.dispatch(toolCall.name, parse(argumentsJson), signal)
      set pill status 'completed' | 'error', store result/error in payload
  append one assistant(tool_calls) message + one tool message per call to toolExchange
  round += 1
```

- **Round cap `MAX_TOOL_ROUNDS = 5`**, counted **globally** across all tools (Chris's Gardasee
  example: search → fetch → calculate → diagram → misc are five *different* tools on this one
  spine). Tool execution is possible in rounds 0–4 (five rounds); a round may contain several tool
  calls, and executing them all is still one round.
- Once five tool-executing rounds have completed and the model *still* wants to call, one final
  pass runs with `tools: []` (`forceAnswer`), so the model must answer rather than call again.
- Text, reasoning, and pill blocks are accumulated **across all rounds in order** into the single
  persisted message — a model may emit only tool calls early and prose last, or interleave.
- Abort (`signal`) cancels both the in-flight stream and any running sandbox worker.

## 6. Pill UI

`Pill.tsx` stays the slim `⚙ calculate_js` inline marker; `data-pill-status`
(`running` | `completed` | `error`) drives the visual (running pulse → done → error).
**Tap-to-expand** reveals the executed `code` and the `result`/`error`. The payload gains
`argumentsJson`, `result`, and `error` — `PillRow.payload` is `unknown`, so **no Dexie
migration**.

This is mechanics and states only. The opulent styling pass (collapsed/expanded look, running
animation, error treatment) is a separate pass Chris drives — consistent with mechanics-first.

## 7. Persistence & replay (deliberate boundary)

- The tool result is persisted in the pill payload so the expand view survives a reload.
- **Cross-turn replay is deferred.** On a *subsequent* user turn the tool exchange is not replayed
  to the model (matching chatsune's drop-on-replay at `stream-engine.ts:159`); the final answer
  text already carries the computed result. Replaying full tool exchanges across turns is a future
  enhancement, tracked in the follow-ups index. This keeps the scope to a single answer's loop.

## 8. Error handling (the *dere* half)

- **Sandbox error / timeout:** the error string is returned to the model as the `tool` result, so
  within the 5-round budget the model can self-correct (fix its code and retry). The pill shows
  `error` status; expanding shows the error. No user-facing dead end — the model carries on.
- **All rounds exhausted with errors:** the final round (no tools) lets the model give its best
  answer with what it has; the failing pills remain visible and expandable.
- **Unknown tool name:** `dispatch` returns a structured error rather than throwing, so a
  hallucinated tool name degrades gracefully into a tool result the model can react to.

## 9. Testing

Vitest (frontend), per the quality bar:

- **Sandbox unit** (`sandbox.worker` `executeCode` extracted for direct call): final-expression
  value returned; `console.*` captured; multi-statement + final value; output cap + truncation
  marker; nulled globals (`fetch` is `undefined`); a thrown error surfaces as `error`.
- **Loop unit** (manager): single round with no calls (pass-through); one round with a tool call
  then a final answer; several calls in one round = one round; cap at 5 forces a final tools-less
  round.
- **Registry unit:** `toolDefs()` projection; `systemPromptSegment()` join + `null` when empty;
  `dispatch` unknown-name structured error.
- **No live provider calls in CI** (provider keys never enter CI). End-to-end tool behaviour
  against a real model is manual verification (§11).

## 10. Security note

Not a Larissa-gated change (no `auth-/sync-/proxy-service`, no `crypto`). The client-side
JavaScript-eval sandbox is nonetheless a security-sensitive surface and is recorded in
`obsidian/insights/security-deferrals.md` / the journal: it executes model-generated code in a
Worker with network/storage globals nulled; revisit the boundary (e.g. an origin-isolated iframe)
only if a future tool needs DOM access.

## 11. Manual verification (Chris, on device)

1. Ask a curated model "How many r's are in strawberry?" — it calls `calculate_js`, the pill
   appears, and the answer is **3**.
2. Tap the pill — it expands to show the executed code and the result; tap again to collapse.
3. Ask a multi-step arithmetic question that needs a couple of rounds — confirm it resolves
   correctly and the round cap is never visibly hit for a legitimate chain.
4. Provoke a sandbox error (e.g. "use calculate_js to call fetch('https://example.com')") —
   confirm the model is told it failed, the pill shows the error on expand, and the model
   recovers with a sensible answer rather than hanging.
5. Confirm a normal chat with **no** maths still streams unchanged (tools present but unused).
6. Reload mid-history — confirm a past tool pill still expands to its stored code + result.

## 12. Files touched

- **New:** `apps/user-client/src/tools/registry.ts`, `tools/calculate-js.ts`,
  `tools/sandbox.worker.ts`, `tools/sandbox-host.ts` (+ their tests).
- **Modified:** `apps/user-client/src/lib/stream-engine.ts` (accept `tools` + `toolExchange`,
  pass through; surface tool-call pills as today), `state/stream-manager.store.ts` (the loop),
  `components/chat/Pill.tsx` (expand + status), `packages/llm-unified/src/composition.ts` (Band-3
  tools-segment producer — accept a `toolsInstruction` input), and the prompt-input assembly in
  `stream-engine.ts` to feed `registry.systemPromptSegment()` in.
- **No Dexie migration.** No `llm-unified` wire/type changes (the layer is already tool-ready).
