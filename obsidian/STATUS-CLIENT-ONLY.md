# Chatsundere Status — Client-only

**Last updated:** 2026-05-24 — Phase 2.5 (Polish & Bug-Bash) complete.
Twelve plan tasks split across eight Phase-2.5 commits (`ef9662a`
fonts, `4aa341d` FAB, `23697b3` monogram, `39fa93a` texture-source
migration v3 + MindspaceLayer + Picker preview, `de12fe2` AutoSizeTextarea,
`62b4602` ProviderSheet polish + Ollama-Cloud save fix, `a3bfad2`
Persona Editor restructure + required markers, plus this doc commit).
All user-client tests pass; typecheck clean; Biome lint clean.
Manual re-smoke pending on Chris's device for the four touched
surfaces. Block-1 wireframes landed in `chatsundere-prototype.html`
for Reading + Interaction Mode + Entrance Hall + My Settings + My Circle
+ Persona Editor; only My History (Phase 4) remains wireframe-blocked.
Phase 3 (Chat surface — Reading + Interaction + Streaming) is the next
deliverable; Phase 4 (History + Polish) follows once Lyra's history
wireframe lands. Brainstorm spec at
[`superpowers/specs/2026-05-23-client-block-1-design.md`](../superpowers/specs/2026-05-23-client-block-1-design.md)
(Decisions 1-35); Phase-2.5 plan at
[`superpowers/plans/2026-05-24-client-block-1-phase-2-5-polish.md`](../superpowers/plans/2026-05-24-client-block-1-phase-2-5-polish.md).

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

## Done (continued from Phase 1)

- **Phase 2 — Settings + Circle + Persona Editor + Entrance Hall
  (2026-05-23 evening)**. Squashed into one Phase-2 commit. What landed:
  - `apps/user-client/src/boot/client-data-db.ts` — Dexie v2 migration
    with `.upgrade()` backfilling `Settings.userFont = 'serif'` and
    `PersonaRow.{tagline:'', temperature:0.85, adultPersona:false}`
    on existing rows; seven built-in mindspaces (Crimson, Aurum,
    Verdan, Azuro, Indigaut, Violetta, Rosari) using Lyra's finalised
    hex values; Verdan/Azuro accent hex refreshed from Phase-1
    provisional values.
  - `apps/user-client/src/state/{mindspace-resolver,mindspace.store}.ts`
    — pure resolver + Zustand store driving the active palette.
  - `apps/user-client/src/components/{MindspaceLayer,MindspaceTexture,
    MindspacePicker,PersonaCard,AccordionCard,ProviderSheet,SaveBar}.tsx`
    — the Phase-2 component library. MindspaceTexture ships three
    CSS-only variants (cloudy, aurora, grain) with respect for
    `prefers-reduced-motion`.
  - `apps/user-client/src/data/{queryKeys,settings,personas,providers,
    mindspaces,chats}.ts` — TanStack-Query data layer over Dexie with
    full CUD for personas / providers, plus query-only access for the
    rest.
  - `apps/user-client/src/routes/app/{entrance-hall,circle,
    persona-editor,settings}.tsx` — the four Block-2 surfaces wired
    to data + state, with accordion accordions, FAB navigation,
    save-bar validation, delete-zone with cascade, etc.
  - `apps/user-client/src/App.tsx` — wired `/app` subroutes
    (`/app`, `/app/circle`, `/app/persona/new`, `/app/persona/:id`,
    `/app/settings`); MindspaceLayer mounted at root; `app-shell.tsx`
    placeholder removed.
  - Tests: 63 new Vitest cases across mindspace engine, data layer,
    components, and the four routes; all 129 user-client tests pass.
    Phase-1 packages (crypto, llm-unified) remain untouched and green.

- **Phase 2.5 — Polish & Bug-Bash (2026-05-24)**. Eight commits on
  master following Chris's device-smoke of Phase 2. Twelve plan tasks
  driven via subagent-driven-development. What landed:
  - `apps/user-client/public/fonts/` — self-hosted Lora (Regular +
    Italic, ported from chatsune) and Inter variable (from
    upstream `rsms/inter`). `src/index.css` `@theme` block points
    `--font-display` at Lora and `--font-sans` at Inter. No CDN
    call at runtime.
  - `apps/user-client/src/lib/monogram.ts` — kollision-free port of
    `chatsune/backend/modules/persona/_monogram.py`. Five-strategy
    fallback (multi-part initials → letter pairs → doubled first →
    AA…ZZ → '??'). 8 Vitest tests; existing `monogramFor` callers
    keep their one-arg API via a thin wrapper.
  - `apps/user-client/src/boot/client-data-db.ts` — Dexie v3
    migration adds `SettingsRow.userTexture` and
    `PersonaRow.textureOverride`; backfills both from existing rows
    via a raw-Dexie plant-then-reopen pattern. `MindspaceRow.texture`
    survives only as a seed-default for first-install.
  - `apps/user-client/src/state/mindspace-resolver.ts` +
    `mindspace.store.ts` — new `ResolverArgs` accepts `defaultTexture`;
    texture priority is `persona.textureOverride > settings.userTexture > mindspace.texture`.
    Resolver returns `ResolvedMindspace | null` instead of throwing on
    an empty mindspaces list.
  - `apps/user-client/src/components/MindspaceLayer.tsx` — wraps the
    texture in `position: fixed; inset: 0; pointer-events: none;
    z-index: -1; overflow: hidden`. The background now spans the
    whole viewport regardless of content height or scroll position.
  - `apps/user-client/src/components/MindspacePicker.tsx` — preview
    card renders an actual `MindspaceTexture` sample (was a flat
    colour panel). Texture and Colour are now genuinely orthogonal;
    selecting a colour never invokes `onTextureChange`.
  - `apps/user-client/src/components/AutoSizeTextarea.tsx` — new
    component; replaces fixed-height textareas across About Me,
    Global System Prompt, Custom Instructions, About Me Override.
    Strictly controlled with `value` + `onChange`; growable up to
    optional `maxRows`.
  - `apps/user-client/src/components/ProviderSheet.tsx` — opaque
    `bg-ink` body with a click-through `bg-black/60 backdrop-blur-sm`
    backdrop; explicit Cancel + Test & Save buttons; closing via ×
    discards the in-progress edit; password-manager autofill
    suppressed (`autoComplete="off"`, `data-1p-ignore`,
    `data-lpignore="true"`, empty `name`); proxy URL placeholder
    is `https://example.com`. The Ollama-Cloud save bug is fixed —
    the freshly-sealed shared key is held in a local variable and
    used directly for the probe instead of being re-read from the
    stale TanStack-Query cache.
  - `apps/user-client/src/routes/app/circle.tsx` — FAB `+` glyph is
    visible again (`text-bg` was undefined; replaced with `text-ink`;
    glyph bumped from `text-2xl` to `text-3xl leading-none`).
  - `apps/user-client/src/routes/app/persona-editor.tsx` — Identity
    (Name + Tagline) lifted out of the accordion, always visible at
    the top. Accordion order is Custom Instructions → Model →
    Behavior → Mindspace-Override → About-Me-Override.
    Required-field markers (red ✕) render on the accordion header
    via the new `AccordionCard.requiredMarker` prop, and inline next
    to Name when empty. Save requires `modelId` in addition to
    `providerId`. A `userModifiedRef` prevents the draft-seed
    `useEffect` from overwriting in-progress edits when upstream
    data refetches.
  - `apps/user-client/src/routes/app/settings.tsx` — wires the
    Mindspace-Picker to `SettingsRow.userTexture`; About-Me and
    Global System Prompt use the new `AutoSizeTextarea`. Removed
    the now-unused `useUpdateMindspaceTexture` import path.
  - `apps/user-client/src/data/mindspaces.ts` — `useUpdateMindspaceTexture`
    hook removed (texture no longer lives on the mindspace row).
    `useMindspaces` retained.
  - Tests: ~16 new Vitest cases across monogram, db v3 migration,
    MindspaceLayer wrapper, picker controlled-API regression,
    AutoSizeTextarea structural contract, ProviderSheet polish, and
    persona-editor required-field markers. All user-client tests
    green; llm-unified tests green.

## Briefed, awaiting implementation

- **Phase 3 — Chat** (wireframe-ready): Reading Mode (sacred bottom
  edge, tap-expand, affordance ↔ scroll-to-end), Interaction Mode
  (topbar, 2-row cockpit, dim-overlay, auto-close per Decision 16),
  streaming integration, Pills rendering + ADR "Tool Display
  Position".
- **Phase 4 — History + Polish** (gated on My History wireframe):
  List + search, Setup-Hints (deferred from Phase 2 per Decision 27),
  scroll-to-end micro-animation, affordance glow tuning, network-loss
  / abort / partial-stream-on-tab-close edge cases.

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

Phase 2.5 finished. Paused for Chris's manual re-smoke on the four
touched surfaces (Entrance Hall, My Settings, My Circle, Persona
Editor) before kicking off Phase 3 (Chat).

---

## Next session

1. **Chris's manual re-smoke after Phase 2.5** — re-install / reload
   the PWA and walk through:
   - **Typography:** headings and body should render in Lora (serif)
     and Inter (sans) — visible by glyph shape on a calm screen.
   - **Entrance Hall FAB (My Circle):** the `+` glyph on the FAB is
     visible and contrasts against the light circle (was invisible
     before).
   - **Mindspace background coverage:** scroll any long page (My
     Settings while editing About Me; Persona Editor with all
     accordions open) — the texture should still cover the whole
     viewport top-to-bottom, not collapse to a single screen-height.
   - **Mindspace-Picker:** pick a colour, then a texture, then change
     colour again → the texture choice must persist. The preview
     card now shows the chosen texture, not a flat panel. Try this
     in both Settings → About Me → Default Mindspace and Persona
     Editor → Mindspace Override.
   - **Textareas grow:** About Me, Global System Prompt, Custom
     Instructions, About Me Override all expand with content; the
     two prompts cap at a sane row count.
   - **ProviderSheet:** open Settings → Upstream Providers →
     nano-gpt. Background should be opaque (not see-through). Type
     a key → Test & Save runs the probe; on success the sheet
     auto-closes after a beat. Closing via × does NOT save.
     Browsers should NOT propose Bitwarden / 1Password autofill on
     the API-key field. Now open Ollama Cloud — proxy URL field
     defaults to `https://example.com` placeholder. Fill in real
     proxy URL + shared key + API key → Test & Save → key persists
     across a page reload (this was the Phase-2 bug).
   - **Persona Editor:** Name + Tagline are visible at the top
     without expanding any accordion. With Name empty, the inline
     red ✕ shows up next to the label and disappears once you type.
     Closed Custom Instructions and Model accordions show a red ✕
     on their headers until their content / providerId+modelId are
     filled. Save stays disabled until everything required is
     provided (including modelId — previously Model could be
     half-filled).
   - **Monogram on PersonaCard:** create two personas whose names
     start with the same letter (e.g. "Liz" and "Lyra") — their
     monograms should differ (was identical before).
   - **DevTools:** open the `chatsundere_client_data` DB.
     `db.verno` is 3. `settings` carries `userTexture` (default
     `'cloudy'`). `personas` carry `textureOverride: null`.
2. **Phase 3 brainstorm + plan** — walk through the chat surface
   wireframes in `chatsundere-prototype.html` (Reading Mode +
   Interaction Mode + Cockpit). Open the ADR "Tool Display Position"
   discussion.
3. **Phase 3 execution** — subagent-driven, same pattern as Phase 1,
   Phase 2, Phase 2.5.

---

## Pointers

- Server-coupled work: [[STATUS-BACKEND]]
- Block 1 design spec: [`superpowers/specs/2026-05-23-client-block-1-design.md`](../superpowers/specs/2026-05-23-client-block-1-design.md)
- UX concept (Chris + Lyra): [`UX-CONCEPT.md`](../UX-CONCEPT.md)
- Visual ground truth (interactive wireframe): [`chatsundere-prototype.html`](../chatsundere-prototype.html)
- All open todos: [[insights/follow-ups-index]]
- Decisions: `decisions/0001–0028` (plus Block-1 Decisions 17–28 in
  the Block-1 design spec linked above — these are the Phase-2
  brainstorm decisions; promoted ADRs may follow)
- Design briefs: `briefs/phase 0/`
- Session journal: `insights/YYYY-MM-DD-*.md`
- Recent commits: `git log --oneline -20`
