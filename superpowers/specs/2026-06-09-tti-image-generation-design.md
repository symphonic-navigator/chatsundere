# Design — TTI image generation (`generate_image` tool, images as artefacts)

**Date:** 2026-06-09
**Author:** Liz (with Chris)
**Status:** Approved design — Laura spec-pass complete (two hard findings
fixed in place, soft notes applied or consciously kept); next: pre-plan CORS
probes (§10), then implementation plan
**Block:** Client-only feature (Block-2 adjacent — first consumer of the
artefact `kind: 'image'` reserved in the Kern). Ported from chatsune with
deliberate changes. **First real Laura spec-pass runs on this document.**

---

## 1. Summary

Companions gain the ability to paint: a `generate_image` tool that turns an
LLM-authored prompt into one or more images via the user's globally configured
image model. The system is ported from chatsune's proven TTI stack (three model
groups, typed per-group configs, synchronous OpenAI-compatible
`/images/generations` calls) with four deliberate changes:

1. **Global model selection in My Settings** — one primary slot plus a second
   NSFW-capable slot, instead of chatsune's per-connection cockpit panel.
2. **One image is the normal case.** The image count moves out of the user
   config entirely and becomes an optional tool parameter (`count`, default 1)
   the LLM sets only when the user asks for variants. Chatsundere is a chat
   client first, not a TTI workshop.
3. **NSFW readiness without an NSFW model.** Image offerings carry a
   `canDoNsfw` qualifier (all three launch models: `false`). The tool gains an
   optional `nsfw` parameter and the settings a second slot, so the day Chris
   finds a trustworthy NSFW-capable provider, enabling it is pure curation —
   no code change.
4. **Images are artefacts** (`kind: 'image'`), inheriting the entire artefact
   system for free: Treasury (the `Img` tab finally comes alive), lightbox,
   tags, favourites, rename, download, cascade-delete, NSFW gating via persona
   provenance.

This is client-only. It touches no `auth-service` / `sync-service` /
`proxy-service` / `packages/crypto` — **not a Larissa change** — but it
realises a new outbound egress class (image prompts to xAI/nano-gpt, plus
fetches of provider-returned image URLs), logged in
`obsidian/insights/security-deferrals.md`.

---

## 2. Decisions (settled with Chris during brainstorming)

1. **Architecture: TTI is a first-class `packages/llm-unified` capability.**
   Image models are curated offerings with `serviceKind: 'tti'` (the field has
   existed unused in the catalogue since day one) — not a standalone
   user-client module. Curation discipline applies; ChatGPT Image 2 and a
   future NSFW provider join by curation, not by rebuild.
2. **Config typing follows chatsune:** a discriminated union of per-group
   config types (`groupId` discriminator) with one small config view per
   group. No generic schema-driven parameter framework — that would be
   over-engineering for three model groups.
3. **`n` leaves the user config.** Settings configure model + quality/format
   parameters only. The count is decided per call by the LLM (`count`
   parameter, default 1, silently clamped to the group maximum).
4. **Launch lineup: all three chatsune groups.** Grok Imagine (xAI, direct),
   Z-Image turbo/base and Seedream 4.5 (both nano-gpt). ChatGPT Image 2 is a
   later, separate iteration (Chris studies the model first).
5. **NSFW slot is visible from day one, disabled-over-hidden (§11).** While no
   `canDoNsfw` offering exists it renders greyed with a tooltip that **closes
   the loop instead of dangling a task** (Laura hard finding 1): "No
   NSFW-capable image model exists yet — this slot lights up automatically
   when one is curated. Nothing for you to do." If the primary model itself
   can do NSFW (future), the slot greys with "Your primary model already
   supports NSFW". The capability is a visible promise, never a silent
   absence — and never an implied action with no action available.
6. **The `nsfw` tool parameter appears in the schema only when it can work:**
   the persona is `adultPersona` AND the global adult mode is `nsfw` AND an
   NSFW-capable model is configured (second slot, or a `canDoNsfw` primary).
   Most restrictive variant — the runtime error path for an honoured schema
   barely exists. A hallucinated `nsfw: true` outside that gate still gets a
   constructive error, never a crash.
7. **Tool gating is omakase — and the tool is always offered** (revised after
   Laura hard finding 2): `generate_image` stands in the wire tool defs for
   every persona, **even when no image model is configured**. An unconfigured
   call returns a constructive error pointing the user to My Settings → Image
   generation, so discovery happens in the chat at the exact moment of need
   (user asks → model calls → both learn), reusing the constructive-error
   muscle rather than a system-prompt hint. No persona toggle, no cockpit
   chip — image generation is a core capability, not a risk tool like the
   expert uplink. Side benefit: the tool def is constant regardless of
   configuration, so the cached prompt prefix is maximally stable.
8. **In-chat rendering: inline thumbnails.** The chat is a reading surface and
   the image is the content. A pill carries status + prompt; the thumbnails
   render directly in the message (tap → lightbox). Not pill-only, not
   expand-on-tap.
9. **The LLM-authored prompt is copyable** — in the expanded pill (copy
   button) and in the lightbox provenance line. Conscious duplication (Laura
   soft note): the lightbox is the canonical provenance home, the pill copy is
   the in-stream convenience; the pill copy is dropped later if it reads as
   clutter once styling lands.
10. **No "Test image" button in My Settings for v1** (YAGNI — the first real
    chat attempt is the test). Chatsune had one; we add it later if missed.
11. **CORS is an empirical pre-plan question.** Chatsune called the image APIs
    server-side; we call from the browser. Console probes against both
    `/images/generations` endpoints and a nano-gpt R2 signed URL run **before
    the implementation plan is written**, with Chris's keys, to learn whether
    the normal path is `direct` or `cors-proxy` (probe protocol in §10).

---

## 3. Architecture overview

```
My Settings ──pick──▶ SettingsRow.imageGeneration
                        { primary: {ref, config} | null,
                          nsfw:    {ref, config} | null }
                              │
              send path (resolves slots + persona/adult gates)
                              ▼
stream-manager.runIntoDraft:
   images = { primary: slot | null, nsfwSlot, nsfwParamAllowed }   // ALWAYS built
   activeTools = resolveActiveTools(integrationCtx, knowledge, expert, images)
                              │
                              ▼
   generate_image(prompt, count?, nsfw?)   ← context tool, ALWAYS offered;
                              │              unconfigured → constructive
                              ▼              settings pointer (§7.4)
   llm-unified generateImages(offering, config, prompt, count, transport)
       ├─ build per-group payload (ported chatsune helpers)
       ├─ POST {baseUrl}/images/generations   (probed: direct, both providers)
       ├─ parse response (xAI: per-item moderation; nano-gpt: 4xx on refusal)
       ├─ xAI: decode inline b64_json → bytes  (imgen.x.ai is CORS-closed)
       └─ nano-gpt: fetch R2 urls → bytes      (CORS-open; NO auth header)
                              │
                              ▼
   user-client: measure dims (createImageBitmap), thumbnail, persist
       ├─ one ArtefactRow per image (kind 'image', blob + thumbBlob + genMeta)
       ├─ image-result pill (pending → completed/failed; prompt copyable)
       └─ tool result text to the LLM ("Generated N image(s)… refer in prose")
                              │
                              ▼
   chat stream renders inline thumbnails under the pill → tap → lightbox
```

Precedents copied wholesale:

- **Web offerings** (`catalogue/types.ts:49` `serviceKind`, `web?: WebOfferingMeta`)
  — the non-LLM offering pattern (`canonicalRef: null`).
- **Knowledge context tool** (`knowledge/query-tool.ts` `contributeKnowledgeTools`)
  — the conditional context-tool family in `resolveActiveTools`.
- **VisionPill** (`components/chat/VisionPill.tsx`) — the pending-with-live-bar →
  completed-expandable pill lifecycle.
- **Attachment image handling** (`attachments/image-normalise.ts`,
  `AttachmentRow.blob/width/height`) — browser-side image bytes, dimension
  measurement and JPEG thumbnailing.
- **Substitute-vision / expert settings** (`routes/app/settings.tsx`) — the
  global-model My Settings section pattern.

---

## 4. Catalogue (`packages/llm-unified`)

### 4.1 Offering metadata

`Offering` gains an optional `tti` block, mirroring `web?`:

```ts
/** Capability metadata when `serviceKind === 'tti'`; undefined otherwise. */
tti?: {
  groupId: 'xai-imagine' | 'zimage' | 'seedream';
  /** Whether the upstream accepts adult prompts. All launch models: false. */
  canDoNsfw: boolean;
};
```

TTI offerings have `canonicalRef: null` (no CanonicalModel — those are
LLM-shaped), `source: 'curated'`, and live in the existing provider files
(`providers/xai.ts`, `providers/nano-gpt.ts`).

### 4.2 The three offerings

| Display name | Provider | `upstreamSlug` | `groupId` | Notes |
|---|---|---|---|---|
| Grok Imagine | `xai` | `grok-imagine-image` | `xai-imagine` | `tier: 'quality'` maps to `grok-imagine-image-quality` at request time |
| Z-Image | `nano-gpt` | `z-image-turbo` | `zimage` | `variant: 'base'` maps to `z-image-base`; turbo is fast and free |
| Seedream 4.5 | `nano-gpt` | `seedream-v4.5` | `seedream` | |

### 4.3 Config types (chatsune union, minus `n`)

```ts
export interface XaiImagineConfig {
  groupId: 'xai-imagine';
  tier: 'normal' | 'quality';            // default 'normal'
  resolution: '1k' | '2k';               // default '1k'
  aspect: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';  // default '1:1'
}

export interface ZImageConfig {
  groupId: 'zimage';
  variant: 'turbo' | 'base';             // default 'turbo'
  size: '256x256' | '512x512' | '768x768' | '1024x1024' | '1280x720'
      | '720x1280' | '1536x1024' | '1024x1536' | '1536x1536';  // default '1024x1024'
}

export interface SeedreamConfig {
  groupId: 'seedream';
  aspect: '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '2:3';  // default '1:1'
  quality: 'standard' | 'high' | 'ultra';  // default 'standard'
}

export type ImageModelConfig = XaiImagineConfig | ZImageConfig | SeedreamConfig;
```

A `defaultConfigFor(groupId)` helper produces the defaults; a
`maxCountFor(config)` helper encodes the clamp table:

| Group / variant | Max count |
|---|---|
| Grok Imagine | 10 |
| Z-Image turbo | 10 |
| Z-Image base | 4 (≈10× slower than turbo) |
| Seedream 4.5 | 4 (upstream hard cap) |

### 4.4 Seedream resolution table

The deterministic `aspect × quality → (width, height)` table is ported
verbatim from chatsune (`_nano_gpt_image_groups.py:26-48`): 21 cells, every
resolution ≥ 3,686,400 pixels and a multiple of 32. Pure data + a lookup
function, unit-tested cell by cell against the chatsune source.

---

## 5. Adapter — `generate-images.ts` (`packages/llm-unified`)

A synchronous one-shot module over the existing transport/routing layer (the
same `direct` / `cors-proxy` routing chat completions use).

### 5.1 Request building (pure, per group)

```ts
// xAI                                     // nano-gpt (both groups)
POST {baseUrl}/images/generations          POST {baseUrl}/images/generations
{                                          {
  model: 'grok-imagine-image'                model: 'z-image-turbo' | 'z-image-base'
       | 'grok-imagine-image-quality',            | 'seedream-v4.5',
  prompt, n,                                 prompt, n,
  response_format: 'b64_json',               size: '<WxH>',          // Seedream via
  aspect_ratio: config.aspect,               response_format: 'url'  // resolution table
  resolution: config.resolution
}                                          }
```

The two providers deliberately use **different `response_format`s**, driven by
the §10 probe results: xAI's image CDN (`imgen.x.ai`) is CORS-closed to the
browser, but `b64_json` puts the bytes inline in the (CORS-open) POST
response — no second fetch, no proxy. nano-gpt's R2 bucket is CORS-open, so
`url` avoids inflating the POST response there.

### 5.2 Response handling

- **xAI:** `data[]` items carry `b64_json` (decoded client-side to a Blob),
  optional `mime_type`, and `respect_moderation: false` + `reason` for blocked
  items → those become per-image moderation results.
- **nano-gpt:** `data[]` items carry `url` (Cloudflare R2 signed URL). No
  per-image moderation; a refused prompt fails the whole POST with 4xx →
  constructive error. `cost` may be absent (Z-Image turbo) — read defensively.
- **R2 fetch rule (ported chatsune trap):** result URLs are fetched with a bare
  `GET` and **no `Authorization` header** — a Bearer token collides with the
  AWS-V4 signature and yields 403.
- **Timeouts:** 60 s for the xAI POST; 300 s for nano-gpt (Z-Image base at
  count 4 takes ~3 min); 60 s per nano-gpt result-URL fetch.
- **Dimensions** are measured client-side after the fetch
  (`createImageBitmap`), not trusted from provider metadata.

### 5.3 Result shape

```ts
export type ImageGenItem =
  | { kind: 'image'; bytes: Blob; mime: string }
  | { kind: 'moderated'; reason: string | null };

export interface GenerateImagesResult {
  items: ImageGenItem[];
  /** The resolved upstream model id actually used (e.g. 'grok-imagine-image-quality'). */
  modelId: string;
}
```

Errors (HTTP failure, timeout, malformed response) throw a typed error whose
message feeds the constructive-error path (§7.4).

---

## 6. Settings

### 6.1 Data model — Dexie v19

Current head is `this.version(18)` (MCP). Add `this.version(19)` with a
backfill upgrade (non-indexed field, but the upgrade must run on existing
installs):

```ts
/** Global image-generation models. ref = "providerId:upstreamSlug". */
imageGeneration: {
  primary: { ref: string; config: ImageModelConfig } | null;
  nsfw:    { ref: string; config: ImageModelConfig } | null;
};  // backfill: { primary: null, nsfw: null }
```

⚠ **Parallel-work check at plan time:** v19 is claimed under the
parallel-feature Dexie version ownership rule; verify the head is still 18
when the plan is written.

### 6.2 My Settings — "Image generation" section

- **Primary slot:** a model picker listing TTI offerings of the user's
  configured, enabled providers (reusing the `ModelPickerField`/`ModelPickerModal`
  machinery filtered to `serviceKind: 'tti'` if it fits cleanly; otherwise a
  simple picker — plan-time call). Below it, the group-specific config view:
  - `XaiImagineConfigView` — tier SegRow, resolution SegRow, aspect SegRow.
  - `ZImageConfigView` — variant SegRow, size select.
  - `SeedreamConfigView` — aspect SegRow, quality SegRow.
  No count stepper anywhere (decision 3). Switching model resets the config to
  the new group's defaults.
- **NSFW slot:** rendered always (decision 5), with the two disabled states
  and tooltips described there. When eligible offerings exist, it is the same
  picker + config view, restricted to `canDoNsfw` offerings.
- Clearing the primary slot leaves the tool offered but unconfigured —
  in-chat calls then return the constructive settings pointer (decision 7);
  the NSFW slot cannot be set without a primary.
- **Persistence idiom pinned (Laura soft note):** the section persists
  **immediately** on every change, like its cited siblings (substitute-vision,
  expert, expert-web pickers) — it is not governed by the room's `SaveBar`,
  and nothing in the section may visually imply staged-until-saved behaviour.
- Styling deliberately minimal — mechanics first; Chris does the polish pass.

---

## 7. The `generate_image` tool

### 7.1 Schema

```ts
{
  name: 'generate_image',
  description:
    'Generate one or more images from a text prompt. The user has ' +
    'pre-configured the model and image dimensions; you only choose the ' +
    'prompt. Be descriptive — a good prompt has subject, style, lighting, ' +
    'and composition cues.',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'A detailed description of the image(s): subject, style, lighting, composition.' },
      count:  { type: 'integer', minimum: 1, description: 'How many variants to generate. Omit for the normal case of one image; only set when the user explicitly asks for multiple variants (e.g. "show me three options" → count: 3).' },
      // nsfw is present ONLY under the §2.6 gate:
      nsfw:   { type: 'boolean', description: 'Set true only when the user asks for explicit adult imagery. Routes to the NSFW-capable model.' },
    },
    required: ['prompt'],
  },
}
```

### 7.2 Offering & gating

- Offered as a **context tool** (fourth-category precedent) **always** — even
  with no image model configured (decision 7). An unconfigured call returns
  the constructive settings pointer (§7.4); a configured one generates. No
  persona toggle, no cockpit chip.
- The `nsfw` property is included in the schema only when **all three** hold:
  `persona.adultPersona === true`, `settings.adultMode === 'nsfw'`, and an
  NSFW-capable model is configured (the `nsfw` slot, or a `canDoNsfw`
  primary). The gate is stable within a chat, so the cached prompt prefix is
  unaffected.

### 7.3 Execution

1. Clamp `count` to `maxCountFor(config)` silently (absent → 1).
2. Resolve the slot: `nsfw: true` → the NSFW slot (or a `canDoNsfw` primary);
   otherwise the primary.
3. Call `generateImages` with the slot's offering ref + config snapshot.
4. Persist each successful item as an artefact (§8), collect moderated items.
5. Update the pill payload; return the LLM text result:
   - `"Generated 2 image(s) from your prompt. They are already displayed to
     the user. Refer to them in prose; do not output URLs or file paths."`
   - Moderated items appended: `"1 image was blocked by the provider's content
     filter (reason: …)."`

### 7.4 Constructive errors (the *dere* half)

- No image model configured (the first-run discovery path, decision 7):
  `"No image model is configured yet. Tell the user that image generation is
  available once they pick a model in My Settings → Image generation."`
- `nsfw: true` without an eligible model (hallucinated parameter):
  `"NSFW image generation is not available — no NSFW-capable model is
  configured. Offer the user a non-explicit variant of their idea instead."`
- Provider refusal (nano-gpt 4xx): the provider message is surfaced and the
  model is told to inform the user and suggest rephrasing the prompt.
- Network/timeout: the pill fails with the error; the tool result tells the
  model the generation failed and the user can simply ask again. The
  conversation never wedges; user input is preserved.

### 7.5 Pill lifecycle (`image-result` kind — already in `PillRow`)

- **Pending:** `Painting · <model display name>` with the live bar
  (VisionPill pattern). If `count > 1`: `Painting 3 images · <model>`.
- **Completed:** collapsed `Painted · <model>`; expanded → the full prompt
  with a **copy button**, the model name, and per-image moderation notes if
  any.
- **Failed:** `Couldn't paint` + constructive detail on expand. The expanded
  failed-state copy is held to the §7.4 bar (Laura soft note): an invitation
  with a next step, never a bare shrug.
- Pills persist with the message and survive reload (both finalise paths),
  exactly like vision pills.

---

## 8. Artefact persistence

One `ArtefactRow` per successful image (`count` images → up to `count` rows):

```ts
{
  kind: 'image', format: 'image', origin: 'generated',
  chatId, personaId,                       // provenance → NSFW gating for free
  title,        // derived from the prompt (first ~6 words), renameable
  fileName,     // slugified title + real extension from mime ('.jpg' / '.png')
  mime,         // from the fetch response
  content: '',  // text field unused for images
  // NEW non-indexed fields (no extra Dexie bump — v19 carries the version):
  blob?: Blob;        // original provider bytes, unmodified
  thumbBlob?: Blob;   // downscaled JPEG for chat stream + Treasury grid
  width?: number; height?: number;          // measured via createImageBitmap
  genMeta?: { prompt: string; modelRef: string; configSnapshot: ImageModelConfig };
}
```

- Thumbnailing reuses the `image-normalise.ts` machinery (target: the chat
  bubble width budget at 380 px; exact pixel budget is a plan-time constant).
- The artefact inherits Treasury (the `Img` type tab), lightbox, tags,
  favourites, rename, download, cascade-delete with the chat, and the
  persona-provenance NSFW gating — all existing mechanics, zero new code
  paths.
- Moderated items produce **no artefact** (unlike chatsune's audit stubs —
  YAGNI client-side; the pill records the moderation note).

---

## 9. Chat rendering & lightbox

- The persona message carries the pill block; the generated images render as
  **inline thumbnails** directly below it (decision 8): one image → a single
  thumbnail at bubble width; several → a 2-column grid at 380 px.
- Tap → lightbox, which lazy-loads the full `blob` (the stream only ever
  decodes `thumbBlob`).
- The lightbox shows a provenance line: the prompt (copyable), the model
  display name. Rename/tags/favourite/download as for every artefact.
- Reading mode renders the thumbnails exactly the same — images are content,
  not chrome.

---

## 10. CORS probe results (empirical, 2026-06-09)

Run with Chris at the browser console (app origin `http://localhost:3000`),
serial, with real keys and real generations:

| Probe | Result |
|---|---|
| nano-gpt `POST /images/generations` (Z-Image turbo) | **PASS** — 200, CORS-open; response shape matches the chatsune map (`data[].url` + `storageKey`, `cost` absent for turbo) |
| nano-gpt R2 signed-URL fetch (bare GET, no auth header) | **PASS** — 200, `image/jpeg`, 321 KB, `createImageBitmap` → 1024×1024 |
| xAI `POST /images/generations` (`response_format: 'url'`) | **PASS** — 200, CORS-open (`usage.cost_in_usd_ticks` present) |
| xAI `imgen.x.ai` image fetch | **FAIL** — HTTP 200 but no `Access-Control-Allow-Origin`; the browser cannot read the bytes |
| xAI `POST` with `response_format: 'b64_json'` | **PASS** — 200, `data[].b64_json` inline (decoded → valid 1024×1024 JPEG) |

**Consequence (wired into §5):** both providers run fully `direct` — no CORS
proxy involvement on the happy path. nano-gpt uses `response_format: 'url'` +
the R2 fetch; xAI uses `response_format: 'b64_json'` because its image CDN is
CORS-closed to browsers. The existing `cors-proxy` routing remains available
per provider row as the general fallback, but nothing in this feature depends
on it.

---

## 11. Testing

Unit (Bun, llm-unified):
- Payload builders per group, including the tier/variant → upstream-model-id
  mapping and the full Seedream resolution table.
- Response parsing: xAI per-item moderation, nano-gpt missing-`cost`,
  malformed shapes.
- `maxCountFor` clamp table; `defaultConfigFor`.

Unit (Vitest, user-client):
- Tool gating matrix: tool present even without a primary model, with
  `execute` returning the constructive settings pointer; `nsfw` property
  present/absent across the §2.6 three-way gate (8 combinations, test-pinned).
- Count clamping; slot routing (`nsfw: true` → NSFW slot; hallucinated
  `nsfw` → constructive error).
- Settings migration backfill (v19); NSFW-slot disabled states.
- Pill lifecycle (pending → completed with copyable prompt; failed).
- Artefact persistence: one row per image, thumb generated, provenance fields.

Live verification (never CI, serial per the curation rule): one real
generation per group against the real APIs, matched in full.

---

## 12. Out of scope (this iteration)

- ChatGPT Image 2 (separate iteration after Chris studies the model).
- An actual NSFW-capable offering (curation event, no code).
- "Test image" button in My Settings (decision 10).
- Image *editing* / img2img, artefact iteration on images.
- A gallery view beyond the Treasury `Img` tab.
- Audit stubs for moderated items.

---

## 13. Manual verification (Chris, on device)

1. **No model configured (first-run discovery):** in a chat, ask for an
   image → the companion calls `generate_image`, receives the constructive
   pointer, and tells you image generation is available once a model is
   picked in My Settings → Image generation; the pill shows the failed state
   with the constructive detail on expand. My Settings shows the empty
   primary slot and the disabled NSFW slot with the closed-loop tooltip.
2. **Configure Z-Image turbo** (free): pick it in the primary slot, set a size
   → in a chat, ask the companion to paint something → a `Painting · Z-Image`
   pill appears with a live bar → the image renders inline below the message →
   tap → lightbox shows the full image + the prompt (copy it) → Treasury `Img`
   tab lists it; rename, tag, favourite, download all work.
3. **Variants:** ask explicitly for "three variants" → one pill
   (`Painting 3 images`), three thumbnails in a grid, three artefacts in the
   Treasury.
4. **Grok Imagine quality + 2k + 16:9:** configure, generate → image honours
   aspect/resolution; expanded pill shows the prompt.
5. **Seedream 4.5 ultra:** configure, generate → works; count request of "five
   variants" silently yields 4 (the upstream cap).
6. **Moderation:** with Grok, request something the provider blocks → the pill
   completes with a moderation note, the companion explains constructively, no
   broken artefact appears.
7. **NSFW gate:** with an adult persona in NSFW mode (and no NSFW model
   configured) the tool schema carries no `nsfw` parameter; the NSFW settings
   slot is visible-but-disabled with the tooltip.
8. **SFW gating:** generate an image with an adult persona, switch global mode
   to SFW → the artefact disappears from Treasury/lightbox surfaces (persona
   provenance gating).
9. **Reload mid-history:** reopen the chat → pill and thumbnails persist;
   delete the chat → its image artefacts cascade away.
