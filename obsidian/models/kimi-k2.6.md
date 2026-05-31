# Model Curation Record — Kimi K2.6

> Curation record. See [[../providers/chutes]] for the shared chutes mechanics.

- **Identity:** Kimi K2.6 · family `kimi`
- **T/R/V:** tools ✅ · reasoning ✅ · vision ✅ (input image; output text-only)
- **replayReasoning:** false (soft-CoT)
- **🕊️ Freedom:** free — `freedomOriented: true` (Chris, 2026-05-30: Moonshot
  open-weight) and every deployment below is `freedomOrientedDeployment: true`.

Offered on chutes, nano-gpt and novita, each with a hand-written catalogue adapter
(`confidence: 'verified'`). **QAT model** — quantisation-aware training (Chris is a
fan; quantised weights behave close to full precision). Output is text-only; vision
is input-side.

## Offering — chutes

- **slug:** `moonshotai/Kimi-K2.6-TEE` · **adapterId:** `chutes:moonshotai/Kimi-K2.6-TEE`
- **context:** recommended/max 262 144 (the widest curated)
- **reasoning control:** `reasoning_effort` (low/medium/high) to enable; **off =
  `chat_template_kwargs: { enable_thinking: false }`**. Kimi-K2.6-TEE is the
  reason the chutes off switch is NOT `reasoning_effort: 'none'`: that value 400s
  on this model (and harder still with an image). See [[../providers/chutes]].
- 🔒 **Privacy:** yes (chutes TEE)
- **Vision:** verified — image input describes the test image correctly once the
  off switch moved to `chat_template_kwargs` (the earlier `reasoning_effort: 'none'`
  + image 400 is resolved).

## Offering — nano-gpt

- **slug:** `moonshotai/kimi-k2.6` · **adapterId:** `nano-gpt:moonshotai/kimi-k2.6`
- **context:** recommended/max 256 000
- **reasoning control:** model-slug swap (`steps`, `offStep: 'off'`); bare cleanly
  off, `:thinking` + `reasoning_effort` on the `reasoning` channel.
- 🔒 no TEE / no ZDR.

## Offering — novita

- **slug:** `moonshotai/kimi-k2.6` · **adapterId:** `novita:moonshotai/kimi-k2.6`
- **context:** recommended/max 256 000
- **reasoning control:** `enable_thinking` boolean (`toggle`); off via
  `enable_thinking: false`. `reasoning_content` channel. 🔒 no TEE / no ZDR.

## Offering — wafer

- **slug:** `Kimi-K2.6` · **adapterId:** `wafer:Kimi-K2.6`
- **context:** recommended/max 262 144
- **reasoning control:** **`fixed-on`** (the "off only hides" case). On the
  adapter path Kimi cannot be silenced: the live conversation-suite
  (`makeLiveBinding` → `waferAdapter`, the same path the product uses) emits a
  reasoning trace on **every** reasoning-off run despite `reasoning_effort: 'none'`
  — 2/2 suite runs failed `reasoning-absent`. (Curiously, hand `curl` probes with
  the identical body were silent ~7/8; the discrepancy is unexplained, but the
  end-to-end suite is the **authoritative gate**, so we model what it reproduces.)
  No reliable off exists on wafer — `enable_thinking:false` is a no-op (Kimi
  reasons by default when no `reasoning_effort` is given). Modelled `fixed-on`
  rather than a toggle that would falsely promise an off. `reasoning_content`
  channel. **Follow-up:** revisit if wafer ships a hard off-switch.
- **tool calls:** streaming, concurrent with reasoning.
- **usage:** OpenAI-standard — `reasoning_tokens` under `completion_tokens_details`,
  cached under `prompt_tokens_details`.
- 🔒 **Privacy:** **ZDR** — adapter sends `Wafer-ZDR: required` (always on). No TEE.
  See [[../providers/wafer]].
- **Vision:** verified (suite `vision` green — describes the test image as "red").

## Validation (2026-05-30, conversation-suite)

- **Core scenario:** nano-gpt 44/44, novita 22/22, chutes 44/44 — all green
  (tools, reasoning on/off, usage, memory). chutes off now uses
  `chat_template_kwargs`, which fixed the previously-broken reasoning-off.
- **Vision scenario:** nano-gpt ✅, novita ✅ and chutes ✅ describe the test image
  ("red"). **Image-size lesson:** a 24x24 test image was mis-perceived by Kimi as
  "black"; at 128x128 it reports "red" correctly — the vision scenario now embeds
  a 128x128 image.
- **wafer (2026-05-31):** vision 4/4 green; core tools / memory / reasoning-on /
  usage all green. Reasoning-off is **not** offered (`fixed-on`) because the
  adapter path cannot suppress it — see the wafer offering above.
