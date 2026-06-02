# Provider Curation Record — xAI

**Onboarded:** 2026-06-02 (Liz, via `/curate` Mode 1) · **Status:** live-curated,
one offering (Grok 4.3).

xAI is Elon Musk's AI company. Grok is its flagship model. The headline
characteristic is **freedom orientation** — xAI/Grok refuses near-nothing
despite a Californian home (Chris, 2026-06-02). This is a deliberate identity
fit for Chatsundere's anti-censorship stance.

## Base characteristics

- **id:** `xai` · **displayName:** xAI
- **Base URL:** `https://api.x.ai/v1`, Bearer auth. OpenAI-compatible
  `/chat/completions` (the only surface we use — completions-not-responses
  rule applies).
- **Key:** `keys/.xai-test-key` (local only, never in CI).
- **Probe:** `GET /models`.
- **Shape:** `openai-chat-completions`.
- **sortPriority:** 20 — shares the slot with novita; registration order
  breaks the tie. Ranked after chutes (TEE, NGO partner, priority 10) and
  wafer (ZDR, privacy-forward, priority 15), ahead of the general aggregators.

## Trust

| Property | Status |
|---|---|
| TEE | ❌ none |
| ZDR | ❌ none **today** |
| Jurisdiction | US |

**Future note — NGO-negotiated ZDR:** as an NGO, Chatsundere may negotiate
special zero-data-retention conditions with xAI. The venice.ai precedent is
the template — venice routes everything ZDR via an xAI deal. If that lands:
flip `trust.zdr` to `true` and emit a per-request ZDR header (the
`Wafer-ZDR: required` pattern is the design template — see
[[wafer]]). No implementation required until the deal is confirmed.

## Conversation-affinity prompt caching

xAI's prompt cache is **conversation-affinity**: routing the turns of one chat
to the same back-end server maximises cache hits. The mechanism is the
`x-grok-conv-id` request header — set it to the chat's stable id and every
turn of that chat lands on the same server.

Implementation: `cacheKey` on `CanonicalRequest` → threaded through
`StreamCompletionArgs` → emitted as `x-grok-conv-id` in `xaiAdapter.buildRequest`
from `req.cacheKey`, sourced from the chat's UUIDv7 id in the stream engine.

Live probe (2026-06-02): `usage.prompt_tokens_details.cached_tokens` populated
on repeated turns with the same `x-grok-conv-id`.

## CORS

`api.x.ai` sends **no `Access-Control-*` headers** (probed 2026-06-02). An
authenticated browser POST carrying the `x-grok-conv-id` header triggers a
preflight xAI does not honour → **direct browser calls are impossible**.
Provider is therefore `corsHint: 'requires-proxy'` — routed through the CORS
proxy (same as wafer, ollama-cloud). The Bun-side live conversation-suite is
unaffected (no CORS enforcement server-side).

## Freedom orientation

`freedomOrientedDeployment: true` for all offerings — xAI/Grok adds no
meaningful censorship layer, consistent with xAI's public positioning and
Chatsundere's anti-censorship stance.

## Offerings

One curated offering: **Grok 4.3** (`canonicalRef: 'grok-4.3'`, `upstreamSlug:
'grok-4.3'`, `adapterId: 'xai:grok-4.3'`). Grok 4.20 deliberately excluded —
its multi-agent architecture requires orchestration machinery Chatsundere does
not support; 4.3 is the smaller-but-smoother, more popular choice (Chris,
2026-06-02).

## Documentation

- API reference: <https://docs.x.ai/api>
- Models list: live `GET /v1/models`
