# Chatsundere Status — Client-only

**Last updated:** 2026-05-24 (Polish iterations 7 + 8 landed on top of
Phase 2.9) — Mindspace Cards & Adult Mode complete; two follow-up
polish passes on the card / topbar surfaces ahead of the small-group
deploy planned for 2026-05-25 evening. Four commits past Phase 2.9
proper: `6553224` (Phase 2.9), `86975d7` (iteration 7), this iteration
8, plus this doc commit. All 240 user-client tests pass across 57
files; typecheck + Biome lint clean; full build clean. Manual smoke
pending on Chris's device for the per-card mindspace texture (each
card carries its own atmosphere, not the user's default) and the
EditorTopbar redesign (SVG arrow + Lora title, one vertically centred
row across Circle / Persona-Editor / Settings / Account). Block-1
wireframes landed in `chatsundere-prototype.html` for Reading +
Interaction Mode + Entrance Hall + My Settings + My Circle + Persona
Editor; only My History (Phase 4) remains wireframe-blocked. Phase 3
(Chat surface) is the next deliverable. Brainstorm spec at
[`superpowers/specs/2026-05-23-client-block-1-design.md`](../superpowers/specs/2026-05-23-client-block-1-design.md)
(Decisions 1-47; D28 revoked by D36); Phase-2.9 spec at
[`superpowers/specs/2026-05-24-phase-2-9-mindspace-cards-adult-mode-design.md`](../superpowers/specs/2026-05-24-phase-2-9-mindspace-cards-adult-mode-design.md)
and plan at
[`superpowers/plans/2026-05-24-phase-2-9-mindspace-cards-adult-mode.md`](../superpowers/plans/2026-05-24-phase-2-9-mindspace-cards-adult-mode.md).

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

- **Phase 2.6 — Polish Iteration 2 (2026-05-24)**. Nine commits on
  master following Chris's iteration-2 device-smoke of Phase 2.5.
  Ten plan tasks driven via subagent-driven-development. What landed:
  - `apps/user-client/src/components/EditorTopbar.tsx` — new shared
    topbar component (40×40 back button with discard semantic +
    confirm-on-dirty; plain title centre; "Save & Back" pill right).
    Used by Persona Editor and My Settings.
  - `apps/user-client/src/components/AccordionCard.tsx` — `meta` prop
    widens from `string` to `ReactNode` so callers can compose
    dynamic previews.
  - `apps/user-client/src/components/SaveBar.tsx` — latent `bg-bg/95`
    transparency bug fixed (→ `bg-ink/95`). New `saveLabel?: string`
    prop lets each caller name its action ("Save Persona" / "Save
    Settings").
  - `apps/user-client/src/components/MindspacePicker.tsx` — new
    `hideFont?: boolean` prop suppresses the Font row when the caller
    handles font separately. Used by both the Persona Editor's
    Mindspace-Override (Font lives in Font-and-Voice now) and My
    Settings' Default-Mindspace (no user-font any more).
  - `apps/user-client/src/boot/client-data-db.ts` — `SettingsRow.userFont`
    removed. New personas default to `serif`. Existing rows with
    orphaned userFont are harmlessly ignored (Dexie schemaless for
    non-indexed fields; no version bump).
  - `apps/user-client/src/routes/app/persona-editor.tsx` — mounts
    `EditorTopbar`; introduces `isDirty` state; splits Save into
    `onSaveStay` (bottom SaveBar, persists + stays) vs `onSaveAndBack`
    (topbar, persists + navigates); dynamic accordion metas for
    Model (`<provider> · <model>`), Behavior (NSFW badge pill when
    `adultPersona`), Mindspace-Override (`Using user default` or
    `<mindspace> · <texture>`); new Font-and-Voice accordion section
    between Behavior and Mindspace-Override (font chips + a hint
    that TTS lands later).
  - `apps/user-client/src/routes/app/settings.tsx` — converted to
    draft + Save flow. About Me, Global System Prompt, Default
    Mindspace edits write to local `SettingsDraft` state; SaveBar
    diffs and dispatches `updateSettings.mutateAsync` only on Save.
    Upstream Providers stay out-of-band (per-provider Test & Save).
    EditorTopbar mounted.
  - `apps/user-client/src/routes/app/circle.tsx` — drops "Room · "
    breadcrumb prefix; back button bumped to the 40×40 convention.
  - `apps/user-client/src/routes/app/entrance-hall.tsx` — removes the
    `settings.data?.userFont` lookup; heading now uses `font-display`
    directly.
  - Tests: 11 new Vitest cases across AccordionCard meta-as-node,
    EditorTopbar (6 cases), MindspacePicker hideFont, persona-editor
    dynamic-meta (3 cases), persona-editor Font-and-Voice (2 cases),
    settings draft-save (2 cases). Two existing tests adjusted for
    new UX (settings-route persists, persona-editor name-input).
    All 176 user-client tests pass.

- **Phase 2.7 — Account Room + Polish Iteration 3 (2026-05-24)**.
  Seven commits on master following Chris's iteration-3 device-smoke.
  Seven plan tasks driven via subagent-driven-development. What
  landed:
  - `apps/user-client/src/routes/app/persona-editor.tsx` — bottom
    `<SaveBar />` removed. EditorTopbar's "Save & Back" is the only
    persist path. Discard via Back (with confirm-on-dirty). `pb-32`
    → `pb-8`. `onSaveStay` function dropped.
  - `apps/user-client/src/components/AccordionCard.tsx` — gains a
    smooth `scrollIntoView({ behavior: 'smooth', block: 'nearest' })`
    on every open, guarded by an `isInitialRef` so accordions that
    mount with `defaultOpen={true}` don't auto-scroll.
  - `apps/user-client/src/routes/app/entrance-hall.tsx` — gains a
    sixth `RoomTile` "My Account" (icon `⌬`, meta "Identity & auth",
    route `/app/account`).
  - `apps/user-client/src/routes/root.tsx` — global topbar's
    gear-icon shortcut to `/settings` is removed. `GearIcon` import
    dropped.
  - `apps/user-client/src/routes/app/account-sections/` — four new
    section components: `account-section.tsx` (port of old
    `/settings/account.tsx`), `auth-methods-section.tsx` (port),
    `about-section.tsx` (port), `server-linking-section.tsx` (newly
    authored — status + "Link to server" button).
  - `apps/user-client/src/routes/app/account.tsx` — new
    `AccountPage` route component. EditorTopbar with title "My
    Account"; four accordions in order Account / Auth Methods /
    Server Linking / About; `hideSaveAndBack` suppresses the
    Save & Back pill (no global draft to persist).
  - `apps/user-client/src/components/EditorTopbar.tsx` — new
    optional `hideSaveAndBack?: boolean` prop; when true, swaps
    the Save & Back button for an 88px-wide spacer to keep the
    centred title balanced.
  - `apps/user-client/src/routes/onboarding/invitation/_return-url.ts`
    — new shared helper exposing `useReturnUrl()` (default
    `/onboarding`) and `useNavTarget()` for forward-step search-
    preserving navigations.
  - `apps/user-client/src/routes/onboarding/invitation/{form,scan,
    confirm,recovery-reveal}.tsx` — all four step files now read
    the `?return=` query param via the helper for their exit-wizard
    back-targets; forward-step navigations preserve the search
    string so the return-URL flows through.
  - `apps/user-client/src/routes/change-passphrase.tsx` — link
    targets migrate from `/settings*` to `/app/account`.
  - `apps/user-client/src/App.tsx` — registers `<Route
    path="/app/account" element={<AccountPage />} />`. Drops the
    `/settings/*` route block and the five `SettingsLayout/Account/
    AuthMethods/ServerLinking/About` + `Navigate` imports.
  - `apps/user-client/src/routes/settings/` — entire directory
    deleted (layout.tsx + four sub-page files).
  - Tests: 4 new Vitest cases across AccordionCard scrollIntoView
    (2 cases), EditorTopbar hideSaveAndBack, account.tsx
    composition (2 cases), server-linking section navigation. All
    183 user-client tests pass.

- **Phase 2.8 — Polish Block (2026-05-24)**. Four squashed commits on
  master following Chris's pre-very-early-alpha polish ask. Driven by
  subagent-driven-development per task. What landed:
  - `apps/user-client/src/index.css` — new `.brand-logo` rules (cyan→
    pink→gold gradient + `✦` twinkle, identical to docs/index.html)
    plus `.splash-*` keyframes and reduced-motion overrides. Italic
    Lora wordmark replaced by the gradient brand mark in the topbar.
  - `apps/user-client/src/routes/root.tsx` — italic Lora wordmark
    replaced by the gradient brand mark; new topbarLogoRef passed
    through `SplashContext` to the overlay; topbar logo held
    `opacity: 0` until the splash FLIP completes (or until the splash
    dismisses without one — 150 ms safety poll, capped at 3.5 s).
  - `apps/user-client/src/components/EditorSticky.tsx` (new) — shared
    sticky-region wrapper adopted by Persona Editor (topbar +
    Continue/New Chat/Incognito quick-actions in edit mode), My
    Settings (topbar only), and My Account (topbar only). `top-11
    lg:top-14 z-10` offsets the region to sit below the global root
    header (which is sticky `top-0 z-20`); exposes `data-editor-sticky`
    as a stable test selector instead of fragile class-substring
    matches. Identity and Delete-zone stay outside the sticky on
    purpose (Delete is meant to be slightly harder to reach).
  - `apps/user-client/src/boot/client-data-db.ts` — Dexie v4 migration
    adds `SettingsRow.displayName: string`, backfills `''` on existing
    rows, seeds `''` on fresh installs.
  - `apps/user-client/src/data/settings.ts` — `useDisplayName()` hook:
    trimmed `displayName` → `session.username` → `'—'`.
  - `apps/user-client/src/routes/app/account-sections/account-section.tsx`
    — new Display Name input block above the existing username
    section; live-write on blur via `useUpdateSettings`; max 60
    chars; whitespace-only normalises to empty; gated on a one-shot
    init flag so the settings-resolve seed can't overwrite in-flight
    user typing.
  - `apps/user-client/src/routes/app/entrance-hall.tsx` — "WELCOME
    BACK" greeting now uses `useDisplayName()` instead of
    `session?.username`.
  - `apps/user-client/src/components/{SplashContext,SplashOverlay}.tsx`
    (new) — cold-start splash overlay gated by
    `sessionStorage.splashShown`. Tap/Escape/3s-hard-timeout skip
    paths; `prefers-reduced-motion` reduces to a 200 ms crossfade.
    FLIP migration computes `transform: translate(Δx,Δy) scale(s)`
    from `getBoundingClientRect` deltas and applies it with
    `transition: transform 500 ms ease-in-out`; on completion
    dispatches `chatsundere:splash-flip-done` for Root to flip the
    topbar opacity to 1.
  - Tests: 20+ new Vitest cases (EditorSticky 5 incl. data-attribute,
    SplashOverlay 6 incl. null-ref bailout, client-data-db-v4 2,
    useDisplayName 4, account.display-name 3, entrance-hall.greeting
    2, root.brand-logo 2, root.splash 2, persona-editor.sticky 1,
    settings.sticky 1, account.sticky 1). All 212 user-client tests
    pass; llm-unified Bun tests untouched and green; full
    `pnpm typecheck && pnpm lint && pnpm --filter user-client run build`
    clean.

- **Phase 2.9 — Mindspace Cards & Adult Mode (2026-05-24)**. One
  squashed commit on master following Chris's pre-very-early-alpha
  brainstorm. Driven by subagent-driven-development per task. What
  landed:
  - `apps/user-client/src/boot/client-data-db.ts` — Dexie v5 migration
    adds `SettingsRow.adultMode: 'nsfw' | 'sfw'`; default `'nsfw'`
    (per spec §2 Decision 2 — SFW is the special case); device-local
    (sync-exclusion contract documented in code for future sync).
  - `apps/user-client/src/data/settings.ts` — `useAdultMode()` hook
    (`{ mode, toggleMode, setMode }`).
  - `apps/user-client/src/data/personas.ts` — `useFilteredPersonas()`
    composes `usePersonas()` + `useAdultMode()`. **Project guideline**:
    any UI that lists personas, counts them, or resolves a recent
    persona reference must use this hook; raw `usePersonas()` is for
    Editor-class persona-by-id lookups only.
  - `apps/user-client/src/components/AdultModeToggle.tsx` (new) —
    brand-bar pill, single-state with ⇄ glyph, click toggles, NSFW
    red-toned / SFW grey-toned, subtle shimmer.
  - `apps/user-client/src/components/PersonaCard.tsx` — new required
    `mindspace: ResolvedMindspace` prop. Card background tint =
    palette.surfaceBase at 10% opacity; base border = palette.accentBorder.
    NSFW vs SFW box-shadow ring + CSS shimmer streak. Per-card random
    shimmer delay (djb2 hash of persona.id mod 4 s). prefers-reduced-motion
    disables shimmer.
  - `apps/user-client/src/routes/root.tsx` — `<AdultModeToggle />`
    mounted between logo and connectivity badge; brand-bar uses
    `justify-between gap-2` for three-child distribution.
  - `apps/user-client/src/routes/app/circle.tsx` — `useFilteredPersonas()`;
    resolves mindspace per card via existing `resolveMindspace()`;
    empty-state copy unchanged (no-leak per spec §2 Decision 4).
  - `apps/user-client/src/routes/app/entrance-hall.tsx` — `useFilteredPersonas()`
    for `personaCount` and `recentPersona` lookup. Continue-chat card
    naturally hides when recent persona is filtered out.
  - `apps/user-client/src/routes/app/persona-editor.tsx` — mount-effect
    updates global `useMindspaceStore` with the loaded persona's
    mindspace context.
  - `apps/user-client/src/index.css` — new `.adult-mode-toggle*`,
    `.persona-card*`, `@keyframes pill-shimmer`, `@keyframes
    persona-shimmer`, reduced-motion overrides.
  - Tests: ~18 new Vitest cases across client-data-db v5 (2),
    use-adult-mode (3), use-filtered-personas (3), AdultModeToggle
    (4), persona-card (3 added), root.adult-mode-pill (1),
    circle.filter (3), entrance-hall.filter (3), persona-editor.mindspace
    (1). All 238 user-client tests pass across 57 files; llm-unified
    Bun tests untouched and green; `pnpm typecheck && pnpm lint && pnpm
    --filter user-client run build` clean.

- **Polish iteration 7 (2026-05-24)** — three follow-ups from Chris's
  iteration-7 smoke after Phase 2.9. One squashed commit (`86975d7`).
  - `apps/user-client/src/routes/app/circle.tsx` — Circle owns the
    user-default mindspace context. Mount-effect now resets the global
    mindspace store to `persona: null` so the Persona-Editor's
    persona-specific mindspace does not leak back when the user
    navigates back from editing.
  - `apps/user-client/src/routes/app/persona-editor.tsx` — mindspace-
    sync effect now depends on draft fields (`draft.mindspaceId`,
    `draft.textureOverride`) instead of `persona.data`. Picking a
    mindspace inside the editor updates the ambient background
    immediately — live preview without needing to Save.
  - `apps/user-client/src/components/PersonaCard.tsx` — card tint now
    uses `palette.accentSubtle` (a persona-specific 6% rgba of the
    mindspace accent) instead of `palette.surfaceBase + '1a'`. The
    8-hex-alpha suffix is not valid on an rgba string so the rule was
    silently ignored — cards had no visible mindspace tint until this
    fix. `accentSubtle` is already an rgba with the right opacity.

- **Polish iteration 8 (2026-05-24)** — two follow-ups from Chris's
  pre-deploy review of the persona surface. One squashed commit.
  - `apps/user-client/src/components/MindspaceTexture.tsx` — new
    optional `animationDelaySeconds` prop, propagated to each layer's
    inline `animation-delay`. Lets multiple texture instances on the
    same screen avoid synchronised drift. Grain variant ignores the
    prop (no animation).
  - `apps/user-client/src/components/PersonaCard.tsx` — each card now
    renders its persona's `MindspaceTexture` inside the rounded
    container (clipped by the existing `overflow: hidden` on
    `.persona-card`). Content layered above the texture via
    `relative z-[1]`; the shimmer `::after` keeps top z-stack via DOM
    order. Per-card texture-delay derived from a second djb2 hash
    window (`tx:<persona.id>` mod 8 s) so card textures and shimmers
    don't co-pulse. Fixes "all persona cards show the user-default
    texture, not the persona's own".
  - `apps/user-client/src/components/EditorTopbar.tsx` — full redesign.
    Hand-drawn SVG back arrow (24×24 viewBox, stroke 1.5, rounded
    caps) inside a 44×44 hit target. Title promoted from `<span>` at
    `text-sm` to `<h1>` at `text-lg lg:text-xl` in `font-display`
    (Lora) with `leading-none` so back arrow, title, and Save-pill
    sit on the same vertical centre line. No gradient on the title —
    same family as the brand wordmark but visually quieter. Save &
    Back button unchanged (border + uppercase + tracking) plus a
    `transition` on hover. `hideSaveAndBack` spacer kept.
  - `apps/user-client/src/routes/app/circle.tsx` — inline header
    replaced with `<EditorTopbar … hideSaveAndBack />` so Circle,
    Persona-Editor, My Settings, and My Account share one topbar
    surface.
  - `apps/user-client/tests/unit/persona-card.test.tsx` — one new
    Vitest case asserting the `.mindspace-texture` overlay renders
    inside the card with the persona's mindspace texture name. 240/240
    user-client tests green; llm-unified Bun tests untouched.

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

Phase 2.9 + Polish iterations 7 & 8 finished. Paused for Chris's
iteration-8 manual smoke covering the per-card mindspace texture
(each card carries its own atmosphere) and the EditorTopbar redesign
(SVG arrow + Lora title across Circle / Persona-Editor / Settings /
Account). Small-group deploy scheduled for 2026-05-25 evening.

---

## Next session

1. **Chris's iteration-8 smoke** (post-deploy or just before) — reload
   the PWA and walk through:
   - **Persona cards (My Circle):** each card now shows its mindspace's
     own texture (cloudy / aurora / grain) clipped inside the rounded
     card, not the user-default texture. Cards with different mindspaces
     should look visibly different from each other; cards with the same
     mindspace should NOT pulse in unison (per-card hashed
     animation-delay).
   - **EditorTopbar (Circle / Persona-Editor / Settings / Account):**
     SVG back arrow on the left (44×44 hit area, stroke 1.5 — should
     feel deliberate, not generic Unicode), Lora title centred
     (text-lg mobile / text-xl desktop, no gradient), Save & Back pill
     on the right where applicable. All three on the same vertical
     centre line — back arrow should NOT sit lower than the title any
     more.
   - **Long persona names** in the Persona-Editor title should truncate
     gracefully without wrapping.

2. **Phase 3 brainstorm + plan** — walk through the chat surface
   wireframes in `chatsundere-prototype.html` (Reading Mode +
   Interaction Mode + Cockpit). Open the ADR "Tool Display Position"
   discussion. Include the "panic button" idea (one-tap kick-out
   from an in-flight NSFW chat when SFW mode is toggled mid-session,
   captured during the Phase 2.9 brainstorm).

3. **Phase 3 execution** — subagent-driven, same pattern as Phases
   1, 2, 2.5, 2.6, 2.7, 2.8, 2.9.

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
