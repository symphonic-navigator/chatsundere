# Model Curation Record — Kimi K2.6 (TEE)

> Curation record. See [[../providers/chutes]] for the shared provider mechanics.

- **Identity:** Kimi K2.6 · family `kimi`
- **T/R/V:** tools ✅ · reasoning ✅ (optional, effort buckets) · vision ✅ (input text + image + video)
- **replayReasoning:** false (soft-CoT)

## Offering — chutes

- **slug:** `moonshotai/Kimi-K2.6-TEE` · **adapterId:** `chutes:moonshotai/Kimi-K2.6-TEE`
- **context:** recommended/max 262 144 (the widest of the four)
- **reasoning control:** `reasoning_effort` (low/medium/high), off = omit
- 🔒 **Privacy:** yes (chutes TEE)
- 🕊️ **Freedom:** pending live judgement

## Notes

- **QAT model** — quantisation-aware training (Chris is a fan of QAT; more
  providers should do it). Output is text-only; vision is input-side.
- Live validation should exercise the wide context and a tool turn; record the
  `generate_image` tool-fire result and whether `reasoning_content` surfaces.

## Why

A QAT model in TEE with a 256k-class context — a strong, distinctive privacy-first
offering. QAT means the quantised weights behave close to full precision, which is
exactly the quality-per-byte trade chatsundere wants to surface.
