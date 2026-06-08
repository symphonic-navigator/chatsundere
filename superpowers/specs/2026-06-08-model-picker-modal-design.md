# Model Picker Modal — Design Spec

**Date:** 2026-06-08
**Author:** Liz (brainstormed with Chris)
**Branch:** `feat/model-picker-modal`
**Status:** Approved design, pending implementation plan

## Problem

Chatsundere selects a model in three places, each with a different, unhandy UI:

1. **Persona editor** (`apps/user-client/src/routes/app/persona-editor.tsx`, `ModelList`,
   ~line 937) — a pretty inline two-tier picker (canonical model → provider/deployment).
   Returns `(canonicalId, providerId, upstreamSlug)`.
2. **Substitute-vision setting** (`apps/user-client/src/routes/app/settings.tsx`,
   `SubstituteVisionSetting`, ~line 58) — a native `<select>` listing every vision-capable
   offering, stored as `"${providerId}:${upstreamSlug}"`.
3. **Ask-expert setting** (`apps/user-client/src/routes/app/settings.tsx`,
   `ExpertModelSetting`, ~line 108) — a native `<select>` listing every offering, stored as
   `"${providerId}:${upstreamSlug}"`.

The persona picker is good but inline-only; the two settings pickers are flat, unsearchable
native dropdowns. There is no shared component, no search, and the existing `family` field on
canonical models is never surfaced.

## Goal

One reusable, animated modal — `ModelPickerModal` — that selects a model and returns it. Used
at all three call sites. Family-grouped, searchable, two-step (model → provider), with a
consistent click depth.

## Decisions (locked during brainstorming)

- **Two-step drill**, not inline expansion: step 1 is the model list, clicking a model navigates
  to step 2 (its providers) with a back arrow. Calm, one-intent-per-screen — deliberately chosen
  over the inline-accordion pattern used elsewhere because a modal benefits from the focused step.
- **Grouped by family + search.** Models sit under family headings (`claude`, `deepseek`, `glm`,
  `gemma`, `kimi`, `qwen`, `mimo`, `mistral`, `grok`, …). Groups are **not** collapsible — they
  render open. Search filters across all groups; empty groups disappear.
- **Single click on a provider selects and closes** the modal (with a close animation).
- **Always show step 2**, even when a model has exactly one provider — consistent click depth,
  and the user sees the provider's trust badges / context / capabilities before committing.
- **Animated open and close** — CSS only, no animation library (the codebase has none).

## Component API

New file: `apps/user-client/src/components/ModelPickerModal.tsx`

```ts
interface ModelSelection {
  canonicalId: string;
  providerId: string;   // configured provider row id (DB)
  upstreamSlug: string;
}

interface ModelPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (sel: ModelSelection) => void;
  providers: ProviderRow[];                 // configured providers from the DB
  configuredTemplateIds: string[];
  filter?: 'all' | 'vision';                // capability gate; defaults to 'all'
  current?: { providerId: string; upstreamSlug: string } | null;  // marks the active choice
  onBrowseProviders?: () => void;           // action offered in the empty / under-configured state
}
```

The modal returns the full `ModelSelection`. Each call site maps it to its own storage shape.

## Interaction & data flow

### Step 1 — choose a model

- Sticky search input at the top.
- Below it, canonical models grouped under family headings.
- Each model row shows: `displayName`, trust badges (TEE / ZDR availability across its
  offerings), and a provider count (number of matching offerings on configured providers).
- Family ordering is deterministic (e.g. by the lowest `sortPriority` among a family's
  offerings, then alphabetical) — stable across renders.
- Clicking a model row navigates to step 2.

### Step 2 — choose a provider

- Header: back arrow + the chosen model's name. Back returns to step 1 **preserving the search
  text**.
- Below: one row per offering for that canonical on a configured provider, ordered by the
  existing `rankOfferings()`. Each row reuses the persona-editor deployment row: provider name,
  TEE / ZDR / jurisdiction / freedom badges, `ctx`, and Tools / Vision pills.
- The row matching `current` shows a check.
- **Single click on a row** fires `onSelect(sel)` and closes the modal.

### Search mechanics

- `query.trim().toLowerCase()`, matched with `displayName.toLowerCase().includes(query)`.
- Case-insensitive, trimmed, substring ("contains"). Name only.
- Empty family groups vanish while filtering; a family header renders only if ≥1 of its models
  matches.

### Capability filter

- `filter='vision'`: a canonical is visible in step 1 only if it has ≥1 offering with
  `profile.vision === true` on a configured provider; step 2 shows only vision-capable offerings.
- `filter='all'` (default): no capability gating.

## Modal shell & animation

- Bottom-sheet, following the existing `AddProviderPicker` pattern: backdrop
  (`bg-black/60 backdrop-blur-sm`) + sheet (`fixed inset-x-0 bottom-0 rounded-t-2xl max-h-[80vh]`).
- Close on Escape and backdrop click.
- Animated **open and close**: a small local mount/transition state. On open, mount then animate
  in; on close, animate out, then unmount (so the close is visible, not an instant disappearance).
  Implemented with a CSS keyframe / transition — no new dependency.

## Call-site changes

1. **Persona editor.** The inline `ModelList` becomes a **trigger button** summarising the
   current selection; clicking it opens the modal. `onSelect` → existing
   `patch({ canonicalId, providerId, modelId })`. Stale-selection handling stays on the trigger
   button (shows the stored name + "no longer available").
2. **Substitute-vision setting.** The `<select>` becomes a trigger button, `filter='vision'`.
   `onSelect` → store `` `${providerId}:${upstreamSlug}` `` (unchanged storage).
3. **Ask-expert setting.** The `<select>` becomes a trigger button, `filter='all'`. Same storage.

## Edge cases

- **No / too few providers:** the modal shows a constructive empty state with an "Add a
  provider" action (`onBrowseProviders`), rather than only a disabled control — consistent with
  Chatsundere's constructive-error-handling principle.
- **Stale selection:** handled by each call site's trigger button (stored name + "no longer
  available" notice). The modal itself does not need to render stale state.
- **Offerings without a `canonicalRef`:** the picker is canonical-first, so any discovered
  offering with `canonicalRef === null` is not selectable here. All curated offerings carry a
  `canonicalRef`, so in practice nothing reachable today is lost; if a non-canonical offering
  ever needs picking, that is a separate follow-up, not in scope.

## Testing

- **Vitest (logic):** family grouping (ordering, empty-group removal), search filter
  (trim / case / contains, header visibility), capability filter (canonical visible iff ≥1
  matching offering; step-2 list gated).
- **Manual on device (Chris):** open/close animation, two-step navigation + back preserving
  search, single-click-provider closes, all three call sites, empty-provider state.

## Scope & guardrails

- One feature unit: the component plus the three call-site conversions. One squashed commit.
- Touches `apps/user-client` only — no `packages/*`, no `auth/sync/proxy/crypto`, no Dexie
  schema. **No Larissa audit required.**
- British English throughout (code, comments, copy).
