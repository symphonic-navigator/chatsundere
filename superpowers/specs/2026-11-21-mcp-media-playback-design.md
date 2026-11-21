# Audio and video from MCP tools in the chat — analysis and design proposal

**Status:** DRAFT for Chris's approval (2026-11-21). Laura's spec-pass done; her 4 hard defects are closed in §3.1–3.4, her soft notes taken except the polling merge (§3.5).
**Target:** 0.6.0 from `master` ([ADR 0042](../../obsidian/decisions/0042-release-0.6-from-master-before-eidolon.md)).
**Scope now:** groundwork for audio and video that MCP tools return, rendered in the chat. The real ElevenLabs and Higgsfield connections, and the storage policy for media in the Treasury (gallery), come later.

---

## 1. What the client does today

- `apps/user-client/src/mcp/mcp-client.ts:413-420` keeps only `text` content of a `tools/call` result and joins it. Every `image`, `audio`, `resource` and `resource_link` block is dropped silently. `structuredContent` and `_meta` are ignored.
- We negotiate protocol `2025-06-18` (`mcp/protocol.ts`), so servers may legitimately send all of the content types in §2.1.
- The `generate_image` tool already has the pattern we need: bytes are persisted as an artefact (`persistImage`), the tool result carries `meta.artefactIds`, the `image-result` pill renders them (`ImagePill.tsx`), and the model is told "they are already displayed to the user".
- `ArtefactRow` knows `kind: 'text' | 'image'` with `blob`, `thumbBlob`, blob sync (`blobRef`, `blobOversized`). Audio and video fit this row with two new kinds.
- Sync limits (`apps/sync-service/src/env.ts`): `MAX_BLOB_BYTES` 32 MiB ciphertext per blob, `ACCOUNT_QUOTA_BYTES` 2 GiB shared by records and blobs. Proxy (`apps/proxy-service/src/env.ts`): `MAX_BODY_BYTES` 50 MiB.
- No Content-Security-Policy restricts `media-src`, so `blob:` playback works.

## 2. How the servers deliver media

### 2.1 What MCP allows (2025-06-18)

| Shape | Carries | Notes |
|---|---|---|
| `{type:'image', data, mimeType}` | base64 bytes | since the start |
| `{type:'audio', data, mimeType}` | base64 bytes | since 2025-03-26 |
| `{type:'resource', resource:{uri, mimeType, blob\|text}}` | embedded bytes | |
| `{type:'resource_link', uri, mimeType?, name?, size?}` | a link, fetched by the client | since 2025-06-18 |
| MCP Apps (`ui://` resource, extension) | an HTML view the host renders in a sandboxed iframe | what claude.ai shows, see 2.4 |

There is no `video` content type. Video arrives as a link, an embedded resource, or a URL in text.

### 2.2 ElevenLabs — verified against the live connector

Checked read-only, no credits spent, on Chris's own "Kumbu² – Lina teaser" flow:

- Generation is asynchronous: `creative_generate_*` returns `flow_id` and `session_ids`, then `creative_get_flow_run_status` is polled with `poll_after_seconds`.
- The result is **JSON inside a `text` block**, not `resource_link` and not base64:
  `{"generation_id": "...", "modality": "audio", "full_res_url": "https://elevenlabsusercontent.com/.../content.mp3?Expires=...&Signature=...", "preview_url": "..."}`.
- The URL is a **signed CDN link that expires within hours** (the one read at 20:20 UTC expired at 23:00 UTC the same day).
- Their server instructions say "No view renders here" to hosts without MCP Apps: on claude.ai the stacked player card with "Open in Music" and "Open flow" is **ElevenLabs' own MCP App view**, not claude.ai's native rendering.
- CORS headers of `elevenlabsusercontent.com` are not verified yet (our cloud sandbox cannot reach the host). To probe from a browser on Chris's machine.

### 2.3 Higgsfield — from their docs, not verified live

- Server `https://mcp.higgsfield.ai/mcp`, OAuth sign-in, paid plan, credits per generation.
- Asynchronous jobs: `job_status` with `poll_after_seconds`, `jobs_wait` long-polls up to 12 jobs. Video takes about 60–180 s.
- Results are **result URLs**; uploads go through presigned URLs and media ids. Download links are described as short-lived.
- Ships an MCP Apps "generation widget" that polls by itself; text-only hosts are told to poll.

### 2.4 Verdict on "control channel MCP, data channel HTTP"

**Confirmed for both.** MCP carries jobs, status and JSON with signed, short-lived HTTPS URLs; the bytes travel over plain HTTP(S) from a CDN. Neither uses `resource_link` or inline `audio` today. Both also ship an MCP Apps view, which is how claude.ai gets its pretty players.

Two consequences:

1. A generic renderer must find media **in three places**: typed content blocks (`audio`, `image`, `resource`), `resource_link`, and **HTTPS URLs inside JSON text** — the last one is what both providers actually do.
2. Because links expire, **the bytes must be fetched and stored when the result arrives**, the way `generate_image` does. A chat that only kept the URL would show dead players by tomorrow.

## 3. Proposal

### 3.1 Media extraction (`mcp/media-extract.ts`, pure, unit-tested)

From a `tools/call` result build `MediaRef[]`:
`{ source: {kind:'bytes', base64} | {kind:'url', url}, mime, kind:'audio'|'video'|'image', name?, sizeHint? }`.

- `audio` / `image` blocks and `resource` blobs → bytes.
- `resource_link` with an `audio/*`, `video/*` or `image/*` mime → url.
- JSON text: walk parsed `structuredContent`, or the `text` if it parses as JSON, and take `https:` string values whose path ends in a known media extension (`.mp3 .wav .ogg .opus .m4a .aac .flac .mp4 .webm .mov .png .jpg .jpeg .webp .gif`) or whose sibling field says `modality`/`mime_type`/`content_type` audio or video. When a `preview_url` and a `full_res_url` point at the same thing, take the full one once.
- Allow-list of mimes only; never HTML, SVG or anything scriptable from this path. Only `https:`.

**Duplicates.** A later status call returns the same files with fresh signatures (ElevenLabs tells the model to call it again to pick a variation). Media are keyed by the provider's `generation_id` when one sits beside the URL, else by the URL without its query string, across the whole chat. A repeat adds no artefact and no card, only a small marker "Same 4 audio files as above" that jumps to them.

**Titles.** Generic file names (`content.*`, hashes) count as missing; rows are numbered "Audio 1–n" (or "Variation 1–n" when the provider marks variations).

The text the model sees stays as it is today (it still needs `flow_id`, ids and so on to chain calls). The persist is awaited, with a timeout, before the result goes back to the model, as `generate_image` does, and one line reports the true outcome with the mapping: "Shown to the user as players: Audio 1 = generation ThV60…, Audio 2 = …; 1 file could not be saved (link unreachable). Refer to them by these names in prose, do not repeat the URLs." So "take number 2" means the same file to the user and to the model. Bytes never go to the model.

### 3.2 Fetch and persist

- Fetch each URL directly; when CORS refuses, fall back to the existing authenticated proxy route (`routing: 'cors-proxy'`, as MCP calls already do). No proxy-service change, so Larissa's paths stay untouched.
- Caps: per file 32 MiB (the sync limit) to start; above that the file is kept on the device and marked `blobOversized`, the existing "lives only here" path.
- Sniff the first bytes against the claimed mime; a mismatch is dropped with a note.
- Persist as `ArtefactRow` with `kind: 'audio' | 'video'`, `format: 'audio' | 'video'`, plus non-indexed `durationMs`, `posterBlob` (first video frame as JPEG, via an off-screen `<video>` + canvas), `source: {serverName, toolName, url}` for provenance. `kind` is not indexed, so no Dexie version bump.
- MCP `image` results get the same treatment for free and render through the existing `ImagePill`/lightbox.

- Progress is reported in bytes ("Saving video · 12 of 28 MB").
- Failures keep their cause: `expired` (from the signed URL's `Expires`, or a 403 after it), `unreachable` (network, CORS plus proxy, server error, app killed mid-fetch), `wrong-type` (sniff mismatch), `unsupported` (not on the allow-list). The pending source URL is kept on the artefact row until the bytes are saved, so a fetch can be retried; when a chat opens, unsaved media whose link is still valid are retried quietly.

### 3.3 The card and the players (`components/chat/media/`)

A block-level media card under the MCP tool-call pill, always shown, never inside the pill's expandable detail (like `image-pill-block`). The tool pill above it keeps its usual collapsed behaviour.

- **Audio row, two lines** (fits 380 px with a thumb-sized slider). Line 1: 44 px round play/pause, title, `0:12 / 0:46` in tabular numerals, "⋯". Line 2: a full-width seek bar on a native `<input type="range">` with a touch target at least 44 px tall (keyboard, screen reader and touch work out of the box). Durations come from metadata, so they show before anyone presses play.
- **Video tile.** Poster frame, duration badge bottom-left, play glyph centre, "⋯" top-right, always visible. Tap plays inline (`playsInline` for iOS) with the same transport overlaid, plus fullscreen. Width capped to the message column; aspect from metadata.
- **"⋯" menu** on both: Download, Open in Treasury, Open original (while the link is valid).
- **States**, each with its own words, disabled over hidden:
  - *Saving* — static shimmer with size and progress.
  - *Ready.*
  - *Downloading from your vault* — the record has synced, the bytes are on their way (`BlobSyncMarker`).
  - *Lives only on the device that saved it* — over 32 MiB (`blobOversized`): player and Download greyed out with that reason; title, duration and poster still shown.
  - *Couldn't save* — the cause in plain words ("The link has expired", "Couldn't reach the file", "This wasn't the audio it claimed to be"), with **Try again** and **Open original** while the link is valid, both greyed out with the reason once it has expired.
  - Refused items get a note: "1 file not shown: unsupported type".
- **One sound at a time.** A small media coordinator: starting a player pauses any other player and pauses read-aloud; read-aloud starting pauses the player. When a clip ends, read-aloud does **not** resume by itself; its transport stays paused with Resume. VoiceTransport's Exit leaves the player alone. **Live voice** joins the coordinator: starting a player holds the floor, a live turn pauses the player.
- Styling per CLAUDE.md §11: opulent but quiet, monospace pill for the provider label (`ElevenLabs · creative_generate_in_flow`), respects the reduce-animations switch.
- Lock-screen controls (Media Session) only after the read-aloud bridge passed its listening check; same constant pattern.

### 3.4 Treasury, lightbox and picker in this release

Media artefacts must not land on surfaces that cannot show them (Laura, hard).

- `formatToType` (`lib/treasury-filter.ts`) gets `audio` and `video`; the Treasury gets an "Audio & video" tab whose tiles reuse the players.
- `artefactToViewable` (`lightbox/viewable-item.ts`) renders the same `MediaPlayer` in the lightbox.
- `ArtefactPicker` shows audio and video greyed out: "Audio and video can't be sent to a model yet."
- Storage policy (what syncs, what expires) stays for the talk in §4.

### 3.5 Out of scope, and why

- **MCP Apps rendering** (provider HTML views in an iframe). Best fidelity, but it executes third-party HTML inside our client: sandbox, postMessage bridge, tool-call proxying, CSP. That needs its own ADR and a Larissa audit. Our native players cover the need without trusting provider code.
- Audio input to models (multimodal), STT of returned media, uploads to providers.
- Polling helpers for async jobs: the model already polls through the tools; we render whatever the final status call returns.
- **Polling noise and a "being generated" placeholder.** A Higgsfield video can produce a dozen status-call pills. Merging consecutive calls to the same tool into one pill ("Checking progress · ×12") and a placeholder card from the first `creative_generate_*` result are a known gap, a follow-up unit.

## 4. Treasury (gallery) — considerations only

- Size: 46 s of MP3 ≈ 1 MB; 46 s of 720p MP4 ≈ 5–15 MB; 1080p can pass 32 MiB. Four music variants per call (the screenshot) are four files.
- Options to discuss: a per-kind sync switch (audio synced, video device-only by default); "keep" vs "ephemeral" media (only kept ones sync, the rest expires from the device after N days); a visible media share of the 2 GiB quota in `SyncQuotaLine`; raise `MAX_BLOB_BYTES` for video vs chunked blobs.
- The Treasury already lists image artefacts; audio/video tiles reuse the players.

## 5. Security notes

- Third-party bytes play only as `blob:` URLs in `<audio>`/`<video>`; never as HTML. Mime allow-list plus magic-byte sniff.
- Signed URLs are not secrets of ours but are bearer links to the user's content: do not log them, do not sync them beyond the sealed artefact record.
- Fetching a URL the model can influence: limited to URLs that came from the MCP server's own result, never from model text, `https:` only, redirects not followed across to non-https.

## 6. Proposed units

1. `media-extract` + tests (pure): the three channels, de-duplication, titles.
2. Persist path (fetch, proxy fallback, sniff, progress, poster, failure causes, retry, artefact kinds) + tests.
3. `MediaPlayer` (audio row, video tile, all states) + media coordinator with read-aloud and live voice.
4. Wire into `mcp-client.ts` / `mcp-tools.ts` (content beyond text, truthful model line) and the card.
5. Treasury tab, lightbox, picker (§3.4).
6. Docs: README, STATUS, ADR "native players instead of MCP Apps for media".

## 7. Decisions

1. **Release line (Chris, 2026-11-21):** 0.6.0 from `master`; Eidolon starts in 2027. Written down in [ADR 0042](../../obsidian/decisions/0042-release-0.6-from-master-before-eidolon.md), which supersedes ADR 0041.
2. **Sync of media (default, until the storage talk):** no new switch. Audio and video sync like images do today: up to 32 MiB per file, larger files stay on the device through the existing `blobOversized` path, which the UI already explains. The storage talk (§4) may change this for video.
3. **MCP Apps:** not now. A later, separate ADR with a Larissa audit, if native players turn out not to be enough.

## Manual verification (to be completed with the final spec)

- Ask a persona with ElevenLabs connected for a short music piece: four players "Audio 1–4", durations before play, one plays at a time, seek by thumb at 380 px.
- Ask it to "take number 2" for something: the status call adds no second set of players, only the marker, and the model uses the right generation.
- Reload the chat the next day: players still play (bytes saved, link expired).
- Flight mode while the result arrives: "Couldn't reach the file" with Try again; back online, Try again saves it.
- Video from ElevenLabs or Higgsfield: poster, duration, inline play on iPhone and Android, fullscreen, Download from "⋯".
- Second device: the media show "Downloading from your vault", then play; a video over 32 MiB shows "Lives only on the device that saved it".
- Read-aloud running, start a player: read-aloud pauses and stays paused after the clip. Live voice: a turn pauses the player.
- Treasury: "Audio & video" tab plays; lightbox plays; the picker shows media greyed out with the reason.
