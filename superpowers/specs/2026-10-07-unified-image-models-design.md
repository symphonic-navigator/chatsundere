# Unified Image Models — Design Specification

**Date:** 2026-10-07 · **Author:** Liz, brainstormed with Chris · **Status:** draft for Chris's review

## 1. Purpose and Scope

### 1.1 Why

nano-gpt now carries nine attractive new image models, and Chris wants them to
widen the portfolio. Today every text-to-image (TTI) model is a bespoke
*group*: its own config schema (`ImageModelConfig` union), its own payload
branch, its own config view, sometimes its own resolution table. Nine more would
roughly triple that code. This spec replaces the four bespoke groups with **one
data-driven model description** and adds the nine models as data.

### 1.2 In scope

- One `TtiOfferingMeta` descriptor that fully describes an image offering
  (family, variant, aspects, resolutions, qualities, prices, wire shape).
- One stored config shape `{ aspect, resolution, quality }`; the model identity
  lives only in the slot's `ref`.
- The family-first picker (Chris's choice "C"): one button per family, a
  *Variant* row in the config when a family has more than one usable offering.
- Migrating the four existing offerings (Grok Imagine via xAI, Z-Image,
  Seedream 4.5, GPT Image 2) onto the descriptor; Z-Image's turbo/base split
  becomes two offerings.
- Adding nine nano-gpt offerings (§4).
- Client-side PNG→JPEG transcoding of generated images at full resolution.
- Lazy read-time migration of stored slots; a local live harness; Curation
  Records; a "Mode 5 — image models" playbook for the `/curate` skill.

### 1.3 Out of scope

- Image editing / reference images (several new models support them; our TTI
  surface stays text-to-image).
- Extra per-model knobs beyond one quality row (MiniMax LoRAs, Nano Banana web
  search / seed / system prompt) — the "middle way" decision.
- Any `canDoNsfw: true`. **All thirteen offerings ship `canDoNsfw: false`.**
  Chris and the community judge NSFW behaviour first; some models handle a plain
  nude well but refuse once fantasy elements join (e.g. a nude woman with
  butterfly wings), which no single probe reveals. Unlocking later is a one-line
  data change.
- `grok-imagine-image-2.0` on the **direct** xAI API (listed by
  `GET /v1/image-generation-models`, $0.06) — not requested; logged as a
  follow-up.

## 2. Data Model

### 2.1 The descriptor (`packages/llm-unified/src/catalogue/types.ts`)

`TtiOfferingMeta` replaces its current `{ groupId, canDoNsfw, displayName }`:

```ts
export interface TtiOption {
  id: string;            // wire value or table key, e.g. '2k', 'low'
  label: string;         // button text, e.g. '2k', 'Quick'
}

export interface TtiOfferingMeta {
  family: string;              // picker button, e.g. 'Seedream'
  variant: string | null;      // Variant-row label; null = sole family member
  displayName: string;         // full name, e.g. 'Seedream 5.0 Flash'
  canDoNsfw: boolean;
  maxCount: number;            // hard cap for the tool's `count`
  timeoutMs: number;           // POST timeout
  aspects: readonly string[];  // e.g. ['1:1', '16:9', ...]
  resolutions: readonly TtiOption[] | null;  // null = no Resolution row
  qualities: readonly TtiOption[] | null;    // null = no Quality row
  /** Estimated US cents per image, keyed `${resolution ?? '-'}|${quality ?? '-'}`. */
  priceCents: Readonly<Record<string, number>>;
  /** Optional latency hint per quality id, e.g. { low: '~20 s' }. */
  qualityLatency?: Readonly<Record<string, string>>;
  defaults: ImageModelConfig;
  wire: TtiWire;               // §5
  /** xAI marks refused items per entry (`respect_moderation: false`). */
  perItemModeration: boolean;
}
```

`groupId` and the `TtiGroupId` type are removed.

### 2.2 The stored config (`packages/llm-unified/src/tti/config.ts`)

```ts
export interface ImageModelConfig {
  aspect: string;
  resolution: string | null;
  quality: string | null;
}
```

A slot stays `{ ref: 'providerId:upstreamSlug', config }`. Validity is judged
**against the offering's descriptor**: `isValidConfigFor(meta, config)` — the
aspect is in `aspects`, the resolution is in `resolutions` (or both null), the
quality likewise. The four per-group schemas, `defaultConfigFor(groupId)` and
`maxCountFor(config)` are replaced by `meta.defaults` and `meta.maxCount`.

### 2.3 Families

| Family | Variants (in this order) | Providers |
|---|---|---|
| FLUX.3 | — | nano-gpt |
| GPT Image 2 | — | nano-gpt |
| Grok Imagine | `1` (xAI), `2.0` (nano-gpt) | xAI, nano-gpt |
| MiniMax H3 | — | nano-gpt |
| Nano Banana 2.1 | — | nano-gpt |
| Qwen Image | `2.1`, `2.1 Pro` | nano-gpt |
| Seedream | `4.5`, `5.0 Flash`, `5.0 Lite`, `5.0 Pro` | nano-gpt |
| Z-Image | `Turbo`, `Base` | nano-gpt |

## 3. Picker and Configuration UI (`apps/user-client/src/components/image-gen/`)

### 3.1 Picker (`TtiModelSelect`)

- One button per **family**, alphabetical. A family appears when at least one of
  its offerings is on a usable provider (existing `usableTemplateIds` rule, and
  the existing empty-state copy when none is).
- `onSelect` returns the chosen offering's `ref`. Picking a family selects its
  **first usable variant** (data order) — unless the current slot already sits in
  that family, in which case nothing changes.
- The NSFW slot reuses the picker with `nsfwOnly`: offerings without
  `canDoNsfw` are filtered out *before* families are formed, so a family shows
  only its NSFW-capable variants and vanishes if it has none. With every offering
  `false`, the slot keeps its existing "lights up automatically" copy.

### 3.2 Config view — one generic component

Rows, top to bottom, each rendered only when it offers more than one choice:

1. **Variant** — the family's usable offerings. Label = `variant` (or
   `displayName` when `variant` is null). When the row's offerings span more than
   one provider, each label gains ` · <provider displayName>` (today only Grok
   Imagine: "1 · xAI", "2.0 · nano-gpt").
2. **Aspect** — `meta.aspects`.
3. **Resolution** — `meta.resolutions`, each button labelled
   `<label> · <price>` using `priceCents[`${id}|${config.quality ?? '-'}`]`.
   When `resolutions` is null, the flat price is shown as a small inline-marker
   pill beside the Aspect label instead, so a price is always visible.
4. **Quality** — `meta.qualities`; each button shows `<label>` plus
   `qualityLatency[id]` when present ("Low · ~20 s").

Price formatting: whole cents as `5¢`, fractional as `2.7¢`, ≥ 100 as `$1.20`.

The four bespoke views in `config-views.tsx` are deleted.

### 3.3 Carry-over on a variant or family switch

`carryOverConfig(prev, nextMeta)` (pure, in `tti/config.ts`):

- `aspect`: kept if in `nextMeta.aspects`, else `nextMeta.defaults.aspect`.
- `resolution`: kept if `nextMeta.resolutions` contains that id, else the
  default (null when the next model has no Resolution row).
- `quality`: same rule against `nextMeta.qualities`.

### 3.4 Defaults

| Offering | Default |
|---|---|
| Resolution, when prices differ by tier | the **cheapest** tier |
| Resolution, when the price is flat | the **highest** tier (Seedream 4.5 therefore defaults to 2.7k for new picks; stored slots keep their tier) |
| Quality | the fastest option, except GPT Image 2, which keeps `medium` (Chris, 2026-06-10) |
| Aspect | `1:1` |

## 4. The Thirteen Offerings

Aspect lists are the intersection of each model's supported set with the shared
palette `1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 21:9` (calm rows; exotic ratios
such as 1:8 are left out deliberately). Prices are the billed costs observed in
the 2026-10-07 probes unless marked *catalogue*.

### 4.1 New on nano-gpt (probed live 2026-10-07)

| Slug | Wire | Aspects | Resolutions → price | Quality | maxCount | timeout |
|---|---|---|---|---|---|---|
| `minimax-h3/text-to-image` | aspect-resolution | palette | 1k 2¢ · 2k 6¢ | — | 4 | 300 s |
| `qwen-image-2.1/text-to-image` | aspect-resolution | palette | 1k 2¢ · 1.5k 4¢ · 2k 6¢ | — | 4 | 300 s |
| `qwen-image-2.1-pro` | size-table | 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3 | — (flat 7.5¢) | — | 4 | 300 s |
| `black-forest-labs/flux-3/text-to-image` | aspect-resolution | palette | 1k 5¢ · 2k 12¢ · 4k 65¢ | — | 4 | 300 s |
| `bytedance/seedream-v5.0-flash` | aspect-resolution | 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3 | 1k · 1.5k · 2k, flat 2.7¢ | — | 4 | 300 s |
| `seedream-v5.0-lite` | size-table | 1:1, 16:9, 9:16, 3:2, 2:3 | — (flat 3.5¢) | — | 4 | 300 s |
| `bytedance/seedream-v5.0-pro` | aspect-resolution, no resolution param | 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3 | — (flat 9¢) | — | 4 | 300 s |
| `xai/grok-imagine-image/v2.0/text-to-image` | aspect-resolution, `qualityParam: 'quality'` | 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3 | 1k / 2k | Low (~20 s) · Medium (~70 s) | 4 | 300 s |
| `nano-banana-2.1` | aspect-resolution, `qualityParam: 'thinking_level'`, `extra: { output_format: 'jpeg' }` | palette | 1k / 2k | Quick = `minimal` · Considered = `high` | 4 | 300 s |

Notes the descriptors and records must carry:

- **FLUX.3 `maxCount` is 4**, not the catalogue's 10: a 4k call at 10 images
  would bill $6.50 from one tool call.
- **Seedream 5.0 Pro always renders and bills 2k** (~2730×1536 at 16:9, 9¢).
  `resolution: '1k'`, `'1K'` and `size: '1k'` were all ignored; the catalogue's
  1k price of 4.5¢ is wrong. So no Resolution row and no resolution param.
- **Grok Imagine 2.0 prices** (billed): 1k low 4¢, 1k medium 6¢, 2k medium 8¢;
  2k low is measured by the harness (§7.3). nano-gpt's catalogue warns that
  prompts refused under xAI's terms may still be billed.
- **Nano Banana** bills actual usage: ~6.1¢ at 1k/minimal, ~9.8¢ at 2k/high; the
  remaining cells come from the harness. Without `output_format` it returns PNGs
  of ~10 MB.
- Size tables (pixel-exact in the probe or listed by the catalogue):
  - Seedream 5.0 Lite: 1:1 2048×2048 · 16:9 2560×1440 · 9:16 1440×2560 ·
    3:2 3072×2048 · 2:3 2048×3072. (The catalogue's 4K sizes are left out.)
  - Qwen Image 2.1 Pro: 1:1 2048×2048 · 16:9 2730×1536 · 9:16 1536×2730 ·
    4:3 2364×1773 · 3:4 1773×2364 · 3:2 2508×1672 · 2:3 1672×2508.

### 4.2 Migrated existing offerings

| Offering | Wire | Aspects | Resolutions | Quality | Notes |
|---|---|---|---|---|---|
| `xai:grok-imagine-image` (variant `1`) | aspect-resolution, `modelByQuality: { normal: 'grok-imagine-image', quality: 'grok-imagine-image-quality' }`, `responseFormat: 'b64_json'`, `perItemModeration: true` | 1:1, 16:9, 9:16, 4:3, 3:4 | 1k / 2k | Normal 2¢ · Quality 5¢ (xAI `image_price`) | timeout 60 s, maxCount 10 |
| `nano-gpt:z-image-turbo` (variant `Turbo`) | size-table | 1:1 1024², 16:9 1280×720, 9:16 720×1280, 3:2 1536×1024, 2:3 1024×1536 | — (flat 1.2¢) | — | maxCount 10 |
| `nano-gpt:z-image-base` (variant `Base`, **new offering**) | size-table | 1:1 1024², 16:9 1024×576, 9:16 576×1024, 4:3 1024×768, 3:4 768×1024 | — (flat 1.7¢) | — | maxCount 4 |
| `nano-gpt:seedream-v4.5` (variant `4.5`) | size-table (existing table) | existing seven | 2k · 2.2k · 2.7k (from standard/high/ultra), flat 4¢ | — | |
| `nano-gpt:gpt-image-2` | size-table (existing table) + `qualityParam: 'quality'` | existing eight | 1k / 2k | Low · Medium · High (~24 s / ~70 s / ~3.5 min) | timeout 600 s; prices per cell from the record and harness |

Z-Image loses its 256/512/768 and 1536² square sizes. This is deliberate: one
size per aspect keeps the descriptor rectangular (every aspect × resolution cell
exists), and the small sizes were rarely useful for a chat image.

## 5. Wire and Post-processing

### 5.1 `TtiWire` and `buildImagePayload` (`tti/payloads.ts`)

```ts
type TtiWire =
  | {
      kind: 'aspect-resolution';
      sendResolution: boolean;                 // false for Seedream 5.0 Pro
      qualityParam?: 'quality' | 'thinking_level';
      modelByQuality?: Readonly<Record<string, string>>;
      extra?: Readonly<Record<string, string>>;
      responseFormat: 'url' | 'b64_json';
    }
  | {
      kind: 'size-table';
      sizes: Readonly<Record<string, readonly [number, number]>>; // `${aspect}|${resolution ?? '-'}`
      qualityParam?: 'quality';
      responseFormat: 'url';
    };
```

`buildImagePayload(slug, meta, config, prompt, n)`:

- Common: `{ model, prompt, n, response_format }`; `model` is
  `modelByQuality[quality]` when present, else the slug.
- `aspect-resolution`: `aspect_ratio: config.aspect`; `resolution` when
  `sendResolution`; `[qualityParam]: config.quality` when set; then `extra`.
- `size-table`: ``size: `${w}x${h}` `` from `sizes`; `[qualityParam]` when set.

The existing `gpt-image-2-resolutions.ts` and `seedream-resolutions.ts` tables
move into a single `tti/size-tables.ts` alongside the four new tables.

### 5.2 `generateImages` (`tti/generate-images.ts`)

Takes `{ slug, meta, config, … }` instead of a group-tagged config. The timeout
comes from `meta.timeoutMs`; `parseImagesResponse` takes
`meta.perItemModeration` instead of a group id. Everything else (proxy routing,
the header-free R2 GET, the `image` / `moderated` / `failed` item kinds) is
unchanged.

### 5.3 PNG→JPEG transcode (`apps/user-client/src/attachments/image-transcode.ts`)

Applied to every successfully fetched item before it is saved as an artefact:

- Only `image/png` is transcoded; JPEG, WebP and anything else pass through.
- `createImageBitmap(blob)` → `OffscreenCanvas` at the **original size** (no
  downscaling) → fill white (alpha flattened, as in `image-normalise.ts`) →
  `convertToBlob({ type: 'image/jpeg', quality: 0.92 })`.
- Items are transcoded **one after another**, never in parallel (4 × 16 MP
  bitmaps would strain a phone).
- Any failure (decode error, out of memory, missing `OffscreenCanvas`) keeps the
  original PNG silently. The image is never lost; it is only larger.
- The pure decision (`shouldTranscode(mime)`) and the fallback path are
  unit-tested with an injected encoder; the canvas itself is manual-verified.

Expected effect from the probes: Nano Banana 10.7 MB, Qwen Pro 8.7 MB and Grok
2.0 medium 7.3 MB PNGs become roughly 0.7–2 MB JPEGs.

## 6. Migration

### 6.1 Lazy read-time upgrade, no Dexie version

`settings.imageGeneration` is an unindexed field, so no Dexie version bump is
needed (and none can collide with parallel work). A pure
`upgradeImageSlot(stored): { ref, config } | null` in `tti/upgrade.ts` runs
wherever a slot is read (`ImageGenerationSection`, `resolveImageSlot` in
`send-message.ts`). The upgraded shape is written back on the next save.

| Legacy config | Upgraded |
|---|---|
| `xai-imagine { tier, resolution, aspect }` | same ref; `{ aspect, resolution, quality: tier }` |
| `zimage { variant: 'turbo', size }` | ref `nano-gpt:z-image-turbo`; aspect from the size's ratio (256/512/768/1024/1536 squares → `1:1`) |
| `zimage { variant: 'base', size }` | ref `nano-gpt:z-image-base`; aspect as above, falling back to `1:1` when base lacks it |
| `seedream { aspect, quality }` | same ref; resolution `standard→2k`, `high→2.2k`, `ultra→2.7k` |
| `gpt-image-2 { aspect, resolution, quality }` | same ref; fields copied |
| new shape, valid for the ref | unchanged |
| new or legacy shape, invalid, but the ref resolves | ref kept, config = the offering's `defaults` |
| ref no longer resolves | `null` (slot unset — today's behaviour) |

### 6.2 Mixed versions across synced devices

`imageGeneration` is in `SETTINGS_SYNC_ALLOWLIST`. An **old** client that
receives the new shape fails `isImageModelConfig` and shows the slot as unset
until it updates (the app-update mechanism of 2026-09-26 makes that short); the
tool then tells the model no image model is configured. An old client that
**saves** writes a legacy shape, which the new client upgrades. Nothing is
corrupted; at worst image generation is briefly unavailable on a stale device.

## 7. Testing

### 7.1 Automated — `bun test` (`packages/llm-unified`)

- **Descriptor consistency** over every TTI offering of every provider (mirrors
  `providers/offerings.test.ts`): `defaults` passes `isValidConfigFor`; every
  aspect × resolution cell exists in a `size-table`; every resolution × quality
  combination has a `priceCents` entry; `variant` is non-null whenever the family
  has more than one member; `maxCount ≥ 1`; all thirteen have
  `canDoNsfw: false`.
- **Payload tests**: the exact body for each of the thirteen offerings at its
  default config plus one non-default config, matching the probed bodies.
- `upgradeImageSlot`: one case per row of the §6.1 table.
- `carryOverConfig`: kept / fallen-back for each of the three fields, including
  a switch to and from a model without a Resolution row.
- `parseImagesResponse` with `perItemModeration` true and false.

### 7.2 Automated — Vitest (`apps/user-client`)

- Picker: families, alphabetical order; family hidden when no provider is
  usable; NSFW slot shows no family while every offering is `false`, and only the
  capable variant when a test descriptor sets one `true`.
- Config view: rows hidden when they would offer a single choice; the price pill
  replaces the Resolution row for flat-price models; provider suffix only on a
  cross-provider Variant row; variant switch applies `carryOverConfig`.
- `image-transcode`: PNG goes to the encoder, JPEG/WebP pass through, encoder
  failure keeps the original.
- `resolveImageSlot` upgrades a legacy slot.

### 7.3 Live harness — local only, never in CI

`packages/llm-unified/curation/run-tti-suite.ts` generates one image per
offering through the real `generateImages()` (keys from `keys/`), at the default
config plus each priced cell not yet measured, **including FLUX.3 4k** (Chris,
2026-10-07). It asserts the returned pixel dimensions against the descriptor
(size tables exactly; tiers within the model's observed band) and prints the
billed `cost`, which fills the remaining `priceCents` cells. Expected spend:
about $1.50.

## 8. Documentation

- One Curation Record per family under `obsidian/models/tti-<family>.md`,
  carrying the §4 findings and the NSFW rationale; `gpt-image-2.md` is renamed
  into `tti-gpt-image-2.md` and updated.
- `.claude/skills/curate/references/image-curation.md` — "Mode 5": catalogue
  fetch → serial probes (`aspect_ratio`/`resolution`/quality, billed `cost`,
  returned dimensions, PNG vs JPEG) → descriptor → harness → record. The skill's
  router gains a row.
- `obsidian/insights/follow-ups-index.md`: `grok-imagine-image-2.0` on direct
  xAI; NSFW judgement per model once community feedback is in.

## 9. Audits

- **Laura — spec-pass** before the plan: the variant moves one level down
  (family → Variant row), which changes the reachability of thirteen models.
- **Laura — pre-squash pass** on the built picker.
- **Larissa — not required**: nothing under `apps/auth-service`,
  `apps/sync-service`, `apps/proxy-service` or `packages/crypto` changes.

## 10. Manual Verification (Chris, on device)

1. **Families:** My Settings → Image generation shows eight family buttons
   alphabetically. Picking *Seedream* shows a Variant row
   (4.5 · 5.0 Flash · 5.0 Lite · 5.0 Pro); *FLUX.3* shows none.
2. **Prices:** FLUX.3 shows `1k · 5¢`, `2k · 12¢`, `4k · 65¢`. Seedream 5.0 Pro
   shows no Resolution row and a `9¢` pill beside Aspect.
3. **Carry-over:** On Seedream 5.0 Flash pick 16:9 and 2k, switch to 5.0 Lite →
   16:9 stays, no Resolution row; back to Flash → 16:9 stays, resolution `2k`.
4. **Quality:** Grok Imagine 2.0 shows `Low · ~20 s` / `Medium · ~70 s`; the
   Resolution prices change with the quality.
5. **Grok across providers:** with both xAI and nano-gpt set up, *Grok Imagine*
   shows `1 · xAI` and `2.0 · nano-gpt`; with only nano-gpt, no Variant row.
6. **Migration:** a device that had Seedream 4.5 "high" configured before the
   update now shows Seedream · 4.5 · 2.2k; a Z-Image *base* user lands on
   Z-Image · Base.
7. **NSFW slot** still says it lights up automatically.
8. **Generation:** ask a persona for a picture with each of the nine new models
   once; it appears in the chat.
9. **Transcode:** generate with Nano Banana at 2k; the saved artefact is a JPEG
   of about 1–2 MB, not a 10 MB PNG, at full resolution.
10. **Second device:** after sync, the second (updated) device shows the same
    model and config.
