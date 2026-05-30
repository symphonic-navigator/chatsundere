---
name: curate
description: Curate Chatsundere model & provider support — onboard a provider, integrate/curate a model, or verify & repair a misbehaving offering. Use when adding a provider or model, or when a specific model behaves wrongly on a provider (e.g. a tool call failing, reasoning not surfacing, broken streaming).
---

# /curate — Chatsundere model & provider curation

This skill makes Claude the interactive adapter author. The catalogue
(`CanonicalModel`s, per-provider `Offering`s, and the hand-written adapter `.ts`
siblings) is produced by us at maintain-time, not at the user's runtime. The
earlier machine-synthesis loop — a weak analyser model babysat by fixture replay
— is retired; byte-level fixture replay could go green while a model was
functionally broken (the MiMo-V2.5-via-chutes `generate_image` HTTP 400 case).
Real correctness needs end-to-end behavioural validation, which an interactive
agent drives and diagnoses. You are that author now: probe live, write the
adapter by hand, and prove it against the conversation-suite.

## Read first, every mode

Before routing, load both shared references — they ground every playbook:

- [`references/catalogue-model.md`](references/catalogue-model.md) — the
  catalogue data model from a curator's view (`CanonicalModel` → `Offering` →
  `ModelProfile`, the `parseCatalogueEntry` gate, the freedom logic).
- [`references/conventions.md`](references/conventions.md) — Curation Records vs
  ADRs, the ownership split, British-English and git/worktree rules,
  local-only verification.

## Intent router

Match what the maintainer (usually Chris) said to exactly one playbook, then
load it. One playbook per task keeps context lean.

| What the user said | Mode | Load |
|---|---|---|
| "onboard chutes" / "add a provider" / "let's integrate <provider>" | 1 | [`references/provider-onboarding.md`](references/provider-onboarding.md) |
| "curate GLM-6" / "integrate <model>" / "add a model" | 2 | [`references/model-curation.md`](references/model-curation.md) |
| "<model> on <provider> seems broken" / "users complain about X on Y" / "verify X" / "a tool call is failing / reasoning isn't surfacing / streaming is broken" | 3 | [`references/verify-offering.md`](references/verify-offering.md) |
| "check these 8 models" / "batch-check this sub-selection" | 4 | [`references/batch-check.md`](references/batch-check.md) |

Mode 2 and mode 3 both run the deterministic conversation-suite; its mechanics
live in [`references/conversation-suite.md`](references/conversation-suite.md),
which those playbooks point into.

## Hard constraints (always)

- **British English** in every artefact you write — code, comments, YAML,
  records, log strings. The live chat with Chris is the only German surface.
- **Never commit anything that would alarm a security reviewer.** When in doubt,
  pause and raise it.
- **Subagents never merge, push, or switch branches.** The orchestrator (Liz)
  owns all git. This applies to mode 4 fan-out especially.
- **Verification is local-only.** Provider keys live under `keys/`
  (e.g. `keys/.chutes-test-key`) and never enter CI. No test that hits a live
  provider runs in GitHub Actions.
