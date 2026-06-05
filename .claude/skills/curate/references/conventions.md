# Conventions — Records, ADRs, ownership, git, verification

Shared rules for every curation mode. Read alongside
[`catalogue-model.md`](catalogue-model.md).

## Curation Records (a documentation genre)

Records are prose documentation, distinct from ADRs. They are the project's
honesty surface — they feed public docs and release notes — so they carry not
just *what* but *why*.

- **Model Curation Record** → `obsidian/models/<id>.md`. Contains: identity
  (`family`, the T/R/V `requiredCaps`); per offering its trade-offs (provider,
  tool-call streaming, `ReasoningControl` mode, context recommended vs max); the
  🔒 Privacy and 🕊️ Freedom badges with the freedom note; **and the WHY** — why
  this freedom/trust judgement, which adapter quirk was needed, which probe
  evidence supports it. Note `recommended ≠ max` explicitly where they differ.
- **Provider Curation Record** → `obsidian/providers/<id>.md`. Contains: base
  characteristics (ZDR / TEE / DSGVO / jurisdiction), slug conventions, the
  `usage` reporting quirk, key and documentation references, and the reasoning
  behind the onboarding choices.

The badge emojis (🔒 / 🕊️) are product content and are permitted in these
Markdown records. No emojis anywhere in code.

## The ADR boundary

Numbered ADRs in `obsidian/decisions/` are reserved for genuine cross-cutting
decisions (e.g. "introduce a lineage axis", "retire the synthesis pipeline").
Per-model and per-provider Records are **not** ADRs — they would bloat and dilute
the sequential ADR namespace. Records and ADRs cross-link; a Record may cite an
ADR for the rule it follows, and an ADR may cite Records as evidence.

## Ownership split

Curation is collaborative. The **human owns the freedom/trust judgement** —
`freedomOriented`, `freedomOrientedDeployment`, `trust`, and the freedom note.
The **agent owns the measured/authored parts** — the probe findings, the adapter
`.ts`, the `ModelProfile`, the conversation-suite run. You write the Record
together. The rigid "machine-only writes the lower block" split of the old design
is relaxed, but **`parseCatalogueEntry` (Valibot) remains the gate** — nothing
lands that it rejects.

## British English

Every artefact you write is British English: `colour`, `behaviour`,
`initialise`, `licence` (noun), `authorise`, `jurisdiction`. No mixed-language
strings. The live chat with Chris is the only German surface.

## Git and worktree rules (CLAUDE.md §8)

- **Subagents never merge, push, or switch branches.** The orchestrator (Liz)
  handles all git — this is absolute, especially in mode 4 fan-out.
- **Squash per feature unit** — one squashed commit per curation unit (e.g.
  "Onboard chutes provider", "Curate GLM-6"), not finer, not coarser.
- **`[skip ci]`** on the subject line for doc-only commits (Records, ADRs,
  Markdown — no code change). Mixed text-plus-code commits do not get the tag.

## Verification is local-only

Provider keys live under `keys/`, one file per provider, convention
`keys/.{provider}-test-key` (e.g. `keys/.chutes-test-key`, `keys/.nano-test-key`).
They **never** enter CI. The conversation-suite and any live probe run
deliberately and locally; no test that hits a live provider runs in GitHub
Actions. Unit tests against code (catalogue schema, scanner logic, `model-file`
read/write, pure adapter helpers) stay in CI and need no keys.
