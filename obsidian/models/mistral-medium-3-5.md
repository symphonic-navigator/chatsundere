# Model Curation Record — Mistral Medium 3.5

> Curation record. See [[../providers/mistral]] for the shared Mistral mechanics
> (the thinking-in-content quirk, the usage-on-terminal-chunk quirk, CORS).

- **Identity:** Mistral Medium 3.5 · family `mistral`
- **T/R/V:** tools ✅ · reasoning ✅ · vision ✅ (image input; output text-only)
- **replayReasoning:** false (soft-CoT)
- **🔒 Privacy (first-party):** no TEE / no ZDR (EU jurisdiction). nano-gpt: no TEE / no ZDR.
- **🕊️ Freedom:** **pending Chris** — `freedomOriented` left for Chris;
  both deployments' `freedomOrientedDeployment` are `null`.

Curated on the first-party `mistral` API (hand-written `mistral-openai` adapter)
and on `nano-gpt` (the `nano-gpt-slug-swap` adapter). Both `confidence: 'verified'`.

## Offering — mistral (first-party)

- **slug:** `mistral-medium-3-5` — **the literal slug, NOT `mistral-medium-latest`**
  (there is no `-latest` alias that resolves to 3.5; see [[../providers/mistral]]
  §Slug conventions, the medium caveat) · **adapterId:** `mistral:mistral-medium-3-5`
- **context:** recommended **131 072** / max **262 144** (conservative recommended; see provider record)
- **reasoning control:** **`toggle`** (`defaultOn: false`). Binary `reasoning_effort`
  `"high"`/`"none"`; `"none"` is a genuine off (`reasoning-absent` PASS). Thinking
  in the polymorphic `delta.content` array (the adapter's `foldDeltaContent`).
- **tool calls:** single-block, streaming, concurrent with reasoning. `generate_image` fired reliably.
- **usage:** on the terminal chunk; no reasoning-token breakdown.
- **Vision:** verified — names "green" on the Sylvir test image.

## Offering — nano-gpt

- **slug:** `mistral/mistral-medium-3.5` (note the **`mistral/` org prefix and the
  dotted `3.5`** — differs from Small 4's `mistralai/` and from the first-party
  hyphen form; `:thinking` sibling exists) · **adapterId:** `nano-gpt:mistral/mistral-medium-3.5`
- **context:** recommended/max **262 144**
- **reasoning control:** **`toggle`** (`defaultOn: false`) via slug swap
  (`:thinking`). Bare cleanly off; `:thinking` on the standard `reasoning` channel.
- **🔒 Privacy:** no TEE / no ZDR.

## Validation (2026-05-31, conversation-suite, live)

- **first-party (`mistral`):** core **16/22** — reasoning on/off (the polymorphic
  parser), tools, vision, usage **all PASS**; the **6 failures are the
  `memory-echo` turn** (HTTP 400 message-ordering constraint, not an adapter bug —
  see [[../providers/mistral]]). Vision green.
- **nano-gpt:** core **22/22 green** (incl. memory-echo) + vision green.
