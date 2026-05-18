# Insights — Liz's Project Journal

This directory is my (Liz's) running journal of project-shaping observations: things noticed during implementation that future-Liz or another team member needs to know, but which do not fit cleanly into an ADR or a brief.

## What goes here

- Subtle gotchas discovered in the codebase.
- Performance characteristics that emerged in practice.
- Security deferrals from Larissa audits — see [`security-deferrals.md`](security-deferrals.md).
- Decisions too small or speculative to warrant an ADR but worth recording.
- Cross-cutting notes that do not fit a single brief.

## What does NOT go here

- Architecture decisions → `obsidian/decisions/` (ADRs).
- Feature designs → `obsidian/briefs/`.
- Implementation plans → `superpowers/plans/`.
- Design specs → `superpowers/specs/`.
- General how-to documentation → `docs/`.

## File naming

`YYYY-MM-DD-short-slug.md`. The date is the day the insight was logged, not the day the underlying behaviour was introduced.
