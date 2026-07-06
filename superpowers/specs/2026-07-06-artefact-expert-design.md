# Artefact Expert

**Date:** 2026-07-06
**Author:** Liz (with Chris)
**Branch:** `full-backend-transition`
**Status:** Approved by Chris; Laura spec-pass clean (2026-07-06) — ready for plan

---

## 1. Purpose

Let the user nominate a dedicated model to build artefacts, separate from the
persona's own model. Some models (Opus 4.8, Sonnet 5, GLM 5.2, Kimi K2.x, …) are
exceptional at producing self-contained artefacts — interactive SPAs, physics
sims, Markdown idea-boards — while the persona itself may run on a smaller,
more private, or local model.

This is the second member of the **"expert"** family (after `ask_expert`), and
`expert` is our deliberate umbrella term for the delegation features to come.
The rationale is threefold:

- **Freedom/privacy split.** Artefact-building is far less privacy- and
  freedom-sensitive than the conversation itself. A 31B local model will never
  match Opus 4.8 at "build me a great interactive physics diagram", and that is
  fine — the heavy, non-sensitive lifting can go to a strong upstream while the
  persona stays on the trusted model.
- **Cost focus.** The best models are expensive per megatoken; spending that
  budget only where it pays off (artefacts) is a real advantage.
- **Explicit user request.** After `ask_expert` shipped, users asked for a
  separate artefact-builder model.

We already dispatch artefact creation to a subagent, so mechanically little
changes: we swap *which* offering the subagent runs.

**Omakase, dere towards the user:** off by default; when the user does nominate
an artefact expert, it is on by default in every chat, with a per-chat opt-out.

---

## 2. Current state

### 2.1 The `ask_expert` pattern we mirror

- **Global slot:** `SettingsRow.expertModel: string | null` — a
  `"templateId:upstreamSlug"` ref — is chosen at *My Settings › "Ask an Expert"*
  (`apps/user-client/src/routes/app/settings/expert.tsx:122`) via a
  `ModelSlotPicker` with a "Use none" clear (`onClear`, line 132).
- **Per-chat toggle:** the cockpit menu shows an *Ask expert* On/Off section
  (`apps/user-client/src/components/chat/CockpitMenu.tsx:48`), gated on
  `askExpertAvailable = settings.expertModel != null`
  (`apps/user-client/src/components/chat/Cockpit.tsx:182`).
- **State model:** `askExpert` is **transient** — a Zustand value
  (`state/current-chat.store.ts:35`) reset per chat from the persona's
  `askExpertDefault` (`chat-page.tsx:270`). It is a per-*turn* intent ("ask an
  expert *for this question*"), so it deliberately does not persist.

### 2.2 The artefact dispatch we extend

`apps/user-client/src/integrations/artefact/artefact-integration.ts` contributes
a `create_artefact` tool on every send. Its `execute` resolves the author model
via `defaultResolveBase(ctx)`, which today reads **`ctx.personaOffering`** — the
persona's model — for provider, target, and reasoning profile, and fetches the
key with `ctx.getKey(ctx.personaOffering.providerId)`. It then calls
`authorArtefact({ base, brief, reasoning, … })`, persists the result with
`addGeneratedArtefact`, and invalidates the chat-artefacts query.

`IntegrationContext` (`apps/user-client/src/integrations/types.ts:14`) is
assembled per send by `buildIntegrationContext`
(`apps/user-client/src/integrations/build-context.ts`), called from the
stream-manager at `state/stream-manager.store.ts:808`. It already
**pre-resolves** capability config (e.g. `webSearch`, `webFetch`, `useProxy`)
rather than having tools read settings themselves. The artefact-owner fields
(`chatId`, `personaId`, `personaOffering`) arrive via the `ArtefactTarget`
argument. Model refs everywhere are `"providerTemplateId:upstreamSlug"`, split
on the first `:` and resolved with `getOffering(templateId, slug)` (the pattern
at `stream-manager.store.ts:636` and `:750`); `OfferingRef.providerId` carries
that template id and is what `ctx.getKey` expects.

The `ask_expert` uplink is resolved the same way: the stream-manager builds an
already-resolved `SubagentBase` from `settings.expertModel` and passes it in,
gated at runtime by the cockpit toggle — `runtimeEnabled:
useCurrentChatStore.getState().askExpert` (`stream-manager.store.ts:831`).
`ask-expert.ts` itself only consumes the resolved base; it does no ref parsing.

### 2.3 Data model — already scaffolded

Both fields were added in a prior session, ahead of this work:

- `SettingsRow.artefactExpertModel?: string | null`
  (`apps/user-client/src/boot/client-data-db.ts:39`) — global,
  `"templateId:upstreamSlug"`, absent/`null` = none. Already listed in the sync
  strip (`apps/user-client/src/sync/strip.ts:53`).
- `ChatRow.useArtefactExpertModel?: boolean`
  (`apps/user-client/src/boot/client-data-db.ts:244`) — per-chat opt-out,
  **absent ⇒ true** (use the expert whenever one is configured).

Both are non-indexed → **no Dexie version bump**, so no collision risk with the
parallel sync-hardening work.

**Deliberate divergence from `askExpert`:** the artefact toggle is a *standing*
per-chat preference ("in this chat, artefacts are always built by the good
model"), not a per-turn intent. Hence it persists on `ChatRow` (and rides along
with the chat on sync) and has no persona-level default. This is the model the
scaffold already committed to, and it matches the "on by default when an expert
is set" behaviour.

---

## 3. Design

### 3.1 Global slot — *My Settings › "Ask an Expert"* (`expert.tsx`)

Add a second `ModelSlotPicker` **below** the existing "Expert web access"
section:

- **Label:** `Artefact expert`
- **Empty label:** `None — pick an artefact-expert model`
- **Filter:** `all` — the artefact author does not call tools itself, so we do
  not restrict to tool-capable models.
- **Select:** `update.mutate({ artefactExpertModel: \`${templateId}:${slug}\` })`
- **Clear ("Use none"):** `update.mutate({ artefactExpertModel: null })`
- **Explanatory copy** — its own section, honest about the privacy surface:

  > This model builds your artefacts — interactive pages, widgets, demos —
  > instead of your persona's own model. One global choice, applied across all
  > personas; each chat can opt out.

  > Unlike "Ask an expert", building an artefact sends a **brief** written by
  > your persona, which can include detail drawn from your conversation. Choose
  > a model you're comfortable sharing that with.

  The second paragraph is **not** a copy of the `ask_expert` note (which says
  "only the sanitised question leaves your device"). The artefact brief is
  richer, and the copy must say so.

There is **no** web-access sub-section for the artefact expert — the author does
not browse.

### 3.2 Per-chat toggle — cockpit menu (`CockpitMenu.tsx`, `Cockpit.tsx`)

Add an **Artefact expert** On/Off section to `CockpitMenu`, structurally
identical to the *Ask expert* section (On/Off chips):

- **Availability gate:** shown only when `settings.artefactExpertModel != null`
  (a new `artefactExpertAvailable` prop, mirroring `askExpertAvailable`). When
  no global expert is set there is nothing to toggle, so — consistent with
  `askExpert` — the section is absent.
- **Value:** `chat.useArtefactExpertModel ?? true`.
- **Change:** writes to the **persisted** ChatRow via `useUpdateChat`
  (`data/chats.ts:102`), i.e.
  `updateChat.mutateAsync({ id: chatId, patch: { useArtefactExpertModel: on } })`.
  This is the wiring difference from `askExpert` (which writes the transient
  store): the artefact toggle is a standing preference, so it goes to the DB and
  invalidates the chat query.

**Micro-sublabels (Laura #1).** The two On/Off sections are otherwise
pixel-identical yet carry different persistence semantics — *Ask expert* is a
per-turn transient intent, *Artefact expert* a standing per-chat preference.
Nothing in the visual distinguishes them, which is exactly the adjacent-lookalike
astonishment the rubric names. Add a faint sub-label line under each section
title (a new `cockpit-menu-sublabel` element under `cockpit-menu-label`):

- *Ask expert* → **`for this turn`**
- *Artefact expert* → **`for this chat`**

Lowercase, muted, non-intrusive — an inline-marker whisper, not a paragraph. This
touches the existing *Ask expert* section too (a small, deliberate retrofit).

`Cockpit.tsx` reads the chat row (already available via `useChat`) and settings,
computes `artefactExpertAvailable` and the current value, and passes the new
props down to `CockpitMenu`.

### 3.3 Dispatch & resolution (`artefact-integration.ts` + stream-manager)

- Extend `IntegrationContext` (`integrations/types.ts`) with:
  ```ts
  /** The artefact-expert offering to build artefacts with, or null to use the
   *  persona model. Pre-resolved per send: set when a global artefact expert is
   *  configured AND this chat has not opted out; null otherwise. */
  artefactExpert: OfferingRef | null;
  ```
  Add it to the `ArtefactTarget` input of `buildIntegrationContext`
  (`integrations/build-context.ts`) and copy it straight onto the returned
  context, next to `personaOffering`.
- The **stream-manager** computes it where it assembles the `ArtefactTarget`
  argument (`stream-manager.store.ts:808`): split
  `settings.artefactExpertModel` on the first `:` into an `OfferingRef`
  (`{ providerId: templateId, upstreamSlug: slug }`, mirroring `:636`/`:750`),
  set to `null` when no global expert **or** `chat.useArtefactExpertModel ===
  false`. Unlike `askExpert` (read from the transient store at `:831`), the
  gate reads the **persisted chat row** for the active chat.
- `defaultResolveBase(ctx)` uses **`ctx.artefactExpert ?? ctx.personaOffering`**
  as the offering to resolve — provider, target, and (critically) the *expert
  offering's own* reasoning profile, never the persona's. The key is fetched
  with `ctx.getKey(<that offering's providerId>)`.

`null` → identical behaviour to today (persona builds the artefact).

### 3.4 Error path — "error + next step" (no silent fallback)

When `ctx.artefactExpert` is set (the chat wants the expert) but the offering is
**unresolvable at execute time** — key missing / master key locked, provider
needs a proxy that is unavailable, or the offering is gone from the catalogue —
`create_artefact` **does not fall back to the persona model**. It returns a
constructive `ToolResult` error that the persona relays to the user, e.g.:

> Your artefact expert (Opus 4.8) isn't reachable right now — unlock its key, or
> pick a different model under My Settings › "Ask an Expert".

Rationale: a silent fallback would build a worse artefact than the user asked
for, with no explanation. An honest error preserves the user's next step (the
*dere* half of the product). This is a conscious choice over silent fallback.

The error message names the configured expert and points at the exact settings
location. Where the specific cause is known (locked key vs missing provider), the
message says which; otherwise it gives the generic "isn't reachable" line.

**Persona-independent inline surface (Laura #4).** The constructive next-step
must not depend solely on the persona faithfully relaying a `ToolResult` string —
a smaller or quirky persona model may soften, truncate, or drop it. So the
expert-unavailable failure is *also* surfaced inline, independent of the relay:

- The failing `create_artefact` returns
  `meta: { artefactExpertUnavailable: true }` alongside the constructive `error`
  string — a discriminant that marks this specific case (distinct from an
  ordinary artefact-build failure).
- The stream-manager, seeing that discriminant on the tool outcome, drives an
  inline cockpit alert (a `role="alert"` note in the `cockpit-*-note` family,
  mirroring the dictation-failed note at `Cockpit.tsx:537`) carrying the
  constructive message **and a direct route** to *My Settings › "Ask an Expert"*,
  plus a dismiss. Transient state on the current-chat store; cleared on dismiss
  or on the next send.

Thus the user gets the actionable next-step even if the persona says nothing
useful. The persona relay remains (it is still natural for the model to comment),
but the guarantee no longer rests on it.

### 3.5 What we are NOT building (YAGNI)

- No per-persona artefact-expert default (unlike `askExpertDefault`) — the
  standing per-chat opt-out is enough; a persona-level default is not requested.
- No artefact-expert web access.
- No new artefact operations — this covers `create_artefact` only, structured so
  future artefact tools resolve the same `ctx.artefactExpert` seam for free.
- No Dexie migration — the fields exist and are non-indexed.

---

## 4. Testing

Backend/unit (Bun runner where the logic is framework-free, Vitest for React):

- **`resolveBase` selection** — with `ctx.artefactExpert` set, the author runs
  the expert offering (provider/target/reasoning from the expert, key fetched
  for the expert's provider); with it `null`, the persona offering, exactly as
  today.
- **Error path** — expert set but `getKey` returns `null` (or offering
  unresolvable) yields a constructive `ToolResult` error carrying
  `meta.artefactExpertUnavailable === true`, **not** a persona fallback and
  **not** a thrown exception.
- **Inline failure surface** — given a tool outcome with
  `meta.artefactExpertUnavailable`, the cockpit renders the alert note with the
  constructive message and a route to the expert settings; it is absent
  otherwise.
- **Stream-manager gating** — `artefactExpert` is `null` when no global expert,
  `null` when the chat has `useArtefactExpertModel === false`, and the parsed
  `OfferingRef` when a global expert is set and the chat has not opted out
  (including the absent ⇒ true case).
- **Cockpit** — the Artefact expert section renders only when a global expert is
  set; toggling writes `useArtefactExpertModel` to the chat row; both toggle
  sections show their sub-labels (`for this turn` / `for this chat`).

## 5. Manual verification (Chris, on device)

1. No artefact expert set → cockpit shows no Artefact-expert section; artefacts
   build with the persona model (unchanged).
2. Set an artefact expert in My Settings › "Ask an Expert" → the cockpit
   Artefact-expert section appears, On by default; ask for an artefact → it is
   built by the expert model.
3. Toggle it Off in one chat → that chat builds artefacts with the persona
   model; a different chat still uses the expert (per-chat, persisted).
4. Lock the master key (or remove the expert provider's key) → ask for an
   artefact → an inline cockpit note shows the constructive "expert isn't
   reachable" next-step with a route to the expert settings, **independent of
   whatever the persona says**; no artefact is produced, no silent downgrade.
5. "Use none" clears the global expert → the cockpit section disappears again.

## 6. Gates

- **Laura spec-pass** (her main lever) — **done, 2026-07-06: no hard defects.**
  She affirmed both flagged choices (hide-when-no-global-expert is *more*
  consistent than disable-with-tooltip here; the no-silent-fallback error path is
  an honest next-step, not a dead-end). Two soft findings are folded in above
  (§3.2 micro-sublabels, §3.4 persona-independent inline surface). Two are logged
  as future-watch for when the "expert" family grows past two members
  (`obsidian/insights/ux-deferrals.md`): menu density at 380 px, and renaming the
  "Ask an Expert" settings page to "Experts".
- **Larissa** — not required. Client-only; no `auth-service`, `sync-service`,
  `proxy-service`, or `packages/crypto` change. The one privacy-relevant surface
  (the brief reaching a new upstream) is addressed by the honest settings copy in
  §3.1.
