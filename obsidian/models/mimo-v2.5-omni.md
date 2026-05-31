# Model Curation Record — MiMo V2.5 Omni

> Curation record. novita mechanics match the other novita offerings
> ([[mimo-v2.5-pro]] is the text-only sibling).

- **Identity:** MiMo V2.5 Omni · family `mimo` · canonical id `mimo-v2.5-omni`
- **T/R/V:** tools ✅ · reasoning ✅ · vision ✅ (image input; output text-only)
- **replayReasoning:** false (soft-CoT)
- **🕊️ Freedom:** free — `freedomOriented: true` (Chris, 2026-05-31) and the
  novita deployment is `freedomOrientedDeployment: true` (novita adds no
  censorship).

MiMo V2.5 is Xiaomi's open-weight, natively omni-modal MoE model (text + image +
video input upstream, text output). The community treats it as a strong
GPT-4o-class substitute, but workable western compute for it is scarce — outside
China novita is effectively the only home. Curated under the display name **MiMo
V2.5 Omni** to set it apart from the larger text-only `mimo-v2.5-pro` sibling.

## Offering — novita

- **slug:** `xiaomimimo/mimo-v2.5` · **adapterId:** `novita:xiaomimimo/mimo-v2.5`
- **context:** recommended **200 000** · max **1 048 576**. novita reports a 1M
  ceiling; recommended is capped at 200k — the smart, non-agentic window (~1000
  A4 pages), where a 1M MoE realistically stays sharp. They legitimately differ;
  the Context-Gauge uses recommended.
- **reasoning control:** `enable_thinking` boolean (`toggle`, default on); off is
  **genuinely off** — `enable_thinking: false` empties the `reasoning_content`
  channel while `content` still answers. No granular effort buckets.
- **reasoning channel:** `reasoning_content`.
- **tool calls:** single block (one SSE event carried `id` + `name` + full
  `arguments`); args valid JSON; `generate_image` fires reliably; reasoning and
  tool calls coexist (`concurrentWithReasoning`).
- **vision:** **works** — the suite vision scenario passes **12/12** live runs.
  This drove a fix to the suite itself: the original synthetic solid-colour test
  image made MiMo leak chain-of-thought into the `content` channel ("Thinking
  Process: ...") and ramble past the bare colour word (~88%, 23/26) — a uniform
  block gives the model nothing to perceive (the Kimi-24px class). The shared
  test image is now a content-rich photo (the Sylvir bard, green cloak); MiMo
  names "green" reliably even when verbose, because the question has an
  unambiguous answer. See `scenarios/_test-image.ts`. Two further empirical
  gotchas, both probe-confirmed:
  1. **Image must be a base64 data URL** — a remote image URL 400s on novita
     ("invalid request error"). The product sends base64, so the pipe is fine;
     the suite's embedded data-URL image exercises exactly this path.
  2. **Do not under-cap `max_tokens` on image turns.** MiMo can be verbose before
     answering, so a tight cap (e.g. 80) truncates before the answer. The adapter
     sends **no** `max_tokens`, so this never bites the product path.
- **usage:** OpenAI-standard — `reasoning_tokens` under `completion_tokens_details`,
  `cached_tokens` under `prompt_tokens_details`. Handled by the shared
  `novitaThinkingAdapter` unchanged.
- **adapter:** reuses `novitaThinkingAdapter(slug, vision=true)` — behaviour
  identical to the GLM / DeepSeek / Kimi / Gemma families it already serves, so
  no new adapter was written.
- 🔒 **Privacy:** no TEE / no ZDR.

## Why novita-exclusive

MiMo V2.5 is open-source and genuinely good, but western compute for it is scarce
— a market-failure / mis-allocation Chris flagged, and exactly the gap
Chatsundere exists to close. The **chutes contrast** is the cautionary tale: MiMo
V2.5 on chutes was the canonical failure that retired the old byte-replay
synthesis loop (its `generate_image` round-trip returned HTTP 400 while fixture
replay stayed green). On novita the same flow passes `assertNoHttpError`
end-to-end — empirical proof that the deployment matters, not just the weights.

## Validation (2026-05-31, conversation-suite, live)

- **Core scenario:** PASS on both reasoning permutations (on + off), 22/22 —
  tools (`generate_image` fired, args valid JSON), memory echo, usage all green;
  reasoning-present on, reasoning-absent off.
- **Vision scenario:** PASS **12/12** on the new content-rich Sylvir test image.
  (The retired synthetic solid-colour image flaked ~88% on a reasoning-leak; the
  swap fixed it — see the vision note above.)
- Run via `curation/run-novita-mimo-suite.ts` (local-only, never CI).
