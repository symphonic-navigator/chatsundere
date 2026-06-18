# Changelog — Process & tooling

> Archived from `STATUS-CLIENT-ONLY.md` on 2026-06-18 (STATUS reorg).
> Reverse-chronological. Chapter index: [[README]].


## Session log

**Earlier 2026-06-08 — Laura — UX auditor landed**
(process/tooling; squashed onto master, **NOT pushed**). Codified read-only audit
subagent (`.claude/agents/laura.md`) — the **UX twin of Larissa** — brainstormed
end-to-end with Chris (spec → plan → inline build). Her rubric *is* her system
prompt (single source of truth, no drift): an **empowerment north star**
("does this feel like empowerment, or like nagging?" — the chat as a *readable
shared work*, read-only mode the canonical example), the five principles, two
product tenets (*everything at their fingertips*; *chat at the centre, ~95% of use
time*), and an objective **hard-defect checklist** (click-depth, visibility,
burial, reachability, dead-ends, misdirection). **Three modes:** spec-pass (early
= the main lever, catches "the wrong thing" for the price of a paragraph) /
pre-squash verify / holistic sweep at milestones. **Two-tier authority:** hard
usability defects **block the squash** like a Larissa critical (not deferrable
without Chris's sign-off); taste is advisory (Chris arbitrates). Gate discipline in
CLAUDE.md **§9 renamed "Audit Gates"** (9.1 Larissa, 9.2 Laura) + §1-roster and
§15-index entries; deferrals log `obsidian/insights/ux-deferrals.md`. **Design
language — round-1 brainstorm held 2026-06-08, then consciously parked by Chris**
(1-2 days to reflect; direction approved in spirit). First reference
`visuals/redesign-idea-1.png` (380 px Entrance-Hall: Instrument-Serif heading,
status pills, "Continue page" anchor, 2-col grid of eight neon-glow "My X" cards).
Capture + the four ranked tensions + the open push/pop-vs-expand-in-place fork in
[[insights/2026-06-08-design-language-brainstorm-1]]. **First real Laura run: the TTI
spec-pass.** Spec/plan:
[[../../../superpowers/specs/2026-06-08-laura-ux-auditor-design]],
[[../../../superpowers/plans/2026-06-08-laura-ux-auditor]]. **Next:** TTI feature — Laura
audits its spec before Liz builds; then the design-language session.
**Earlier 2026-06-08 — Subagent improvements landed**
(squashed onto master `146328e`, **NOT pushed**; **NOT yet device-verified**).
Three threads in one feature unit, brainstormed end-to-end with Chris, built
**subagent-driven** in an isolated worktree (13 tasks, per-task review + a final
**opus** holistic review = **no critical/important**; the load-bearing isolation
invariant re-verified intact). **(a) Author default reasoning:** the artefact-author
subagent now runs at its model's **chat-default** reasoning (was hard-disabled), with
a conditional output budget (16384 tokens when reasoning on, 8192 off) so reasoning
tokens don't truncate the HTML. **(b) Expert web access:** the `ask_expert` expert
uplink can now use **`web_search` / `web_fetch`** via a **bounded tool loop** (round
cap 8), with its own **independent settings** (`settings.expertWeb`, **Dexie v17**),
an **auto-default of exa + neural** when resolvable (degrades to single-shot when no
backend resolves or set to Off), and **visible web activity in the ExpertPill**
(`searching the web · <query>` / `reading · <host>` live; the executed searches/fetches
listed in the expanded pill). New **My Settings** section "Expert web access" (search/
fetch backend pickers + a depth picker, proxy-gated, the displayed effective backend
matches what actually runs via the exa-preference). **(c) Unification:** the identical
`AuthorBase`/`ExpertBase` descriptor merged into **`SubagentBase`**, and the
`web_search`/`web_fetch` tool builders extracted into a shared **`buildWebTools`** used
by both the chat integration and the expert; **no shared tool-loop engine by design**
(author = one-shot generator, expert = tool-loop agent — recorded as decision D5).
**Not a Larissa change** (client-only; no auth/sync/proxy/crypto). **New outbound
egress** (the expert's web queries) logged in [[insights/security-deferrals]] —
isolation preserved (web queries derive only from the sanitised standalone question;
`nsfwAllowed` from the persona, same as chat web). Full-tree capture verified
(`git diff branch..master` empty over the 33 touched files) + `pnpm typecheck --force`
**14/14** on master before worktree cleanup. Verification (on master after squash):
typecheck **14/14**; user-client vitest **1162 pass / 8 fail** (the unchanged
`cockpit-draft`/`chat-page`/`chat-route` localStorage-jsdom baseline, +16 new feature
tests all green); llm-unified `bun test` **283/0**; `pnpm run build` **9/9**; biome
clean (the lone `index.css` format drift is pre-existing on master, not ours). Spec/plan:
[[../../../superpowers/specs/2026-06-08-subagent-improvements-design]],
[[../../../superpowers/plans/2026-06-08-subagent-improvements]]. **Device test (spec §9):**
(1) reasoning-capable persona → ask for an artefact → the author reasons, the file is
complete; (2) with nano-gpt + a proxy + an expert model set, My Settings → "Expert web
access" shows **exa / Neural** as the auto default; (3) small-model persona + expert
chip on → ask a question needing current facts → the ExpertPill shows
`searching the web · "…"` (possibly several) then `thinking → answering`; expand the
finished pill → the standalone question, the executed searches, the expert answer, the
companion replies in its own voice; (4) set expert web Off → the expert answers from
its own knowledge, no web phases; (5) no proxy → the section shows the "needs a proxy"
notice; (6) the expanded pill's question carries no personal context from the chat.
**Next:** Chris device-tests → pushes the master backlog himself (Liz must NOT push).
**Earlier 2026-05-31 — Roadmap locked + UI-polish round +
Mistral & OpenRouter onboarded.** Six commits on master, not yet pushed (pushing
as one package). (1) **Roadmap to beta locked** — [ADR 0031](../../decisions/0031-eight-block-roadmap-to-beta.md)
+ [[ROADMAP]]; v0.1.0 is a local-only alpha at Block 2; "mainstream provider"
gate relaxed. (2) **UI-polish round, all device-verified by Chris:** copy-toast,
desktop-only Enter-to-send (Shift+Enter = newline), and My-Circle Continue/New-Chat
(`ab34528`); offering picker now renders deployments **inline under the chosen
model** + **coloured TEE/ZDR badges** with tooltips (`dfa469e`); PWA updates apply
**silently on next cold start** (banner removed — a mid-session reload would drop
the in-memory MK and force re-unlock) (`a1b9782`). (3) **#5 Regenerate rebuilt
non-destructively — DONE on branch `feature/regenerate-non-destructive`, awaiting
Chris's device test before squash to master.** `useRegenerate` now re-rolls only
the last persona answer in place and never touches the user message. The streaming
core was extracted into `stream-manager.runIntoDraft`, shared by `start` (fresh
send) and a new `stream-manager.regenerate` (clears the target persona row,
re-streams into it). On stream failure the target stays `incomplete` so the
existing `StreamInterruptedFooter` offers Retry; on abort mid-regenerate the
target is preserved (not deleted) via a `reusedDraft` flag on the handle.
Persona/secret resolution is now a shared `resolvePersonaContext` helper. The
chat-route regenerate test that was missing now exists and genuinely clicks the
button. Spec + plan under `superpowers/` (2026-05-31). 6 commits on the branch;
the 8 cockpit-draft/chat-page/chat-route localStorage-jsdom failures remain
pre-existing (verified identical on master).
(4) **Mistral + OpenRouter onboarded** (`e00de39` canonicals, `3bb3ebb` providers,
`d027e9a` doc): 3 Mistral flagship canonicals; **Mistral direct** (`mistral-openai`
adapter handles the polymorphic thinking-in-`delta.content`, reasoning toggle
high/none, usage on finish_reason; **CORS-direct, no proxy**) + **via nano-gpt**
(fully green 22/22 +vision); **OpenRouter** re-offers our 8-model canonical set
(MiMo excluded; all clean `toggle` incl. GLM-5.1/Kimi which are fixed-on elsewhere;
CORS-direct). Both freedom-oriented (Chris). Closed the **tensorix client-list gap**
(registered but never in settings); client provider list now matches all 8
built-ins. **Mistral via OpenRouter investigated + EXCLUDED** — proprietary
Mistral 404s under a privacy-oriented OR data-policy (which most of our users
run) + free-tier rate-limit; documented in `providers/openrouter.md`.
typecheck 13/13; llm-unified 204 Bun; user-client 518 (the 8 cockpit-draft/
chat-page/chat-route localStorage-jsdom failures remain pre-existing). **Next:**
Chris device-tests `feature/regenerate-non-destructive` (5 manual-verification
steps in the plan) → squash to master, then Block-1 memory (chatsune port).

## Done

- **Status-tracking split (2026-05-23)** — STATUS.md → STATUS-BACKEND.md;
  STATUS-CLIENT-ONLY.md established for the standalone-mode side; cross-
  refs set. CLAUDE.md §6/§15-layout/§16 updated to reference both split
  files (2026-06-01) — the old single-STATUS.md references are gone.
- **UX-CONCEPT.md landed (2026-05-23)** — full operating-concept brief
  by Chris + Lyra; serves as the North-Star concept document for the
  client-only work. Open Questions section flags Mindspace palette,
  textures, voice-pill treatment, et al.
- **First interactive wireframe (2026-05-23)** —
  `chatsundere-prototype.html`. Covers Reading Mode + Interaction Mode
  + Entrance Hall + Treasury. Visual ground truth for Phase 3.
- **Block 1 design spec (2026-05-23)** —
  `superpowers/specs/2026-05-23-client-block-1-design.md`. 16 captured
  decisions, 4-phase implementation plan, 15 acceptance criteria.
  Chris-approved.
- **Phase 1 implementation plan (2026-05-23)** —
  `superpowers/plans/2026-05-23-client-block-1-phase-1-backbone.md`.
  13 tasks, fully TDD-structured. Subagent-driven execution.
