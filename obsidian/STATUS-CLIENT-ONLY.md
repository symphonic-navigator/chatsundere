# Chatsundere Status — Client-only

**Last updated:** 2026-05-23 — Phase 1 (Backbone) implementation
complete. Thirteen plan tasks squash into one Phase-1 commit; all 107
tests pass (66 user-client + 41 llm-unified); typecheck clean across
user-client / llm-unified / crypto; user-client `pnpm build` clean.
Manual smoke deferred to Chris's device-test. Block-1 wireframes
landed in `chatsundere-prototype.html` for Reading + Interaction Mode
+ Entrance Hall + My Settings + My Circle + Persona Editor; only
My History (Phase 4) remains wireframe-blocked. Phase 2 can start as
soon as Chris's manual smoke + sync is done. Brainstorm spec at
[`superpowers/specs/2026-05-23-client-block-1-design.md`](../superpowers/specs/2026-05-23-client-block-1-design.md);
plan at [`superpowers/plans/2026-05-23-client-block-1-phase-1-backbone.md`](../superpowers/plans/2026-05-23-client-block-1-phase-1-backbone.md).

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
  Chris-approved.
- **Phase 1 implementation plan (2026-05-23)** —
  `superpowers/plans/2026-05-23-client-block-1-phase-1-backbone.md`.
  13 tasks, fully TDD-structured. Subagent-driven execution.
- **Phase 1 — Backbone, complete (2026-05-23)**. Squashed into one
  commit. What landed:
  - `apps/user-client/src/lib/secrets.ts` — DEK-backed AES-GCM seal/open
    with `slotId` AAD binding (defends against ciphertext-swap across
    storage slots). 10 Vitest tests.
  - `apps/user-client/src/boot/client-data-db.ts` — Dexie DB
    `chatsundere_client_data` with seven tables (settings, providers,
    personas, mindspaces, chats, messages, pills), UUIDv7 IDs per
    ADR 0025, idempotent v1-seeding of three built-in mindspaces
    (Aurum, Azuro, Verdan) + settings singleton. Boot opens both
    crypto DB and client-data DB in parallel. 5 Vitest tests.
  - `apps/user-client/src/routes/onboarding/matrix.tsx` — three
    server-coupled cells disabled with `aria-disabled` + "Coming with
    Block 2" tooltip per UX-CONCEPT "Disabled over Hidden"; only
    "Just this device" remains an active link. 3 Vitest tests.
  - `packages/llm-unified/` — full library: 7 modules + 3 built-in
    providers + 7 test files. Registry pattern ported from
    `../chatsune/backend/modules/providers/_registry.py`.
    Single OpenAI-chat-completions adapter shape; three pre-registered
    providers (nano-gpt, Novita AI, Ollama Cloud) with CORS hints
    (`inofficial` / `direct` / `requires-proxy`). Transport routes
    direct or via cors-proxy. Hand-written SSE parser with split-chunk,
    abort-signal, and tool-call support. System-prompt composition is
    a pure module with stub Project + Memory slots. Probe surfaces
    structured ProbeResult for "Test Connection". 41 Bun tests.
  - Test runner split per CLAUDE.md: Bun for `packages/llm-unified`,
    Vitest for `apps/user-client`. Both clean.
  - New deps: `dexie@^4` and `uuidv7@^1.0.2` in user-client.
  - Two minor follow-ups noted for later (not blocking): (a) add input
    validation to `hexToRgb` in `client-data-db.ts` before a Phase-2+
    palette editor wires it up to user input; (b) consider extracting
    the duplicated `asMockFetch` helper if a third llm-unified test
    file needs it.

## Briefed, awaiting implementation

- **Phase 2 — Settings + Circle** (wireframes now available in the
  updated `chatsundere-prototype.html` — Lyra delivered Settings,
  My Circle, and Persona-Editor surfaces). Awaiting Chris's
  device-test of Phase 1 + sync on Phase-2 details before kickoff.
  Scope: My Settings (Provider-Editor with Test-Connection, CORS-Proxy
  global config, Unlocker, About-Me, Default-Mindspace), My Circle
  (Persona list + editor with name/colour/font/instructions/model/
  mindspace-override/about-me-override), Mindspace-Engine
  (CSS-custom-properties driven, resolution priority persona >
  user-default), Entrance Hall skeleton (greeting, Continue-Card,
  rooms-grid with Treasury + Projects greyed, Setup-Hints panel).
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

- Lyra's wireframe for My History — still in flight; Settings,
  Circle, Persona-Editor have landed (2026-05-23 update of
  `chatsundere-prototype.html`).
- Final 7-Mindspace palette + 2–3 finalised textures — Lyra-led.
- Provider endpoint exact base-URLs and probe paths (nano-gpt, Novita,
  Ollama Cloud) — verified live during Phase 1 implementation.
- "Wider encryption-at-rest" (messages, personas, settings) — Chris
  flagged this is a bigger-group conversation, not a Block 1 decision.
- ADR "Tool Display Position" — drafted during Phase 3 implementation.

---

## Doing now

Phase 1 finished. Paused for Chris's manual device-test smoke +
sync on Phase 2 scope (Settings / Circle / Mindspace-Engine /
Entrance Hall).

---

## Next session

1. **Chris's manual smoke** — fresh PWA install → 2×2 intent matrix
   with three greyed cells + "Just this device" active → local-only
   onboarding → `/app`. Verify in DevTools that both `chatsundere`
   (crypto-owned) and `chatsundere_client_data` (Dexie) IDBs exist,
   the latter containing three mindspaces + one settings row.
2. **Phase 2 brainstorm + spec extension** — walk through the
   updated wireframe (Settings, My Circle, Persona Editor) together;
   extend the Block-1 spec with concrete surface architecture and a
   Phase 2 implementation plan.
3. **Phase 2 execution** — subagent-driven, same pattern as Phase 1.

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
