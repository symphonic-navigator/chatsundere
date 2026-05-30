# Next batch — providers & models to add (planned 2026-05-31, for 2026-06-01)

Chris's list for tomorrow's curation session. Captured before sleep; we curate
these together. Order roughly by priority / dependency.

## New providers to integrate

- **wafer.ai** — integrate. Headline feature to surface prominently:
  **"Wafer-ZDR: required"** as a standout capability (a particularly strong
  privacy/trust signal — model it as a first-class badge-worthy property, akin to
  the chutes TEE story). Confirm the exact ZDR semantics with their docs/contact
  before asserting it on the trust surface.
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

- **GLM / Kimi reasoning-effort probe (chutes).** We modelled chutes reasoning as a
  `toggle` because effort does not modulate the trace for DeepSeek-V3.2 / Gemma; GLM
  and Kimi were not probed for effort modulation. If they DO modulate, consider
  whether `steps` is more honest for those two specifically. ~2-minute live probe.
  See [[2026-05-31-chutes-reasoning-on-switch]].

## Chris's parallel track (not Liz)

- Chris sets up the **provisional stop-gap CORS proxy** on his VPS — needed for
  **ollama-cloud** and later **xAI** integration. (Tracks with the deferred
  per-provider proxy work.)
