# Chatsundere Status — Client-only

**Last updated:** 2026-05-23 — Block 1 brainstorm complete; design spec
landed at [`superpowers/specs/2026-05-23-client-block-1-design.md`](../superpowers/specs/2026-05-23-client-block-1-design.md).
Chris-approved (incl. Decision 16 auto-close-trigger restoration). Phase 1
(Backbone) starts immediately; Phases 2–4 gated on remaining Lyra
wireframes. `UX-CONCEPT.md` and the first interactive wireframe
(`chatsundere-prototype.html`) committed alongside as canonical
North-Star documents.

This file tracks **client-only / standalone-mode work** — everything
the user-client can do without talking to a server. The goal is that
Chatsundere is an excellent experience even in pure-local mode; sync,
homelab, and sidecar live on the server side and are tracked in
[[STATUS-BACKEND]]. Read both files at the start of every session;
update the relevant one at the end.

---

## Scope

### In scope here

- Local chat experience (UI, message rendering, session shape)
- LLM provider integration as far as the client owns it (model
  selection, prompt routing, per-provider auth)
- Local storage of chat sessions / conversation context
- User-facing UX patterns (pill handling, expressive feedback,
  organic variation, omakase defaults)
- Data model for future tool support (stored only, no execution)
- Neurodivergent-accessibility behaviour and review surfaces

### Deliberately out of scope (deferred)

- Tools execution (data model lives here; no execution surface)
- Knowledge bases / libraries
- Integrations (homelab, sidecar)
- Voice (Block 4 — Chris's expressive-voice concept lands later)
- Cloud sync ([[STATUS-BACKEND]] territory)

---

## Done

- **Status-tracking split (2026-05-23)** — STATUS.md → STATUS-BACKEND.md;
  STATUS-CLIENT-ONLY.md established for the standalone-mode side; cross-
  refs set; CLAUDE.md §6/§16 still reference the old single STATUS.md
  and need an update on a later doc-touch commit.
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
  Chris-approved; ready for `writing-plans` invocation on Phase 1.

## Briefed, awaiting implementation

- **Phase 1 — Backbone** (wireframe-independent, immediate start):
  Dexie schema (settings / providers / personas / mindspaces / chats /
  messages / pills), `packages/llm-unified` registry + openai-chat-
  completions adapter + transport (direct vs. cors-proxy) + streaming
  + composition, MasterKey-based secret encryption, onboarding gating
  on the 4-cell intent matrix (local-only enabled, three other paths
  disabled with tooltip).
- **Phase 2 — Settings + Circle** (gated on Lyra wireframes for those
  surfaces): My Settings (Provider-Editor, CORS-Proxy, Unlocker,
  About-Me, Mindspace defaults), My Circle (Persona list + editor),
  Mindspace-Engine (CSS-custom-properties, persona > user-default
  resolution), Entrance Hall skeleton.
- **Phase 3 — Chat** (wireframe-ready): Reading Mode (sacred bottom
  edge, tap-expand, affordance ↔ scroll-to-end), Interaction Mode
  (topbar, 2-row cockpit, dim-overlay, auto-close per Decision 16),
  streaming integration, Pills rendering + ADR "Tool Display
  Position".
- **Phase 4 — History + Polish** (gated on My History wireframe):
  List + search, Setup-Hints, scroll-to-end micro-animation,
  affordance glow tuning, network-loss / abort / partial-stream-on-
  tab-close edge cases.

## Open design questions / blockers

- Lyra's wireframes for Settings, Circle, Persona-Editor, History —
  in flight; Chris will iterate 2–3× in parallel to Phase 1.
- Final 7-Mindspace palette + 2–3 finalised textures — Lyra-led.
- Provider endpoint exact base-URLs and probe paths (nano-gpt, Novita,
  Ollama Cloud) — verified live during Phase 1 implementation.
- "Wider encryption-at-rest" (messages, personas, settings) — Chris
  flagged this is a bigger-group conversation, not a Block 1 decision.
- ADR "Tool Display Position" — drafted during Phase 3 implementation.

---

## Doing now

Writing the Phase 1 implementation plan next; **pause after Phase 1**
to sync on incoming wireframe iterations before opening Phase 2.

---

## Next session

1. **`writing-plans` skill** → Phase 1 Backbone implementation plan,
   subagent-friendly per CLAUDE.md global preference.
2. **Phase 1 execution** — Dexie schema first, then llm-unified, then
   crypto helpers + composition module, then onboarding gating.
3. **Pause + sync** on Lyra wireframe iterations before Phase 2.

---

## Pointers

- Server-coupled work: [[STATUS-BACKEND]]
- Block 1 design spec: [`superpowers/specs/2026-05-23-client-block-1-design.md`](../superpowers/specs/2026-05-23-client-block-1-design.md)
- UX concept (Chris + Lyra): [`UX-CONCEPT.md`](../UX-CONCEPT.md)
- Visual ground truth (interactive wireframe): [`chatsundere-prototype.html`](../chatsundere-prototype.html)
- All open todos: [[insights/follow-ups-index]]
- Decisions: `decisions/0001–0028`
- Design briefs: `briefs/phase 0/`
- Session journal: `insights/YYYY-MM-DD-*.md`
- Recent commits: `git log --oneline -20`
