# Reasoning visibility is per-deployment — and chutes hides nothing (2026-05-30)

Teed up for a fresh context. Started from "chutes hides reasoning on some models /
we read the wrong channel" — **both premises turned out false.** What's actually
going on, and the rule Chris set.

## The rule (Chris, 2026-05-30)

**Reasoning in `content` counts as reasoning ONLY if it is explicitly delimited by
`<think>` / `<thinking>` tags.** Undelimited prose in `content` (e.g. an answer
with a "Reasoning:" paragraph) is just answer prose — NOT reasoning. We never
extract/guess reasoning out of bare prose. This aligns with "validate the pipe,
never the intelligence": we surface a reasoning *channel*, we don't infer one.

## Empirical reasoning-visibility map (probed live, effort:high, hard prompt)

| Offering | Reasoning visibility |
|---|---|
| chutes GLM-5 / GLM-5.1 | `reasoning_content` channel ✅ |
| chutes Kimi-K2.6 | `reasoning_content` channel ✅ |
| chutes DeepSeek-V3.2 | `reasoning_content` channel ✅ — but **adaptive**: skips visible CoT on *trivial* prompts (318 reasoning_content deltas on the bat-and-ball prompt; 0 on "say a greeting") |
| chutes Gemma-4-31B-turbo | **none** — 0 `reasoning_content`; the "reasoning" is undelimited prose in `content`. `reasoning_tokens: 0`. No `<think>` tags. → by the rule, NOT reasoning |
| nano-gpt Gemma (`:thinking`) | `reasoning` channel ✅ (different deployment, real channel) |
| novita Gemma (`enable_thinking`) | `reasoning_content` channel ✅ |

So reasoning visibility is a **per-offering** property, not a per-canonical one.
The same Gemma-4-31B canonical has channel reasoning on nano-gpt/novita but none
on chutes-turbo-TEE.

## Why the suite's `reasoning-present` goes red for these two

`coreScenario` turn 0 is "Reply with a one-sentence greeting" — trivial. The
reasoning-permutation assertions (`assertReasoningPresent`) run on that turn.
- **DeepSeek-V3.2 (chutes):** adaptive → no visible CoT on a greeting → red, even
  though the channel works fine on substantive prompts. **The probe prompt is the
  problem, not the model/adapter.**
- **Gemma (chutes):** no channel at all → red, correctly (there is no reasoning to
  surface).

## Plan for the new context

1. **Suite fix (DeepSeek + robustness):** change the reasoning-present probe to a
   prompt that *requires* reasoning (so any genuine channel-reasoning model shows
   it). Likely a dedicated reasoning turn rather than the trivial greeting. Then
   re-validate across the catalogue (full live re-run — provider keys, local only).
2. **chutes Gemma modelling (the real decision):** it has no channel reasoning, so
   its offering should not claim visible reasoning. BUT the canonical
   `gemma-4-31b` has `requiredCaps.reasoning: true` (true for nano-gpt/novita), and
   `parseCatalogueEntry` forbids an offering with `reasoning.mode === 'none'` for a
   reasoning-required canonical. So this needs a deliberate call on the capability
   model — options to weigh: a per-offering "reasoning not channel-visible" state,
   relaxing the gate for this case, or reconsidering the chutes Gemma offering.
   Do NOT extract prose (Chris's rule above).
3. Optionally: an adapter rule that, IF a model emits `<think>…</think>` in
   `content`, routes that to the reasoning channel — but only tag-delimited, and
   only if we meet a model that needs it (YAGNI until then).

## Current committed state

The chutes off-switch fix (`chat_template_kwargs.enable_thinking:false`) is in
(`79e92ab`). The reasoning-present reds for chutes DeepSeek-V3.2 + Gemma are
**documented, not yet fixed** — they live in those two model records and
`providers/chutes.md` as the open follow-up this note expands.
