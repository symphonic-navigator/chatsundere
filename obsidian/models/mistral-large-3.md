# Model Curation Record — Mistral Large 3

> Curation record. See [[../providers/mistral]] for the shared Mistral mechanics
> (the usage-on-terminal-chunk quirk, CORS, slug conventions).

- **Identity:** Mistral Large 3 · family `mistral`
- **T/R/V:** tools ✅ · reasoning ❌ (none) · vision ✅ (image input; output text-only)
- **replayReasoning:** false
- **🔒 Privacy (first-party):** no TEE / no ZDR (EU jurisdiction). nano-gpt: no TEE / no ZDR.
- **🕊️ Freedom:** **pending Chris** — `freedomOriented` left for Chris;
  both deployments' `freedomOrientedDeployment` are `null`.

> **Note on `requiredCaps`:** Large 3 has **no reasoning**. If the
> `mistral-large-3` canonical declares `requiredCaps.reasoning: true`, the
> capability gate (`parseCatalogueEntry`) will REJECT a `{ mode: 'none' }`
> offering. This offering therefore assumes the canonical declares
> `requiredCaps.reasoning: false`. Flagged for Liz at integration — see the
> subagent report.

Curated on the first-party `mistral` API (hand-written `mistral-openai` adapter)
and on `nano-gpt` (the `nano-gpt-slug-swap` adapter). Both `confidence: 'verified'`.

## Offering — mistral (first-party)

- **slug:** `mistral-large-latest` · **adapterId:** `mistral:mistral-large-latest`
- **context:** recommended **131 072** / max **262 144** (conservative recommended; see provider record)
- **reasoning control:** **`none`** — Large 3 takes **no `reasoning_effort` param**
  and its content is always a plain string (verified: `reasoning-absent` PASS,
  content-only stream). The adapter never emits a reasoning param for a
  `none`-mode offering.
- **tool calls:** single-block, streaming. `generate_image` fired reliably.
- **usage:** on the terminal chunk; no reasoning-token breakdown.
- **Vision:** verified — names "green" on the Sylvir test image.

## Offering — nano-gpt

- **slug:** `mistralai/mistral-large-3-675b-instruct-2512` (**no `:thinking`
  sibling** on nano-gpt) · **adapterId:** `nano-gpt:mistralai/mistral-large-3-675b-instruct-2512`
- **context:** recommended/max **262 144**
- **reasoning control:** **`none`** — the bare slug streams content only even when
  prompted to think (probed live), and there is no `:thinking` sibling, so the
  slug-swap adapter simply never swaps. Consistent with the first-party Large 3.
- **🔒 Privacy:** no TEE / no ZDR.

## Validation (2026-05-31, conversation-suite, live)

- **first-party (`mistral`):** core **8/11** — reasoning-absent, tools, vision,
  usage **all PASS**; the **3 failures are the `memory-echo` turn** (HTTP 400
  message-ordering constraint, not an adapter bug — see [[../providers/mistral]]).
  Vision green.
- **nano-gpt:** core **11/11 green** (incl. memory-echo) + vision green.
