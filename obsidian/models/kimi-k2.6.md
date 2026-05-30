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
- **reasoning control:** `reasoning_effort` steps; off = `reasoning_effort: "none"`.
- 🔒 **Privacy:** yes (chutes TEE)
- ⚠️ **Vision limitation:** chutes Kimi-K2.6-TEE returns **HTTP 400 when an image
  is sent together with `reasoning_effort`** (probed: image + `reasoning_effort`
  → 400; image + no effort field → 200). Since `chutesAdapter` always sends
  `reasoning_effort`, image turns on this offering currently fail. chutes **Gemma**
  does not have this problem. Tracked as a follow-up (omit `reasoning_effort` on
  image turns, or a Kimi-specific chutes path); text + tools + reasoning are fully
  verified.

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

## Validation (2026-05-30, conversation-suite)

- **Core scenario:** nano-gpt 44/44, novita 22/22 — all green (tools, reasoning
  on/off, usage, memory).
- **Vision scenario:** nano-gpt ✅ and novita ✅ describe the test image ("red").
  chutes ❌ — the `reasoning_effort` + image 400 above (a chutes-side quirk, not a
  Kimi capability gap). **Image-size lesson:** a 24x24 test image was mis-perceived
  by Kimi as "black"; at 128x128 it reports "red" correctly — the vision scenario
  now embeds a 128x128 image.
