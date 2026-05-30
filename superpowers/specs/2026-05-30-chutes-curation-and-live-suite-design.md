# Chutes Curation + Live Conversation-Suite Binding — Design

- **Date:** 2026-05-30
- **Status:** Draft
- **Author:** Liz (Claude Code), brief-led with Chris
- **Depends on:** runtime adapter dispatch (Slice 1, `ba26ab4`); the `/curate`
  skill; the conversation-suite (`packages/llm-unified/curation/conversation-suite/`).
- **First real dogfood of `/curate`.** Chutes is the first curated provider — a
  TEE-only, OpenAI-compatible upstream, NGO-relationship partner.

---

## 1. Context & Motivation

Slice 1 made hand-written `ModelAdapter`s real at runtime. This brings the first
provider, **chutes**, fully live: a `chutes-openai` adapter, the provider
registration with `knownModels`, and — the prerequisite that unblocks live
validation — a **live `RunnerBinding`** so the conversation-suite can drive a
real chutes model end-to-end.

All facts below are empirical (live probe + chatsune's proven chutes adapter),
not docs.

## 2. The Live RunnerBinding (the prerequisite)

The conversation-suite (`runner.ts`) defines `RunnerBinding` (`runTurn`,
`toolResultFor`) and `runSuite`, but no concrete binding exists. The wrinkle:
`assertNoHttpError` needs `TurnOutcome.httpStatus`, but `streamCompletion`
**throws** on non-2xx — so the motivating MiMo-400-style case would surface as an
exception, not a checkable outcome. **Resolution:** the binding does its own thin
fetch (to capture the status) and reuses the existing pieces; it does NOT go
through `streamCompletion`.

```
// packages/llm-unified/curation/conversation-suite/binding.ts (new)
makeLiveBinding({
  offeringRef, providerConfig, apiKey, corsProxyUrl?, corsProxyKey?,
  adapter, tools, fetchImpl?    // fetchImpl injectable for key-free unit tests
}): RunnerBinding
```

`runTurn(messages, reasoning)`:
1. `wire = adapter.buildRequest({ messages, reasoning, tools })`.
2. `request = buildRequest({ provider: providerConfig, apiKey, …, path: '/chat/completions', method: 'POST', body: wire.body })` (reuse `transport.ts`).
3. `response = await (fetchImpl ?? fetch)(request)`.
4. If `!response.ok || !response.body`: drain and `return assembleOutcome(response.status, [])` — the **400 is captured, not thrown**, so `assertNoHttpError` can fail it.
5. Else: collect `parseWithAdapter(response.body, adapter)` into chunks and `return assembleOutcome(response.status, chunks)`.

`toolResultFor(toolName, _argumentsJson)`: synthesise a minimal tool result
`{ role: 'tool', content: JSON.stringify({ ok: true }), name: toolName }` so the
conversation can continue (subject to the known `WireMessage`-has-no-`tool_calls`
limitation — fine for terminal-tool-call scenarios like the seed).

**Testing:** inject `fetchImpl` returning a fake `Response` (a 400, and a 200 with
an SSE `ReadableStream`) to assert the status-capture and assembly mapping — no
network, no key. The real run is Chris's live verification (§6).

## 3. The `chutes-openai` ModelAdapter

One adapter for all chutes models (uniform OpenAI-compatible upstream). Lives at
`packages/llm-unified/src/adapters/chutes-openai.ts`, implements `ModelAdapter`,
registered as `'chutes-openai'`.

**`buildRequest(req)`** → `{ model, body }`:
- `body = { model, messages: req.messages, stream: true, stream_options: { include_usage: true } }`.
- Reasoning: `if (req.reasoning.enabled) body.reasoning_effort = req.reasoning.effort ?? 'medium';` else **omit** (empirically confirmed: `reasoning_effort` accepted, omission = off — chatsune's proven shape).
- Tools: when `req.tools?.length`, map to `[{ type: 'function', function: { name, description, parameters } }]`.
- `model` is the offering slug (e.g. `deepseek-ai/DeepSeek-V3.2-TEE`), supplied to the adapter — see §3.1.

**`parseChunk(raw, state)`** → `{ events, state }`:
- **Usage first:** when `payload.usage` is present (chutes sends it on a final
  event with `choices: []`), emit `{ type: 'usage', usage }` where
  `usage = { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, totalTokens: usage.total_tokens, reasoningTokens?: usage.reasoning_tokens, cachedTokens?: usage.prompt_tokens_details?.cached_tokens }`.
  **Note (empirical, differs from OpenAI):** chutes puts `reasoning_tokens`
  **top-level in `usage`**, not under `completion_tokens_details`.
- Reasoning: from `choice.delta.reasoning_content` (chutes' field; `reasoning` is
  not used).
- Content: from `choice.delta.content`.
- Tool calls: reassemble fragments across events via `ParseState` keyed by
  `tool_calls[].index` (the Slice-1 / baseline pattern), flush on `finish_reason`.
- Finish: map `choice.finish_reason` to the `StreamChunk` finish reason.
- Ignore the `chutes_verification` attestation field for parsing (note it in the
  provider record as the TEE proof).

**`profile: ModelProfile`** — measured: `reasoning: { mode: 'steps', steps: ['low','medium','high'], offStep: null, defaultStep: 'medium' }` (effort buckets, off = omit → no off-step value), `toolCalls: { supported: true, streaming: true, concurrentWithReasoning: <from probe> }`, `vision: <per model>`, `replayReasoning: false` (soft-CoT: DeepSeek/GLM/Kimi/Gemma never replay their own thinking). Note: the catalogue `profile` is not yet runtime-consumed (Slice 2); it is recorded for correctness now.

### 3.1 Per-model slug binding
One adapter instance shared by all chutes models. The model slug comes from the
request, not hardcoded — so `buildRequest` must receive the slug. Since
`CanonicalRequest` has no model field, the chutes adapter is created per-slug via
a small factory `chutesAdapter(slug: string): ModelAdapter` and each is
registered under a per-model id, **or** (preferred, simpler) the single
`'chutes-openai'` adapter reads the slug from `knownModels.id` by having
`streamCompletion` pass it — but Slice 1 passes no slug into `buildRequest`.
**Decision:** register one adapter per model via the factory, id =
`chutes:<slug>` (e.g. `chutes:deepseek-ai/DeepSeek-V3.2-TEE`), and set each
`KnownModel.adapterId` to it. The factory keeps the body-shaping logic in one
place. (A slug-on-CanonicalRequest refactor is deferred — not needed now.)

## 4. Provider registration + scanner

- **`ProviderDefinition`** (`src/providers/chutes.ts`, registered in
  `_register-builtins.ts`): `id: 'chutes'`, `displayName: 'Chutes'`,
  `iconKey: 'chutes'`, `baseUrl: 'https://llm.chutes.ai/v1'`,
  `shape: 'openai-chat-completions'`, `capabilities: ['llm','streaming','tools']`,
  `configFields: [apiKeyField('Chutes API key')]`, `probe: { path: '/models', method: 'GET' }`,
  `secretFields: new Set(['api_key'])`, `corsHint: 'direct'` (chatsune confirms
  browser CORS), `sortPriority: 5` (a privacy-first partner ranks ahead of
  nano-gpt's 10), and `knownModels` (§5).
- **`ProviderScanner`** (`src/providers/curation/chutes-scanner.ts`):
  `groupChutesModels(models: { id: string; confidential_compute?: boolean }[]): DiscoveredOffering[]`
  — one offering per model, `teeVariant = confidential_compute === true`, no
  reasoning-sibling slug (reasoning is a body param). Pure + unit-tested.

## 5. `knownModels` (4 TEE models, from the live /models probe)

Each entry sets `adapterId: 'chutes:<slug>'` and
`reasoning: { kind: 'optional', effort: { buckets: ['low','medium','high'], defaultBucket: 'medium' }, defaultOn: false, replayReasoning: false }`.

| id (slug) | displayName | contextWindow | vision | tools | note |
|---|---|---|---|---|---|
| `deepseek-ai/DeepSeek-V3.2-TEE` | DeepSeek V3.2 (TEE) | 131072 | false | true | |
| `moonshotai/Kimi-K2.6-TEE` | Kimi K2.6 (TEE) | 262144 | true | true | QAT model; input text+image+video |
| `zai-org/GLM-5.1-TEE` | GLM 5.1 (TEE) | 202752 | false | true | |
| `google/gemma-4-31B-turbo-TEE` | Gemma 4 31B Turbo (TEE) | 131072 | true | true | FP4 quant — note in record |

`vision` reflects input image support (Kimi + Gemma); all output text-only.

## 6. Curation Records

- **Provider Record** `obsidian/providers/chutes.md`: base characteristics
  (TEE-for-all via `confidential_compute`; the `chutes_verification` attestation
  hash; CORS `direct`; jurisdiction/ZDR per Chris's relationship knowledge),
  slug convention (`org/Model-TEE`), the `reasoning_effort` reasoning control,
  the `usage` quirk (final event, `choices:[]`, top-level `reasoning_tokens`),
  key (`keys/.chutes-test-key`) + doc (`llms.txt`) references, and the WHY
  (NGO partner, Privacy badge, future recommendation). 🔒 Privacy badge: yes.
- **Model Records** `obsidian/models/<id>.md` per model: identity, T/R/V,
  context, badges, and the WHY. Gemma's FP4 quant and Kimi's QAT noted.

## 7. Live Validation (Chris's manual verification)

With `keys/.chutes-test-key`, run the conversation-suite via `makeLiveBinding`
against (at least) DeepSeek V3.2 and Gemma 4, across reasoning on/off, with the
`generate_image` tool in the scenario. Confirm:
1. `assertNoHttpError` green (no 400 — the chutes shape is correct).
2. `assertToolCallFired('generate_image')` — does the model fire the tool?
   (Gemma is the watch case — the playbook flags Gemma/DSv4-Flash tool-reluctance.)
3. `assertUsagePresent` — usage surfaces and normalises (incl. top-level
   `reasoning_tokens`).
4. Reasoning on → `reasoning_content` surfaces on a non-trivial prompt
   (the trivial-prompt probe showed `reasoning_tokens: 0`; the suite uses a
   prompt that should elicit thinking). Record the finding either way.

## 8. Testing (CI-safe, no keys)

- `chutes-openai` adapter: `buildRequest` (reasoning on/off, tools on/off,
  `stream_options`) and `parseChunk` (reasoning_content, fragmented tool-call
  reassembly, usage with top-level `reasoning_tokens`, `choices:[]` usage event)
  — unit-tested with fabricated payloads (mirrors `nano-gpt-deepseek.baseline.test.ts`).
- `groupChutesModels`: pure unit tests.
- `makeLiveBinding`: injected `fetchImpl` proves status capture (400 → outcome
  with `httpStatus: 400`, no throw) and the 200→parse→assemble mapping.
- The live suite run itself is local-only (§7); never CI.

## 9. Acceptance

- `bun run build && bun run typecheck && bun test` clean; chutes adapter +
  scanner + binding unit-tested without keys.
- Chris's live run: a chutes model completes the conversation-suite with
  `assertNoHttpError` + `assertUsagePresent` green; tool + reasoning findings
  recorded.
- Records committed; chutes registered and selectable (via `knownModels`) in the
  client.
