# Spec — CLAUDE.md Design for Chatsundere

**Date:** 2026-05-18
**Status:** Draft, awaiting Chris's review
**Author:** Liz (with Chris brainstorming)
**Topic:** Initial `CLAUDE.md` and companion artefacts at the root of `chatsundere/`

---

## Goal

Establish a `CLAUDE.md` that future Liz-sessions (and any other Claude instance dropped into this repo) can load and immediately know:

- what Chatsundere is and what's load-bearing,
- which rules are non-negotiable,
- how the team works (Liz / Lyra / Larissa / Ann / Chris),
- where to look for deeper detail (progressive discovery).

The file is the *always-loaded* context. Anything that isn't always needed lives behind a pointer.

## Non-Goals

- **Not a duplicate of the Phase 0 briefs.** Stack details, endpoint shapes, data models stay in `obsidian/briefs/`.
- **Not a complete Chatsune lessons archive.** Only the 12-15 lessons that change behaviour go in; the rest stays in `../chatsune/` as read-only reference.
- **Not a deployment manual.** That lives in a future `docs/DEPLOYMENT.md`.

## Approach (decided by Chris)

> "Progressive discovery aus der Bibel" — short top-level rules + pointers, deep content loaded only when relevant.

Length budget: ~250–350 lines. Tone: prescriptive but human. British English (per Chris's global preferences).

## Structure

| # | Section | Purpose | Approx. lines |
|---|---|---|---|
| 1 | Identity & Team | Who Liz/Lyra/Larissa/Ann/Chris are and what each owns | 12 |
| 2 | Mission | One paragraph: what Chatsundere is and the trust posture | 8 |
| 3 | Hard Rules | E2EE, zero-knowledge backend, OPAQUE, AGPLv3 stance | 20 |
| 4 | Tech Stack at a Glance | Compact table only; reasoning lives in briefs | 25 |
| 5 | Monorepo Layout | Tree of `apps/`, `packages/`, `infra/`, `docs/`, `superpowers/`, `obsidian/` | 25 |
| 6 | Directory Conventions | Which directory is for what — and what is *not* for | 25 |
| 7 | Language & Communication | German chat, British English in code/docs/commits | 10 |
| 8 | Git Workflow | Pre-public on master; one squashed commit per feature unit; free-form imperative | 25 |
| 9 | Larissa Security Gate | When to summon, what she checks, deferrals doc, Liz's responsibility | 25 |
| 10 | Quality Bar | Strict TS, no `any` without comment, JSDoc on package-public, test coverage for security paths | 20 |
| 11 | UX Principles | Don't make me think, least astonishment, omakase, disabled-over-hidden, single uniform flows | 20 |
| 12 | Versioning & Releases | Trigger: 2-3 upstreams chattable → public + v0.x.x; SemVer with planned automation | 15 |
| 13 | Lessons from Chatsune | Dense ~12 bullets — the war stories that shape behaviour | 30 |
| 14 | What NOT to Do | Restrained list: things specifically out of scope or banned | 15 |
| 15 | Pointers | The progressive-discovery index | 25 |

Total estimate: ~280 lines. Fits the budget.

### Section Notes

**§ 3 Hard Rules.** Should include: zero-knowledge backend; OPAQUE for passphrase, Passkey+PRF first-class; no plaintext keys/passphrases over the wire ever; AGPLv3 for `apps/*`; Prometheus from day one; mobile-first lg-breakpoint UI; **every text artefact in the repo (code, comments, commits, docs, specs, ADRs, briefs, log strings, error messages) is British English — German is the chat-only surface, no exceptions.** This is called out as a Hard Rule (not just a §7 communication note) because Chatsune drift on this point was costly to clean up.

**§ 6 Directory Conventions.** Critical to document the three-way split that diverges from defaults:
- `docs/` — GitHub Pages, public-facing documentation (architecture, deployment, release process). Audience: external operators and contributors.
- `superpowers/specs/` and `superpowers/plans/` — internal design specs and implementation plans (this file's home). Audience: Liz/Chris during build.
- `obsidian/briefs/` — Lyra/Chris design briefs. `obsidian/decisions/` — ADRs. `obsidian/insights/` — Liz's running journal of project-shaping observations (including Larissa security deferrals).

**§ 8 Git Workflow.** Pre-public phase: work on `master`, but still *squash chunks* before pushing. One commit per scope-unit (per `feedback_squash_granularity` memory). Free-form imperative messages, no Conventional Commits prefix.

**§ 9 Larissa Security Gate.** Trigger: my (Liz's) judgement call before squashing changes that touch `apps/auth-service`, `apps/sync-service`, `apps/proxy-service`, or `packages/crypto`. Frontend-only work skips. Iteration: Larissa → I fix → re-run → squash when clean. Findings I deliberately defer: logged in `obsidian/insights/security-deferrals.md` with rationale. Pure discipline — no git hook fallback.

**§ 13 Lessons from Chatsune.** Pulled from the 52 chatsune memories. Candidates (subject to Chris's edit):
- Empirical truth over docs — probe behaviour, trust data over published specs.
- Quality 10 over 100 — depth, not feature count.
- Omakase over options — opinionated defaults, not toggles.
- Single uniform flows — owner uses the same primitives as users; no implicit shortcuts.
- Disabled over hidden — show capabilities even when unavailable, with tooltip.
- Don't make me think + Principle of Least Astonishment — UX north star.
- Defaults over delete — emit `updated` events on conceptual delete, no `deleted` event.
- No D&D in user-facing UI — replaced by context menus, buttons, auto-sort.
- Inline-marker aesthetic — small monospace pills, subtle, present but non-intrusive.
- Organic variation in effects — randomise per-element; no uniform motion.
- Simplify after 2-3 failed fixes — write a spec, rewrite; don't patch further.
- Flag wish-driven decisions — when I sense Chris is wish-thinking, surface it.
- Manual verification sections in every spec — Chris values device-tested checklists.
- Subagents never merge/push/branch-switch — forbid in subagent prompts.

(Cut to ~12 in the final file; some merge.)

**§ 14 What NOT to Do.** Restrained per Chris's steer. Initial set:
- No MongoDB (we chose PostgreSQL for deployment simplicity).
- No drag-and-drop in user-facing UI.
- No parallel chats per user.
- No OAuth federation.
- No `email` or `phone` field on `users`.
- No password complexity rules at the server (OPAQUE doesn't see the password).
- No "forgot password" — recovery key is the only path.
- No localStorage for tokens.

**§ 15 Pointers.** Table form, two columns: "When working on…" → "Load".

## Companion Artefacts (created alongside CLAUDE.md)

1. `obsidian/decisions/README.md` — ADR convention and index.
2. Initial ADR set (one file each, ~30-50 lines):
   - `0001-postgres-over-mongodb.md`
   - `0002-agplv3-for-apps.md`
   - `0003-squash-per-feature.md`
   - `0004-bootstrap-cli-not-env.md`
   - `0005-require-prf-for-passkey-mk-wrapping.md`
   - `0006-exactly-one-primary-admin.md`
   - `0007-recovery-key-required-at-registration.md`
3. `obsidian/insights/README.md` — what goes here (Liz's running journal incl. security deferrals).
4. `obsidian/insights/security-deferrals.md` — initialised empty with header explaining format.

## Implementation Order

1. Create `obsidian/decisions/` and `obsidian/insights/` directories with `README.md` files.
2. Write the 7 initial ADRs.
3. Write `CLAUDE.md` at repo root, referencing the ADRs and briefs by path.
4. Single commit: `Add CLAUDE.md, decisions/ADRs and insights skeleton`.

## Open Questions

1. **Lyra brief-hygiene checklist.** Should this live as a short doc at `obsidian/briefs/README.md` (so Lyra reads it before producing the next brief), or stay in my memory only? *Liz's recommendation:* Put it in `obsidian/briefs/README.md` so it's portable to Lyra's web context.
2. **Versioning automation hints.** Chris mentioned "noch nicht ganz reife Ideen" for automated versioning. Should §12 just say "manual SemVer + release notes from v0.1.0 onwards, automation TBD" or wait for Chris's ideas? *Liz's recommendation:* Manual now, ADR later when ideas firm up.
3. **ADR numbering.** Sequential (`0001-…`) or topic-prefixed (`auth-0001-…`)? *Liz's recommendation:* Sequential and global, like the chatsune INSIGHTS log.

## Acceptance

This spec is acceptable when Chris has:

- agreed the section list and length budget,
- approved the initial ADR set,
- answered (or deferred) the three open questions above.
