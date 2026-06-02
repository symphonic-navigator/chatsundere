# Persona Settings — Design Spec

**Date:** 2026-06-02
**Author:** Liz (brainstormed end-to-end with Chris)
**Status:** Approved — ready for implementation plan
**Branch:** `worktree-persona-settings` (isolated worktree; main checkout stays on master)
**Larissa:** not required — client-only, no `auth-/sync-/proxy-service` or `crypto` path

## 1. Summary

Three additions to the persona / settings surface, all client-only and local-first:

1. **Per-persona context window** — a slider letting each persona pick how large a
   context window to use (default `recommended`, red zone towards `max`), backed by
   **real context truncation** in the stream assembly and a constructive in-stream
   marker when earlier turns fall out of the model's memory.
2. **Persona avatar** with a rounded-square crop/fit window — the cropped full image
   plus crop metadata stored locally in IndexedDB, rendered via CSS, with the existing
   monogram as fallback. Shown in My Circle cards and the chat top-bar.
3. **Global substitute vision model** — for now a **disabled, honest placeholder** in
   My Settings (no DB field, no picker). The actual upload + routing behaviour is
   deferred to its own spec because Chatsundere has no image-attachment subsystem yet.

The three are deliberately decoupled. Feature 3 is intentionally minimal this cycle
(see §5 and §8).

## 2. Background & constraints

- **No image-attachment subsystem exists yet.** The cockpit has no file picker, paste
  handler, or drag-drop; `stream-engine.ts` always sets a wire message's `content` to a
  plain string. The multimodal `image_url` `WireContentPart` exists in
  `packages/llm-unified/src/types.ts` (added for the vision *test suite*) but is never
  produced by the client. Feature 3's full behaviour therefore depends on a whole
  upload/storage/wire/render subsystem that is its own Block-2 feature. This cycle ships
  only the honest placeholder.
- **Context window today is purely a gauge ceiling.** `contextUtilisation(used, capacity)`
  (`apps/user-client/src/lib/token-estimator.ts`) drives the top-bar bar; there is **no**
  truncation — `stream-engine.ts` replays the entire history. Feature 1 adds truncation
  for the first time.
- **Local-first / zero-knowledge.** Unlike chatsune (which stored avatars server-side on
  the filesystem behind signed URLs), avatars here live only in the browser's IndexedDB.
  Nothing is uploaded to a server.
- **chatsune divergences (deliberate):** context window was per-model-per-user there →
  **per-persona** here; vision fallback was per-persona there → **global** here.

## 3. Feature 1 — Per-persona context window + truncation

### 3.1 Data model

`PersonaRow` gains one non-indexed field:

```ts
contextWindow: number | null; // null = use the offering's recommended window
```

Dexie **v10** migration backfills `null` on existing personas (see §6).

### 3.2 Resolution

A pure helper (new `apps/user-client/src/lib/context-window.ts`):

```ts
const FLOOR = 65_536; // 64k — our system prompts are substantial and every
                      // integrated model carries a generous context window.

/** Effective floor for a given offering — never above its max. */
function effectiveFloor(offering: Offering): number {
  return Math.min(FLOOR, offering.context.max);
}

/** Resolve the context window a persona will actually use against an offering. */
function resolveContextWindow(persona: PersonaRow, offering: Offering): number {
  const target = persona.contextWindow ?? offering.context.recommended;
  return clamp(target, effectiveFloor(offering), offering.context.max);
}
```

`clamp` keeps the value valid even when the persona later switches to an offering with a
smaller `max`. `STEP = 4096`.

### 3.3 Slider (persona editor)

A new control inside the editor's **Behavior** accordion (or its own small accordion —
plan decides), only meaningful when a model is selected:

- Range `effectiveFloor(offering)` → `offering.context.max`, step `4096`.
- **Track colour:** green from floor to `recommended`, red from `recommended` → `max`
  (a CSS gradient with the colour break at the `recommended` fraction of the track).
- **Default marker** at `recommended`; a **"Use default"** button resets
  `contextWindow` to `null`.
- Value label `{value.toLocaleString()} tokens`. In the red region a subdued hint:
  "higher = costlier, slower, often weaker".
- **Edge case:** when `offering.context.max <= effectiveFloor(offering)` (no head-room),
  the slider is **disabled** with a tooltip ("This model's context window isn't
  adjustable"), mirroring chatsune's disabled-when-too-small behaviour. No red region in
  that case.
- When no model is selected yet, the control is disabled with the existing "Pick a model"
  affordance pattern.

### 3.4 Truncation (`stream-engine.ts`)

A new pure function (testable in isolation):

```ts
/**
 * Drop the oldest history messages until the estimated token total fits the
 * budget. The system prompt (first) and the current user message (last) are
 * never dropped. Returns the kept messages plus how many were trimmed.
 */
function truncateToWindow(
  wireMessages: WireMessage[],
  budget: number,
): { messages: WireMessage[]; trimmed: number };
```

Rules:

- **Always kept:** index 0 (system prompt) and the final message (the active user turn).
- Drop from the **oldest** history message forward (index 1++) until the summed
  `estimateTokens` of all kept messages ≤ `budget`.
- If `system + current user` alone already exceed `budget`, send them anyway — the active
  turn cannot be trimmed; `trimmed` counts only history messages actually removed.
- Token estimate uses the existing 4-chars-per-token heuristic (`estimateTokens`).
  Reasoning/pill blocks are already excluded from the wire by `toWireMessage`.

`stream-engine.ts` resolves `budget = resolveContextWindow(persona, offering)` and passes
the wire messages through `truncateToWindow` before sending. This means `stream-engine`
must receive the resolved budget (it already builds the wire array); the plan wires the
budget in from the caller that already knows persona + offering.

### 3.5 Gauge

`InteractionMode` already receives both `persona` and `offering`. Change the value it
hands the top-bar from `offering.context.recommended` to
`resolveContextWindow(p.persona, p.offering)`. No other gauge change.

### 3.6 Truncation marker (constructive handling — the *dere* half)

When `truncateToWindow` trimmed ≥ 1 history message for the current send, render a
**subtle, non-intrusive inline marker** at the top of the visible stream in Reading Mode:

> "Earlier messages are out of the model's memory."

- The dropped messages **remain in the DB** — only the wire is trimmed; the user can still
  scroll and read them. The marker communicates that the model no longer *sees* them.
- The marker reflects the **most recent send's** trim outcome (derived, not persisted) —
  it is informational, in the inline-marker aesthetic (small monospace pill, subtle
  background), and respects `prefers-reduced-motion`.
- Exact placement (above the first still-in-window message vs. a top banner) is a plan
  detail; the principle is: honest, quiet, no data-loss implication.

## 4. Feature 2 — Persona avatar (rounded-square crop)

### 4.1 Data model — new table

A new Dexie table `personaAvatars`, primary key `personaId`:

```ts
interface PersonaAvatarRow {
  personaId: string;       // PK — 1:1 with a persona
  blob: Blob;              // the downscaled FULL image (not pre-cropped)
  mime: string;            // e.g. 'image/webp'
  crop: { x: number; y: number; zoom: number }; // positioning metadata
  updatedAt: number;
}
```

Kept in a **separate table** so the persona list query never loads image bytes.
`useDeletePersona` gains a cascade delete of the avatar row inside its existing
transaction.

### 4.2 Storage approach — full image + CSS crop (re-editable)

Following chatsune's pattern (the part Chris liked): we store the **downscaled full image**
plus crop metadata, **not** a pre-baked cropped image. The crop is reproduced at display
time via CSS (`background-size` / `background-position`) inside a rounded-square box. This
keeps the crop **re-editable** without re-uploading.

- **Normalisation before storage:** downscale the source so its longest edge ≤ **512 px**
  (avatars render small; 512 px is ample and keeps IndexedDB light), re-encode as
  **WebP** (`canvas.toBlob('image/webp', 0.9)`).
- **Input guard:** `accept="image/*"`, hard cap **5 MB** on the picked file (rejected with
  a constructive message), basic mime sniff.
- **Crop math** (`{x, y, zoom}` → CSS `background-*`) is ported from chatsune's
  `CroppedAvatar` and unit-tested.

### 4.3 Crop modal

Port chatsune's hand-rolled Canvas crop modal (no external library):

- Drag-to-pan (mouse + touch), zoom slider (0.1–3.0).
- Mask changed **circle → rounded-square** to match Chatsundere's tiles.
- On mobile: a **bottom-sheet** (mobile-first); constrained-width on desktop.
- Confirm → produces `{ blob, mime, crop }`; the editor holds it in local component state.

### 4.4 Display component

`<PersonaAvatar personaId size>` + a `usePersonaAvatar(personaId)` hook:

- Loads the blob lazily as an object URL (revoked on unmount); renders a rounded-square box
  with the CSS-cropped background.
- **Fallback:** while no avatar exists (or none set), render the existing
  `monogramFor(persona.name)` tile — identical look to today.
- Used in **`PersonaCard`** (replaces the inline monogram tile) and the chat
  **`InteractionTopbar`**. Not on message bubbles or the greeting (keeps the reading
  surface calm — economical-with-space).

### 4.5 Editor flow

- Avatar control sits in the editor's **Identity** section.
- Tap → file picker → crop modal → Save; plus a **"Remove"** action returning to the
  monogram.
- The chosen avatar is held as **local component state** (`pendingAvatar:
  { blob, mime, crop } | 'remove' | null`) and flushed to `personaAvatars` **within the
  existing save flow** (`persistDraft`), after the persona id is known — so an avatar can
  be set during creation without threading Blobs through the persona draft or the
  TanStack query cache.
- Data-layer hooks: `useSetPersonaAvatar`, `useRemovePersonaAvatar`, `usePersonaAvatar`.

## 5. Feature 3 — Global substitute vision model (disabled placeholder)

Scope this cycle is **only the honest UI shell**, per "disabled over hidden":

- A **disabled** row/card in `apps/user-client/src/routes/app/settings.tsx`, placed next to
  the **Providers** section, labelled e.g. "Image understanding for non-vision models".
- A constructive sub-text / tooltip: **"Activates once image attachments arrive (coming
  soon)."**
- **No DB field, no model picker, no resolution logic.** The full design — global setting
  field, picker over configured vision-capable offerings, detection of "current model
  lacks vision + image attached", the describe-via-substitute call, and description
  injection — is deferred to a dedicated spec written alongside the image-attachment
  subsystem.

This both honours the "disabled over hidden" principle and avoids designing the picker UX
before the upload shape exists.

## 6. Data model / migration

Single Dexie **v10** bump covering both DB changes:

- `personas` store: add non-indexed `contextWindow` (backfill `null`).
- Add `personaAvatars` table — primary key `personaId` (no secondary indexes needed).

```ts
this.version(10)
  .stores({
    // ...unchanged stores...
    personaAvatars: 'personaId',
  })
  .upgrade(async (tx) => {
    await tx.table('personas').toCollection().modify((p) => {
      p.contextWindow = null;
    });
  });
```

The `PersonaRow` type gains `contextWindow`; a new `PersonaAvatarRow` type and table
handle are added to `ClientDataDb`.

## 7. Testing

- **Unit:** `resolveContextWindow` / `effectiveFloor` (clamp + edge where `max <= floor`);
  `truncateToWindow` (budget boundaries, system + current-user protection, the
  cannot-trim-active-turn case, `trimmed` count); the CSS crop math (ported chatsune
  cases).
- **Component (Vitest):** the editor context-window slider (default marker, "Use default"
  reset, disabled when no head-room), the avatar crop modal + `<PersonaAvatar>` fallback,
  and the disabled Feature-3 settings placeholder.
- **Data layer:** `personaAvatars` set/remove + cascade-delete with the persona.
- Per project rule: run the **full** user-client Vitest suite, not just the touched dir,
  and verify the known pre-existing baseline (the `cockpit-draft`/`chat-page`/`chat-route`
  localStorage-jsdom failures) is unchanged against master. `pnpm typecheck` is the gate.

## 8. Out of scope (deferred)

- The image-attachment subsystem (upload/paste/drag-drop UI, attachment storage, a
  message image content block, multimodal wire injection, thumbnail rendering).
- Feature 3's real behaviour (substitute-model picker, vision-lack detection, describe
  call, description injection, caching) — its own spec, alongside the upload subsystem.
- A per-model tokeniser (truncation keeps the 4-chars heuristic for now).

## 9. Manual verification (device, by Chris)

1. Edit a persona, drag the context slider into the red zone — colour break sits at
   `recommended`, hint shows; "Use default" snaps back to `recommended`.
2. On a model whose `max` equals its `recommended` (e.g. a single-`ctx` offering), the
   slider is disabled with its tooltip.
3. Have a long chat exceed a deliberately-low window → the top-bar gauge fills and the
   "out of the model's memory" marker appears; scrolling up still shows the older
   messages.
4. Set a persona avatar from a photo, pan/zoom in the rounded-square crop, save → it shows
   in My Circle and the chat top-bar; "Remove" restores the monogram.
5. Avatar set during **creation** (before first save) persists correctly.
6. My Settings shows the disabled "Image understanding for non-vision models" placeholder
   with its tooltip, next to Providers.
