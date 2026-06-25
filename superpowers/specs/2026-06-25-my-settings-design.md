# My Settings — Design Spec

- **Date:** 2026-06-25
- **Author:** Liz (with Chris)
- **Status:** Chris-approved (brainstorm); **Laura spec-pass complete — no hard defects.** SOFT-1 (identity seam), SOFT-4 (blur-flush on navigate-away), SOFT-6 (name the destination tile) folded in (§2.2, §3, §14). SOFT-2 (Web label) + SOFT-3 (image-block headings) are Chris-arbitrated copy calls; SOFT-5 (staged-vs-always-save asymmetry) carried forward to the design-language pass. → user review → implementation plan
- **Scope:** Rebuild `/app/settings` in the design language as a navigation matrix over six focused sub-pages, consuming the picker primitives shipped on `feat/picker-components` (PickerOverlay/PickerField + Mindspace/Model/Web overlays). This is the **My Settings** slice of the UI/UX makeover, the successor to the Main Menu and My Account slices.

---

## 1. Context & Goals

Today `/app/settings` (`routes/app/settings.tsx`) is a single long stack of nine `AccordionCard`s with a draft + `SaveBar`. It predates the design language entirely. The makeover proceeds surface-by-surface; with the Main Menu (`7bb552f7`) and My Account (`355f9bfa`) landed, **My Settings** is next, and the picker primitives it needs already exist (internal-only, in the showcase) from the preceding slice.

The redesign applies the same moves that worked for My Account: a **PageScaffold** breadcrumb/`?`-help chrome, an **always-save** model (no `SaveBar`), and a **nav-palette matrix** of `NavTile`s leading to one focused sub-page per intent. The goal is the project's core conviction — *simplify & unify, single surface per intent* ([[project_simplify_unify_single_surface]]) — and a calmer, more comprehensible Settings for the neurodivergent audience ([[project_neurodivergent_audience]]).

The nine accordion sections collapse cleanly into **six tiles**, each its own page. No setting is dropped (see §2 mapping).

### 1.1 What already exists (reuse points)

| Concern | Existing code |
|---|---|
| Page chrome (breadcrumb, `?`-help, back) | `components/ui/PageScaffold.js` + `PageBar`, `useHelp` |
| Nav tile (colour, icon, meta, `to`/`onActivate`, disabled) | `components/ui/NavTile.js` |
| Always-save single-line row | `routes/app/account/InlineEditRow.tsx` (`Saved ✓` live region) |
| Picker shell + trigger | `components/ui/PickerOverlay.js`, `components/ui/PickerField.js` |
| Mindspace / Model / Web overlays | `MindspacePickerOverlay`, `ModelPickerOverlay`, `WebPickerOverlay` |
| Provider list / proxy / capability summary | `ProvidersSection` + `CorsProxyBlock` + `CapBadgeRow` (in `settings.tsx`) |
| Per-provider editing (today an overlay) | `components/ProviderSheet.tsx` |
| Image generation (primary + NSFW slots) | `components/image-gen/ImageGenerationSection.tsx` |
| Voice (read-aloud / highpass / dictation) | `components/voice/VoiceSection.tsx` |
| Substitute-vision / expert-model pickers | `SubstituteVisionSetting` / `ExpertModelSetting` in `settings.tsx` |
| Web / expert-web data wiring | `WebInterfacingSection`, `ExpertWebSection`, `webBackendOptions`, `usableTemplateIds` |

**No persistence schema changes. No Dexie bump.** Every sub-page reads and writes the existing `SettingsRow` / `ProviderRow` shapes through the existing `useSettings`/`useUpdateSettings`/`useProviders` hooks.

---

## 2. The root matrix — `/app/settings`

A `PageScaffold` (crumb `My Settings`, `back="/app"`, `onHelp`) over a **3×2 `NavTile` matrix** (`grid grid-cols-2 gap-3`, the My Account precedent). The root carries **no inline content** — Settings has nothing that belongs on the wrapper itself; it is a pure palette.

### 2.1 Tiles, colours, mapping

Three colour pairs from the **nav palette** (`index.css`: `--color-nav-pink #ff6db0`, `--color-nav-blue #5b9dff`, `--color-nav-purple #a98bff`). Pink is the **same token the Main Menu uses for the Relate room** — a warm magenta, deliberately distinct from the reserved destructive red (`--color-destructive #ff5a5a`). Green sits out (three colours × two reads cleaner than six forced hues).

| Tile | Colour | Bundles (today's sections) |
|---|---|---|
| **You** | 🩷 pink | About Me + Global Instructions + Default Mindspace |
| **AI Providers** | 🩷 pink | CORS proxy + capability summary + provider list + add + (new) per-provider page |
| **Web Access** | 🔵 blue | Web-interfacing (search + fetch backends) |
| **Voice** | 🔵 blue | `VoiceSection` (read-aloud, highpass, dictation) |
| **Images** | 🟣 purple | Image Understanding (substitute-vision) + Image Generation (primary + NSFW) |
| **"Ask an Expert"** | 🟣 purple | Expert model + Expert web |

Tile order top-to-bottom is the table order. Labels are final (Chris-approved): the quotes on **"Ask an Expert"** are intentional (without them it reads as a question, not a feature); **AI Providers** disambiguates from "internet service provider"; **Web Access** (Laura SOFT-2) is clearer than a bare "Web" and — unlike "Web Search" — does not undersell the fetch half.

There are **no row labels** — colour does the soft grouping; an explicit "Core / Live / Augment" caption would be explanatory clutter the calm ND line rejects. The colour grouping is purely visual association local to this surface.

### 2.2 Disabled-over-hidden

Today Web and Expert-web are **hidden** until a usable provider contributes `web` (`settings.tsx:256`/`:312` return `null`). In a fixed matrix the raster must not reshape, so this flips to **disabled-over-hidden** (§11; the My-Projects-visible-but-disabled precedent from the Main Menu):

- **You**, **AI Providers** — always enabled.
- **Web** — enabled iff at least one usable provider contributes a `web` offering (`aggregateServiceKinds(usableTemplateIds(...)).includes('web')`, the same predicate as today's mount). Otherwise **disabled** with a constructive reason that **names the destination tile**, not just the fix (Laura SOFT-6): e.g. *"Add a web-capable provider under AI Providers to enable."* — so the eye lands on the right pink tile (mirrors the in-page proxy notice, `settings.tsx:316`). The CORS-proxy nuance is handled *inside* the page (§5), not at the tile.
- **Voice**, **Images**, **"Ask an Expert"** — **always enabled**. Each is meaningful with zero providers: the page itself teaches via constructive-empty states (already built for Images; mirrored for the others). Their *internal* sub-controls use disabled-over-hidden, not the tile.

> Planning pins the exact per-tile predicate against the live offering helpers (`aggregateServiceKinds`, `webBackendOptions`, `listTtiOfferings`, vision availability, TTS availability). The Web gate is the one confirmed here; the others default to always-enabled-with-internal-states unless planning finds a capability that is *entirely* local-impossible.

Each enabled tile shows a calm `meta` line reflecting current state (e.g. `3 providers`, `GLM TTS`, `no expert model yet`) — finalised in planning.

---

## 3. Sub-page: **You** — `/app/settings/you`

A single calm scroll page, **always-save**, three stacked blocks:

1. **About Me** — multi-line text (`globalAboutMe`). Persists on **blur** (Enter inserts a newline in a textarea, so blur is the commit), with the My Account `Saved ✓` live-region pattern. Helper copy unchanged: *"included in every persona's system prompt unless overridden per-persona."*
2. **Global Instructions** — multi-line text (`globalInstructions`), same always-save-on-blur. Helper copy unchanged.

**Blur-flush on navigate-away (Laura SOFT-4 — guards against silent data loss).** Because these rows commit on blur, leaving the page via the breadcrumb/back **must flush any pending edit before unmount** — a back-tap that races the blur-save must not drop the last keystrokes while the UI implied saving. The plan must guarantee blur-before-unmount (or an explicit commit on navigation); the manual-verification step (§14.2) tests it (*type → tap back immediately → reopen → text present*). Neglecting this turns a SOFT into a real defect.

**Identity-seam clarity (Laura SOFT-1).** The app now has two identity-flavoured homes — *My Account* (who you are to the system: username, display name) and *Settings › You* (what the AI knows about you). To pre-empt the wrong-first-guess, the **You tile's `meta` and the page's `?`-help draw the line in plain words** — the tile meta reads roughly *"how the AI sees you"*, distinct from My Account's account-identity framing. Both pages are self-evident on arrival, so this is a copy-level clarification, not a structural change.
3. **Mindspace** — a **`PickerField`** whose value renders a **live preview** of the current mindspace (the existing `MindspacePicker` preview, `previewName` = the user's display name). Tapping it opens **`MindspacePickerOverlay`**, zooming out of the preview button; Save commits `defaultMindspaceId` + `userTexture` (+ font) together. Treating the mindspace as its own picker is deliberate — the *same* `MindspacePickerOverlay` returns later on personas and projects (one component, three call-sites).

The always-save model **replaces the `SaveBar`** for this page (consistency with My Account). The multi-line always-save row is a small new primitive or an `InlineEditRow` multi-line mode — decided in planning (see §8).

---

## 4. Sub-page: **AI Providers** — `/app/settings/providers`

The `ProvidersSection` content, rehoused into a `PageScaffold` page (crumb `My Settings › AI Providers`):

- **CORS proxy** (`CorsProxyBlock`) — stays here, on the overview. It is global provider-infra, not a per-provider knob.
- **Capability summary** — `CapBadgeRow` of lit `ServiceKind`s with the existing "what you'd unlock" tooltips.
- **Provider list** — one row per configured provider (monogram, name, connection status, per-provider capability badges). A row navigates to the **per-provider page** (§4.1) instead of opening a sheet.
- **Add provider** — `AddProviderPicker` (unchanged behaviour; on pick, navigate to the new provider's per-provider page).

### 4.1 Per-provider page — `/app/settings/providers/:templateId`

The single genuinely-new page (Chris's "schöne Provider-Seite"). Replaces the bottom-sheet `ProviderSheet` overlay with a real sub-page (crumb `My Settings › AI Providers › nano-gpt`) — the only **three-level** path in My Settings; every other tile is one level deep.

Carries the `ProviderSheet` substance, restyled:

- Header: provider monogram + display name.
- **API key** field with reveal toggle.
- **Test & Save** — an **explicit** action button that seals the key and runs `probeProvider`, surfacing the probe status (`Probing…` / `✓ valid` / `✗ reason`). This is a **justified exception to always-save**: a network probe must be a deliberate act, not fired on every keystroke. (The always-save model governs text/pref fields, not network probes.)
- **Capabilities** — `CapBadgeRow` for this provider (`providerServiceKinds`).
- **Remove** — destructive (red), guarded by a `ConfirmDialog` (gold-protects the safe option). Deleting the key disconnects personas that use it; the existing warning copy is preserved.
- **Needs-proxy** state preserved: a proxy-required provider whose proxy is unset shows the existing constructive line pointing back to the overview's CORS proxy.

---

## 5. Sub-page: **Web Access** — `/app/settings/web`

A `PageScaffold` page hosting the general **`WebPickerOverlay`** flow via a `PickerField` (or the section inline — planning decides whether the page embeds the selectors directly or behind a trigger; the overlay primitive exists either way). Field set: **Search backend** + **Fetch backend**, `"Off"` a first-class equally-weighted choice. Writes `settings.webInterfacing`.

- **No usable web offering** → the tile is disabled (§2.2), so the page is normally reached only when web is available. If reached while web offerings exist but **all require the CORS proxy and none is set**, show the existing constructive *"Web search and fetch need a CORS proxy — set one up under AI Providers"* notice (today's `settings.tsx:316` behaviour).

---

## 6. Sub-page: **Voice** — `/app/settings/voice`

`VoiceSection` rehoused unchanged into a `PageScaffold` page. It already owns read-aloud granularity, voice selection, the high-pass cleanup (Auto/Off/50/100 Hz), and dictation settings, each with its own internal disabled-with-reason states. No behavioural change beyond the chrome and always-save (the section already persists immediately).

---

## 7. Sub-page: **Images** — `/app/settings/images`

Unifies the two image directions on one page (crumb `My Settings › Images`). The two page-level block headings are the plain-language in/out pair (Laura SOFT-3): **"Reading images"** and **"Creating images"** — legible at a glance without prose. (The generation block keeps its own internal "Primary model" / "NSFW model" sub-headings.)

1. **Reading images** — the substitute-vision picker, migrated from `ModelPickerField` to a **`PickerField` + `ModelPickerOverlay`** with the **vision filter call-site-locked** (no user-facing toggle). The vision-locked empty state must **name the constraint** (*"No image-capable models available — add a provider that offers vision"*, picker spec §8) because the filter is invisible. Writes `settings.substituteVisionModel`.
2. **Creating images** — `ImageGenerationSection` rehoused. It **already** carries the two-slot model Chris wants: **Primary** + an **NSFW** slot that "lights up automatically when one is curated" (`ImageGenerationSection.tsx:96`), with disabled-over-hidden when no NSFW-capable offering exists or the primary already does NSFW. Per-model `ImageModelConfigView` is preserved. Writes `settings.imageGeneration`.

Both persist immediately (no SaveBar). The "image-settings component" Chris asked for is therefore largely **the composition of these two blocks** on one page, not a new primitive — the dual-model capability already exists.

---

## 8. Sub-page: **"Ask an Expert"** — `/app/settings/expert`

Unifies the expert uplink on one page (crumb `My Settings › "Ask an Expert"`):

1. **Expert model** — `PickerField` + `ModelPickerOverlay` (`filter='all'`). Writes `settings.expertModel`. Privacy copy preserved (*"only the sanitised question leaves your device"*).
2. **Expert web** — the expert **`WebPickerOverlay`** flow (`mode='expert'`: Search + **Depth** + Fetch). Writes `settings.expertWeb`. **Disabled-over-hidden inside the page** (not the tile): when no usable web offering exists, or no expert model is chosen, show the existing constructive notices (`settings.tsx:261`/`:270`) rather than hiding the controls.

---

## 9. Components: reused vs new

**Reused as-is:** `PageScaffold`/`PageBar`, `useHelp`, `NavTile`, `PickerField`, `PickerOverlay`, `MindspacePickerOverlay`, `ModelPickerOverlay`, `WebPickerOverlay`, `CorsProxyBlock`, `CapBadgeRow`, `AddProviderPicker`, `VoiceSection`, `ImageGenerationSection`, `ConfirmDialog`.

**New (this slice):**
- **Per-provider page** (`/app/settings/providers/:templateId`) — rehouses `ProviderSheet` substance into a `PageScaffold` page. `ProviderSheet` is removed once nothing references it.
- **The six sub-page route components** + the root matrix page, replacing `settings.tsx`.
- **An always-save multi-line text row** for About Me / Global Instructions — either a multi-line mode on `InlineEditRow` or a sibling `InlineEditTextarea` (planning decides; favour extending `InlineEditRow` if its `Saved ✓` plumbing transfers cleanly). Persists on blur.

**Removed:** the `settings.tsx` accordion stack, its draft/`SaveBar` machinery, and `ProviderSheet` (superseded by the per-provider page). `AccordionCard` stays in the codebase only if other surfaces still use it (planning verifies; otherwise it goes too).

---

## 10. Routing

Add the My Settings sub-tree mirroring the My Account sub-tree registration (the `/app/account/*` routes — planning locates the router file). Routes:

```
/app/settings                          → root matrix
/app/settings/you
/app/settings/providers
/app/settings/providers/:templateId
/app/settings/web
/app/settings/voice
/app/settings/images
/app/settings/expert
```

All under `ProtectedRoute` (Settings needs a session). `back` targets: sub-pages → `/app/settings`; per-provider → `/app/settings/providers`; root → `/app`.

---

## 11. Error handling & edge cases

- **Stale stored value** (a picked model/backend whose provider was removed) → `PickerField` constructive stale copy (picker spec §6); the overlay still lets the user pick a valid value.
- **Empty option sets** → calm constructive-empty states with the next step (picker spec §8); never a dead blank. The vision-locked empty state names the invisible constraint (§7).
- **Provider probe failure** on the per-provider page → inline status with the upstream reason; the provider is saved disabled, not silently dropped (today's behaviour).
- **No master key in session** on save/probe → the existing "re-login required" guard.
- **Discard guard** for staged pickers (Mindspace/Web) → handled by `PickerOverlay`'s dirty guard (picker spec §2.3); model picker never stages, so it dismisses freely.
- **Disabled tiles/controls** are focusable with an announced reason (disabled-over-hidden), never removed from the DOM.

---

## 12. Comprehension / Laura considerations (pre-spec-pass notes)

For the Laura spec-pass to weigh explicitly:

- **Click-depth.** Settings goes from one scroll to one nav level (root → tile), and AI Providers to two (→ per-provider). Justified by the simplify-unify conviction and the My Account precedent (Chris-validated). Settings is low-frequency; the calm/discoverability gain dominates.
- **Cross-surface colour reuse.** Pink = "Relate room" in the Main Menu, "You + AI Providers" here. Liz's read: low-stakes (a settings-matrix hue isn't mapped to a room); flagged for Laura's ruling on whether it risks misdirection.
- **Labels.** Final and Chris-approved with rationale (§2.1) — Laura confirms they read as intended.
- **Disabled-over-hidden flip.** A user with no providers now *sees* Web (disabled, with the fix) rather than it being absent — more discoverable, matches §11.

---

## 13. Testing

- **RTL per sub-page:** root matrix renders six tiles with correct colours/targets; Web tile disabled-with-reason when no web offering, enabled otherwise; You page always-save-on-blur for both text blocks + mindspace `PickerField` opens the overlay; AI Providers list navigates to per-provider; per-provider Test&Save probe paths (ok/error/needs-proxy) + guarded Remove; Images understanding vision-lock + the existing generation primary/NSFW states; Expert model + expert-web internal disabled states.
- **Always-save:** blur persists; no `SaveBar` present; `Saved ✓` live region announced.
- Run the **full** user-client vitest at the gate (not just the touched dir), expecting the known **8 Node-localStorage baseline** ([[project_vitest_baseline_is_node_localstorage]]).
- `pnpm typecheck --force` at the gate (Turbo caches typecheck; force it — [[feedback_turbo_caches_typecheck]]).

---

## 14. Manual verification (Chris, on device)

1. Open `/app/settings` → six tiles in three colour pairs; pink = the Main Menu's Relate hue; tap each tile → its page zooms in; back collapses into the tile.
2. **You:** edit About Me / Global Instructions → blur → `Saved ✓`; reload shows the saved text. **Blur-flush (SOFT-4):** type into a field → tap the breadcrumb back *immediately* (no explicit blur) → reopen You → the text is present (no dropped keystrokes). Tap the Mindspace preview → `MindspacePickerOverlay` zooms out of it; change + Save → preview updates; discard-on-back when dirty raises the confirm. The You tile's meta reads as the AI-facing identity, distinct from My Account.
3. **AI Providers:** proxy + summary + list on the overview; tap a provider → its page; Test&Save probes; Remove asks to confirm. Add a provider → lands on its page.
4. **Web Access:** with no web provider, the tile is disabled with a reason that names "AI Providers"; add one → tile enabled → page lets you pick Search/Fetch (incl. "Off").
5. **Voice:** all read-aloud / highpass / dictation controls present and persisting.
6. **Images:** "Reading images" lists only vision models (no toggle); empty state names the constraint. "Creating images" shows Primary + the NSFW slot's disabled-with-reason.
7. **"Ask an Expert":** pick an expert model; expert-web shows its disabled-with-reason until a web provider + expert model exist, then offers Search/Depth/Fetch.
8. **a11y:** disabled tiles/controls are focusable and announce their reason; `prefers-reduced-motion` → instant zooms.

---

## 15. Scope boundary, follow-ons & deferrals

**In scope:** the root matrix, the six sub-pages, the per-provider page, the always-save multi-line row, routing, and the removal of the old `settings.tsx` stack + `ProviderSheet`.

**Out of scope / deferred:**
- **Chat / Persona model-picker migration** to `ModelPickerOverlay` — their own makeover slices (the two looks coexist meanwhile, by decision; picker spec §11).
- **Makeover-wide a11y follow-ons** (fold in opportunistically when touched): PageBar crumb tap-target <44 px + `:focus-visible` rings; `.cs-btn` `:hover`/`:focus-visible`; `ReadingOverlay`/`ConfirmDialog` adopting the picker focus-trap.
- **Laura SOFT-2** (telegraph no-Save vs staged picker via row affordance grammar) — design-language pass, not this slice.
- **Mindspace on personas/projects** — future call-sites of the same overlay; not wired here.
