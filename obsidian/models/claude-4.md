# Model Curation Record — Claude 4 family (Haiku/Sonnet/Opus)

> Curation record for all seven curated Claude models. They share identical
> mechanics on nano-gpt, so one record with a per-model slug table beats seven
> near-duplicate files. See [[../providers/nano-gpt]] for the shared mechanics
> and [[../decisions/0032-premium-censored-models-via-routers]] for the policy.

- **Family:** `claude` · **Provider:** nano-gpt only (ADR 0032 — OpenRouter is
  excluded for Anthropic; its limited-keys path routes to Bedrock, no caching).
- **T/R/V:** tools ✅ · reasoning ✅ · vision ✅ (all seven).
- **replayReasoning:** false — extended-thinking signature replay is deferred
  build-when-needed (no live tool-loop consumer yet; spec §5.2). Plain chat does
  not require replay.
- **🚫 CENSORED:** `canonical.freedomOriented: false` (Anthropic aligns/censors
  at source) × nano-gpt `freedomOrientedDeployment: true` (routes verbatim) →
  `effectiveFreedom = 'restricted'` → loud CENSORED badge in the picker.
- **🔒 Privacy:** no TEE / no ZDR (bare nano-gpt deployment).

## Shared mechanics (all seven)

- **adapter:** `claudeAdapter` (wraps `nanoGptSlugSwapAdapter` + Anthropic
  `cache_control` injection). adapterId `nano-gpt:<base-slug>`.
- **reasoning control:** **toggle** (`defaultOn: true`). Slug swap: base = off
  (`reasoning-absent`), the thinking sibling = on (`reasoning-present`). Effort
  does **not** modulate the trace (live-probed 2026-06-01 — flat across the
  family), so a toggle, not steps. Thinking streams on the `reasoning` channel.
- **prompt caching:** Anthropic caching is opt-in; the adapter injects
  breakpoints (stable prefix 1h + token-anchored history anchor 1h + rolling
  tail 5m). nano-gpt passes `cache_control` through. Verified: the prefix is
  read back next turn (`cache_read ≈ full prefix`).
- **context:** recommended 200 000; max 200 000 (Haiku 4.5, Opus 4.5) or
  1 000 000 (Sonnet 4.6, Opus 4.6/4.7/4.8) per Anthropic's window.

## Per-model slugs

| Canonical | base slug (off) | thinking slug (on) | max ctx |
|---|---|---|---|
| `claude-haiku-4.5` | `claude-haiku-4-5-20251001` | `claude-haiku-4-5-20251001-thinking` | 200k |
| `claude-sonnet-4.5` | `claude-sonnet-4-5-20250929` | `claude-sonnet-4-5-20250929-thinking` | 200k |
| `claude-sonnet-4.6` | `anthropic/claude-sonnet-4.6` | `anthropic/claude-sonnet-4.6:thinking` | 1M |
| `claude-opus-4.5` | `claude-opus-4-5-20251101` | `claude-opus-4-5-20251101:thinking` | 200k |
| `claude-opus-4.6` | `anthropic/claude-opus-4.6` | `anthropic/claude-opus-4.6:thinking` | 1M |
| `claude-opus-4.7` | `anthropic/claude-opus-4.7` | `anthropic/claude-opus-4.7:thinking` | 1M |
| `claude-opus-4.8` | `anthropic/claude-opus-4.8` | `anthropic/claude-opus-4.8:thinking` | 1M |

The suffix is inconsistent (`-thinking` for the dated Haiku/Sonnet 4.5,
`:thinking` for the rest) — the adapter carries each thinking slug explicitly.

## Validation (2026-06-01, `run-claude-suite.ts`, nano-gpt)

All seven: core conversation-suite **22/22** (reasoning off + on, tool call +
valid JSON args, multi-turn memory carried, usage normalised) and **cache
ENGAGED** (turn-2 `cached` ≈ full prefix). Notably Opus 4.8 — which failed and
did not cache on OpenRouter (Bedrock routing) — is fully green here.

## Notes

OpenRouter Claude offerings were built first, then moved here when the
limited-keys/Bedrock reality surfaced (ADR 0032). The cache-breakpoint module,
canonicals, and CENSORED derivation are route-agnostic and were reused unchanged.
