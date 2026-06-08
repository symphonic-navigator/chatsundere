# Substitute-vision as a live in-stream pill

**Date:** 2026-06-08
**Author:** Liz (brainstormed with Chris)
**Status:** Design — approved, pending spec review
**Scope:** Client-only (`apps/user-client`). Not a Larissa change (no auth/sync/proxy/crypto; no new egress — the substitute describe already exists).

---

## 1. Context

When the active companion model cannot see images, an uploaded image is routed
through a user-chosen **substitute vision model** that describes it; the
description is injected into the wire as text (the substitute-vision flow,
2026-06-05). The describe is a single one-shot network call.

The current flow runs the describe **inside `start`, before the stream handle
exists**: `start` persists the user message + an `incomplete` persona draft +
binds attachments, then `await`s the describe, then calls `runIntoDraft` (which
creates the handle and streams). During the describe window the handle does not
exist, so `isStreamLive` is `false`. This produced two device-found UX problems
(and a now-fixed duplicate-send bug): the only progress signal was a cockpit
footer hint, and the empty persona draft briefly read as "stream interrupted".

Two band-aids landed (`2c54e60`, `af46e5d`): an `isSending` send-guard, a footer
suppression, a `describingChats` store flag + a cockpit "Describing image…" hint.
This design **replaces** them with the proper fix.

## 2. Goal

From the user's perspective the persona response **begins immediately** on send:
the persona bubble appears live, and a **per-image "reading image" pill** shows
the substitute describe in progress (an expandable, live-indicated pill that, when
done, reveals the vision model's description + which model produced it). The
actual LLM tokens follow once the describe completes (they depend on the
description being in the wire). The cockpit bottom hint is removed.

## 3. Non-goals

- Prior-turn attachment replay on regenerate (still deferred, spec §9 of the
  2026-06-05 design). Regenerate keeps its current text-only behaviour.
- Describing on a model that *can* see images (`direct` disposition) or on a
  cached description — no network call happens, so no pill.
- Changing the wire format, the describe prompt, or the substitute resolution
  (`resolveSubstituteVision`). Only *when* and *how visibly* the describe runs.

## 4. Architecture

### 4.1 Flow restructure (the core)

`start` (stream-manager) is unchanged through the transaction (persist user
message + `incomplete` persona draft, re-home lazy orphans, snapshot doc
references, `attachPendingToMessage`, clear draftInput). It then calls
`runIntoDraft` with the **raw** user input — `userText` plus the `userMessageId`
— instead of a pre-resolved `userMessageText`. The blocking
`resolveUserContent(args, userMessageId)` call is **removed from `start`**.

`runIntoDraft` (shared by `start` and `regenerate`):

1. Builds the lore pill (unchanged) and **creates the stream handle**
   (`status: 'streaming'`), then `set`s it into the store. **`isStreamLive`
   becomes true here** — the response is live.
2. **New, gated on `!reusedDraft`** (fresh send only): resolves the user content
   with live describe pills (§4.3), into the already-live handle. For a
   `regenerate` (`reusedDraft === true`) this step is skipped and the existing
   `args.userMessageText` is used as-is (unchanged behaviour).
3. Builds the wire with the resolved content and runs the existing tool-loop /
   stream (`runToolLoop` → `runStreamEngine`), unchanged.

So the describe moves from "before the handle" to "after the handle, before the
tokens", inside the live stream.

### 4.2 The vision pill

One pill **per substituted image** (Chris's call). Modelled as a `tool-call`
pill (reusing the full pending→completed→failed lifecycle, payload, persistence,
and live-update path) with a **reserved tool name `describe_image`** and
`positionHint: 'above-text'`. `Pill.tsx` dispatches it to a new **`VisionPill`**
component, exactly as it dispatches `create_artefact`→`ArtefactPill` and
`ask_expert`→`ExpertPill`:

```ts
if (row.kind === 'tool-call' && name === 'describe_image') return <VisionPill row={row} />;
```

Payload shape: `{ model: string; fileName: string; result?: string; error?: string }`.

`VisionPill` states (British-English copy; styling is a later pass):
- **pending:** `Reading image · <fileName>` with a live progress bar (the
  "something is happening" indicator), mirroring `ExpertPill`/`ArtefactPill`
  pending chrome.
- **completed:** a collapsed pill `Read image · <fileName>`; expanded reveals the
  description (`result`) and a `via <model>` line.
- **failed:** `Couldn't read image · <fileName>` (tombstone styling); the image
  still degrades to a text placeholder in the wire (unchanged), and the LLM
  answer still streams.

**Ordering:** vision pills are emitted **before** the lore pill in the content
buffer (the image is part of the just-sent input; lore is injected context).

### 4.3 Pill-lifecycle wiring

`resolveAttachmentParts` (`attachments/resolve-send.ts`) gains two optional deps:

```ts
onDescribeStart?: (a: AttachmentRow) => void;
onDescribeEnd?: (a: AttachmentRow, outcome: { ok: true; text: string } | { ok: false; error: string }) => void;
```

It calls `onDescribeStart(a)` immediately before a real `deps.describe(...)` call
(i.e. only for an uncached substitute image), and `onDescribeEnd(a, …)` after it
resolves or fails. Cached descriptions and `direct`/`placeholder`/text parts fire
neither — so no pill appears when nothing actually runs.

`runIntoDraft` provides the callbacks. `onDescribeStart` builds a `describe_image`
tool-call PillRow (`status: 'pending'`, payload `{ model, fileName }`), inserts a
`{ type: 'pill', pillId }` block into the live handle's `contentBuffer` **ahead of
the lore pill block** (spliced before the lore block's index, or at the front when
there is no lore — so vision pills lead, in image order, then lore), appends the
row to `pillBuffer`, and `set`s a fresh handle (same copy-on-write pattern as
`onChunk`). `onDescribeEnd` finds that pill by id and replaces its `status` +
payload (`result` or `error`), then `set`s again. Multiple images therefore yield
pills in upload order, all before the lore pill.

The resolution itself stays `resolveUserContent`'s job (now invoked from
`runIntoDraft`): it needs the `userMessageId`, the `args` (active offering,
substitute ref, one-shot base), and the new callbacks, plus the abort `signal`
so a cancelled send stops the describe.

### 4.4 Persistence & abort

Vision pills live in `pillBuffer`, so the existing finalise path persists them
with the message (expandable after reload — same as lore/tool pills). On abort
during the describe, `abortDiscard` for a fresh send (`reusedDraft === false`)
**deletes the draft** (existing behaviour) → no orphan pills; the user message +
bound image survive, and a retry re-describes.

## 5. Band-aid removal (cleanup)

`isStreamLive` again covers the whole live window (including the describe), so the
two band-aid commits and the interim hint are reverted:

- `chat-page.tsx`: remove the `if (sendMessage.isPending) return` guard in
  `onSend`, the `isSending={sendMessage.isPending}` prop, and the
  `|| sendMessage.isPending` clause in the interrupted-footer condition.
- `InteractionMode.tsx`, `Cockpit.tsx`, `DualActionBtn.tsx`: remove the
  `isSending` prop and its use (the Enter guard, the button `busy`).
- `Cockpit.tsx`: remove the `describingImage` selector + the "Describing image…"
  `<output>`.
- `stream-manager.store.ts`: remove `describingChats` state, the `markDescribing`
  callback, and the `describingOn` logic in `resolveUserContent`.
- Tests: remove `isSending={false}` from the 6 fixtures
  (`InteractionMode.test.tsx`, `cockpit-attachments`, `cockpit-source-menu`,
  `cockpit`, `interaction-mode`, `interaction-topbar`) and delete
  `dual-action-btn.test.tsx`.

Net result: smaller than before the band-aids.

## 6. Error handling

- Describe failure → `onDescribeEnd(a, { ok:false, error })` → pill `failed`; the
  image becomes a text placeholder in the wire (unchanged `resolveAttachmentParts`
  degradation); the LLM answer still streams.
- `resolveUserContent`'s outer try/catch still degrades to plain text on any
  unexpected error; a pending pill left by such a path is finalised/deleted with
  the draft.
- No substitute one-shot base (unresolved key) → describe throws → caught → pill
  `failed` + placeholder (unchanged degradation).

## 7. Testing

- **VisionPill** (`tests/components/chat/vision-pill.test.tsx`): pending shows
  `Reading image` + fileName; completed expands to the description + `via <model>`;
  failed shows the tombstone copy.
- **Pill dispatch** (`Pill.test` or a focused test): a `tool-call` row named
  `describe_image` renders `VisionPill`.
- **resolveAttachmentParts** (`tests/.../resolve-send` or unit): `onDescribeStart`
  /`onDescribeEnd` fire once per uncached substitute image and never for cached /
  direct / text; `onDescribeEnd` carries the description on success and the error
  on failure.
- **runIntoDraft / store** (`stream-manager-store.test.ts`): a fresh substitute
  send pushes a pending `describe_image` pill into the live handle before any
  token, then flips it to completed; a `regenerate` does not resolve attachments.
- **Full vitest** at the baseline (the reverted fixtures clean; the known
  `cockpit-draft`/`chat-page`/`chat-route` localStorage-jsdom failures unchanged).
  Typecheck `--force` 14/14 (turbo caches typecheck — force at the gate).

## 8. Manual verification (device, Chris)

1. Active model without vision + a configured image substitute; upload an image,
   send → the persona response appears **immediately** with a **`Reading image ·
   <name>`** pill (live bar), **no** "interrupted", **no** cockpit bottom hint,
   **no** duplicate turn on a second click (the send is disabled while live).
2. When the describe finishes, the pill flips to `Read image · <name>`; the LLM
   answer streams below; expand the pill → the description + `via <model>`.
3. Two images in one prompt → **two** pills, each resolving independently.
4. Re-open the chat later → the pills persist and still expand.
5. A describe failure (e.g. an unreachable substitute) → `Couldn't read image`
   pill, the answer still streams (from the placeholder).
6. Regenerate the answer → no new describe, no new pill (unchanged).

## 9. Decisions

- **D1.** Stream handle is created **before** the describe; the describe runs as
  an in-stream pill. The LLM tokens necessarily wait for the describe (semantic
  dependency) — "response begins" means the live bubble + pill, not the tokens.
- **D2.** One pill **per image**; expanded shows description **+ model name**.
- **D3.** Vision pills render **above** the lore pill (input-related first).
- **D4.** Modelled as a `tool-call` pill (`describe_image`) → `VisionPill`, reusing
  the pill lifecycle/persistence with **no Dexie change** (no new pill kind).
- **D5.** Gated on `!reusedDraft` — fresh sends describe-with-pills; regenerate is
  unchanged.
- **D6.** The interim band-aids (`isSending`, footer suppression, `describingChats`
  + cockpit hint) are **removed**; `isStreamLive` is the single source of truth.
