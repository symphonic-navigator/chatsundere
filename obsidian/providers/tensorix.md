# Provider Curation Record — Tensorix (tensorix.ai)

> Curation record (not an ADR). The honesty surface for Tensorix — what it is,
> how we talk to it, and *why* we trust it. See
> `.claude/skills/curate/references/conventions.md`.

**Onboarded:** 2026-05-31 (Liz, via `/curate` Mode 1) · **Status:** live-curated,
seven EU-sovereign ZDR offerings (DeepSeek V4 Flash deliberately excluded — see
Reasoning mechanism) · **Last addition:** Kimi K3, 2026-07-28.

- **id:** `tensorix` · **displayName:** Tensorix
- **Base URL:** `https://api.tensorix.ai/v1` (OpenAI-compatible Chat Completions)
- **Auth:** Bearer token · key file `keys/.tensorix-test-key` (local only, never in CI)
- **Docs:** <https://docs.tensorix.ai> · LLM-friendly full text: `https://docs.tensorix.ai/llms-full.txt`
- **Probe:** `GET /models` (sparse: id only) · richer per-model metadata at `GET /model/info`
- **CORS:** `direct` — the OPTIONS preflight to `/v1/chat/completions` returns
  **200** with full `Access-Control-*` headers (mirrors the request Origin,
  `access-control-allow-headers: authorization,content-type`,
  `allow-credentials: true`; probed live 2026-05-31). Direct browser calls work,
  so no proxy is needed (contrast wafer, which 405s the preflight).
- **sortPriority:** 12 — privacy-forward (EU-sovereign ZDR, always-on), ranked
  just after chutes (TEE, the strategic NGO partner) and ahead of wafer (opt-in
  ZDR). Chris's call (2026-05-31).

## Base characteristics

- 🔒 **Privacy: ZDR, not TEE.** Tensorix's privacy guarantee is **zero data
  retention** — prompts and completions are *"processed in ephemeral enclaves
  and never stored, logged, or persisted to any storage system"*, and *"We do
  not use your inference data to train or improve any models"* (verbatim from the
  binding Privacy Policy **and** Terms, read 2026-05-31). Unlike wafer's
  per-request `Wafer-ZDR: required` header, Tensorix ZDR is **policy-default and
  architectural** — every request, no opt-in. So the adapter sends **no** trust
  header; every offering carries `trust: { tee: false, zdr: true, jurisdiction: 'EU' }`.
- **The trust basis is policy + EU justiciability, not attestation.** Contrast
  chutes, whose ZDR is cryptographically attestable via TEE. The term "enclave"
  in Tensorix's copy suggests TEE, but no attestable proof was found (the
  zero-data-retention blog post did not render for machine reading). We trust it
  because (a) ZDR is stated in the *binding* Privacy Policy and Terms — breaking
  it is a misleading-data-statement → GDPR breach, not merely a contract breach;
  (b) Tensorix is an **Irish company** (Company No. 796387), directly under Irish
  DPC supervision and EU-justiciable; (c) the reputational cost to a
  privacy-first vendor of breaking it would be existential. The EU residency
  alone is *not* the guarantee (GDPR does not mandate non-retention) — the
  combination of a binding ZDR promise *and* EU justiciability is the lever.
- **EU sovereignty / DSGVO:** 100% EU data residency, infrastructure in **Dublin
  and Helsinki**, *"data never leaves EU jurisdiction"*, GDPR Article 44
  compliant, SCCs for transfers. Governing law: **Ireland**. `trust.jurisdiction:
  'EU'` (Chris's call, 2026-05-31 — generic EU rather than 'IE' to stay robust
  against in-EU site shifts).
- **Metadata retention (not content):** account data, usage *metrics*, and
  security logs are retained up to 12 months; financial records 6 years (Irish
  tax law). This is metadata (who/when/how-many-tokens), **not** prompt/completion
  content — no conflict with the ZDR claim, which governs inference content.

## AUP / freedom

- **freedomOrientedDeployment: true** for all six offerings (Chris, 2026-05-31).
  The Terms prohibit only the expected minimum — illegal/harmful content and EU
  AI Act Article 5 (CSAM, manipulative AI, social scoring) — and defer NSFW/adult
  specifics to a separate Acceptable Use Policy.
- **Caveat — AUP not machine-verified.** The AUP page (`/aup`, `/acceptable-use`)
  is a client-rendered 404 over every path tried; the Terms reference it but do
  not reproduce it. The adult-friendly judgement rests on **Chris's empirical
  experience** running chatsune against Tensorix compute (empirical truth over
  docs), not on a read of the AUP text. If the AUP text is later pasted in,
  re-verify and update this note.

## Slug conventions

Flat `org/model` ids (e.g. `deepseek/deepseek-v4-pro`, `z-ai/glm-5.1`,
`moonshotai/kimi-k2.6`) — no reasoning-sibling slugs (reasoning is the body
`reasoning_effort` param) and no TEE-prefix zoo. One offering per id, like wafer.
**One wrinkle:** Tensorix lists Kimi twice under different casing
(`moonshotai/Kimi-K2.6` *and* `moonshotai/kimi-k2.6`, identical specs). The
scanner (`groupTensorixModels`) deduplicates case-insensitively, keeping the
first; we curate the lowercase slug.

## Reasoning mechanism (empirical)

- Steered by the **OpenAI-standard `reasoning_effort`** param: `'low' | 'medium'
  | 'high'` enable. Reasoning surfaces on `reasoning_content` (DeepSeek also
  duplicates it onto `reasoning` — the adapter prefers `reasoning_content`, never
  double-counts). Effort does not modulate the trace, so reasoning is a `toggle`
  (not `steps`) where it can be turned off at all.

### Response-caching — the trap that nearly mismodelled this

Tensorix **response-caches byte-identical prompts.** A repeated prompt returns
the first reply from cache — and if that first reply had no reasoning (e.g. the
suite's reasoning-*off* turn), the repeat reads trace-free too. This made the
conversation-suite **lie in both directions**: a repeated reasoning-on prompt
looked silent (cache hit on a prior off reply → false `reasoning-present` FAIL),
and a repeated reasoning-off prompt looked clean (cache hit → false
`reasoning-absent` PASS). The fix was to probe the **off-switch with UNIQUE
prompts**, which is the authoritative measurement below. (In production, chats
vary, so the cache rarely bites; but it must never drive the curation verdict.)

### Per-model off-switch (off-leak probe, `reasoning_effort:'none'`, UNIQUE prompts ×6)

| Model | off-leak | control |
|---|---|---|
| DeepSeek V3.2 | 0/6 | **`toggle`** — genuine off |
| DeepSeek V4 Pro | 0/6 | **`toggle`** — genuine off |
| GLM-5 | 0/6 | **`toggle`** — genuine off |
| GLM-5.1 | **6/6** | **`fixed-on`** — off does not suppress |
| GLM-5.2 | **6/6** (720-char trace, 2026-06-17) | **`fixed-on`** — off does not suppress |
| Kimi-K2.6 | **6/6** | **`fixed-on`** — off does not suppress (as on wafer) |
| Kimi-K3 | 0/6 (2026-07-28) | **`toggle`** — genuine off, `reasoning_tokens: 0` |

`fixed-on` is the honest "off only hides" model — a toggle would falsely promise
an off. On unique prompts every curated model reasons reliably with
`reasoning_effort` (4/4); the on-default is `medium`.

**The split runs through the Kimi family itself:** K2.6 cannot be silenced here
while K3 can, on the same provider, through the same adapter, with the same
parameter. Whatever governs the off lives in the model, not in Tensorix's
plumbing — which is why the probe is per offering and never inherited from a
sibling.

**Effort never modulates the trace — re-confirmed for K3 (2026-07-28).** The
provider-wide `toggle`-not-`steps` choice was an assumption carried since
onboarding; it was measured properly for Kimi K3 (2 prompts × low/medium/high ×
3 reps, unique prompts) and held: the ranking *contradicts itself between the two
prompts* (P1 `low` 617 chars mean vs `medium` 461; P2 `medium` 770 vs `high` 388)
and the within-cell spread reaches 1250 chars, exceeding every between-level
difference. A ladder would promise steerability we cannot demonstrate.

### DeepSeek V4 Flash — excluded

V4 Flash reasons **only in bare `content` prose** on Tensorix — the
`reasoning_content` channel is empty under every switch tried (`reasoning_effort`
low/med/high, `chat_template_kwargs.enable_thinking`, `thinking`, none; 0/12). It
*does* think (full step-by-step inline in the answer), but with no separable,
steerable channel it does not fit the channel-based reasoning model the canonical
requires, and adds nothing over the wafer/nano-gpt/novita V4-Flash offerings that
expose a real channel. So it is **not** curated on Tensorix.
- **Per-deployment divergence (the curation lesson):** **GLM 5.2** is `fixed-on`
  here (off leaks 6/6) but a **clean toggle on wafer** (0/6, measured 2026-07-28)
  — the same model, measured per offering, not assumed. *(This bullet previously
  claimed the divergence for Kimi-K2.6 with the polarity reversed — that K2.6 was
  a clean toggle on Tensorix. It was wrong and contradicted the probe table
  directly above it, which records 6/6 leaks; corrected 2026-07-28. The claim
  likely predates the response-cache discovery that invalidated the first round
  of Kimi measurements.)*
- **Reasoning channel varies by model.** GLM and Kimi surface reasoning on
  `reasoning_content` only. **DeepSeek (V3.2, V4-pro, V4-flash) emit the SAME
  text on BOTH `reasoning` and `reasoning_content`** (probed: `'We'` = `'We'`).
  The adapter therefore reads `reasoning_content` first and only falls back to
  `reasoning`, so the DeepSeek trace is **never double-counted**. (A naive
  concatenation would double every DeepSeek reasoning token.) `reasoning_details`
  is structured, not text — ignored.
- **Tool calls fire reliably** on all six, including DeepSeek V4 Flash, which
  historically failed to fire `generate_image` on chatsune. No mitigation needed.

## `usage` reporting quirk

OpenAI-standard shape (contrast chutes' top-level `reasoning_tokens`):
- `usage.completion_tokens_details.reasoning_tokens` — reasoning tokens.
- `usage.prompt_tokens_details.cached_tokens` — prompt-cache hits.
- Delivered on a final `choices: []` event when `stream_options.include_usage`
  is set. The `tensorix-openai` adapter normalises accordingly.

## Context windows (from `GET /model/info`, `max_input_tokens`)

DeepSeek V3.2 / V4-pro: **163 840** · GLM-5 / GLM-5.1 / GLM-5.2: **131 072** ·
Kimi-K2.6: **262 144** (vision). `recommended = max` for these — no
Tensorix-specific degradation data to justify a lower recommended.

**Kimi K3 is the one exception**, and deliberately so: `recommended` **262 144**
under a **1 048 576** ceiling. The `/models` objects are minimal here (no window
at all — `{id, object, created, owned_by}`), so nothing was measured; the figures
are inherited from the model's other three routes so the Context-Gauge reads
identically wherever the user runs K3.

## Curated offerings

Seven EU-sovereign ZDR offerings — see the model records:
[[../models/deepseek-v3.2]] (toggle), [[../models/deepseek-v4-pro]] (toggle),
[[../models/glm-5]] (toggle), [[../models/glm-5.1]] (fixed-on),
[[../models/glm-5.2]] (fixed-on), [[../models/kimi-k2.6]] (fixed-on, vision),
[[../models/kimi-k3]] (toggle, vision — added 2026-07-28). DeepSeek V4 Flash
excluded ([[../models/deepseek-v4-flash]] — bare-content reasoning, no channel).

## Documentation

- API docs: <https://docs.tensorix.ai> · full text: `https://docs.tensorix.ai/llms-full.txt`
- Per-model metadata: live `GET /v1/model/info`.
- Privacy Policy: <https://tensorix.ai/privacy> · Terms: <https://tensorix.ai/terms>
