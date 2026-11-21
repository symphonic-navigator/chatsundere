# Audio and video from MCP tools — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MCP tool results that carry audio or video (typed blocks, `resource_link`, or HTTPS URLs inside JSON) are saved as artefacts on arrival and shown in the chat as native players.

**Architecture:** A pure extractor turns a `tools/call` result into `MediaRef`s. A save service fetches each (direct, then the authenticated CORS proxy), sniffs and stores it as an `audio`/`video` artefact, keyed for de-duplication. The MCP tool awaits the saves (with a timeout) and records `media` items in its pill payload; a block-level `MediaCard` renders them, joins unfinished saves, and offers retry. A module-level "media floor" makes players, read-aloud and live voice exclusive.

**Tech Stack:** TypeScript strict, React 18, Tailwind v4, Dexie, TanStack Query, Zustand, Vitest (jsdom), pnpm.

**Spec:** `superpowers/specs/2026-11-21-mcp-media-playback-design.md` (approved by Chris 2026-11-21, Laura's spec-pass closed).

## Global Constraints

- British English in code, comments, copy, commits (CLAUDE.md §3.7). SPDX header `// SPDX-License-Identifier: AGPL-3.0-only` on every new file.
- Mobile-first at 380 px; hit targets ≥ 44 px; disabled over hidden; respect the reduce-animations switch (existing `prefers-reduced-motion`/app switch CSS hooks).
- Only `https:` URLs; mime allow-list: `audio/mpeg audio/mp4 audio/aac audio/ogg audio/opus audio/wav audio/x-wav audio/webm audio/flac video/mp4 video/webm video/quicktime`. Never HTML/SVG/script from this path; play only via `blob:` URLs.
- Extensions recognised in URLs: `.mp3 .wav .ogg .opus .m4a .aac .flac .mp4 .webm .mov` (images are out of scope for this plan; MCP `image` blocks follow later).
- Sizes: no client cap below 32 MiB; hard cap 200 MiB per file (cause `too-large`). Files over 32 MiB are stored normally; the sync layer marks them `blobOversized`.
- Tool wait: the MCP tool awaits all saves for at most **45 000 ms**, then returns with the unfinished ones as `saving`.
- Never log or put signed URLs into error messages (spec §5). Never fetch a URL that came from model text — only from the MCP server's own result.
- No Dexie version bump: new fields are non-indexed; `kind`/`format` are not indexed.
- Commands: `pnpm --filter user-client test -- <path>` for focused runs; at the end `pnpm test`, `pnpm typecheck`, `pnpm run build` from the repo root. Lint: `pnpm lint`.
- Commits: imperative, capitalised, ending with `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. Subagents commit on the current branch only; never push, merge or switch branches.

## Review Focus

1. **The same files twice** — a second status call returning the same generations with fresh signatures must add no artefact and no player (Task 1 + Task 4 tests).
2. **A link that expires while the user is away** — re-opening the chat after expiry shows "The link has expired", Try again disabled, no fetch attempt (Task 3 + Task 6 tests).
3. **CORS refusal on the CDN** — a `TypeError` from the direct fetch falls back to the proxy exactly once (Task 3 test).
4. **A server lying about type** — `content.mp3` whose bytes are HTML is refused as `wrong-type` (Task 3 test).
5. **Two players and read-aloud** — starting player B pauses A and read-aloud; read-aloud does not resume when a clip ends (Task 5 tests).

---

### Task 1: Media extraction (pure)

**Files:**
- Create: `apps/user-client/src/mcp/media-extract.ts`
- Test: `apps/user-client/tests/mcp/media-extract.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type MediaKind = 'audio' | 'video';
  export interface MediaRef {
    key: string;                 // de-dup key: `gen:<generation_id>` or `url:<origin+pathname>` or `bytes:<sha-like hash of first 64 base64 chars + length>`
    kind: MediaKind;
    mime: string;                // allow-listed; from block/link/field, else from extension
    source: { kind: 'bytes'; base64: string } | { kind: 'url'; url: string };
    expiresAt: number | null;    // ms epoch from `Expires=` (seconds) or `X-Amz-Date`+`X-Amz-Expires`, else null
    providerName: string | null; // `name` of a resource_link when not generic
  }
  export interface McpRawResult { content?: unknown[]; structuredContent?: unknown }
  export function extractMedia(result: McpRawResult): { refs: MediaRef[]; refused: number };
  export function isGenericFileName(name: string): boolean; // content.*, hex/uuid-like stems
  ```

- [ ] **Step 1: Write failing tests** covering, with exact expectations:
  - `audio` block `{type:'audio', data:'SUQz', mimeType:'audio/mpeg'}` → one ref, `source.kind==='bytes'`, kind `audio`.
  - `resource` block with `resource:{uri:'x', mimeType:'video/mp4', blob:'AAAA'}` → bytes ref, kind `video`.
  - `resource_link` `{uri:'https://cdn.example/a.webm', mimeType:'video/webm', name:'clip.webm'}` → url ref, `providerName:'clip.webm'`.
  - ElevenLabs fixture (text block containing JSON) `{"generations":[{"generation_id":"G1","modality":"audio","full_res_url":"https://elevenlabsusercontent.com/x/content.mp3?Expires=1795302000&KeyName=k&Signature=s","preview_url":"<same URL>"}]}` → exactly one ref, `key==='gen:G1'`, `expiresAt===1795302000000`, mime `audio/mpeg`.
  - Two generations G1/G2 → two refs in source order.
  - Same JSON in `structuredContent` and in text → refs not doubled.
  - `http:` URL, `javascript:` URL, an `.svg` URL, `image/svg+xml` resource_link → no refs; the svg/link ones count in `refused` (the non-https ones are ignored silently, they are not media offers).
  - URL with no extension but sibling `"mime_type":"video/mp4"` → video ref.
  - Plain prose text (not JSON) containing an `.mp3` URL → **no** ref (only JSON is walked; prose may be model-shaped).
  - `isGenericFileName('content.mp3')`, `('3f2a9c1e.mp4')` true; `('Lina teaser.mp3')` false.
- [ ] **Step 2: Run** `pnpm --filter user-client test -- tests/mcp/media-extract.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** in `media-extract.ts`. Walk JSON depth-first with a depth limit of 8 and a node limit of 5 000; for each object, look at string fields that parse as `https:` URLs; mime from sibling `mime_type|mimeType|content_type|contentType`, else `modality` (`audio`→ mime from extension), else extension. Group by `generation_id|id` sibling when present: prefer `full_res_url` over `preview_url|url` within one object. Key: `gen:` when a `generation_id` sibling exists, else `url:` origin+pathname.
- [ ] **Step 4: Run** the test → PASS.
- [ ] **Step 5: Commit** "Extract audio and video references from MCP tool results".

### Task 2: The MCP client returns the raw content

**Files:**
- Modify: `apps/user-client/src/mcp/mcp-client.ts:304-312` (`McpCallResult`), `:411-420` (result parsing)
- Test: `apps/user-client/tests/mcp/mcp-client-content.test.ts` (mock `fetch` the way existing `tests/mcp/*` client tests do; find one with `rg -l mcpToolsCall apps/user-client/tests`)

**Interfaces:**
- Produces: `McpCallResult` gains `raw?: McpRawResult` (type from Task 1), set on success and on `isError` results; `stdout` unchanged (text blocks joined).

- [ ] **Step 1: Failing test:** a JSON-RPC reply `{result:{content:[{type:'text',text:'hi'},{type:'audio',data:'SUQz',mimeType:'audio/mpeg'}],structuredContent:{a:1}}}` → `stdout==='hi'`, `raw.content.length===2`, `raw.structuredContent` deep-equals `{a:1}`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement; type `content` as `unknown[]` (validated later by the extractor).
- [ ] **Step 4:** run → PASS; also run `pnpm --filter user-client test -- tests/mcp` → all PASS.
- [ ] **Step 5: Commit** "Keep the full content of MCP tool results".

### Task 3: Save service and media artefacts

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts:464-465` (`ArtefactKind` += `'audio' | 'video'`, `ArtefactFormat` += `'audio' | 'video'`), `ArtefactRow` gains:
  ```ts
  /** kind audio|video — provenance, duration and the de-dup key. Non-indexed. */
  mediaMeta?: { key: string; durationMs: number | null; serverName: string; toolName: string };
  ```
  The video poster is stored in the existing `thumbBlob` (+`thumbBlobRef`) so blob sync needs no change.
- Create: `apps/user-client/src/lib/media/media-sniff.ts`, `apps/user-client/src/lib/media/media-save.ts`, `apps/user-client/src/lib/media/media-probe.ts`, `apps/user-client/src/data/media-artefacts.ts`, `apps/user-client/src/state/media-progress.store.ts`
- Test: `apps/user-client/tests/lib/media/media-sniff.test.ts`, `tests/lib/media/media-save.test.ts`, `tests/data/media-artefacts.test.ts`

**Interfaces:**
- Consumes: `MediaRef` (Task 1); `fetchWithProxyAuth`, `getProxyAuthSource` from `@chatsundere/llm-unified`; `mintBlobRefFor`, `enqueueSync`, `isLinkedForSync`, `scheduleClass1Sync` as used in `data/artefacts.ts:113-165`.
- Produces:
  ```ts
  // media-sniff.ts
  export function sniffMediaMime(head: Uint8Array): string | null; // ID3/MPEG frame → audio/mpeg; 'OggS' → audio/ogg; 'RIFF....WAVE' → audio/wav; 'fLaC' → audio/flac; ftyp box → video/mp4 (or audio/mp4 when brand is 'M4A '); 1A45DFA3 → video/webm; 'ftypqt' → video/quicktime
  export function sniffAgrees(claimed: string, sniffed: string | null): boolean; // same top-level type; webm audio/video interchangeable; mp4 audio/video interchangeable

  // media-save.ts
  export type MediaFailCause = 'expired' | 'unreachable' | 'wrong-type' | 'too-large';
  export type MediaSaveOutcome =
    | { status: 'saved'; artefactId: string }
    | { status: 'duplicate'; artefactId: string }
    | { status: 'failed'; cause: MediaFailCause };
  export interface MediaSaveContext { chatId: string; personaId: string; serverName: string; toolName: string; title: string }
  /** Single-flight per `ref.key`: a second call while one runs joins it. */
  export function saveMedia(ref: MediaRef, ctx: MediaSaveContext, signal?: AbortSignal): Promise<MediaSaveOutcome>;
  export function isExpired(ref: Pick<MediaRef, 'expiresAt'>, now?: number): boolean;

  // media-probe.ts (browser APIs; injectable for tests)
  export interface MediaProbe { durationMs: number | null; poster: { blob: Blob; width: number; height: number } | null }
  export function probeMedia(blob: Blob, kind: MediaKind): Promise<MediaProbe>; // off-screen <audio>/<video>, loadedmetadata, video: seek 0.1 s, canvas → JPEG ≤ 640 px wide; 8 s timeout → nulls

  // data/media-artefacts.ts
  export function findMediaArtefactByKey(chatId: string, key: string): Promise<ArtefactRow | undefined>;
  export function addMediaArtefact(input: { chatId: string; personaId: string; key: string; kind: MediaKind; mime: string; title: string; bytes: Blob; probe: MediaProbe; serverName: string; toolName: string }): Promise<string>;

  // state/media-progress.store.ts (Zustand, in-memory only)
  export const useMediaProgress: UseBoundStore<StoreApi<{ byKey: Record<string, { done: number; total: number | null }>; set(key: string, done: number, total: number | null): void; clear(key: string): void }>>;
  ```

- [ ] **Step 1: Failing tests (sniff):** byte fixtures for each signature above; `sniffMediaMime(new TextEncoder().encode('<!doctype html>'))===null`; `sniffAgrees('audio/mpeg', null)===false`.
- [ ] **Step 2: Failing tests (save)**, with `fetch` stubbed and `fake-indexeddb` as in existing data tests:
  - `isExpired({expiresAt: 1000}, 2000)===true`; `({expiresAt:null})===false`.
  - Expired ref → `{status:'failed', cause:'expired'}` and `fetch` **not called**.
  - Direct fetch rejects `TypeError` → one proxied fetch with headers `x-cors-proxy-target` = URL origin and `x-cors-proxy-kind: mcp`; success → `saved`.
  - Direct 403 when `isExpired(ref, now+0)` is false but `expiresAt` is within 60 s → `expired`; any other non-OK → `unreachable`.
  - Body `<!doctype html>` with claimed `audio/mpeg` → `wrong-type`; no artefact row written.
  - `content-length` 210 MiB → `too-large`, body cancelled.
  - Second call with the same key while the first is in flight → same promise (fetch called once).
  - Ref whose key already has an artefact in this chat → `duplicate` with that id, no fetch.
  - Error messages / outcomes never contain the URL string (assert `JSON.stringify(outcome)` lacks `Signature=`).
- [ ] **Step 3: Failing tests (data):** `addMediaArtefact` writes `kind:'audio'`, `format:'audio'`, `origin:'generated'`, `fileName` `<slugified title>.<ext>`, `mediaMeta.key`; video stores `probe.poster.blob` as `thumbBlob` with width/height; linked → outbox has a `blob-put` per blob + one upsert. `findMediaArtefactByKey` finds it by chat + key.
- [ ] **Step 4:** run the three files → FAIL.
- [ ] **Step 5: Implement.** Stream the body with a reader to update `useMediaProgress` and enforce the 200 MiB cap; sniff the first 64 bytes. `probeMedia` failures never fail the save (nulls). Bytes refs (`source.kind==='bytes'`) skip fetching.
- [ ] **Step 6:** run → PASS. Run `pnpm --filter user-client test -- tests/data tests/lib/treasury` to check the widened unions broke nothing.
- [ ] **Step 7: Commit** "Save audio and video from MCP results as artefacts".

### Task 4: Wire the MCP tool to the save service

**Files:**
- Create: `apps/user-client/src/mcp/media-items.ts`
- Modify: `apps/user-client/src/mcp/mcp-tools.ts:65-100` (`McpToolContext` gains `media?: McpMediaContext`), `:368-374` (success path); `apps/user-client/src/data/send-message.ts` (build `media` ctx where the MCP ctx is built, `rg -n "contributeMcpTools|mcp:" src/data/send-message.ts src/tools/registry.ts`); `apps/user-client/src/lib/chat-export.ts:84` (markers)
- Modify: `apps/user-client/src/data/media-artefacts.ts` (add `patchMediaPillItem`)
- Test: `apps/user-client/tests/mcp/media-items.test.ts`, `tests/data/media-artefacts.test.ts` (patch case: saved patch removes `source`, outbox gets a `pills` upsert), extend the existing mcp-tools test (`rg -l contributeMcpTools apps/user-client/tests`)

**Interfaces:**
- Consumes: `extractMedia` (T1), `McpCallResult.raw` (T2), `saveMedia`, `MediaSaveOutcome`, `isExpired` (T3).
- Produces:
  ```ts
  // media-items.ts
  export interface MediaItem {
    key: string; kind: MediaKind; mime: string; title: string;  // "Audio 1", "Video 2", or a non-generic provider name
    status: 'saving' | 'saved' | 'duplicate' | 'failed';
    cause?: MediaFailCause; artefactId?: string;
    source?: { url: string; expiresAt: number | null };       // kept only while not saved; dropped on 'saved'/'duplicate'
    refused?: number;                                           // on the first item only: unsupported files not shown
  }
  export function titleFor(ref: MediaRef, index: number, kindCount: number): string;
  export function modelLineFor(items: MediaItem[]): string;
  export interface McpMediaContext { chatId: string; personaId: string; save: typeof saveMedia }
  // data/media-artefacts.ts (added in this task)
  export function patchMediaPillItem(pillId: string, key: string, patch: Partial<MediaItem>): Promise<boolean>; // writes like lib/tool-summary.ts:99-114 (transaction, enqueueSync 'pills', scheduleClass1Sync); drops `source` when patch.status is 'saved' or 'duplicate'
  ```
  Pill payload field: `media: MediaItem[]` (merged through `ToolResult.meta`, as `generate_image` does with `artefactIds`). Bytes refs are saved inside the tool and never carry `source`.

- [ ] **Step 1: Failing tests (`media-items`):**
  - `titleFor` → `"Audio 1"`… when `providerName` is null or generic; the provider name otherwise.
  - `modelLineFor` for 2 saved (keys `gen:G1`, `gen:G2`) + 1 failed `unreachable` returns exactly:
    `Shown to the user as players: Audio 1 = generation G1, Audio 2 = generation G2. 1 file could not be saved (could not reach the file). Refer to them by these names in prose; do not repeat their URLs.`
  - Saving items: `… Audio 3 is still being saved and appears when ready.`; duplicates: `Audio 1 and Audio 2 are the same files already shown above.`
  - URL-keyed items use `= file <n>` instead of `= generation <id>`.
- [ ] **Step 2: Failing tests (mcp-tools):** a tool whose call returns the ElevenLabs fixture with a `media` ctx stub → `ToolResult.output` is the original stdout + `\n\n` + model line; `meta.media` has one `saved` item with `artefactId`. A `save` stub that never resolves → after the timeout (use fake timers, 45 000 ms) the item is `saving` with `source.url` set. Without `media` ctx → behaviour unchanged.
- [ ] **Step 3:** run → FAIL.
- [ ] **Step 4: Implement.** In the success path: `extractMedia(r.raw)`, then `Promise.race` of `Promise.allSettled(saves)` against a 45 000 ms timer; never let a save failure fail the tool. Signed URLs go only into `MediaItem.source` (sealed pill payload), never into `output`. `chat-export.ts`: one marker per item, `marker('Audio: <title>')` / `marker('Video: <title>')`.
- [ ] **Step 5:** run → PASS; `pnpm --filter user-client test -- tests/mcp tests/lib/chat-export.test.ts` → PASS.
- [ ] **Step 6: Commit** "Show MCP audio and video results to the model truthfully".

### Task 5: The media floor

**Files:**
- Create: `apps/user-client/src/lib/media/media-floor.ts`, `apps/user-client/src/lib/media/use-media-floor-bridge.ts`
- Modify: `apps/user-client/src/routes/app/chat/chat-page.tsx` (call the bridge after `useVoicePlayback` at `:783`, with `voice`, the monologue controller and the live-voice controller in scope there)
- Test: `apps/user-client/tests/lib/media/media-floor.test.ts`, `tests/lib/media/use-media-floor-bridge.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export type FloorOwner = string; // 'read-aloud' | 'monologue' | 'live-voice' | `player:<artefactId>`
  export function claimMediaFloor(owner: FloorOwner, yieldFloor: () => void): void; // calls the previous owner's yieldFloor if owner differs
  export function releaseMediaFloor(owner: FloorOwner): void;                          // no-op unless owner holds it; never resumes anyone
  export function currentFloorOwner(): FloorOwner | null;
  export function useMediaFloorBridge(args: { voice: VoicePlayback; monologue: { transportState: TransportState; pause: () => void }; live: { floor: Floor; hold: () => void } | null }): void;
  ```
  Bridge rules: `voice.transportState` entering `'speaking'` → `claim('read-aloud', voice.pause)`; same for monologue; live voice entering a user or persona floor (any `Floor` other than idle/off — check the `Floor` union in `lib/voice/live/live-voice-machine.ts`) → `claim('live-voice', live.hold)`; leaving those states → `release`.
- [ ] **Step 1: Failing tests:** claim A then B → A's yield called once, owner B; release by a non-owner leaves the owner; release never calls any yield (no auto-resume); bridge: transport `'speaking'` then a `player:x` claim → `voice.pause` called; a later `'paused'` → floor released.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** "Let one sound play at a time across players and voice".

### Task 6: The media card and players

**Files:**
- Create: `apps/user-client/src/components/chat/media/MediaCard.tsx`, `AudioRow.tsx`, `VideoTile.tsx`, `MediaMenu.tsx`, `use-media-element.ts`, `media-copy.ts`, `format-time.ts`
- Modify: `apps/user-client/src/components/chat/Pill.tsx:80-140` (MCP tool pills with `payload.media` render the normal inline pill **and** a block-level `<div className="media-card-block"><MediaCard …/></div>` after it), `apps/user-client/src/index.css` (styles next to `.image-pill-block`)
- Test: `apps/user-client/tests/components/chat/media-card.test.tsx`, `tests/components/chat/format-time.test.ts`

**Interfaces:**
- Consumes: `MediaItem`, `patchMediaPillItem` (T4), `saveMedia`, `isExpired` (T3), `useMediaProgress` (T3), `claimMediaFloor`/`releaseMediaFloor` (T5), `useBlobBytes` (`sync/blob-fetch.ts:426`), `BlobSyncMarker`/`resolveBlobMarker` (`components/blob/BlobSyncMarker.tsx`).
- Produces: `export function MediaCard(props: { pill: PillRow; chatId: string | null; personaId: string | null; serverLabel: string }): JSX.Element` and `export function MediaPlayer(props: { artefact: ArtefactRow; title: string; compact?: boolean }): JSX.Element` (used by Task 7).
- Copy (`media-copy.ts`, exact):
  - saving: `Saving audio…` / `Saving video…`, with progress `Saving video · 12 of 28 MB` (MB = bytes/1 048 576, rounded)
  - downloading: `Downloading from your vault…`
  - device-only: `This file lives only on the device that saved it.`
  - failed: expired `The link has expired, so the file could not be saved.`; unreachable `Couldn't reach the file.`; wrong-type `This wasn't the audio or video it claimed to be.`; too-large `This file is too large to save.`
  - buttons: `Try again`, `Open original`, `Download`, `Open in Treasury`; disabled reason when expired: `The link has expired.`
  - duplicate marker: `Same ${n} ${n === 1 ? 'file' : 'files'} as above` (button, scrolls to `[data-media-artefact="<id>"]`)
  - refused note: `${n} ${n === 1 ? 'file' : 'files'} not shown: unsupported type`
  - provider label pill: `${serverLabel} · ${toolName}`
- Layout (Laura): audio row is two lines — line 1: 44 px round play/pause (`aria-label` `Play Audio 1` / `Pause Audio 1`), title, `m:ss / m:ss` (`tabular-nums`), `⋯`; line 2: full-width `<input type="range">` with a ≥ 44 px tall hit area, `aria-label` `Seek Audio 1`, `aria-valuetext` `0:12 of 0:46`. Video tile: poster (`thumbBlob` via `useBlobBytes(...,'thumbBlob')`), duration badge bottom-left, centre play glyph, `⋯` top-right always visible; tap → inline play with `playsInline`, same transport overlaid, fullscreen button.

- [ ] **Step 1: Failing tests** (render `MediaCard` with Dexie rows, `HTMLMediaElement.prototype.play/pause` stubbed):
  - `format-time`: `0→'0:00'`, `46_000→'0:46'`, `3_725_000→'1:02:05'`.
  - Saved audio item → a play button `Play Audio 1`, time text `0:00 / 0:46` from `mediaMeta.durationMs` before play.
  - Clicking Play on Audio 2 while Audio 1 plays → Audio 1's element `pause` called (floor).
  - Failed `unreachable` with unexpired source → text `Couldn't reach the file.` and enabled `Try again`; clicking it calls `saveMedia` and then `patchMediaPillItem` with `status:'saved'`.
  - Failed with expired source → `The link has expired, so the file could not be saved.`, `Try again` and `Open original` disabled with title `The link has expired.`
  - `saving` item on mount with unexpired source → `saveMedia` called once (joins single-flight); expired → patched to `failed`/`expired`, no fetch.
  - Artefact with `blobOversized` and no local `blob` → `This file lives only on the device that saved it.`, play and Download disabled, title and duration visible.
  - `duplicate` items → no player, one button `Same 2 files as above`.
  - Video item → poster `img`, badge `0:46`, `⋯` button present.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement (`use-media-element.ts` owns one `HTMLMediaElement` per artefact, object-URL lifecycle as in `ImagePill.tsx:63-80`, claims `player:<id>` on play, releases on pause/ended). **Step 4:** run → PASS.
- [ ] **Step 5:** `pnpm --filter user-client test -- tests/components/chat` → PASS (existing pill tests unchanged).
- [ ] **Step 6: Commit** "Play MCP audio and video inline in the chat".

### Task 7: Treasury, lightbox and picker

**Files:**
- Modify: `apps/user-client/src/lib/treasury-filter.ts:4-19` (`TreasuryType` += `'media'`; `audio|video` → `'media'`), `apps/user-client/src/components/treasury/TypeTabs.tsx` (tab label `Audio & video`), `apps/user-client/src/components/treasury/TreasuryRow.tsx` (glyph `♪` / `▶`), `apps/user-client/src/components/lightbox/viewable-item.ts:57` (`kind: 'media'` viewable carrying `artefact`), the lightbox body switch (`rg -n "kind === 'image'" src/components/lightbox`) rendering `MediaPlayer`, `apps/user-client/src/components/artefact/ArtefactPicker.tsx` (audio/video rows `aria-disabled`, reason `Audio and video can't be sent to a model yet.`), `apps/user-client/src/lib/artefact-sections.ts` (`formatGlyph` cases)
- Test: extend `tests/lib/treasury-filter*.test.ts` (`rg -l formatToType apps/user-client/tests`), new `tests/components/artefact/picker-media.test.tsx`

**Interfaces:**
- Consumes: `MediaPlayer` (T6).
- [ ] **Step 1: Failing tests:** `formatToType('audio')==='media'`, `('video')==='media'`, `('svg')==='image'`; `artefactToViewable(audioRow).kind==='media'` with `caps.download===true, editSource===false, copy===false`; picker renders an audio row disabled with the reason text and selecting it does nothing.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS; `pnpm --filter user-client test -- tests/components tests/lib` → PASS.
- [ ] **Step 5: Commit** "Give audio and video a place in the Treasury".

### Task 8: Gates and docs (Liz, not a subagent)

- [ ] `pnpm test`, `pnpm typecheck`, `pnpm run build`, `pnpm lint` from the repo root — all green.
- [ ] Laura pre-squash pass on the branch diff against the spec; fix hard defects, log deferrals in `obsidian/insights/ux-deferrals.md`.
- [ ] Larissa: not required (no `auth-service`, `sync-service`, `proxy-service`, `packages/crypto` change); state this in the PR.
- [ ] ADR 0043 "Native players for MCP media, not MCP Apps" in `obsidian/decisions/` + index; README feature list line; `superpowers/open-items.md` entries for the storage talk, polling merge and MCP `image` blocks.
- [ ] Draft PR against `master`; STATUS changes proposed in the PR body (the STATUS commit follows Chris's squash, CLAUDE.md §10).
