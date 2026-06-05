# Unified Lightbox & User Attachments — Design Spec

**Date:** 2026-06-05
**Author:** Liz (brainstormed end-to-end with Chris)
**Status:** Approved — ready for implementation plan
**Branch:** `feat/attachments-and-lightbox` (isolated worktree; main checkout stays on master)
**Larissa:** not required — client-only (`apps/user-client` + a one-shot `llm-unified` wire call); no `auth-/sync-/proxy-service` or `crypto` path. The new outbound surface is logged in `obsidian/insights/security-deferrals.md` (see §13).

## 1. Summary

A **single, unified lightbox** component plus the first **user-attachment** use case (uploading text and images). The lightbox is the one viewer/manager for *all* rich content in Chatsundere — uploaded attachments now, generated artefacts and images later — so that the forthcoming artefact feature plugs in without touching the lightbox.

Three deliverables, all client-only and local-first:

1. **The unified lightbox** — a presentation-only component fed a list of viewable items, an index, and a per-item capability descriptor. It renders a body by content `kind` (image / text / markdown) and a toolbar by content `origin` (upload / generated). Navigation loops; text has a Preview ↔ Source (editable) toggle. It opens by zooming out of the tapped thumbnail and closes by zooming back into it.
2. **User attachments** — uploading text and images via the cockpit `(+)` picker, clipboard paste, and OS file drag-drop (desktop). Attachments are first-class entities in a new IndexedDB table, local to a chat while pending, attached to a user message on send, rendered as a thumbnail strip in both the cockpit and the message bubble, and injected into the wire request on send.
3. **Global substitute vision model** — making real the disabled placeholder shipped with the persona-settings cycle. When the active persona's model cannot see images, a globally-configured vision model describes each image in text, and that description is injected into the non-vision model's context. The proven chatsune mechanism, ported client-side and made global.

The producers of *generated* content (an image-generation tool, the artefact feature) are out of scope; the lightbox and data model reserve the seams for them.

## 2. Background & constraints

- **No attachment subsystem exists yet.** The cockpit `(+)` button is a disabled stub (`apps/user-client/src/components/chat/Cockpit.tsx`, `data-control="plus"`, "Coming with Treasury"). There is no file picker, paste, or drop handler. `apps/user-client/src/components/AutoSizeTextarea.tsx` is the plain controlled textarea.
- **The wire is multimodal-ready but the client never produces it.** `WireContentPart` with `image_url` exists in `packages/llm-unified/src/types.ts` (added for the vision test suite), but `stream-engine.ts` always sets a message's `content` to a plain string. This spec is the first producer of multimodal content from the client.
- **Vision capability is a per-offering boolean.** `offering.profile.vision` (`true` ⇒ the model can see images), surfaced today only as a picker hint (`apps/user-client/src/routes/app/persona-editor.tsx:1016`).
- **The content model is a closed union.** `ContentBlock = text | pill | reasoning` and `PillRow.kind ∈ { tool-call, kb-injection, image-result, voice-expression }` (`apps/user-client/src/boot/client-data-db.ts`). User attachments are **not** added to this union (decision A, §4); they are a parallel first-class relation joined by `messageId`.
- **Blob storage is proven.** `personaAvatars` (Dexie v11) stores a `Blob` + metadata and renders via CSS; the same pattern backs attachments.
- **One-shot inference already exists.** `composeOneShotWire` / the one-shot completion path (used by the title generator) routes a non-streaming call through the per-model adapter. The substitute-vision "describe this image" call reuses this path.
- **Overlay precedent.** Sheets (`TocSheet`, `BranchSheet`) are absolute-positioned bound to `.chat-page` (to survive the mindspace transform layers); `AvatarCropModal` is a fixed modal; `SplashOverlay` performs an imperative FLIP transform. The lightbox follows the `.chat-page`-bound absolute pattern and borrows the FLIP technique.
- **chatsune divergences (deliberate):** the vision fallback model was per-persona there → **global** here; the description orchestration was a backend service there → **client-side** here, cached on the attachment row rather than in Redis. **Image normalisation** ran server-side (Pillow) at chatsune's inference chokepoint; with no backend in our path it moves **client-side** (browser canvas), porting the rules/parameters but not the code (§5.3).

## 3. Scope

**In scope**

- The unified lightbox component (image + text/markdown bodies; upload-origin toolbar).
- Upload via `(+)` picker, clipboard paste, OS file drop.
- The `attachments` table; pending → sent lifecycle; cockpit + message-bubble rendering.
- Rename and Remove (Remove is pending-only, via the lightbox).
- Preview/Source toggle with editable source for pending text attachments.
- Multimodal wire injection (images + text attachments, filename always carried).
- Global substitute vision model (setting + routing + caching + live status).
- Vision gating and the no-substitute fallback.

**Out of scope (seams reserved)**

- Generated content producers: image-generation tool, the artefact feature. The lightbox `origin: 'generated'` toolbar (Download, Delete) and the `state: 'deleted'` render path ("image deleted") are *designed* but not built (no producers exist).
- Download and Delete actions (generated-origin only).
- A context menu / quick-remove gesture on thumbnails (kept as a future option; "Duplo over Lego").
- PDF and other binary types, OCR (a large separate topic — beta or later).
- Pinch/zoom-and-pan within an image (fit-to-view only in v1).
- Editing the content of already-sent attachments (would mean retroactive message editing — its own feature). Rename of sent attachments *is* supported (metadata only).

## 4. Data model

### 4.1 New table `attachments` (decision A — first-class entities)

```ts
export type AttachmentKind = 'image' | 'text';
export type AttachmentOrigin = 'upload' | 'generated'; // only 'upload' produced in v1
export type AttachmentState = 'active' | 'deleted';    // 'deleted' reserved for generated content

export interface AttachmentRow {
  id: string;
  chatId: string;
  messageId: string | null;   // null while pending (local to the chat's compose state)
  origin: AttachmentOrigin;
  kind: AttachmentKind;
  fileName: string;           // user-editable; ALWAYS sent on the wire
  mime: string;
  order: number;              // stable ordering within its collection
  state: AttachmentState;     // 'active' in v1; flips to 'deleted' when generated-delete lands
  createdAt: number;

  // Payload — exactly one is populated per kind:
  blob?: Blob;                // kind === 'image' — the NORMALISED JPEG (§5.3), the only copy
  text?: string;              // kind === 'text' (editable via the lightbox Source view while pending)

  // Image metadata (kind === 'image') — post-normalisation:
  width?: number;
  height?: number;

  // Substitute-vision cache (kind === 'image'): the description, keyed by the model that produced it
  visionDescription?: { model: string; text: string } | null;
}
```

Index: `'id, chatId, messageId, [chatId+messageId]'`. Pending attachments are queried by `[chatId+messageId]` with `messageId = null`; a message's attachments by `[chatId+messageId]` with its id.

### 4.2 Settings — global substitute vision model

`SettingsRow` gains one non-indexed field:

```ts
substituteVisionModel: string | null; // an offering ref (provider+model); null = none configured
```

### 4.3 Dexie migration v11 → v12

`.stores({ ..., attachments: 'id, chatId, messageId, [chatId+messageId]' })`; `.upgrade` backfills `substituteVisionModel = null` on the settings row. Fresh-open verno assertions bump 11 → 12.

### 4.4 Lifecycle

- **Add** → an `AttachmentRow` with `messageId: null`, `origin: 'upload'`, `state: 'active'`.
- **Remove (pending)** → row deleted (blob released). The lightbox advances to the next item in the collection.
- **Send** → every pending row for the chat has its `messageId` set to the new user message id (atomically with message creation). They are no longer pending.
- **Switch chat** → pending rows stay bound to their `chatId`; the other chat shows its own (or none). Pending attachments are therefore local to the chat, as required.

## 5. Upload — entry points & validation

### 5.1 Entry points

1. **`(+)` picker** — the existing stub becomes live: opens the native file dialog (`accept` filtered to the supported types), multiple selection allowed. Primary, mobile-capable path.
2. **Clipboard paste** — a paste handler on the cockpit: image/file clipboard items become attachments; **plain text remains normal textarea paste** (prompt text), to avoid astonishment.
3. **OS file drag-drop** — dropping OS files onto the chat surface adds them. This is *desktop OS interaction* (pulling a file in from outside), explicitly distinct from in-app element drag-and-drop, which §11 forbids — the distinction is recorded here as the rationale. A drop target overlay appears on dragover; touch has no drag and is unaffected.

### 5.2 Accepted types & limits (validated at the boundary — security-first)

- **Images:** `image/png`, `image/jpeg`, `image/webp`, `image/gif`. Per-file cap ~**10 MB** on the **raw input** (the gate before normalisation; the stored/sent copy is much smaller — see §5.3).
- **Text-like:** `text/*` plus common code/markdown types (by mime and, as a fallback, extension: `.md`, `.txt`, `.json`, `.csv`, `.ts`, `.js`, `.py`, …). Per-file cap ~**1 MB**.
- **Anything else** (PDF, binary) is rejected at the picker/drop with a friendly, constructive notice naming what is supported (least astonishment). PDF/OCR is a deferred topic.

Rejected files never create a row. Limits and the type list live in one module so they are easy to tune.

### 5.3 Client-side image normalisation (at upload)

Many models impose tight image limits (edge length, bytes, formats). Every accepted image is **normalised in the browser at upload time**, and **only the normalised copy is stored and sent** (WYSIWYG: the lightbox shows exactly what the model receives). This ports chatsune's proven *rules and parameters*; the *technique* is browser-native (chatsune normalised server-side with Pillow — we have no backend in this path, so it must be client-side; see §2).

Rules (a pure-ish `normaliseImageForLlm(file): Promise<{ blob, width, height }>` module):

- **Longest edge ≤ 1024 px**, aspect ratio preserved, **never upscale**.
- **Output always `image/jpeg`, quality 0.85.**
- **Flatten alpha onto white** (`#ffffff`) — JPEG carries no transparency.
- **Animated GIF → first frame only** (canvas draws one frame inherently).
- **Apply EXIF orientation, then drop all metadata** — `createImageBitmap(file, { imageOrientation: 'from-image' })` applies orientation; canvas re-encode drops EXIF/ICC.
- **Small images are not scaled but still re-encoded** to JPEG, for a single predictable output.
- **Universal cap for all models** (no per-model limit) — a deliberate "Duplo" choice; a per-model lookup can come later if a model proves stricter.

Technique: `createImageBitmap` (with `imageOrientation: 'from-image'`, and `resizeWidth`/`resizeHeight` + `resizeQuality: 'high'` where supported) → draw onto a white-filled `canvas` (or `OffscreenCanvas`) at the target size → `canvas.toBlob('image/jpeg', 0.85)`. Where high-quality resize is unavailable, fall back to stepped halving for clean downscaling.

The stored `AttachmentRow.blob` is this JPEG, `mime = 'image/jpeg'`, `width`/`height` are the post-normalisation dimensions. The original filename is kept for display and the wire (its extension may no longer match the JPEG bytes — acceptable; the name is a label). **No byte-budget loop** (chatsune had none): a 1024 px q85 JPEG sits comfortably under typical model limits; if a future model is stricter we add an adaptive pass. **Behaviours without a v1 warning** (documented, matches chatsune): GIF animation is lost, transparency becomes white.

## 6. The unified lightbox

### 6.1 Contract (the "Duplo" core)

The lightbox knows nothing about Dexie, attachments, or artefacts. It receives:

```ts
interface ViewableItem {
  id: string;
  kind: 'image' | 'text' | 'markdown';
  fileName: string;
  // content accessors:
  imageUrl?: string;      // object URL for kind 'image'
  text?: string;          // raw text for 'text' / 'markdown'
  // capability descriptor, derived by the caller from origin + kind + pending state:
  caps: {
    rename: boolean;
    remove: boolean;      // upload-origin, pending
    download: boolean;    // generated-origin (not produced in v1)
    delete: boolean;      // generated-origin (not produced in v1)
    editSource: boolean;  // text/markdown, pending
  };
}

interface LightboxProps {
  items: ViewableItem[];
  index: number;
  onRename(id: string, name: string): void;
  onRemove(id: string): void;          // caller decides what "remove" means
  onEditText(id: string, text: string): void;
  onClose(): void;
  originRect?: DOMRect;                 // for the zoom open/close
}
```

The caller (cockpit or message bubble) maps its `AttachmentRow[]` → `ViewableItem[]` and supplies the callbacks. This is the single seam the artefact feature later reuses. Note the storage `AttachmentKind` is only `image | text`; the finer viewer distinction `text` vs `markdown` is **derived by the caller** from mime/extension (`.md` ⇒ `markdown`, else `text`) — storage stays coarse, the viewer renders precisely.

### 6.2 Chrome (toolbar) by `origin`

- **Upload (v1):** Rename, Remove. No Download (the user already has the file). No Delete.
- **Generated (reserved):** Rename, Download, Delete (→ "image deleted" in the stream).
- Categorically inapplicable actions are **omitted, not greyed** (Download for one's own upload is never meaningful — this is not a "temporarily unavailable" case where §11's disabled-over-hidden applies).

The filename sits in the toolbar and is the rename affordance (tap to edit inline; confirm/escape). Close (`×`) triggers the zoom-back-to-thumbnail.

### 6.3 Body by `kind`

- **image:** fit-to-view. (Pinch/zoom-pan deferred.)
- **markdown:** a **Preview** (default; rendered through the existing `MarkdownContent` pipeline) ↔ **Source** segmented toggle. Source is an editable monospace textarea; edits call `onEditText` and persist to the pending row. Sent attachments expose Source read-only (`editSource: false`).
- **text / code:** same Preview/Source toggle; Preview shows the text (syntax-highlighted via the existing shiki path when the language is known, otherwise plain), Source is the editable raw.

### 6.4 Navigation

Left/right chevrons cycle the `items` array with **loop** (wrap-around); a `n / total` counter shows position. Keyboard `←`/`→` and `Esc` (close) on desktop. When a Remove drops the current item, the index resolves to the next item (or closes if the collection is now empty).

### 6.5 Zoom open / close (so the user *feels* it)

On open, FLIP from `originRect` (the tapped thumbnail's bounding rect) to the lightbox surface; reverse on close. Borrows `SplashOverlay`'s imperative-transform technique. `prefers-reduced-motion` ⇒ a plain opacity fade. The lightbox is an absolute overlay bound to `.chat-page` (z above the sheets), consistent with the existing overlay pattern.

## 7. Cockpit thumbnail strip

Layout, top → bottom (confirmed against the real cockpit, which has its controls **above** the input): **controls row → divider → thumbnail strip → input field**. The strip + input form a visual unit ("the prompt"), separated from the controls by the divider. The strip is horizontally scrollable when it overflows; each thumbnail shows the image (or a document tile with the extension) and the filename. Tapping a thumbnail opens the lightbox (collection = all pending attachments for the chat; `originRect` = the thumbnail). **No `×` on the thumbnail** — removal is via the lightbox only (Chris's deliberate anti-misclick choice; see §12 for the rationale and the future context-menu option).

## 8. Sent attachments in the message bubble

A sent user message renders its text plus a thumbnail strip below it, joined from `attachments` by `messageId` (decision A keeps `contentBlocks` about text/reasoning/pills). Tapping a thumbnail opens the lightbox with collection = that message's attachments. Origin is `upload`, so the toolbar is Rename only for sent items (Remove is pending-only); Source is read-only. A row with `state: 'deleted'` renders an "image deleted" placeholder — the path exists for the future generated-delete; uploads never reach it in v1.

## 9. Wire injection (on send)

Built where `stream-engine.ts` currently assembles the user turn's `content`. For a user message with attachments, `content` becomes a `WireContentPart[]`:

- **Images, model can see (`offering.profile.vision`):** an `image_url` part with a base64 data URL of the stored (already-normalised, §5.3) JPEG blob. A short preceding text part names the file (`[Image: <fileName>]`) so the filename always travels.
- **Images, model cannot see + substitute configured:** a text part with the substitute description (§10), formatted `[Image description for <fileName> (via <model>): <text>]`.
- **Images, model cannot see + no substitute:** a placeholder text part `[Image: <fileName> — current model cannot see images, image omitted]` (chatsune's graceful degrade).
- **Text attachments:** a delimited text part headed by the filename, e.g. `Attachment: <fileName>\n\`\`\`\n<text>\n\`\`\``. Model-agnostic.

History replay re-injects the same parts deterministically (image descriptions read from the cached `visionDescription` on the row, so a replayed turn stays consistent without re-describing).

## 10. Global substitute vision model

Porting chatsune's proven mechanism, client-side and global.

### 10.1 Setting

The persona-settings-cycle placeholder (`SubstituteVisionPlaceholder` in `settings.tsx`) becomes a real picker under "Image understanding", filtered to offerings with `profile.vision === true`, writing `settings.substituteVisionModel`. Disabled-over-hidden when no vision-capable offering is configured (constructive tooltip).

### 10.2 Trigger (precedence — Chris's rule)

A pure `canSendImages(persona, substituteModel, lookupOffering)` (ported from chatsune's `visionGate.ts`):

1. Active persona model's `profile.vision === true` ⇒ image sent directly. **Active model always wins.**
2. Else if a `substituteVisionModel` is configured and *it* is vision-capable ⇒ substitute path.
3. Else ⇒ non-vision-no-substitute (warn on attach, placeholder on send; §11).

### 10.3 Mechanism

When the substitute path fires on send, for each image without a cached `visionDescription` for the current substitute model:

- One-shot call (via the existing one-shot wire path) to the substitute model with the image (base64 data URL of the same normalised JPEG, §5.3) and a fixed instruction (British English):
  > "Please describe this image in detail: subjects, objects, layout, any visible text, colours, and the overall mood. Be specific and concrete. Do not add interpretation or advice — only what is in the image."
- The call uses the most conservative shape: **no reasoning, no tools, low temperature (~0.2)**. One silent retry on first failure (cold-start tolerance); a second failure surfaces a constructive error and falls back to the placeholder part for that image.
- The result is cached on the attachment row (`visionDescription = { model, text }`) and injected per §9. Cache hit ⇒ no re-describe.

### 10.4 Live status

While an image is being described, its thumbnail (cockpit and/or the just-sent message) shows a quiet "analysing…" state; on success it clears, on error it shows a constructive retry affordance. (Internal status only — **no** technical vision chip in the lightbox; Chris: it would overwhelm the user.)

## 11. Vision gating & fallback

- **Attach is never hard-blocked** in v1: a user may attach an image intending to switch to a vision model before sending. If the resolved model is non-vision and no substitute is set, the cockpit shows an honest, quiet warning near the send affordance ("Current model cannot see images — pick a vision-capable model or set a substitute in Settings"). On send, the image degrades to the placeholder text part (§9) rather than failing the turn.
- Text attachments are unaffected by vision capability.

## 12. UX rationale & deferred options

- **No `×` on thumbnails.** Tiny close targets are misclick bait; an accidental removal costs a re-upload. Removal lives in the lightbox, and because the lightbox loops and advances on remove, clearing several mis-picked attachments happens in one session without closing. The residual cost (first-time discoverability, since other apps put an `×` there) is accepted.
- **"Duplo over Lego."** Prefer fewer, larger, simpler pieces. A thumbnail context menu (long-press/right-click → Remove/Rename/Open, the §11 idiom, a deliberate non-`×` gesture) is **deferred** — revisit only if real use shows it adds value.
- **PDF/OCR deferred** to beta or later (a large topic of its own).

## 13. Security note (not a Larissa change)

Client-only; the only new network egress is the substitute-vision one-shot call and the existing chat send now carrying image/text parts. Uploaded content leaves the device only towards the provider the user has chosen for the active or substitute model — inherent to using a cloud model, identical in nature to the web-interfacing outbound surface. Recorded in `obsidian/insights/security-deferrals.md`. No plaintext key, passphrase, or master-key surface is touched. Image data URLs and descriptions are never logged.

## 14. Testing (Vitest; per §10 of CLAUDE.md)

- `attachments` store: add / remove / pending→sent / chat-locality; Dexie v12 migration + backfill; fresh-open verno 12.
- Validation module: accepted/rejected types, size caps.
- Image normalisation (§5.3): longest edge clamped to 1024 px with aspect preserved; no upscaling of small images; output is `image/jpeg`; alpha flattened to white; animated GIF reduced to one frame; EXIF orientation applied; small image re-encoded though not resized. (jsdom lacks full canvas — these run against the real browser-canvas path or a thin abstraction with the canvas behind an injectable seam.)
- `canSendImages` precedence (active wins → substitute → none); the three wire-injection branches.
- Substitute-vision: cache hit skips the call; one-shot shape (no reasoning/tools, temp); retry-once then placeholder.
- Lightbox: capability→toolbar mapping by origin; nav loop + remove-advances-index; Preview/Source toggle; editSource gated by pending.
- Cockpit paste (image→attachment, text→prompt) and the picker; sent-bubble thumbnail strip + lightbox collection.
- The 8 pre-existing `cockpit-draft`/`chat-page`/`chat-route` localStorage-jsdom failures remain the unchanged baseline.

## 15. Manual verification (Chris, on device)

1. `(+)` → pick an image + a `.md` file; both appear as thumbnails above the input, below the divider; the input stays calm.
2. Paste a screenshot → it becomes an attachment; paste a paragraph of text → it lands in the prompt, not as an attachment.
3. (Desktop) drag two files from the OS onto the chat → drop overlay appears, both attach.
4. Tap a thumbnail → lightbox zooms out of it; chevrons loop with the `n / total` counter; close zooms back in.
5. Open the `.md` attachment → Preview renders; switch to Source, edit a line, close; reopen → the edit persisted; send → the edited text reaches the model (filename included).
6. Remove a mis-picked attachment from inside the lightbox → it advances to the next; removing the last closes the lightbox.
7. With a vision model: send an image + question → answered. Switch the persona to a non-vision model, set a substitute vision model in Settings, send an image → the "analysing…" state shows, then the answer reflects the image. Unset the substitute → the quiet warning appears and the image degrades gracefully on send.
8. Rename an attachment → the new name shows on the thumbnail and is what the model receives.
9. Switch to another chat → the pending attachments are not there; switch back → they are.
10. Attach a large (>2000 px) photo and a transparent PNG → both appear normalised (the lightbox view = what the model sees: the photo downscaled, the PNG on white); a portrait photo with EXIF orientation shows upright. An animated GIF attaches as a still.

## 16. Decisions log

- **Scope:** lightbox + upload end-to-end; generated producers reserved-but-not-built.
- **Upload paths:** picker + paste + OS drop (OS drop ≠ in-app drag-and-drop).
- **Data model:** A — dedicated `attachments` table, joined by `messageId`.
- **Substitute vision:** included; global; client-side; chatsune mechanism ported; cached on the row.
- **Cockpit layout:** controls → divider → thumbnail strip → input.
- **Removal:** lightbox-only (no `×`); context menu deferred.
- **Lightbox:** `ViewableItem[]` + index + caps; chrome by origin, body by kind; Preview/Source (edit = pending only); loop nav; zoom open/close; **no vision chip / footer**.
- **Defaults:** image types png/jpeg/webp/gif ≤10 MB raw, text-like ≤1 MB; base64 `image_url`; filename always carried; FLIP zoom with reduced-motion fade; Dexie v12.
- **Image normalisation:** client-side at upload (browser canvas), store-and-send the normalised copy only (WYSIWYG). Ported chatsune rules: ≤1024 px longest edge, JPEG q0.85, alpha→white, GIF first-frame, EXIF-applied-then-stripped, universal cap, no byte-budget loop. (chatsune did this server-side; we cannot — no backend — so it moves to the browser.)
