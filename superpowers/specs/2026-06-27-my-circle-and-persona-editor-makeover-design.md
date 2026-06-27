# My Circle + Persona Editor — Design-Language Makeover

**Date:** 2026-06-27
**Author:** Liz (with Chris)
**Status:** Approved for planning
**Surface:** `apps/user-client` (client-only; **not** a Larissa path)

The ninth and tenth makeover surfaces — the pre-chat pair. After this, only the
chat remains. My Circle and the persona editor are rebuilt in the established
design language (`PageScaffold` + `NavTile` matrix + `cs-row` list + the picker
family + always-save), exactly as the eight prior rooms. No new persona
capabilities are added; the existing editor content is **re-housed and
re-skinned**, not redesigned in substance.

---

## 1. Goals

- My Circle becomes a `cs-row` list consistent with My History / My Treasury,
  but **keeps a visible Continue / New-Chat button on every row** — the
  fast path to the product's core action.
- The persona editor's single long accordion (`EditorSticky` + `EditorTopbar` +
  `AccordionCard`) is decomposed into a **Persona Hub** page plus **eight
  navigable sub-pages**, one per concern, in the makeover language.
- **Always-save throughout** (the whole-makeover model): editing a field
  persists immediately; there is no Save button and no dirty-guard on existing
  personas. A new persona is born via a focused **Create step**.
- Persona **delete moves to My Circle's `⋯` menu** (with confirmation); the
  editor's delete zone is removed.
- Retire the now-orphaned pre-makeover components.

### Non-goals

- No change to persona behaviour, the system-prompt builder, memory/knowledge
  engines, or any wire format. **No Dexie / schema change** (every field already
  exists on `PersonaRow`).
- Persona **Export** is *scaffolded as a visible-but-disabled affordance only* —
  the feature is not built in this work (slot reserved).
- **New incognito chat** stays a disabled-with-reason affordance (the feature is
  not yet built) — disabled-over-hidden.

---

## 2. My Circle (`/app/circle`)

A `cs-row` list of the user's personas, sorted by last interaction
(`compareByLastInteraction`, unchanged), filtered by adult-mode
(`useFilteredPersonas`, unchanged). The no-leak empty-state semantics are
preserved verbatim (identical copy whether empty or filtered-out — spec §2
Decision 4 of the original Circle).

### Chrome
- `PageScaffold`, crumbs `[My Circle]`, `back="/app"`, `onHelp` (new help doc
  key `circle`).
- A single **`＋ New persona`** affordance at the top of the list → `/app/persona/new`.
- No search / no filter (YAGNI; the list is short and sorted). Deliberately
  **not** overloaded with a second metadata line — Chris's call: avoid a
  "that's a lot to read" barrier.

### Row (`ListRow` / `cs-row`)
- **Leading:** `PersonaAvatar` (size 40) with the `StreamingOrb` pinned to its
  corner (as in My History).
- **Body:** persona **name** in `persona.colour` (persona font), over the
  **tagline** (fallback to `instructions.slice(0,60)` as today). Exactly two
  lines — nothing more.
- **Trailing, in order:**
  1. **NSFW `Badge`** (`tone="danger"`) — only in adult mode (SFW filters adult
     personas out upstream, so it only ever shows in adult mode).
  2. The **visible chat button**: label `Continue` when the persona has a chat,
     else `New Chat`. Disabled when the persona's provider is missing, with the
     existing `Provider missing` cue beside it. **Close the loop (Laura SOFT):**
     the cue is no longer a dead label — it routes to Settings → AI Providers (or
     opens the hub's Model field) so the user can act without hunting.
  3. The **`⋯` `OverflowMenu`** (see §2.1).
- **Row-body tap → the Persona Hub** (`/app/persona/:id`).

### 2.1 Overflow menu

Items, top-to-bottom, **with a divider** between the chat group and the
manage group:

```
New chat                         → /app/chat/new?personaId=:id
New incognito chat   (disabled)  reason: "Coming soon — a chat that leaves nothing in memory"
Continue             (disabled if no chat)  → most-recent chat
────────────────────────────────  ← divider
Go to persona                    → /app/persona/:id  (the hub)
Delete…              (destructive) → ConfirmDialog
```

- **Delete** opens a `ConfirmDialog` (`destructive`): title
  "Delete <name>?", body "All chats with this persona will be lost." — replacing
  the editor's old `window.confirm`. On confirm: `useDeletePersona` + stay on My
  Circle (the row disappears).
- The visible button and the menu's `Continue` resolve the same "most-recent
  chat" target (`lastChatByPersona`, unchanged).

### 2.2 Primitive change — `OverflowMenu` dividers

`OverflowMenu` currently has no separator support. Extend `OverflowItem` to
admit a separator entry — e.g. the items array may contain `{ separator: true }`,
rendered as a thin non-focusable `.cs-overflow-sep` line, skipped by keyboard
navigation and ignored for selection. Backward-compatible: existing callers
(no separators) render identically.

---

## 3. Persona create step (`/app/persona/new`)

A deliberately **focused** first step — not the full hub. Because always-save
needs a persisted row, creation is the one explicit-action moment.

Content (top-to-bottom):
- `PageScaffold`, crumbs `[My Circle → New persona]`, `back="/app/circle"`,
  help key `persona`.
- **Import** control (`ChatsuneImportControl`, `mode="create"`) under the
  "Coming from Chatsune? Import a persona and its chats." framing — the primary
  reason a create screen needs import. Seeds name / tagline / instructions /
  avatar / NSFW into the draft and stages sessions + memory (written on Create).
- **Identity:** avatar picker (`AvatarField` — pending blob staged), **name**
  (required), **tagline**, **model** (`ModelSlotPicker`, strongly encouraged but
  not required to create).
- A single **gold "Create persona"** action. **Required to create: name only.**
  On create: `useCreatePersona` → write staged avatar / imported sessions /
  imported memory (the existing `persistDraft` staging logic, run once) →
  navigate to `/app/persona/:id` (the hub).

The eight configuration tiles do **not** appear in create mode (no row to bind
to yet, and a lean create reduces friction — "Don't make me think"). The full
hub appears the moment the persona exists.

---

## 4. Persona Hub (`/app/persona/:id`)

The home page for an existing persona. `PageScaffold`, crumbs
`[My Circle → <persona name>]`, `back="/app/circle"` (honouring `?return=`, see
§7), help key `persona`. The page-bar title renders the persona name in its
own font + colour (live preview, as today's `titleStyle`).

Top-to-bottom:

### 4.1 Action row (the priority — chatting comes first)
A four-item grid (reusing today's quick-actions layout, restyled with `.cs-btn`):

| Button | Behaviour |
|---|---|
| **Continue** | Resume the most-recent chat. **Gold** when available (the screen's one priority). Disabled-with-reason when no chat exists or the persona is incomplete. |
| **New Chat** | `/app/chat/new?personaId=:id`. Disabled-with-reason when incomplete. Gold *instead of* Continue when the persona is valid but has no chat yet. |
| **New Incognito** | Disabled-with-reason ("Coming soon — a chat that leaves nothing in memory") — disabled-over-hidden. One quiet disabled entry per surface (the hub action row; the Circle row `⋯` is the other surface). |
| **History** | `/app/history?personaId=:id`. Disabled when no chats exist. |

**Gold logic (at most one per screen — gold always means the affirmative happy
path, never "fix this"; Laura SOFT):**
- Valid persona **with** a chat → gold on **Continue**.
- Valid persona **without** a chat → gold on **New Chat**.
- **Incomplete** persona (no model or empty instructions) → **no gold** (zero is
  within the at-most-one rule). The unmet requirement is shown calmly: the Model
  field and/or the Instructions tile carry a **"Needs setup"** cue, and the hub
  carries **one calm guidance sentence** framing the disabled row as a next step,
  not a locked door — e.g. *"Add an instruction and pick a model, then <name> can
  chat."* (Laura SOFT — a freshly created persona must read as an invitation, not
  a wall of grey.)

### 4.2 Identity
Avatar (always-save: pick/crop → `useSetPersonaAvatar`; remove →
`useRemovePersonaAvatar`, applied immediately — no staging on the hub), **name**
and **tagline** as always-save inline fields, and the **Model** field
(`ModelSlotPicker`, always-save). Model is here, not on a sub-page, because it is
the most fundamental property of a persona's character (Chris's framing).

### 4.3 The eight tiles (`NavTile` matrix, 2 cols × 4 rows)

Order follows behaviour → engine → knowledge → aesthetics. Colour-clustered by
concern:

| # | Tile | Colour (cluster) | Route | Meta line (basic config) |
|---|---|---|---|---|
| 1 | **Instructions** | pink (*who it is*) | `…/instructions` | `Chatsundere voice · Adult` / `Plain voice` / `Needs setup` when empty |
| 2 | **Roleplay** | pink | `…/roleplay` | `Off` / `First person · Greeting` |
| 3 | **Model behaviour** | blue (*the engine*) | `…/model` | `Temp 0.85 · Expert` (context shown if overridden) |
| 4 | **Integrations** | blue | `…/integrations` | `N servers` / `No tools` |
| 5 | **Knowledge** | green (*knows & retains*) | `…/knowledge` | `N libraries` / `No libraries` |
| 6 | **Memory** | green | `…/memory` | `Remembering` / `Off` (uncommitted-count badge optional) |
| 7 | **Font & Voice** | purple (*appearance & atmosphere*) | `…/font-voice` | `Serif · Voice` / `Serif` |
| 8 | **Mindspace** | purple | `…/mindspace` | mindspace `displayName` / `User default` |

### 4.4 Import / Export (bottom of the hub)
Rarely-used operations, so they live at the **bottom** (where the old delete zone
was — Chris's call):
- **Import** (`ChatsuneImportControl`, `mode="edit"`) — merge a Chatsune export
  into *this* persona. Always-save: applying writes immediately (optional config
  overwrite + additive session/memory import + monotonic NSFW upgrade), reusing
  the current `onApplyImport` logic adapted to write-now rather than stage.
- **Export** — visible but **disabled-with-reason ("Coming soon")**. Slot only.
  Kept quiet and low-weight at the bottom so a permanently-disabled affordance
  reads as a reserved capability, not a standing nag (Laura SOFT).

There is **no delete control on the hub** (moved to My Circle's `⋯`).

---

## 5. The eight sub-pages

Each is a real route, each a `PageScaffold` with crumbs
`[My Circle → <persona name> → <section>]`, `back` to the hub, a per-page help
doc, and **always-save** fields (every `patch` persists immediately via
`useUpdatePersona`). Content is the existing accordion content, re-housed.

1. **Instructions** (`…/instructions`)
   - Two toggles at the top: **Chatsundere tonality** and **Adult persona**
     (these shape model behaviour, so they head the page).
   - **Custom Instructions** textarea (`AutoSizeTextarea`, required — shows the
     required cue when empty).
   - **What the model knows about you** — the About-Me override, **with the
     existing fallback semantics**: empty → the global About-Me is used (shown as
     the grey placeholder); filled → overrides for this persona only.

2. **Roleplay** (`…/roleplay`)
   - **On / off** toggle (or a `cs-segmented` on/off).
   - When **on**: **First person / Third person** narration (`cs-segmented`).
   - When **on**: the **Greeting** section unlocks — a greeting toggle plus the
     greeting-rules textarea (the validation rule stands: greeting on + empty
     rules is flagged). When roleplay is off, greeting is unavailable
     (disabled-with-reason), since the greeting belongs to roleplay framing.
   - **Behaviour change (Chris-signed-off, Laura HARD):** coupling greeting to
     roleplay is a deliberate product decision. Greeting is independent of
     roleplay in the codebase today (`PersonaRow.greetingEnabled` is read
     unconditionally by the opener path), so existing personas may have a
     greeting without roleplay and would keep firing an opener while the control
     is hidden — an orphaned active state. **Fix: a runtime gate** — the opener
     fires only when `roleplay && greetingEnabled`. Greeting-only personas
     quietly stop greeting until roleplay is enabled; their `greetingInstructions`
     are **preserved** (re-appear when roleplay is turned on). **No Dexie
     migration** (runtime gate only — Chris's call between the gate and a one-time
     data cleanup). A test pins "opener does not fire when roleplay is off even if
     greetingEnabled is true".

3. **Model behaviour** (`…/model`)
   - **Temperature** slider (default 0.85, 0–2 step 0.05).
   - **Context window** (`ContextWindowControl`, resolved from the chosen
     offering; "Use default" reset preserved).
   - **Ask an expert by default** toggle (disabled-with-reason when no global
     expert model is configured) — placed here by Chris's call; it is capability
     tuning and saves a separate tile.

4. **Integrations** (`…/integrations`)
   - `McpOverrideSection` (per-persona MCP server access). Framed for future
     non-MCP integrations.

5. **Knowledge** (`…/knowledge`)
   - `KnowledgeSection` (knowledge-base library assignment). This is the
     deferred persona-editor knowledge sub-surface — re-skinned to the design
     language here (its assignment internals are preserved).

6. **Memory** (`…/memory`)
   - The existing `PersonaMemory` page, given makeover chrome (`PageScaffold` +
     crumbs + help) and the **per-persona memory settings folded in at the top**:
     the **Remembering on/off** toggle and the **memory instructions** field
     (today's `MemorySection` knobs), above the existing journal-triage / body /
     versions surface. One Memory surface, reachable from both the hub tile and
     the chat cockpit (`?chat=` deep-link preserved). Functionally complete
     today — this is reskin + host + fold-in, not a rebuild.
   - **Scope label (Laura SOFT):** because this page is reached from a *chat*
     cockpit, the folded-in toggle must be explicitly labelled persona-global —
     e.g. *"Applies to all chats with <name>"* — so a user arriving from one chat
     cannot mistake "Remembering off" for a per-chat switch.

7. **Font & Voice** (`…/font-voice`)
   - **Font** selector (`cs-segmented`: Sans / Serif / Cursive, each shown in its
     own face), with the "font is the persona's visual voice" note.
   - `TtsModerationNotice` + **Voice** (`VoicePicker`), and the **Narrator voice**
     `VoicePicker` when roleplay is on (disabled-with-reason without a TTS
     provider).

8. **Mindspace** (`…/mindspace`)
   - `MindspacePicker` only (always-save). Selecting a mindspace also updates
     `persona.colour` from the mindspace accent (existing linkage preserved);
     texture override handled as today.

---

## 6. Always-save adaptation

- Every sub-page field calls `patch(...)` which now **persists immediately**
  (`useUpdatePersona`) rather than setting a dirty flag. Blur/Enter de-dup as in
  `InlineEditRow`/`InlineEditTextarea` for text fields; toggles/sliders/pickers
  persist on change.
- The hub identity (name/tagline/avatar/model) is always-save.
- **No dirty-guard** anywhere in the persona surfaces (create is the lone
  explicit action).
- The mindspace store reset that Circle and the editor perform (so the editor's
  mindspace context does not leak back to Circle) is preserved.

---

## 7. Routing & `?return=`

New / repurposed routes (flat under `ProtectedRoute`, sibling style, as the rest
of the makeover):

```
/app/persona/new                 → PersonaCreate (focused create step)
/app/persona/:id                 → PersonaHub
/app/persona/:id/instructions    → PersonaInstructions
/app/persona/:id/roleplay        → PersonaRoleplay
/app/persona/:id/model           → PersonaModelBehaviour
/app/persona/:id/integrations    → PersonaIntegrations
/app/persona/:id/knowledge       → PersonaKnowledge
/app/persona/:id/memory          → PersonaMemory   (existing, reskinned)
/app/persona/:id/font-voice      → PersonaFontVoice
/app/persona/:id/mindspace       → PersonaMindspace
```

The hub honours `?return=<path>` (used by the chat interaction-topbar's
persona-name click to return to the chat): back / chat-action navigation lands on
`return` when present, else `/app/circle`. Sub-pages return to the hub.

---

## 8. Components retired

After the rebuild, these have no remaining consumers and are deleted with their
dead CSS:
- `EditorTopbar`, `EditorSticky`, `AccordionCard` (persona-editor + Circle were
  the only consumers).
- `PersonaCard` (Circle was the only consumer; replaced by `cs-row`).
- `MemorySection` (its knobs fold into the Memory page).
- The monolithic `persona-editor.tsx` route is replaced by the create-step + hub
  + sub-page set; `ContextWindowControl` is kept (re-homed to the Model
  behaviour page).

---

## 9. Help docs

New `useHelp` keys + Markdown docs: `circle`, `persona` (hub + create),
`persona-instructions`, `persona-roleplay`, `persona-model`,
`persona-integrations`, `persona-knowledge`, `persona-font-voice`,
`persona-mindspace`. The Memory page reuses / extends its existing help.

---

## 10. Testing

- Vitest at the established baseline. New / updated suites: My Circle row
  (button label resolution, provider-missing, overflow incl. divider + delete
  confirm), the `OverflowMenu` separator, the create step (name-required, import
  staging on create), always-save persistence per sub-page (a representative
  field each), gold-priority resolution on the hub, `?return=` round-trip.
- **Laura spec-pass: done** (1 HARD — greeting/roleplay orphan — fixed via the
  runtime gate in §5.2 with Chris's sign-off; soft findings folded: affirmative-
  only gold + calm incomplete-state sentence, persona-global memory-toggle label,
  provider-missing routes to Settings, concrete incognito reason, quiet Export).
  Pre-squash Laura pass on the built diff still required.
- **opus** whole-branch review before squash.
- Client-only — **no Larissa pass** (no `apps/auth-service`, `sync`, `proxy`, or
  `packages/crypto` change).

## 11. Manual verification (Chris, on device)

1. My Circle: row tap → hub; visible Continue/New-Chat works; provider-missing
   row disables the button; `⋯` shows the divided menu; New incognito is
   disabled; Delete confirms and removes the persona.
2. Create: `＋ New persona` → name-only create succeeds → lands on hub;
   Chatsune import on create seeds fields + brings chats in on Create.
3. Hub: Continue is gold with a chat / New Chat gold without; an incomplete
   persona shows "Needs setup" and guides to the missing step; every tile shows
   the right meta line; Import (merge) works; Export is visibly disabled.
4. Each sub-page: a field edit persists with no Save button and survives back +
   re-open; the chat picks up the change.
5. Memory page reached from both the hub tile and the chat cockpit; toggle +
   instructions live there now.
6. `?return=`: from a chat, tapping the persona name → hub → back returns to the
   chat.

---

## 12. Open follow-ons (non-blocking)

- The makeover-wide tap-target sweep (shared `⋯` trigger 32→40–44 px) — fold the
  new divider menu into it.
- The design-language pass deferrals tracked in STATUS (picker Save-affordance
  grammar, Mindspace live-preview, `:focus-visible` rings) — touch where this
  work overlaps.
