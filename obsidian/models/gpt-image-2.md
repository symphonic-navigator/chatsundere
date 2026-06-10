# Model Curation Record — GPT Image 2 (TTI)

> Curation record for an image-generation offering. See [[../providers/nano-gpt]]
> for the shared nano-gpt mechanics. TTI offerings have no CanonicalModel —
> identity lives on the offering (`serviceKind: 'tti'`).

- **Identity:** GPT Image 2 (OpenAI) · groupId `gpt-image-2`
- **Offering:** `nano-gpt:gpt-image-2` · endpoint `/images/generations`
- **Routing:** nano-gpt routes this model via **wavespeed** (catalogue tag), not
  OpenAI directly. The OpenAI wire shape (`quality` as a top-level field) still
  applies end-to-end.
- **NSFW:** ❌ `canDoNsfw: false` (OpenAI moderation applies upstream).
- **🕊️ Freedom:** deployment-true as for all nano-gpt offerings (verbatim
  routing, no added filter); the model itself is OpenAI-moderated.
- **confidence:** `verified` — 18 live probes on 2026-06-10 (full size sweep,
  all three quality tiers, `n: 2`, plus an end-to-end `generateImages()` run).

## Quality — the pass-through finding

nano-gpt's documented schema does not list `quality`, but the Image-Edits docs
state model-specific parameters pass through when supported. **Probed: they
do.** `quality: 'low' | 'medium' | 'high'` reaches the upstream and steers
generation depth, latency **and billing** (all at 1024×1024, single image):

| Quality | Latency | Billed cost |
|---|---|---|
| `low` | ~24 s | $0.018 |
| `medium` | ~71 s | $0.066 (= catalogue list price / `auto`) |
| `high` | ~206 s | $0.156 |

The catalogue's per-size list prices correspond to the `medium`/`auto` tier.
Because `high` runs to ~3.5 min for a single 1K image, the group's POST timeout
is **600 s** (`POST_TIMEOUT_MS` in `generate-images.ts`). Default config is
`medium` (Chris, 2026-06-10) — the balanced sweet spot.

## Sizes — the multiple-of-32 rule

The catalogue's `supported_parameters.resolutions` list (six sizes) is only a
suggestion. Empirically the upstream accepts **arbitrary sizes** within:

- 512–2560 px in each dimension,
- 655,360–3,686,400 total pixels,

and returns the request **pixel-exact iff both dimensions are multiples of
32**. Off-grid requests are snapped up ratio-preserving (probe: asked
1080×1920, got 1152×2048). Chatsundere therefore only ever requests /32 sizes
from the hardcoded aspect × resolution table in `gpt-image-2-resolutions.ts`
(8 aspects × 2 tiers, including **21:9** — every cell delivered pixel-exact in
the probe sweep, including the 1920×1920 cell that sits exactly at the
3,686,400-pixel maximum). The 2K 21:9 cell (2464×1056) is width-capped by the
2560 px dimension limit, so its pixel count sits below the other 2K cells.

## Mechanics

- `response_format: 'url'` — nano-gpt's R2 bucket is CORS-open; result URLs are
  fetched with a bare, header-free GET (Bearer collides with the AWS-V4
  signature), same as Seedream/Z-Image.
- `n` up to **4** (`max_images` in the nano-gpt catalogue); `n: 2` probed —
  items generate in parallel upstream (barely slower than `n: 1`), cost scales
  linearly.
- No per-item moderation marker (nano-gpt fails the whole POST upstream on a
  refused prompt, as for the other nano-gpt TTI models).
- Image-to-image / edits are upstream-supported (`max_input_images: 4`) but
  **out of scope** for this curation — Chatsundere's TTI surface is
  text-to-image only today.
