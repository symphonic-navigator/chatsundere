# Context Pre-Seeding — Design

**Date:** 2026-06-29
**Author:** Liz (brief-led with Chris)
**Status:** Approved (design), pending implementation plan
**Surface:** `apps/user-client` — Treasury (new "Templates" section) + the chat surface
**Larissa:** not a security path (client-only; no `apps/auth-service`, `apps/sync-service`, `apps/proxy-service`, or `packages/crypto` change)
**Laura:** spec-pass **done — no hard defects**; 6 SOFT + 1 extra folded into §§6, 7, 9, 10, 13 (quiet-secondary affordance placement; first-send *lock* not silent vanish; "Save as template" into the message overflow; "Primer"-pill not greyness-alone; author-here/apply-there signpost; export-lands-hidden notice). Pre-squash pass still required at implementation. Two firm plan conditions she will check: the 380 px control-row shown with the new action, and a legible first-send transition.
**Implementation timing:** **deferred** — built by subagents once the two in-flight features land. Spec + plan are authored now; implementation follows.

---

## 1. Purpose

Some models — older Gemma, some Llama variants — converse more readily when they
believe they are mid-conversation, with the tone already set, than when answering
a single cold opening turn. **Context pre-seeding** lets a user prime a fresh chat
with a short, simulated conversation before sending their first real message.

This is a deliberate "flagship weirdness" feature: a little underground, openly
requested, and aligned with Chatsundere's anti-censorship, user-empowerment
identity. The server never sees any of it (client-only, local-first).

The feature has three user-facing capabilities:

1. **Apply** a saved template to a fresh chat — the simulated turns are inserted as
   primer context before the first real message.
2. **Author and manage** templates in a dedicated library (a new Treasury section).
3. **Export** a real conversation, up to a chosen point, as a new template.

## 2. Goals / Non-goals

### Goals

- A user can craft a multi-turn primer (optionally a leading greeting + alternating
  user/assistant turns) in a simple editor.
- A user can apply a template to a new chat, see the primer rendered distinctly, and
  optionally remove it — **only while the chat has no real user message yet**.
- A user can export a conversation-so-far as a reusable template.
- The simulated turns reach the model on the wire as genuine `user`/`assistant`
  turns (that is the whole point — the model perceives an ongoing conversation),
  while a leading simulated *greeting* is handled exactly like a persona opener.
- Templates are **global** — reusable across any persona and any chat.

### Non-goals

- **No message editing after the fact.** Authoring happens only in the template
  editor; applying is a one-shot at chat creation. Live chat messages remain
  immutable. This is the deliberate cut that keeps the feature small.
- **No seeding mid-conversation.** Once a real user message exists, seeding is gone.
- **No transcript fidelity.** Templates carry plain text only (Tier A) — no pills,
  reasoning/CoT, tool calls, attachments, or artefacts.
- No server involvement; no sync (client-only, like the rest of standalone mode).

## 3. Terminology

- **Template** (`SeedTemplateRow`) — a saved, global primer: an optional greeting +
  an alternating body.
- **Greeting** — an optional single leading assistant turn. Because it is
  assistant-first, it is injected into the system prompt (the opener path), never as
  the first wire message.
- **Body** — a list of turns, **strictly alternating, beginning with `user`**:
  `user → assistant → user → assistant → …`.
- **Seed messages** — the materialised, display-only-but-wire-included `MessageRow`s
  produced when a template is applied to a chat (`kind: 'seed'`).

## 4. The model precedent (why this is feasible)

The codebase already injects synthetic context two ways:

- **Openers** (`kind: 'opener'`) are stored and rendered but **excluded from the
  wire** by `isContextMessage()` and instead echoed into the system prompt via
  `resolveOpenerContext` / `buildPrompt`'s `openerContext` slot
  (`apps/user-client/src/lib/stream-engine.ts`, `apps/user-client/src/lib/opener.ts`).
- **Compaction** injects a `<conversation_compact>` summary into the `memoryContext`
  slot.

Pre-seeding is the **inverse of the opener case**: seed body turns must be **included**
on the wire as real `user`/`assistant` turns. Only a leading *greeting* turn reuses
the opener's system-prompt treatment. So we add a new marker `kind: 'seed'`, and
`isContextMessage()` must **include** seed turns while still rendering them distinctly.

## 5. Data model

A new Dexie table `seedTemplates`:

```ts
interface SeedTemplateRow {
  id: string;
  name: string;
  description: string;
  nsfw: boolean;
  greeting: string | null;          // optional leading assistant turn (plain text)
  body: SeedTurn[];                 // strictly alternating, body[0].role === 'user'
  createdAt: number;
  updatedAt: number;
}

interface SeedTurn {
  role: 'user' | 'persona';         // mirrors MessageRow roles; alternates strictly
  text: string;                     // plain text only (Tier A)
}
```

Notes:

- The `body` invariant (alternating, user-first) is enforced by the editor's
  append-only construction (you add a turn; its role is implied by position), and
  validated on save. The wire builder may additionally assert it.
- `role: 'persona'` is used (not `'assistant'`) to match `MessageRow`; it maps to the
  `assistant` wire role at send time via the existing `toWireMessage`.

### ⚠️ Dexie version hazard (read before implementing)

Two features are in flight in parallel and may also bump Dexie. **Do NOT pin a
version number in the plan.** The new table takes the **next available version after
the parallel features land** ([[project_parallel_feature_dexie_version_ownership]]).
The bump task **must** include the `expect(db.verno).toBe(N)` sweep — roughly two
dozen hard-coded assertions break on any bump
([[project_dexie_bump_breaks_verno_assertions]]). Verify no version-number collision
and run the full gate on the merged state.

## 6. The Treasury "Templates" section (authoring & management)

Treasury hosts the global library. Chris's framing: a template is something the user
"creates" — and they can "create more" — so it belongs with saved/generated things.
It does **not** consume any of the eight Entrance-Hall tiles.

Structure mirrors My Knowledge's list→detail page tree:

```
/app/treasury                              existing — gains a "Templates" entry/filter
/app/treasury/templates                    Level 1 — template list (PageScaffold)
/app/treasury/templates/new                Level 2 — template detail, create mode
/app/treasury/templates/:templateId        Level 2 — template detail, edit mode
```

(Exact route shape — a sub-route vs a Treasury filter tab — is a Laura/plan detail;
the list→detail page-tree contract is the requirement.)

### List

- `PageScaffold`, pure-navigation rows: name + a trailing **NSFW badge** (kept as a
  safety cue, like My Knowledge) + a small turn-count meta.
- Respects the **global NSFW filter** (NSFW templates hidden in SFW mode), consistent
  with My Knowledge / personas.
- Single `+ Add` → `/new`. Empty state.

### Detail (the editor)

- **Metadata:** name, description, NSFW toggle — within the page's one explicit
  **Save + dirty-guard** (My Knowledge document-detail pattern; one mental model).
  The NSFW toggle follows the same "disabled-with-reason in SFW mode" vanish-guard if
  flipping it on would hide the row the user is editing.
- **Greeting:** an optional single assistant turn behind a toggle ("Start with a
  greeting"). When on, a single text area.
- **Body:** alternating turns rendered as labelled rows (`You` / persona). Operations:
  **append a turn** (role implied by position), **delete a turn**, **edit text**, and
  **↑ / ↓ reorder**. **No drag-and-drop** (CLAUDE.md §11). Deleting a middle turn
  re-derives roles by position so the alternation invariant holds.
- Plain-text fields only (Tier A). No rich content.
- **Author-here / apply-there signpost** (Laura SOFT): because the "Use this template"
  entry from Treasury is deferred (§12), the detail page carries a one-line hint —
  "Apply this from a new, empty chat" — so a first-time author is never left guessing
  where their creation gets used.

## 7. Apply flow (chat surface)

### Entry point — in the empty chat (Chris's call)

A **"Seed from template"** affordance appears in a fresh chat **only while the chat
has no real user message yet**. The moment the user sends their first message, the
affordance is gone (the hard boundary that keeps us out of "edit after the fact").

- Tapping it opens a **`PickerOverlay`** (existing zoom-from-trigger shell with
  focus-trap + dirty-guard) listing templates (NSFW-filtered). Selecting one
  **materialises** its turns into the chat as `kind: 'seed'` `MessageRow`s.
- **Placement (Laura SOFT, now a plan constraint):** the empty chat's primary intent
  is "begin" (one intent per screen, ND-friendly). The affordance is therefore a
  **quiet secondary control near the composer — not a banner**, and must **not** sit
  in the primary type-here focal path. The plan **must show the 380 px empty-chat
  layout** with the affordance present, sharing the empty state with the persona
  opener without crowding it.

### Materialisation

- The greeting (if any) becomes a display `MessageRow` mirroring the opener treatment
  (shown, kept off the wire as a turn, echoed into the system prompt).
- Each body turn becomes a `MessageRow { kind: 'seed', role }` — shown distinctly,
  **included** on the wire.

### Greeting / persona-opener interaction

- **Template greeting wins:** if the template has a greeting, the persona's auto-opener
  is suppressed for that chat (no double greeting).
- If the template has **no** greeting, the persona's auto-opener plays normally.
- Seeding is permitted while the chat has only an auto-opener and/or seeds but no real
  user message.

### Rendering & removal

- Seed messages render **distinctly** (greyed / "Primer"-marked, like openers) so the
  user always knows what is real vs primed.
- The **entire seed block is removable wholesale** (one action) while no real message
  has been sent. Seeds are **not** editable turn-by-turn in the chat — tweaking means
  editing the template and re-applying. Applying a second template before sending
  **replaces** the current seed block.
- **The one-way door is the first send, not the remove** (Laura SOFT — corrects §13.3):
  removal is *reversible* (you can re-apply). The irreversible transition is sending
  the first real message, after which seeding and removal are permanently gone for that
  chat. **Make that legible, not silent** (disabled-over-hidden): on first send the seed
  block's remove control **locks with a calm reason** (e.g. "Locked — the conversation
  has begun") rather than vanishing — the block visibly settles from "editable primer"
  to "locked primer". No confirm-on-send (that would nag). The never-applied empty-chat
  affordance simply belongs to the empty state and is gone once a message exists. **Plan
  acceptance criterion:** the first-send transition is a visible lock, not a silent
  disappearance.

## 8. Wire assembly

- New marker `kind: 'seed'` on `MessageRow`.
- `isContextMessage()` (`apps/user-client/src/lib/stream-engine.ts`) **includes** seed
  body turns (unlike openers, which it excludes). They are mapped by the existing
  `toWireMessage` (`role: 'persona'` → `assistant`).
- A leading **greeting** seed reuses the opener path: excluded from the wire as a turn,
  echoed via `resolveOpenerContext` / `openerContext`. `resolveOpenerContext` (or its
  seed-aware sibling) must recognise the seed greeting as well as a real opener.
- Result wire shape: `system (incl. greeting echo) → [seed user → seed assistant → …]
  → real user → …`. Never an assistant turn first.

## 9. Export action (conversation → template)

- A **"Save as template"** action under an assistant message. Captures **everything up
  to and including that message**.
- **Placement = the message overflow (⋯), not the flat control row** (Laura SOFT,
  resolves the two-Save adjacency + 380 px crowding): the persona-message row already
  carries six labelled controls (Branch · Regenerate · Copy · Bookmark · Save · Read);
  a seventh inline at 380 px is a visibility risk, and a second "Save…" verb beside the
  existing "◆ Save" artefact action is a disambiguation tax. "Save as template" is the
  rarest, most deliberate of the actions → it lives in the overflow. If a future layout
  ever sits two saves adjacently, **both must name their target**. **Plan acceptance
  criterion:** show the 380 px persona-message control layout (row + overflow) with the
  new action.
- **Mapping:** a leading persona opener → the template's `greeting`; the real
  user/persona turns → `body`. No opener → `body` begins at the first user turn. If the
  source chat was itself seeded, the seed turns are already plain turns and flatten in
  naturally.
- **Fidelity = Tier A** (the Chatsune-import precedent): plain text of each turn only;
  pills, reasoning/CoT, tool calls, attachments, artefacts are **stripped**.
- Lands as a **new** `SeedTemplateRow` in Treasury with a pre-filled, editable name
  (e.g. persona + date). **NSFW is monotonic** — set true if the source chat is NSFW.
- **Don't let the saved row vanish silently** (Laura SOFT, low priority): if the new
  template would land **hidden** under the current global NSFW filter (NSFW chat exported
  while in SFW mode), the success affordance **says so** (mirroring the §6 vanish-guard)
  rather than letting it disappear — avoids "I just saved it and it's gone".

## 10. Rendering distinctness (shared with §7)

Seed messages reuse the opener's visual treatment so the existing "this is not a real
turn" affordance carries over. The chat must never let a seed turn be mistaken for a
sent message; equally it must not read as broken/unsent.

**Distinctness must read as *intentional primer*, not *failed turn*** (Laura SOFT — and
higher-stakes than for openers, because seeds *are* live on the wire). Greyness alone
conventionally signals disabled/pending/failed; let a **positive marker carry the
meaning** — a "Primer" pill in the inline-marker aesthetic (CLAUDE.md §11) — rather than
greyness alone. Exact rendering is design-language-pass territory; the **plan acceptance
criterion** is the behavioural one: a seed reads as a deliberate primer, never as a
broken/unsent message.

## 11. Edge cases

- **Empty template** (no greeting, empty body): cannot be saved / cannot be applied —
  constructive disable with reason.
- **Body ending on a user turn:** the wire would then place the body's trailing user
  turn directly before the real user message — two adjacent `user` turns, which some
  models dislike. **Decision:** a body **should end on an assistant turn**. The editor
  nudges toward this (e.g. a calm hint when the last turn is a user turn) but does not
  hard-block — strict alternation already prevents adjacency *within* the body; only the
  body↔real-message seam is at issue. Whether to hard-guard the seam is pinned in the
  plan.
- **Applying to a chat that already has a persona opener:** allowed; see §7 greeting
  rule.
- **NSFW template in SFW mode:** hidden from the picker and the Treasury list (safety
  cue), consistent with My Knowledge.
- **Deleting a template** that was used to seed past chats: no effect on those chats —
  seeds are materialised copies, not references.

## 12. Out of scope / deferred

- Secondary "Use this template" entry from the Treasury detail (would add a
  persona-picker flow) — post-alpha, user-driven.
- Per-persona default template (the rejected "Hybrid" scope) — not built.
- Importing/exporting templates as files / sharing between users — future, couples to
  the eventual backend.
- Any message editing of real (non-seed) messages.

## 13. Laura spec-pass focus

- Is the in-empty-chat affordance discoverable without nagging? Does it vanish cleanly
  at first send (no astonishment)?
- Is the seed/real distinction unmistakable yet calm (not "broken")?
- Is the wholesale-remove affordance reachable? (Note: remove is *reversible* — the
  one-way door is the first send; see §7's lock-don't-vanish requirement.)
- Does the Treasury "Templates" section read as belonging there, or as a foreign body?
- Export: is "Save as template" distinguishable from the existing "Save" artefact
  action under a message (two saves — avoid the My-Knowledge `Add ▾`-vs-`⋯` ambiguity
  class)?

## 14. Manual verification (Chris, on device)

1. Author a template with a greeting + 2–3 alternating turns; save; reopen; edits
   persist.
2. Start a fresh chat; "Seed from template" appears; apply; the primer renders
   distinctly; the persona auto-opener is suppressed when the template has a greeting.
3. Remove the seed block wholesale before sending; the affordance still lets you
   re-apply.
4. Send a first message — the seed affordance disappears; the model responds as if
   mid-conversation; inspect the wire (console probe) to confirm seed turns are present
   and no assistant turn is first.
5. Apply a template **without** a greeting to a persona that has an auto-opener — the
   opener still plays.
6. Export a conversation-so-far via "Save as template"; the new template appears in
   Treasury with greeting/body correctly mapped and Tier-A plain text; NSFW set if the
   chat was NSFW.
7. NSFW template is hidden from the picker and Treasury list in SFW mode.

## 15. Testing

- Pure functions: the body alternation invariant + role-by-position derivation; the
  export capture/mapping (opener→greeting, turns→body, Tier-A stripping); the
  greeting/opener suppression rule.
- Engine: `isContextMessage` includes seeds, excludes the seed greeting; wire shape
  never starts with assistant; greeting echo reaches the system prompt.
- Data: Dexie CRUD on `seedTemplates`; the version-bump verno sweep (§5 hazard).
- Component (RTL): the editor append/delete/reorder; the in-empty-chat affordance
  appears/vanishes at the boundary; wholesale remove; "Save as template" under a
  message.
- Full user-client vitest at the 8 Node-localStorage baseline.
