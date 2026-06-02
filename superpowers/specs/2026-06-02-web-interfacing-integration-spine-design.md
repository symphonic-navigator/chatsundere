# Web-Interfacing Integration Spine — Design Spec

**Date:** 2026-06-02
**Author:** Liz (brainstormed end-to-end with Chris)
**Status:** Approved, ready for implementation plan
**Side:** Client-only (no auth/sync/proxy/crypto path — not a Larissa change)

---

## 1. Purpose

Lay the architectural **spine** for *integrations* — dynamic, credential-gated
capability units — using **web interfacing** (`web_search` + `web_fetch`) as the
first concrete case. This round deliberately does **not** integrate any real
provider. The goal is that the only work remaining afterwards to make web search
go live is: *write the nano-gpt web adapter, register it, and curate the `web`
offerings.* Everything else — the abstractions, the registry seam, the tool
wiring, the per-call context plumbing, the settings model and visibility
gating — lands here, dormant until a provider exists.

This is the first realisation of a general pattern. `Integration` is the
semantic **counterpart to `Tool`**:

- A `Tool` is **static, always-on, self-contained** (e.g. `calculate_js`).
- An `Integration` is **dynamic (0..n), credential-gated, and contributes
  capabilities** (tools today, possibly more later). It is active only when its
  capability has been unlocked and configured.

---

## 2. Decisions (all Chris's, made during the brainstorm)

1. **Spine depth: everything except the adapter.** Interfaces, registry seam,
   `IntegrationContext` (NSFW/location) plumbing, the two tools wired and gated
   into the tool-loop, and a functional (unstyled) settings shell with real
   persistence and visibility gating. At zero providers it all sleeps.

2. **Tool ownership: the integration contributes its tools.** The
   WebInterfacing integration owns `web_search`/`web_fetch` (their defs +
   routing). The registry composes static tools + tools from active
   integrations. `Integration` is a first-class interface with
   `contributesTools()`; `toolDefs()`/`systemPromptSegment()`/`dispatch()`
   become functions of the active integration set. Scales to future integration
   kinds (TTS, STT, TTI, LAN actuators).

3. **Backend model: each web backend is its own `web` offering.** brave, exa,
   linkup … are separate offerings with `ServiceKind: 'web'` — even when all
   fronted by nano-gpt — carrying capability flags (`canSearch`/`canFetch`) and
   a `qualityClass` (`classic` vs `ai-friendly`) as metadata. The web settings
   hold **two independent selections** (search backend, fetch backend); "fetch
   from a different provider than search" is simply a different offering id.
   Reuses the entire catalogue + ranking + badge machinery.

4. **The governing invariant: 1 integration ↔ 1 `ServiceKind`; 1 integration ↔
   n tools.** Multiple tools per integration are fine (web has two); multiple
   *capabilities* per integration are forbidden. `Integration.capability` is a
   singular `ServiceKind`, not an array — the type enforces the discipline. An
   integration is named by **capability, not by provider**: there is one `tts`
   integration into which xAI (and others) plug as providers, not "xAI's TTS
   integration". This yields free provider-mixing per capability and keeps
   higher-level compositions (e.g. a future voice mode chaining STT→LLM→TTS)
   clean, because each capability is an independent, composable unit.

5. **Visibility: hidden-until-unlocked** for the web settings section — a
   deliberate exception to the project-wide "disabled over hidden" rule. The
   section is invisible until a usable `web` offering exists. *Within* the
   section, "disabled over hidden" applies again (an unavailable backend is
   greyed with a tooltip, not hidden).

---

## 3. Architecture

### 3.1 The `Integration` abstraction — `apps/user-client/src/integrations/`

New directory, the semantic counterpart to `tools/`.

```ts
interface Integration {
  readonly id: string;                 // 'web-interfacing'
  readonly capability: ServiceKind;    // 'web' — couples to the offering modality model
  /** Active tools for the current context; [] when not unlocked/configured. */
  contributesTools(ctx: IntegrationContext): Tool[];
}
```

`ServiceKind` already exists (`packages/llm-unified/src/catalogue/types.ts:34`,
`'llm' | 'web' | 'tts' | 'stt' | 'tti'`). `capability` is singular by design
(decision §2.4).

### 3.2 `IntegrationContext` — the per-call plumbing

Built per send by the stream-manager. Carries the NSFW and location context
Chris flagged as essential, plus the selected offerings and a call-time key
accessor.

```ts
interface IntegrationContext {
  nsfwAllowed: boolean;                 // from the active persona's adultPersona flag
  location: WebLocation | null;         // shape defined; source deferred (flows as null today)
  webSearchOfferingId: string | null;   // from web settings
  webFetchOfferingId: string | null;    // independently selectable
  getKey: (providerTemplateId: string) => Promise<string | null>;  // credential-bus, MasterKey-gated, call-time only
}
```

`WebLocation` is a minimal, defined shape (e.g. `{ country?, region?, city? }`);
its *source* is an explicit follow-up (§7).

### 3.3 Registry seam — `apps/user-client/src/tools/registry.ts`

Today the registry is static (`TOOLS = [calculateJs]`) with parameterless
`toolDefs()`/`systemPromptSegment()`/`dispatch()`. It becomes composing:

```ts
function resolveActiveTools(ctx: IntegrationContext): Tool[] {
  return [...STATIC_TOOLS, ...INTEGRATIONS.flatMap((i) => i.contributesTools(ctx))];
}
```

`toolDefs(tools)` / `systemPromptSegment(tools)` / `dispatch(name, args, signal,
tools)` all derive from this one list. `calculate_js` stays in `STATIC_TOOLS` →
**zero regression**: it flows exactly as today whether or not any integration is
active.

### 3.4 Web-interfacing concretisation

**`WebInterfacingProvider` contract — in `packages/llm-unified`** (consistent
with the LLM adapters and catalogue living there; the adapter is pure and does
the network call given a key, so it belongs in the shared package):

```ts
interface WebInterfacingProvider {
  readonly canSearch: boolean;
  readonly canFetch: boolean;
  readonly qualityClass: 'classic' | 'ai-friendly';   // "dumb 2002-style" vs exa/linkup
  search?(query: string, ctx: WebContext, key: string, signal?: AbortSignal): Promise<WebSearchResult>;
  fetch?(url: string, ctx: WebContext, key: string, signal?: AbortSignal): Promise<WebFetchResult>;
}
```

`WebContext` is the integration-context subset the provider needs
(`{ nsfwAllowed, location }`). `WebSearchResult`/`WebFetchResult` are minimal
result types the tool serialises into the `ToolResult.output` string for the
model.

**`web-adapter-registry`** (mirror of the existing LLM `adapter-registry`): maps
`offering.adapterId → WebInterfacingProvider`. **Empty today** → no backend
resolves → integration inactive → tools dormant.

**The WebInterfacing integration — `integrations/web/`** owns the two tools:

- `contributesTools(ctx)` resolves `webSearchOfferingId` via the
  web-adapter-registry; if a provider with `canSearch` comes back, it
  contributes `web_search`, whose `execute` pulls `getKey()` and calls
  `provider.search(query, webCtx, key)`. Symmetrically `web_fetch` from
  `webFetchOfferingId` / `canFetch`.
- The two are independent: a user who has chosen only a search-capable backend
  sees only `web_search`.

Tonight nothing resolves → `contributesTools` returns `[]` → the model never
sees the web tools until the adapter lands tomorrow.

---

## 4. Settings data model & visibility

**Persistence.** `SettingsRow` (`apps/user-client/src/boot/client-data-db.ts:11`)
gains:

```ts
webInterfacing: { searchOfferingId: string | null; fetchOfferingId: string | null };
```

**Dexie v11**: version bump + upgrade backfill to
`{ searchOfferingId: null, fetchOfferingId: null }`. Non-indexed field → no
`stores()` change. Default = nothing selected → integration inactive.

**Visibility (hidden-until-unlocked).** The web settings section is invisible
until the set `providersContributing('web')` ∩ usable-providers
(`lib/usable-providers.ts`) is non-empty. Tonight that set is empty → section
hidden → the hidden-until-unlocked behaviour is *immediately testable* even
without an adapter (the section appears the moment a `web` offering exists).
*Within* the section, "disabled over hidden" applies (a `canSearch:false`
backend appears greyed with a tooltip in the search picker).

**UI shell (functional, unstyled — mechanics-first; Chris's styling pass is
separate).** A `WebInterfacingSection` in My Settings with two pickers (search
backend, fetch backend), fed from the usable `web` offerings, each with
`qualityClass` + `canSearch`/`canFetch` badges. Selection persists to
`SettingsRow`. Raw, correct mechanics — no opulence, no orbs.

---

## 5. Wiring into stream-manager / tool-loop

The stream-manager builds the `IntegrationContext` **per send** (it knows the
active persona → `nsfwAllowed`, reads the `webInterfacing` settings, threads the
credential-bus `getKey`) and derives the ctx-bound variants:

```ts
const ctx = buildIntegrationContext(persona, settings, credentialBus);
const tools = resolveActiveTools(ctx);          // static + active integrations
// → toolDefs(tools), systemPromptSegment(tools), dispatch(..., tools)
```

The tool-loop (`lib/tool-loop.ts`) already takes `toolDefs` + `dispatch` as
**injected deps** — we inject the ctx-bound versions. **One seam, no change to
the loop logic.**

**Gating stays two-stage, zero regression:** tools are offered iff
`offering.profile.toolCalls.supported` (existing) **and** `resolveActiveTools`
is non-empty. `calculate_js` is always in the active set → flows exactly as
today, with or without web config. At zero web offerings the web integration
contributes `[]` → the model sees only `calculate_js`, exactly as now.

---

## 6. Testing

All without a live provider:

- **Registry composition:** static + dynamic; `calculate_js` always present;
  web tools dormant at zero providers.
- **Integration resolver:** active/inactive by offering selection + usability;
  `web_search` present without `web_fetch` when only a search-capable backend is
  selected.
- **`IntegrationContext` threading:** `nsfwAllowed` derived from `adultPersona`;
  `location` passed through.
- **Settings persistence + v11 migration backfill;** visibility gating (section
  hidden when the `web` set is empty).

---

## 7. Security

Client-only, no auth/sync/proxy/crypto path → **no Larissa gate today.** Record
in `obsidian/insights/security-deferrals.md` the *planned* outbound surface for
tomorrow: the web integration sends user query/URL **+ the NSFW flag + location**
to an upstream — privacy-sensitive context that leaves the device. Discipline
for the adapter: pull the key only at the outbound point via the credential-bus
(never persist/log it), never log the query or location. Tonight there is no
real network call (no adapter) → no open surface yet.

---

## 8. Explicit deferrals

- **TOMORROW (2026-06-03): the nano-gpt web adapter.** Write it, register it in
  the `web-adapter-registry`, and curate the `web` offerings (brave/exa/linkup…
  each its own offering). After this spine, that is the *only* remaining work to
  take web interfacing live. References:
  `https://docs.nano-gpt.com/api-reference/endpoint/web-search`,
  `.../endpoint/scrape-urls`, `.../miscellaneous/brave`.
- **Location source:** the `WebLocation` shape is defined and threaded, but its
  *origin* (settings field vs browser geolocation vs geo-IP) is a separate
  follow-up; today it flows as `null`.
- **Opulent styling pass** of the section (Chris's separate pass).

---

## 9. Manual verification (Chris, on device)

Because there is no provider yet, verification confirms the spine is *correctly
dormant* and *non-regressive*:

1. A maths chat still triggers `calculate_js` and returns an expandable pill
   exactly as before (zero regression on the existing tool).
2. A normal chat with no web config behaves identically to before (the model is
   offered only `calculate_js`).
3. The web settings section is **not visible** in My Settings (no usable `web`
   offering exists yet) — confirming hidden-until-unlocked.
4. (Once tomorrow's adapter lands, the same section appears, both pickers
   populate, and a selection persists across reload — to be verified then.)
