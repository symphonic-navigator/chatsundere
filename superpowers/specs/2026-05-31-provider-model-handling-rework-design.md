# Provider & Model Handling Rework — Design

**Date:** 2026-05-31
**Author:** Liz (Claude Code)
**Status:** Approved (Chris, 2026-05-31) — ready for implementation plan
**Related:** [[2026-05-30-client-catalogue-migration-slice-2-design]] (canonical-first picker), [[2026-05-29-model-catalogue-data-model-design]] (Offering/CanonicalModel), [ADR 0031](../../obsidian/decisions/0031-eight-block-roadmap-to-beta.md) (roadmap)

---

## 1. Context & problem

The user-client's provider/model surfaces grew organically and have drifted:

- **Upstream Providers** (`apps/user-client/src/routes/app/settings.tsx:18-98`) renders a hard-coded list of all eight built-in providers regardless of whether the user has configured them — a long list dominated by *unconfigured* entries. Each row shows a hard-coded `Text` capability badge that reads nothing from the catalogue.
- **The CORS proxy** is already global in `SettingsRow.corsProxy` (`url` + sealed `sharedKey`) but has **no dedicated UI**. It is set only as a side effect of adding a proxy-requiring provider inside `ProviderSheet` (`ProviderSheet.tsx:91-97`) and can never be inspected, edited, or removed.
- **Capabilities** are an unused, conflated type: `Capability = 'llm' | 'streaming' | 'tools' | 'json-mode' | 'vision'` (`packages/llm-unified/src/types.ts:4`) mixes *modality* (`llm`) with per-model *feature flags* (`tools`, `vision`). The UI never reads it.
- **The model picker** (`persona-editor.tsx:524-634`) lists every canonical model and counts every offering — including offerings on providers the user has not configured — then disables the unreachable ones inline. This is noise during persona building.

This rework straightens all of it out, and lays a reusable pattern (add-from-catalogue picker + capability summary) that **Integrations** will reuse at beta.

## 2. Goals / Non-goals

**Goals**

1. A dedicated, optional, deletable home for the **global CORS proxy**, at the top of Upstream Providers, clearly transitional.
2. Proxy-requiring providers are only *addable* when a proxy is configured.
3. Replace the long provider list with a **configured-only list + a `+` add-picker** of not-yet-added providers.
4. Providers surface **what they actually contribute** as modality badges (LLM/WEB/TTS/STT/TTI), derived from real offerings, plus a **summary** of the user's total contribution across configured providers, showing absent modalities as switched-off badges.
5. The **model picker** shows only models the user can actually use, with provider counts and trust badges computed over configured offerings only.
6. Apply the *dere* treatment: every dead end surfaces its next constructive step.

**Non-goals (deferred)**

- Integrations / plugin-actuators (beta — we only keep the add-picker pattern reusable in spirit; we build no abstraction now, YAGNI).
- `EMB` (embeddings) as a modality — "very questionable" per Chris; no badge for something we may never ship.
- Custom / discovered providers ("Your Endpoints") — out of this unit.
- The server-side replacement of the CORS proxy (beta backend).

## 3. Key decisions

| # | Decision | Source |
|---|---|---|
| D1 | Unavailable items are handled **mixed**: the **add-picker greys out** proxy-providers without a proxy ("needs CORS proxy" + a one-tap shortcut); the **model picker hides** unusable models entirely (noise reduction). | Chris, 2026-05-31 |
| D2 | Modality caps are **derived from real wired offerings only**, never hand-declared on the provider. A modality lights up only once a usable offering of that kind exists. | Chris, 2026-05-31 |
| D3 | Consequence of D2, explicitly accepted: while only `llm` offerings are curated, **every provider shows only `LLM`** and the summary greys WEB/TTS/STT/TTI for everyone. The "nano-gpt gives you everything" pitch only fires once we curate those offerings. | Chris, 2026-05-31 |
| D4 | The global proxy lives **at the top of the Upstream Providers section**, not as a standalone My-Settings section, and is marked **transitional** ("replaced by your server connection at beta"). | Chris, 2026-05-31 |
| D5 | **No persisted-state changes** → **no Dexie migration**. All new states are derived; `corsProxy` and `ProviderRow` already exist. | Liz, grounded in code |

## 4. Data model changes (`packages/llm-unified`)

### 4.1 `ServiceKind`

New type in `catalogue/types.ts`:

```ts
/** A modality a provider contributes, derived from its curated offerings. */
export type ServiceKind = 'llm' | 'web' | 'tts' | 'stt' | 'tti';
```

`Offering` gains a required field, defaulted to `'llm'` in every offering factory so existing definitions need only a one-line factory change (not a per-offering edit):

```ts
export interface Offering {
  // … existing fields …
  serviceKind: ServiceKind; // currently always 'llm'
}
```

Every offering factory (`waferOffering`, the chutes/tensorix/novita/nano-gpt/openrouter/ollama/mistral builders) sets `serviceKind: 'llm'` (a single literal in each factory body). Valibot `parseCatalogueEntry` is extended to validate the new field (default `'llm'` when absent, so any external/discovered catalogue entries remain valid).

The legacy `Capability` type (`types.ts:4`) is left untouched — it is dead for UI purposes. A one-line doc comment marks it "not used for capability display; see `ServiceKind`". No refactor now.

### 4.2 Derivation helpers (`registry.ts`)

```ts
/** Distinct modalities this provider contributes, from its curated offerings. */
export function providerServiceKinds(providerId: string): ServiceKind[];

/** Union of contributed modalities across the given configured providers. */
export function aggregateServiceKinds(configuredTemplateIds: string[]): ServiceKind[];

/**
 * Which addable (not-yet-configured) providers would contribute a given
 * modality — powers the summary's "Add X to unlock Y" tooltip.
 */
export function providersContributing(kind: ServiceKind): string[]; // template ids
```

All three are pure functions over the in-code registry. `MODALITY_ORDER: ServiceKind[] = ['llm','web','tts','stt','tti']` is the canonical display order, exported for the badge rows.

### 4.3 Model-availability helper

```ts
/**
 * Canonicals the user can actually use: those with >= 1 offering on a
 * configured provider. Returns the available list plus the count of hidden
 * ones (for the model picker's quiet footer).
 */
export function availableCanonicals(configuredTemplateIds: string[]): {
  available: CanonicalModel[];
  hiddenCount: number;
};
```

## 5. Surface: My Settings → Upstream Providers (rework)

Order inside the accordion, top to bottom: **(A) Proxy block → (B) Summary row → (C) Configured providers list / empty state → (D) `+` add-picker entry point.**

> **Definition — "usable provider".** A configured `ProviderRow` is *usable* when `enabled === true` **and** it has a working route: either `corsHint !== 'requires-proxy'`, or a `corsProxy` is set. The summary (§5.B) and model-availability (§7) both derive from the **usable** set, never the raw `enabled` set — so a `Needs proxy` provider contributes nothing until its route is restored. `configuredTemplateIds` everywhere in this spec means "template ids of usable providers".

### 5.A Global CORS proxy block (transitional)

- A bordered block at the very top, visually distinct as "advanced / transitional".
- Shows the current proxy URL and a masked indicator that a shared key is set; **Edit** reveals inputs (URL + shared key), **Clear** removes it (`useUpdateSettings({ corsProxy: null })`).
- One-line caption: *"Temporary — at beta this runs over your server connection."*
- Deleting while proxy-providers are configured triggers the **edge-case warning** (§8.2).
- Sealing the shared key reuses the existing `sealSecret(value, mk, 'cors-proxy/shared-key')` slot — identical to today's `ProviderSheet` path, just relocated.

### 5.B Summary row ("Summenanzeige")

- Five badges in `MODALITY_ORDER`: `LLM WEB TTS STT TTI`.
- **Lit** when `aggregateServiceKinds(configuredTemplateIds)` includes it.
- **Greyed** otherwise, with a constructive tooltip:
  - if `providersContributing(kind)` (restricted to *addable* providers) is non-empty → *"Add {names} to unlock {KIND}"*;
  - else → *"Coming soon"*.
- This is also the reusable `CapBadgeRow` component (Integrations will reuse it).

### 5.C Configured providers list

- Lists **only** rows present in `ProviderRow` (`useProviders()`), not the hard-coded eight.
- Each row: monogram, display name, **status**, and its derived modality badges (`providerServiceKinds(templateId)` → today `LLM`).
- **Status** is a derived three-state:
  - `● Connected` — `row.enabled === true` and (not proxy-required OR a proxy is set);
  - `✗ Needs proxy` — `corsHint === 'requires-proxy'` and no `corsProxy` set (the proxy was cleared after this provider was added — §8.2);
  - `✗ Not connected / error` — probe never succeeded.
- Tapping a row opens the slimmed `ProviderSheet` (§6) to edit the key or remove the provider.

### 5.D Add-provider picker (`+`)

- A `+` button opens an **AddProviderPicker** sheet listing built-ins **not yet added** (`BUILT_IN_PROVIDERS` minus configured `templateId`s).
- Each entry shows its monogram, name, and **modality badges** (what it contributes).
- **Proxy-requiring entries without a configured proxy are greyed (D1)**: disabled, captioned *"Needs a CORS proxy"*, with a one-tap shortcut that scrolls to / opens the proxy block (§5.A). (Deredere extra #1.)
- Entries are **sorted freedom-oriented / most-capable first** (Deredere extra #5): rank by (any `freedomOrientedDeployment` offering) then provider `sortPriority`.
- Selecting an addable entry opens the `ProviderSheet` in *add* mode.

### 5.E Empty state

- When no provider is configured: a warm one-liner (*"Your Circle has no voice yet — add a provider to begin."*) with a prominent `+`. No raw empty list.

## 6. Surface: `ProviderSheet` (slimmed)

- **Proxy fields removed** — the proxy is global now (§5.A). The sheet is purely: API key input, **Test & Save**, and (for an existing provider) **Remove**.
- For a proxy-requiring provider, the sheet **reads** the global `corsProxy` for its probe (`routing: { kind: 'cors-proxy' }`), and refuses to save with a constructive error if the proxy was cleared in the meantime (*"Set a CORS proxy first"* + shortcut). The add-picker already gates this, so this is a belt-and-braces guard.
- After a successful probe, the sheet briefly **lights up the contributed modality badges** (Deredere extra #4 — "you just unlocked LLM").

## 7. Surface: Model picker (`persona-editor`)

- `ModelList` lists `availableCanonicals(configuredTemplateIds).available` only (D1 — hide unusable).
- Provider count and **TEE/ZDR** badges are computed over **configured offerings only** (filter `listOfferings(c.id)` to `configuredByTemplate.has(o.providerId)` before counting/badging).
- The inline **Deployment** list shows **only configured offerings** — no disabled CTAs remain in this surface.
- **EU jurisdiction badge** (Deredere extra #3): offerings carrying `trust.jurisdiction === 'EU'` (e.g. tensorix) show a small `EU` badge alongside TEE/ZDR. A new `JurisdictionBadge`, same visual family as `TrustBadge`.
- **Per-model capability hints** (Deredere extra #6): when the user actually has the offering, show tiny `Tools` / `Vision` pills derived from the offering's `ModelProfile` (`toolCalls.supported`, `vision`). Shown only for reachable offerings; nothing rendered otherwise.
- **Quiet footer** (Deredere): when `hiddenCount > 0`, a single muted line — *"＋{hiddenCount} more models once you add providers → My Settings"* — linking to Upstream Providers. One line, not a list (respects "hide for noise" while still signposting).

## 8. Edge cases

### 8.1 Persona references a now-unavailable model

A persona may store `canonicalId`/`providerId`/`modelId` for an offering whose provider was later removed. The model picker must **not** silently drop it:

- If the persona's current canonical is not in `available`, render it as an extra row at the top, marked *"Currently unavailable"*, with the constructive next step — *"add {Provider} or pick another model"* — and the offering's provider name resolved from the catalogue (not the DB row, which is gone).
- Saving the persona remains possible only with a reachable offering selected; the stale reference is shown, never auto-saved over silently.

### 8.2 Clearing the proxy while proxy-providers are configured

- **Clear** in the proxy block first checks for configured providers whose `corsHint === 'requires-proxy'`.
- If any, a confirm dialog: *"{Wafer, Ollama Cloud} need this proxy and will become unavailable until you set one again. Remove the proxy?"*
- On confirm, the proxy is cleared but the **provider rows are kept** (no data loss); they fall to `✗ Needs proxy` status (§5.C) and their model offerings drop out of the picker (they are no longer "configured" for availability purposes — availability requires a usable route).

## 9. Deredere extras (all approved)

1. Proxy shortcut from the add-picker → §5.D.
2. Gap → next-step in the summary tooltip → §5.B.
3. EU jurisdiction badge → §7.
4. Live modality flash after a successful probe → §6.
5. Freedom-oriented / most-capable-first ordering in the add-picker → §5.D.
6. Quiet per-model Tools/Vision hints (only when reachable) → §7.

## 10. Capability taxonomy (clarity)

Two orthogonal badge families, kept strictly separate:

- **Modality / contribution caps** — `ServiceKind` (LLM/WEB/TTS/STT/TTI). Provider-level (derived), surfaced in the Upstream-Providers list, add-picker, and summary.
- **Trust / soft caps** — `Offering.trust` (TEE, ZDR, EU jurisdiction). Offering-level, surfaced in the model picker.

The legacy `Capability` (feature flags: tools/vision/json-mode/streaming) is neither of these and stays internal.

## 11. Testing

- **`packages/llm-unified` (Bun):** `providerServiceKinds`, `aggregateServiceKinds`, `providersContributing`, `availableCanonicals` (incl. hidden-count), `MODALITY_ORDER`; `serviceKind` defaulting in the catalogue parser; every built-in offering is `serviceKind: 'llm'`.
- **`apps/user-client` (Vitest):** Upstream-Providers renders only configured rows; add-picker excludes configured + greys proxy-providers without a proxy + shortcut present; summary lit/greyed logic + tooltip branch; proxy block edit/clear; clear-with-active-proxy-providers confirm; model picker hides unavailable + configured-only counts/badges + quiet footer count; unavailable-persona-model row; EU badge; post-probe modality flash.
- No live provider calls in CI (keys never enter CI) — consistent with CLAUDE.md §10.

## 12. Manual verification (Chris, on device)

1. Fresh install → Upstream Providers shows the empty state + `+`.
2. Add a direct provider (e.g. Mistral) → appears in the list with an `LLM` badge; summary lights `LLM`, greys the rest with "Coming soon".
3. Open the add-picker → Wafer/Ollama are greyed with "Needs a CORS proxy"; tap the shortcut → lands on the proxy block.
4. Set a proxy → Wafer/Ollama become addable; add Wafer → connects.
5. Clear the proxy → confirm warns about Wafer; on confirm Wafer shows "Needs proxy" and its models leave the picker.
6. Model picker shows only usable models; counts/TEE/ZDR reflect configured providers only; the quiet footer counts the rest.
7. Remove a provider a persona uses → that persona's model shows "Currently unavailable" with a next step, not a blank.

## 13. Transitional note

The global CORS proxy (§5.A) and the `requires-proxy` routing are **alpha-only scaffolding**. At beta the authenticated proxy moves server-side (`apps/proxy-service`, Phase 2) and the client reaches proxied providers over the user's server connection. **Follow-up to remove with the beta backend:** the proxy block, the `corsProxy` settings field, and the `Needs proxy` status branch. Logged in `obsidian/insights/follow-ups-index.md`. Not `/schedule`d — gated on the beta milestone, no fixed date.

## 14. Files touched

- `packages/llm-unified/src/catalogue/types.ts` — `ServiceKind`, `Offering.serviceKind`.
- `packages/llm-unified/src/registry.ts` — derivation + availability helpers, `MODALITY_ORDER`.
- `packages/llm-unified/src/catalogue/*` — Valibot parse update.
- `packages/llm-unified/src/providers/*.ts` — `serviceKind: 'llm'` in each offering factory (one line each).
- `packages/llm-unified/src/types.ts` — doc comment on legacy `Capability`.
- `apps/user-client/src/routes/app/settings.tsx` — Upstream-Providers rework (proxy block, summary, configured list, empty state, `+`).
- `apps/user-client/src/components/ProviderSheet.tsx` — remove proxy fields, post-probe flash, proxy-missing guard.
- `apps/user-client/src/components/AddProviderPicker.tsx` *(new)*.
- `apps/user-client/src/components/CapBadgeRow.tsx` *(new — reusable; Integrations will reuse)*.
- `apps/user-client/src/components/CorsProxyBlock.tsx` *(new)*.
- `apps/user-client/src/routes/app/persona-editor.tsx` — availability filter, configured-only counts, jurisdiction + capability hints, quiet footer, unavailable-persona-model row.
- `apps/user-client/src/data/providers.ts` / `settings.ts` — only if a thin helper is needed (no schema change).

No Dexie migration (D5).

## 15. Out of scope / future

- **Integrations (beta):** reuse `AddProviderPicker` + `CapBadgeRow` as the pattern for adding plugin-actuators with their own capability badges.
- **Custom/discovered providers ("Your Endpoints"):** separate unit.
- **Server-side proxy:** §13.
