# Next batch — providers & models to add (planned 2026-05-31, for 2026-06-01)

Chris's list for tomorrow's curation session. Captured before sleep; we curate
these together. Order roughly by priority / dependency.

## New providers to integrate

- **wafer.ai** — integrate. Headline feature: **ZDR** as a first-class
  badge-worthy property (the privacy/trust standout, akin to the chutes TEE story).
  **API recon done (live `/models`, 2026-05-31):**
  - Base `https://pass.wafer.ai/v1`, Bearer auth, OpenAI-compatible chat-completions
    (also an Anthropic-compatible `/v1/messages` — we use chat-completions per
    [[../../CLAUDE.md]] / the completions-not-responses rule). Key: `keys/.wafer-test-key`.
  - **`/models` gives ZDR per model as a boolean `zdr_supported`** — no error-probing
    needed; this drives the badge directly.
  - Each entry carries a `wafer` object: `display_name`, `description`, `provider`,
    `tier`, `context_length`, **`capabilities { vision, tools, reasoning }`** (maps
    1:1 to our T/R/V), and **`pricing` incl. `cache_read_cents_per_million`** (so
    caching is supported).
  - **ZDR is per-request opt-in** via header **`Wafer-ZDR: required`**, NOT default.
    `zdr_supported: true` only means *available* — the adapter must actually SEND the
    header for the badge to be truthful. On a `zdr_supported: false` model the header
    is rejected with `model_zdr_not_supported`. Design: send the header for ZDR models;
    surface the 🔒 ZDR badge only when we both can and do request it.
  - Current catalogue (7): **ZDR ✅** GLM-5.1, Kimi-K2.6, Qwen3.5-397B-A17B ·
    **ZDR ❌** Qwen3.6-35B-A3B, deepseek-v4-flash, qwen3.7-max, deepseek-v4-pro.
    (GLM-5.1 / Kimi-K2.6 / deepseek-v4-flash+pro overlap our existing canonicals —
    new offerings on those; the Qwen models would be new canonicals if we curate them.)
- **OpenRouter** — integrate. Also the delivery route for Claude + ChatGPT (see
  below) per our provider-integration policy.

## New models to curate

- **Claude** (via **router only** — OpenRouter; policy reason below). Include
  **older variants too** — Chris will give the shortlist by community preference
  (he has them in his head). Don't enumerate yet; wait for his list.
- **ChatGPT** (via **router** — nano-gpt and OpenRouter): **5.5**, **4o**.
- **Mistral AI** — targeted integration of the *current* line only:
  **Small 4, Medium 3.5, Large 3**. Explicitly NOT the ~500 legacy models they
  leave lying around — their catalogue is chaotic; curate the three current ones.
- **Grok 4.3** via **xAI** — *lower priority*. Community is annoyed that 4.1
  (a real crowd-favourite) is nearly unavailable; weigh that before investing.

## Policy & technical constraints

- **Claude + ChatGPT go through a router, not direct.** Reason: our provider
  integration policy (the CORS/integration-policy surface). Direct OpenAI/Anthropic
  endpoints are out; nano-gpt / OpenRouter are the sanctioned paths.
- **Claude prompt-cache handling — ADOPT chatsune's breakpoint handling.** Decided
  with Liz 2026-05-31: "Anthropic handles it for us" is **false** for Claude.
  Anthropic caching is opt-in — without explicit `cache_control` breakpoints on the
  content blocks, nothing caches (unlike OpenAI, which auto-caches ~1024+ tokens).
  Via OpenRouter's OpenAI-compatible `/chat/completions`, `cache_control` is passed
  through for Anthropic models, but WE must set the breakpoints (on the large stable
  prefix: system prompt + persona + long history). So port chatsune's cache-breakpoint
  logic for Claude. For **ChatGPT (OpenAI)** caching is automatic — nothing to do.

## Carried over from today (2026-05-31)

- **GLM / Kimi reasoning-effort probe (chutes).** ✅ **RESOLVED 2026-06-01.**
  Probed `zai-org/GLM-5.1-TEE` and `moonshotai/Kimi-K2.6-TEE` across low/medium/high
  (`enable_thinking:true` + `reasoning_effort`, 2 samples each). Effort does **not**
  modulate the trace: GLM-5.1 reasoning tokens *decline* with higher effort
  (low ~6.3k → medium ~4.9k → high ~3.8k — noise/inverse); Kimi-K2.6 is flat
  (~4.0k / 4.1k / 3.7k). So **`toggle` is confirmed correct** for both — no change.
  Conclusion: chutes uniformly accepts `reasoning_effort` but does not granularly
  modulate, so every chutes offering is honestly a toggle, not steps.
  See [[2026-05-31-chutes-reasoning-on-switch]].

## Chris's parallel track (not Liz)

- Chris sets up the **provisional stop-gap CORS proxy** on his VPS — needed for
  **ollama-cloud** and later **xAI** integration. (Tracks with the deferred
  per-provider proxy work.)
