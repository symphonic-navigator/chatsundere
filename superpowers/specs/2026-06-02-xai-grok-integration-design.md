# xAI / Grok 4.3 Integration — Design

**Date:** 2026-06-02
**Author:** Liz (with Chris)
**Status:** Approved for planning
**Larissa gate:** Not triggered — `packages/llm-unified` + `apps/user-client` only; no
auth/sync/proxy/crypto path.

---

## 1. Goal

Onboard xAI as a curated provider with a single first-class model, **Grok 4.3**, including
its vision capability. Grok is a freedom-oriented model from a freedom-oriented provider
(near-zero refusal rate despite a Californian home), so it strengthens our anti-censorship
identity. Grok 4.20 and xAI image generation are explicitly out of scope (§10).

## 2. Empirical findings (probed live, 2026-06-02)

These supersede the xAI documentation, which describes encrypted/summarised reasoning only
for the **Responses API**. We are committed to `/chat/completions` ([[project_completions_not_responses]]),
and the Chat Completions surface behaves as follows (verified against `api.x.ai/v1` with a
live key):

- **Reasoning streams as `delta.reasoning_content`** — token-by-token, the standard
  OpenAI-compatible reasoning channel (identical shape to our `novita-thinking` adapter).
- **`reasoning_content` is already the summarised form.** A request that burned
  `reasoning_tokens: 270` returned a one-sentence `reasoning_content`. xAI hands us a
  human-readable summary by default; there is **no opaque "encrypted" blob** on the Chat
  Completions surface, and nothing ugly to hide.
- **No `encrypted_content` field** is exposed on Chat Completions. Encrypted reasoning
  content is a Responses-API-only feature (`include: ["reasoning.encrypted_content"]`).
- **Prompt caching works via the `x-grok-conv-id` request header.** A probe carrying the
  header reported `usage.prompt_tokens_details.cached_tokens: 128`.
- **Usage shape** (per response, `stream_options.include_usage`):
  `prompt_tokens`, `completion_tokens`, `total_tokens` (which *includes* reasoning tokens:
  163 + 64 + 270 = 497), `prompt_tokens_details.{text_tokens, image_tokens, cached_tokens}`,
  `completion_tokens_details.reasoning_tokens`. This maps cleanly onto our existing
  `NormalisedUsage` (`promptTokens`/`completionTokens`/`totalTokens` + `reasoningTokens` +
  `cachedTokens`).
- **`reasoning_effort`** accepts `none` (off), `low` (xAI default), `medium`, `high`. No
  slug swapping — Grok 4.3 uses the native effort parameter.
- **SSE flow:** delta chunks → finish_reason chunk → usage-only chunk → `[DONE]`, the same
  ordering our OpenAI-shape parsers already handle.

**Consequence — the design simplifies sharply.** Because `reasoning_content` is already a
readable summary and no encrypted blob exists on our surface, the speculative
encrypted-reasoning machinery (a new `StreamChunk` variant, a sidecar storage field, replay
plumbing, a Dexie touch) is **not needed**. We display `reasoning_content` in the existing
reasoning pill, exactly as every other reasoning model. Chris's "encrypted-only replay"
decision resolves elegantly to **no replay** (there is no encrypted blob to replay).

## 3. Decisions (Chris)

1. **Scope:** Grok 4.3 only. Not Grok 4.20 (its multi-agent value needs machinery we don't
   support; 4.3 is the smaller-but-smoother, more popular choice).
2. **Vision is in scope** — central to user demand; Grok's vision is strong.
3. **Reasoning display:** show the summarised `reasoning_content` in the pill + the existing
   "thinking" streaming indicator.
4. **Reasoning replay:** encrypted-only → since no encrypted blob exists on Chat Completions,
   **no replay** (`replayReasoning: false`).
5. **Reasoning control:** full `steps` — `low` / `medium` / `high` + off, default `low`,
   reasoning on by default.
6. **Context:** `recommended: 200_000`, `max: 1_000_000`. Above 200K xAI roughly doubles the
   price; users should "compact and continue" rather than run into the expensive band. The
   context gauge reads `recommended`.
7. **Caching:** send `x-grok-conv-id` = the chat's UUIDv7 id on every request, so all turns
   of one chat route to the same cache server.
8. **Freedom:** `freedomOriented: true` (model) and `freedomOrientedDeployment: true`
   (xAI deployment) → 🕊️ free.
9. **Proxy:** xAI sends no CORS headers → `corsHint: 'requires-proxy'`.
10. **Worktree:** all implementation happens in a dedicated git worktree (Chris works on
    persona-settings in parallel).

## 4. Architecture

Follows the established curation pattern (wafer/mistral/tensorix precedent). One genuinely
new cross-cutting piece: cache-hint threading (§6).

### 4.1 Canonical model — `packages/llm-unified/src/catalogue/canonical-registry.ts`

```ts
{
  id: 'grok-4.3',
  displayName: 'Grok 4.3',
  family: 'grok',
  requiredCaps: { tools: true, reasoning: true, vision: true },
  freedomOriented: true,
  freedomNote: 'xAI/Grok refuses near-nothing; freedom-oriented model.',
}
```

### 4.2 Provider — `packages/llm-unified/src/providers/xai.ts`

```ts
export const xai: ProviderDefinition = {
  id: 'xai',
  displayName: 'xAI',
  iconKey: 'xai',
  baseUrl: 'https://api.x.ai/v1',
  shape: 'openai-chat-completions',
  capabilities: ['llm', 'streaming', 'tools', 'vision'],
  configFields: [apiKeyField('xAI API key')],
  probe: { path: '/models', method: 'GET' },
  secretFields: new Set(['api_key']),
  corsHint: 'requires-proxy',
  offerings,            // single grok-4.3 offering
  sortPriority: 20,     // freedom-oriented but US jurisdiction, no TEE/ZDR, premium-priced
                        // → ranked after the privacy-forward providers. Adjustable by Chris.
};
```

One offering:

```ts
{
  canonicalRef: 'grok-4.3',
  providerId: 'xai',
  upstreamSlug: 'grok-4.3',
  adapter: { kind: 'catalogue', adapterId: 'xai:grok-4.3' },
  profile: {
    reasoning: { mode: 'steps', steps: ['low', 'medium', 'high'], offStep: 'none', defaultStep: 'low' },
    toolCalls: { supported: true, streaming: true, concurrentWithReasoning: true },
    vision: true,
    replayReasoning: false,
  },
  context: { recommended: 200_000, max: 1_000_000 },
  trust: { tee: false, zdr: false, jurisdiction: 'US' },
  freedomOrientedDeployment: true,
  source: 'curated',
  confidence: 'verified',   // set only after the live conversation-suite passes (§7)
  serviceKind: 'llm',
}
```

### 4.3 Adapter — `packages/llm-unified/src/adapters/xai-openai.ts`

Closely mirrors `novita-thinking.ts` (the `reasoning_content` channel + the identical usage
shape), with three xAI specifics:

- **No slug swap.** `model: 'grok-4.3'` always.
- **`reasoning_effort` from the `ReasoningIntent`:**
  `{ enabled: false }` → `reasoning_effort: 'none'`;
  `{ enabled: true, effort }` → `reasoning_effort: effort ?? 'low'`.
  Defensive: an out-of-range effort falls back to `'low'` (xAI rejects unknown values).
- **Cache header.** When `req.cacheKey` is set, emit
  `headers: { 'x-grok-conv-id': req.cacheKey }` on the `WireRequest` (the existing
  `WireRequest.headers` mechanism, already merged by the transport — same path wafer uses for
  `Wafer-ZDR`).

`parseChunk` is the novita pattern verbatim: `delta.reasoning_content` → `reasoning` chunk;
`delta.content` → `token`; fragmented `tool_calls` accumulated by index and flushed on
`finish_reason`; the usage-only chunk → `usage` with `reasoningTokens` (from
`completion_tokens_details`) and `cachedTokens` (from `prompt_tokens_details`).

`stream: true` + `stream_options: { include_usage: true }`. Tools passthrough in the
OpenAI `{ type: 'function', function: {...} }` shape. Vision needs no adapter change — the
multimodal `WireContentPart` array (text + `image_url`) is already the wire shape xAI
accepts; the gate is purely `profile.vision = true`.

### 4.4 Scanner — `packages/llm-unified/src/providers/curation/xai-scanner.ts`

Light, following precedent. Grok 4.3 is the single hardcoded offering; the scanner exists for
parity (probe `/models`, confirm `grok-4.3` is listed) and for the `builtins.test` fixtures.

### 4.5 Client wiring — `apps/user-client`

- `settings.tsx` + `ProviderSheet` gain xAI in the provider list (mirrors the wafer addition).
- Because `corsHint: 'requires-proxy'`, the reworked Upstream-Providers UI already surfaces
  xAI as `✗ Needs proxy` until the global CORS proxy is set, with the "Set up a CORS proxy →"
  shortcut — no new UI work, the existing derived-status path handles it.

### 4.6 Records — `obsidian/`

- `obsidian/providers/xai.md` (new) — provider record.
- `obsidian/models/grok-4.3.md` (new) — model record with the probed facts.

## 5. Reasoning model

- **Control:** `steps` low/medium/high + off (`offStep: 'none'`), default `low`, default-on.
  The cockpit already renders a `steps` control (live-tested low/high), so no new UI.
- **Display:** `reasoning_content` streams into the existing reasoning pill (closed by
  default, opens to the live trace) — it is already the readable summary.
- **Replay:** none. `replayReasoning: false`. Grok's prior thinking is never re-sent as input;
  we hold the conversation context ourselves and there is no compact encrypted blob to replay,
  so this keeps the prompt (and the cache budget) lean.

## 6. Caching design — `x-grok-conv-id` threading

The one cross-cutting addition. The chat's UUIDv7 id must reach the adapter so it can set the
`x-grok-conv-id` header. The adapter's `buildRequest` only receives a `CanonicalRequest`, so:

1. **`adapter-contract.ts`** — add an optional field to `CanonicalRequest`:
   ```ts
   /** Stable per-conversation key for providers with conversation-affinity prompt
    *  caching (xAI's x-grok-conv-id; OpenAI's prompt_cache_key later). Ignored by
    *  adapters that don't cache by conversation. */
   cacheKey?: string;
   ```
2. **stream-engine** (`apps/user-client/src/.../stream-engine.ts`) — set `cacheKey = chatId`
   when composing the `CanonicalRequest` for a streamed chat turn.
3. **one-shot path** (`one-shot-completion.ts`, used by title-gen / memory) — pass the same
   chat id when available, otherwise omit. (Title-gen and memory extraction for a chat can
   reuse the chat's id for cache affinity; this is cheap and harmless.)
4. **xai adapter** — read `req.cacheKey`; if present, emit the header.

All other adapters ignore `cacheKey` — purely additive, no behaviour change. This is the
clean, general home for conversation-cache keys; it does not couple `llm-unified` to any
client persistence type.

## 7. Testing & live verification

- **Bun unit tests** on `xai-openai.ts`: request building (effort mapping none/low/medium/high,
  cache header presence/absence, tools, vision multimodal passthrough) and `parseChunk`
  (reasoning/content split, fragmented tool-call reassembly, usage extraction incl.
  `reasoningTokens`/`cachedTokens`, finish-reason normalisation).
- **`builtins.test` / `canonical-registry.test`** updated for the new provider + canonical.
- **Live conversation-suite** (`run-xai-suite.ts`, local-only, never CI — provider keys never
  enter CI, CLAUDE.md §10). This is the gate that flips `confidence` to `verified`. It must
  confirm, against the real wire:
  1. reasoning **off** (`reasoning_effort: 'none'`) is a **clean off** — no trace leaks (the
     wafer/Kimi `fixed-on` failure mode must be ruled out for Grok);
  2. low / medium / high all stream a trace and the answer;
  3. **vision** — Grok describes a real test image correctly;
  4. **tools** — a tool call fires and reassembles;
  5. **memory/recall** turn (the standard deterministic recall question);
  6. **cache read** — a second turn on the same `x-grok-conv-id` reports non-zero
     `cached_tokens`.

## 8. Data shapes — what does NOT change

- **No new `StreamChunk` variant** — `reasoning_content` → the existing `reasoning` chunk.
- **No Dexie migration, no new message field** — nothing opaque to persist; reasoning is
  display-only as today.
- **No new persistence** anywhere. The only type change is the additive `CanonicalRequest.cacheKey`.

## 9. Manual verification (Chris, on device)

1. Add xAI in Settings → enter the key → with no proxy set, xAI shows `✗ Needs proxy` + the
   proxy shortcut; with the proxy set, it flips to `● Connected` and "LLM unlocked".
2. Pick Grok 4.3 for a persona; the model picker shows the 🕊️ freedom badge, the EU/US
   jurisdiction badge (US), and Vision/Tools hints; reasoning control shows low/medium/high.
3. Send a reasoning-provoking message → the reasoning pill streams a readable summary, then
   the answer renders (Markdown).
4. Switch reasoning to off → no reasoning pill appears; answer still streams.
5. Send an image with a question → Grok describes it correctly.
6. Multi-turn chat → prompt cost falls on later turns (cache hit via `x-grok-conv-id`).

## 10. Out of scope / deferred

- **Grok 4.20** — needs multi-agent machinery we don't support; 4.3 is the better single-model
  choice.
- **xAI image generation** — chatsune has it (`/images/generations`, the Imagine group); we are
  LLM-only here. Revisit when image generation becomes a product surface.
- **Encrypted reasoning replay** — does not exist on the Chat Completions surface; would only
  be reachable via the Responses API, which we deliberately do not use. Documented limitation,
  not a follow-up.

## 11. Larissa

Not triggered. The change touches `packages/llm-unified` and `apps/user-client` only — no
auth-service, sync-service, proxy-service, or `packages/crypto` path. (The unsealed-key access
on the outbound call uses the existing provider-key path; no new crypto surface.)
