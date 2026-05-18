# Briefs — Hygiene Checklist for Lyra

These briefs are produced by Lyra (Claude on the web) in conversation with Chris, then dropped here for Liz to read and implement against.

Before a new brief lands, Lyra: please run the checklist below. It prevents the kind of drift that costs iteration time downstream.

## Pre-publish Checklist

- [ ] **Diff against `~/.claude/CLAUDE.md`** (Chris's global preferences). If something deviates (licence, commit style, language convention, tooling), mark the deviation explicitly: "this deviates from the default because…". Do not silently override.
- [ ] **Diff against prior briefs in `obsidian/briefs/`**. Conflicts? Reconcile or call them out.
- [ ] **Open vs Decided.** Use `[DECIDED]`, `[OPEN]`, `[DEFERRED]` tags directly on bullets. Do not list "Open Questions" that are already answered in line (e.g. "Chris's call: yes").
- [ ] **British English throughout.** No mixed-language strings.
- [ ] **Reference relevant ADRs** in `obsidian/decisions/` when the brief consumes or contradicts a prior decision.
- [ ] **Date and addressee block** at the top: `Date`, `For: Liz`, `From: Lyra (architecture) + Chris (vision)`.

## Layout

- `briefs/phase 0/` — initial project bootstrap (project-setup, auth-service, crypto).
- `briefs/phase 1/` — sync service.
- `briefs/phase 2/` — proxy service and `packages/llm-unified`.
- `briefs/<feature>/` — feature-scoped briefs as they appear.

## How Liz reads briefs

End-to-end before implementing. If something is unclear or in tension with another brief / an ADR / a memory, Liz raises it with Chris (the arbiter) rather than silently guessing.
