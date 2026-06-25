# My Integrations — Design Spec

- **Date:** 2026-06-25
- **Author:** Liz (with Chris)
- **Status:** Chris-approved (brainstorm); **Laura spec-pass complete — no hard defects.** SOFT-1 (name the badge axis) and SOFT-4 (author the help body) folded in (§3); the Test disable-over-error nit folded (§4.2). **SOFT-3 promoted by Chris to in-scope** — a shared dirty-guard (passive `● Unsaved` indicator + discard-confirm) in `PageScaffold`/`PageBar`, applied here and retrofitted to the AI Providers detail page (§4.5). SOFT-2 (one-tap→drill-in for the default) consciously deferred with Chris sign-off (§8.1, `ux-deferrals.md`). → user review → implementation plan
- **Scope:** Rebuild `/app/integrations` (MCP servers) in the design language as a two-tier **list → detail** surface, mirroring the AI Providers tree. Replaces the pre-makeover `EditorSticky`/`AccordionCard` list and the bottom-sheet `McpServerSheet` overlay. The MCP **logic** (probe, key-sealing, local-network routing, tool curation) is ported **verbatim**; only the chrome and the add/edit/delete IA change. This is the **My Integrations** slice of the UI/UX makeover, after the Main Menu, My Account, and My Settings slices.

---

## 1. Context & Goals

Today `/app/integrations` (`routes/app/integrations.tsx`) is still pre-makeover: an `EditorSticky` + `EditorTopbar` (with `hideSaveAndBack`) wrapped around a single `AccordionCard` containing `McpServersSection`. Adding or editing a server opens `McpServerSheet` — a bottom-sheet **overlay** (`fixed inset-x-0 bottom-0`) with raw inputs, `bg-paper` buttons, and an inline two-stage delete. None of it speaks the design language.

The redesign applies exactly the moves that landed for **AI Providers** in the My Settings slice: a **`PageScaffold`** breadcrumb/`?`-help chrome, a **list page** of pure-navigation rows, and a **detail page** per server with the editing logic ported verbatim from the overlay (the same pattern as `ProviderSheet.tsx` → `routes/app/settings/provider.tsx`). The goal is the project's core conviction — *simplify & unify, single surface per intent* ([[project_simplify_unify_single_surface]]) — and a calmer surface for the neurodivergent audience ([[project_neurodivergent_audience]]).

The MCP feature is **functionally complete and recent** — including the local-network routing toggle shipped yesterday (`5441b95f`: `allowDirect` intent vs `routing` outcome, the proxy-or-direct candidate gating, the re-test cue). **The MCP feature logic — probe, routing, sealing, tool execution — is unchanged**; this slice is "rebuild as pages", not "rework the feature". The one deliberate *behavioural* addition is a shared **dirty-guard** for detail pages (§4.5), Chris's resolution of Laura SOFT-3, which also lands on the AI Providers detail page.

### 1.1 What already exists (reuse points)

| Concern | Existing code |
|---|---|
| Page chrome (breadcrumb, `?`-help, back) | `components/ui/PageScaffold.js` + `PageBar`, `content/help/use-help.js` |
| Destructive confirm dialog | `components/ui/ConfirmDialog.js` (destructive role-swap) |
| MCP data hooks | `data/mcp-servers.ts` — `useMcpServers`, `useUpsertMcpServer`, `useDeleteMcpServer`, `sealMcpKey`, `openMcpKey` |
| Connection probe | `mcp/mcp-connectivity.ts` — `testMcpConnection` |
| Tool-name sanitiser | `mcp/tool-naming.ts` — `sanitiseToolName` |
| Row status logic | `statusOf(row, hasProxy)` in `components/mcp/McpServersSection.tsx` |
| Edit/add logic (today an overlay) | `components/mcp/McpServerSheet.tsx` |
| Sibling pattern (list + detail) | `routes/app/settings/providers.tsx` + `routes/app/settings/provider.tsx` |

**No persistence schema changes. No Dexie bump.** The `McpServerRow` shape (incl. `allowDirect`, `routing`, `resolvedEndpoint`, `tools`, `hiddenTools`, settled at Dexie v30) is consumed unchanged through the existing hooks.

---

## 2. Structure & routing

`/app/integrations` stays a **flat list reached directly from the Entrance Hall**. There is **no intermediate nav-matrix root** (unlike My Settings / My Account): MCP is currently the only inhabitant, so a one-tile matrix would be empty ceremony (YAGNI; *economical with space* — [[feedback_economical_with_space]]). When a second integration type arrives (homelab / sidecar are out-of-scope today), the matrix is introduced *then*, and this list moves one tier down — a cheap future move.

```
/app/integrations            → server list      (PageScaffold)
/app/integrations/new        → detail, add mode  (PageScaffold)
/app/integrations/:serverId  → detail, edit mode (PageScaffold)
```

Both detail routes render **one** component, `IntegrationServerPage`, which decides add-vs-edit from the route (`/new` → `existing` undefined; `:serverId` → look up the row) — exactly as the sheet decides today from its `existing?` prop. Two new `<Route>`s register in `App.tsx` alongside the existing `/app/integrations`.

The **Entrance Hall tile** (`routes/app/entrance-hall.tsx`, `Plug` icon → `/app/integrations`, blue, "Nourish" room) is **unchanged** — it already points at the list and is enabled.

The obsolete `components/mcp/McpServersSection.tsx` and `components/mcp/McpServerSheet.tsx` are **deleted** once their content is absorbed (list logic → the list page; edit logic → the detail page), mirroring how the `account-sections/*` and `*Sheet` modules were retired in earlier slices.

---

## 3. List page — `/app/integrations`

A `PageScaffold` (crumb `My Integrations`, `back="/app"`, `onHelp` via a new `useHelp('integrations')`) over a single scrolling column. `integrations.tsx` is rewritten in place; `McpServersSection` is dissolved into it.

> **The `'integrations'` help body must be authored in this slice** (Laura SOFT-4). A `?` that opens nothing is a dead affordance — the inverse of disable-over-hidden. The same key is shared by all three routes (list + both detail modes), as AI Providers shares `'settings-providers'`. Manual-verification step 7 is the gate: the `?` opens real Integrations help, not an empty overlay.

**Content, top to bottom:**

1. **Egress safety note** — the existing aurora-tinted paragraph, kept **1:1**: *"MCP tools run on external servers. Each call sends its arguments — which may include parts of your conversation — to that server. Tools wait for your approval unless you mark a server as trusted."* This is the *dere*/transparency surface ([[project_constructive_error_handling]]); it stays at the top of the list, not buried in the detail page.

2. **Server rows** — **pure navigation** (Chris's call: quieter list, consistent with AI Providers). Each row is a single `<button>` navigating to `/app/integrations/:serverId`, styled like the provider rows (`flex items-center gap-3 rounded-md border border-white/5 bg-white/[0.02] p-3 … hover:bg-white/[0.04]`):
   - Leading: a `⧉` monogram tile (existing convention).
   - Body: server `name` (display font) + the **status string** from `statusOf(row, hasProxy)`, ported **verbatim** (it encodes the local-network routing states: `✗ Disabled` / `✗ Not tested` / `✗ Needs proxy or Local network` / `✗ Needs proxy` / `✗ <error>` / `● Connected (via proxy|direct)`).
   - Trailing: a **read-only badge naming the axis — `Default: On` / `Default: Off`** — derived from `onByDefault`, then the `▸` chevron. The badge replaces the inline toggle that moved to the detail page. **The axis must be named, not bare** (Laura SOFT-1): a row can read `● Connected (via proxy)` **and** `Default: Off` at once — two independent axes (reachability vs. armed-in-new-chats), and a naked `Off` would read as "server is off", contradicting `Connected`. `onByDefault` is only the **global default seed**; the live per-persona lever lives in the persona editor's `McpOverrideSection` (`draft.mcpOverrides`), so this badge is a *tell, not an act* (read-only `Badge`, never a control) — it shows the default without re-introducing an inline control.

3. **Empty state** — kept: *"No MCP servers yet — add one to give your Circle external tools."* (bordered, calm).

4. **`+ Add MCP server`** — the dashed-border add affordance, ported, navigating to `/app/integrations/new` (no catalogue picker — MCP servers are free-form, not template-backed, so the provider-style `AddProviderPicker` has no analogue here).

`hasProxy = settings.data?.corsProxy != null` is computed on the page (as today) and threaded into `statusOf`.

---

## 4. Detail page — `IntegrationServerPage` (`/new` and `/:serverId`)

A `PageScaffold` with crumbs `[{ label: 'My Integrations', to: '/app/integrations' }, { label: existing ? existing.name : 'Add server' }]`, `back="/app/integrations"`, `onHelp` (shared `'integrations'` help key, as providers share one), and **`dirty`** wired to the page's unsaved-changes flag (§4.5). The **entire editing logic of `McpServerSheet` is ported verbatim** — only `onClose()` becomes `back()` (`navigate('/app/integrations')`), the fixed-overlay wrapper becomes the page body, and the inline delete becomes a `ConfirmDialog`.

### 4.1 Fields (unchanged from the sheet)

- **Name** (text).
- **URL** (text; editing clears the prior test result via `clearTestResult()`).
- **Tool prefix** (text; auto-sanitised from name via `sanitiseToolName` until manually edited — the `prefixEdited` latch).
- **Authentication** (select: None / Bearer token / Custom header). `header` reveals **Header name**; non-`none` reveals **Key** (password; placeholder `leave blank to keep current` when editing a row whose scheme matches). Changing scheme/header/key calls `clearTestResult()`.
- **On by default** (checkbox → `onByDefault`) — now lives **only here**.
- **Trusted — run tools without approval** (checkbox → `autoRun`).
- **Local network — connect directly (must support CORS)** (checkbox → `allowDirect`) with its hover tooltip; toggling runs the existing `onToggleAllowDirect()` reset + the `routingChangedHint` re-test cue.

### 4.2 Test + Save (the explicit-action exception)

The makeover's default is always-save, but the **per-provider page is the documented exception** (sealed key + network probe), and MCP inherits it for the same reasons — **plus** the test reveals the tool list the user then curates before saving, so test and save *cannot* collapse into one button. Therefore:

- **`Test connection`** — explicit button (`Testing…` in flight). **Deliberate small deviation from the verbatim port** (Laura nit): the sheet disables Test only on `!mk` and reports a missing URL as an inline error in `onTest`; this page **disables on `!mk` *or* empty `url`** (disable-over-error is the calmer makeover behaviour). The ported test must expect the new disabled condition. Runs `testMcpConnection` through the existing proxy-vs-direct resolution and `allowDirect` gating; renders the error box, the green `● Connected (via proxy|direct) · <endpoint>` box, the `Routing changed — re-test` cue, and the **tool list** with per-tool show/hide checkboxes (`hiddenTools`). All ported verbatim.
- **`Save`** — explicit button (`Button` primary, gold not used — gold protects, never invites), with the passive **`● Unsaved`** indicator (§4.5) beside it whenever the form is dirty. Seals a freshly-typed key via `sealMcpKey` (else preserves the existing sealed blob), upserts the `McpServerRow` with `enabled: true`, clears the `dirty` flag, then `back()` to the list. Validation: Name + URL required; `mk` required.

(The `enabled` field stays always-true as today; no new "enabled" toggle is introduced — YAGNI. The `statusOf` `✗ Disabled` branch remains as defensive code.)

### 4.3 Delete

Replaces the sheet's inline two-stage confirm with a **`ConfirmDialog` (destructive)**, exactly as the provider page does:

- Trigger: a destructive-toned `Remove server` button, shown only when `existing`.
- Dialog: title `Remove <name>?`, body *"The server and its stored key are deleted. Personas lose access to its tools."*, `Remove` / `Keep`, `destructive`. On confirm: `useDeleteMcpServer().mutateAsync(id)` then `back()`.

### 4.4 Unknown / removed server

If `:serverId` matches no row (e.g. Back after a delete, or a stale link), render the `PageScaffold` with a calm notice — *"This server is no longer here — go back to My Integrations to pick another."* — mirroring the provider page's unknown-template branch. No crash, no empty form.

### 4.5 Shared dirty-guard for detail pages (resolves Laura SOFT-3 — built, not deferred)

Today a detail page (provider, and now this one) discards unsaved input silently when the user leaves via the PageBar's `‹` back or an ancestor crumb. Chris's call: **tell the user, both passively and at the moment of leaving.** Because both the back control *and* the crumbs navigate, and because the property is shared across the makeover's detail pages, the guard is a **reusable addition to the shared chrome** — applied here **and retrofitted to the AI Providers detail page** in this slice, so the makeover stays consistent rather than gaining a new asymmetry.

**Two complementary cues (Chris: "beides"):**

1. **Passive "Unsaved" indicator** — a calm read-only marker (a `Badge`, e.g. `● Unsaved`) shown next to the Save button on the detail page whenever the form is dirty. A *tell*, never a control. Lives in the detail page (next to Save), driven by the page's `dirty` boolean.
2. **Discard-confirm on leave** — when the form is dirty and the user activates the PageBar `‹` back or an ancestor crumb, a `ConfirmDialog` intercepts: title *"Discard unsaved changes?"*, body *"Your edits to this server haven't been saved."*, `Discard` (destructive) / `Keep editing`. Discard navigates to the intended target; Keep editing dismisses and stays. This is the established discard-guard idiom (the old `EditorTopbar`, the `PickerOverlay`).

**Mechanism (shared, backward-compatible):**

- `PageBar` gains an optional `onNavigate?: (to: string) => void`. The back control and ancestor crumbs call `onNavigate ?? navigate` (the `?`-help is unaffected). With no `onNavigate`, behaviour is **identical to today** — every existing page (Settings root, Account tree, etc.) is untouched.
- `PageScaffold` gains an optional `dirty?: boolean`. When provided, it owns a `ConfirmDialog` and supplies a guarded `onNavigate` to `PageBar`: if `dirty`, it stashes the target and opens the dialog; otherwise it navigates immediately. Pages that pass no `dirty` get the plain pass-through.
- **Programmatic** `navigate(...)` inside `onSave`/`onDelete` (the save-then-leave and delete-then-leave paths) bypasses the guard naturally — it does not route through `PageBar` — so a successful Save/Delete returns to the list without a spurious "discard?" prompt.
- **Boundary:** the guard covers the in-app chrome (back + crumbs), matching `PickerOverlay`/`EditorTopbar`. It does **not** install a React Router `useBlocker` for the browser back button — that broader interception is out of this slice's scope.

**`dirty` per page:**
- **Integrations detail:** a `dirty` flag flipped true on any field/checkbox change (the change handlers already exist), cleared on a successful Save. In add mode it becomes dirty as soon as the user touches a field.
- **AI Providers detail (retrofit):** `dirty = apiKey !== ''` (the lone editable field). The passive indicator and the discard-confirm both adopt it; the existing `probeProvider` regression tests are unaffected (they exercise Save, not chrome navigation).

---

## 5. Out of scope (YAGNI)

- **No nav-matrix root** for Integrations (single inhabitant — see §2).
- **No new `enabled` toggle** (§4.2).
- **No add-catalogue picker** (MCP servers are free-form — §3).
- **No Dexie / schema change** — the data model is settled (v30).
- **No behaviour change** to probing, routing, sealing, or tool execution — those are ported verbatim and are out of this slice's remit.

---

## 6. Components used

| Need | Component |
|---|---|
| Page chrome on all three routes | `PageScaffold` (+ `PageBar`, `useHelp`) — both gain the optional dirty-guard seam (§4.5) |
| Read-only On/Off row state · passive `● Unsaved` indicator | `Badge` (`components/ui/`) |
| Destructive delete · discard-changes confirm | `ConfirmDialog` (destructive) |
| Save / Remove buttons | `Button` (primary / destructive; no gold) |

The `PageScaffold`/`PageBar` dirty-guard seam (§4.5) is the only change to shared chrome; it is backward-compatible (opt-in via the new optional props) and is **also adopted by the AI Providers detail page** in this slice.

Raw inputs (text/select/password) stay as plain styled elements, matching the provider detail page — the picker family is for value-preview selection, not free-text forms, so it has no role here.

---

## 7. Testing

- **Fresh detail-page component tests** (there are **no** `McpServerSheet` tests to port). The local-network-routing **regression nets already live at the lib layer** — `tests/mcp/mcp-connectivity.test.ts` (the `buildCandidates` proxy-vs-direct gating) and `tests/boot/client-data-db-v30.test.ts` (the `allowDirect` backfill) — and this UI rebuild **does not touch** them, so they stay green by construction. The new detail-page tests mirror the `tests/component/settings-provider.test.tsx` harness (hoisted mocks of `@chatsundere/ui-shared`, `data/mcp-servers.js`, `data/settings.js`, `lib/secrets.js`, `mcp/mcp-connectivity.js`, `content/help/use-help.js`; `MemoryRouter` with the route registered + a stub `/app/integrations` parent for `back()`): cover add-vs-edit seeding, the keep-current-key placeholder, Test disabled without `mk`/`url`, and delete via `ConfirmDialog`.
- The trivial existing `tests/components/mcp/McpServersSection.test.tsx` (one assertion) is **superseded** by the new list-page test and deleted with the component.
- **List page tests**: rows render with the correct `statusOf` string + On/Off badge; a row click navigates to the detail route; `+ Add` navigates to `/new`; empty state shows with no servers.
- **Detail page tests**: add-mode vs edit-mode field seeding; delete opens `ConfirmDialog` and removes on confirm; unknown `:serverId` shows the calm notice.
- **Dirty-guard tests (§4.5)**: the passive `● Unsaved` indicator appears once a field changes and clears after Save; pressing back/crumb while dirty opens the discard `ConfirmDialog`; **Discard** navigates away, **Keep editing** stays; a clean (un-dirtied) page navigates with no dialog; a successful Save/Delete leaves without a spurious prompt. Add a focused `PageBar`/`PageScaffold` unit test for the `onNavigate` pass-through (no `dirty` → direct navigate; `dirty` → guarded). **AI Providers retrofit**: a test that a non-empty `apiKey` triggers the same guard, and that the existing `probeProvider` regression tests still pass unchanged.
- Gates per CLAUDE.md §10: `pnpm typecheck --force` (14/14, distrust a cached pass on test-touching work — [[feedback_turbo_caches_typecheck]]), full user-client vitest at the **8 Node-localStorage baseline** ([[project_vitest_baseline_is_node_localstorage]]).

---

## 8. Audit gates

- **Larissa:** **not** a security path — this is `apps/user-client` only; the crypto (`sealMcpKey`/`openMcpKey`) is consumed via a verbatim port with no change to `packages/crypto` or any `apps/*-service`. No Larissa summon.
- **Laura:** **spec-pass complete — no hard defects.** SOFT-1 + SOFT-4 + the Test-disable nit folded above; **SOFT-3 promoted to in-scope** (the §4.5 dirty-guard); SOFT-2 deferred with sign-off (§8.1). A **pre-squash pass** on the built diff still follows: verify the named badge axis, the authored help body, the dirty-guard cues, and the list/detail/delete reachability survive implementation.

### 8.1 Conscious deferrals (→ `obsidian/insights/ux-deferrals.md`)

- **SOFT-2 — "On by default" goes from one inline tap to enter→toggle→Save→back.** Accepted (Chris sign-off 2026-06-25): it is a Chris-decided trade for surface consistency with AI Providers (*fewer surface types beats fewer clicks* — [[feedback_simplify_unify_single_surface]]), and `onByDefault` is a **set-once default seed**, not a live switch — the live per-persona arming lever is `McpOverrideSection` in the persona editor. The depth cost lands on an infrequent action.
- **SOFT-3 — silently discarded unsaved changes — is NOT deferred. Chris promoted it to in-scope** (2026-06-25): built as the shared dirty-guard in §4.5 (passive `● Unsaved` indicator + discard-confirm on leave), applied here and retrofitted to the AI Providers detail page.

---

## 9. Manual verification (device — Chris)

1. Entrance Hall → My Integrations opens the list with the egress note and any existing servers (correct status string + On/Off badge).
2. `+ Add MCP server` → `/new`; fill Name + URL; **Test connection** resolves (proxy and, with **Local network** on, direct); tools appear and can be hidden; **Save** returns to the list with the new row.
3. Tap an existing server → detail pre-filled; toggling **Local network** shows the *Routing changed — re-test* cue and clears the prior result; re-test resolves; **Save** persists.
4. Edit a server with a stored key: leaving Key blank keeps the current key (test + save still work); entering a new key re-seals it.
5. **Remove server** → `ConfirmDialog`; **Keep** dismisses, **Remove** deletes and returns to the list (row gone).
6. After a delete, pressing Back to a now-dead `:serverId` shows the calm "no longer here" notice, not a crash.
7. Breadcrumbs/back behave on all three routes; `?`-help opens the Integrations help.
8. Reduced-motion: page zoom transitions respect the system setting (inherited from `PageScaffold`).
