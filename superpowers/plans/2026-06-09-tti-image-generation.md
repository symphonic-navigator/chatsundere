# TTI Image Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `generate_image` tool that lets companions paint images via the user's globally configured image model, persisting each image as a `kind: 'image'` artefact with inline thumbnails in the chat stream.

**Architecture:** TTI is a first-class `packages/llm-unified` capability — three curated `serviceKind: 'tti'` offerings (Grok Imagine on xAI, Z-Image + Seedream 4.5 on nano-gpt) with a discriminated-union config, pure payload/parse helpers, and a `generateImages` one-shot over the existing transport. The user-client wires a context tool (always offered; unconfigured calls return a constructive settings pointer), persists results as image artefacts (blob + thumb, no new Dexie version beyond the settings v19 bump), and renders a `tool-call` pill (`payload.name === 'generate_image'`) with inline thumbnails → lightbox.

**Spec:** `superpowers/specs/2026-06-09-tti-image-generation-design.md` (approved; Laura spec-pass folded in; CORS probes §10: both providers fully `direct`, xAI uses `b64_json`, nano-gpt uses `url` + bare R2 GET).

**Tech Stack:** TypeScript strict, Bun test (llm-unified), Vitest (user-client), Dexie v19, React 18, existing transport/routing layer.

**Conventions that bind every task:**
- British English everywhere. No emojis in code/commits.
- Biome bans non-null `!` — use guards. Pre-commit runs Biome only; run `pnpm typecheck` yourself before claiming a task done.
- user-client tests live under `apps/user-client/tests/**`; llm-unified tests are colocated `src/**/*.test.ts`.
- Subagents NEVER merge, push, or switch branches. Commit on the current feature branch only.
- Commits: free-form imperative, capitalised subject, co-author tag `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. Code commits never carry `[skip ci]`.

**One deliberate deviation from the spec (recorded here):** spec §7.5 names the unused `PillRow.kind: 'image-result'`; the implementation instead uses the established mechanism — stream-engine creates `kind: 'tool-call'` pills and `Pill.tsx` dispatches on `payload.name` (exactly how `create_artefact`/`ask_expert`/`describe_image` render). Identical UX, zero special cases. The `image-result` kind stays unused.

---

## Task 1: TTI config types, defaults, count clamp, Seedream resolution table (llm-unified)

**Files:**
- Create: `packages/llm-unified/src/tti/config.ts`
- Create: `packages/llm-unified/src/tti/config.test.ts`
- Create: `packages/llm-unified/src/tti/seedream-resolutions.ts`
- Create: `packages/llm-unified/src/tti/seedream-resolutions.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/llm-unified/src/tti/config.test.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { defaultConfigFor, isImageModelConfig, maxCountFor } from './config.js';

describe('defaultConfigFor', () => {
  test('xai-imagine defaults to normal/1k/1:1', () => {
    expect(defaultConfigFor('xai-imagine')).toEqual({
      groupId: 'xai-imagine',
      tier: 'normal',
      resolution: '1k',
      aspect: '1:1',
    });
  });
  test('zimage defaults to turbo/1024x1024', () => {
    expect(defaultConfigFor('zimage')).toEqual({
      groupId: 'zimage',
      variant: 'turbo',
      size: '1024x1024',
    });
  });
  test('seedream defaults to 1:1/standard', () => {
    expect(defaultConfigFor('seedream')).toEqual({
      groupId: 'seedream',
      aspect: '1:1',
      quality: 'standard',
    });
  });
});

describe('maxCountFor', () => {
  test('grok imagine allows up to 10', () => {
    expect(maxCountFor(defaultConfigFor('xai-imagine'))).toBe(10);
  });
  test('z-image turbo allows up to 10, base only 4', () => {
    expect(maxCountFor({ groupId: 'zimage', variant: 'turbo', size: '1024x1024' })).toBe(10);
    expect(maxCountFor({ groupId: 'zimage', variant: 'base', size: '1024x1024' })).toBe(4);
  });
  test('seedream is hard-capped at 4', () => {
    expect(maxCountFor(defaultConfigFor('seedream'))).toBe(4);
  });
});

describe('isImageModelConfig', () => {
  test('accepts each default config', () => {
    expect(isImageModelConfig(defaultConfigFor('xai-imagine'))).toBe(true);
    expect(isImageModelConfig(defaultConfigFor('zimage'))).toBe(true);
    expect(isImageModelConfig(defaultConfigFor('seedream'))).toBe(true);
  });
  test('rejects junk', () => {
    expect(isImageModelConfig(null)).toBe(false);
    expect(isImageModelConfig({ groupId: 'unknown' })).toBe(false);
    expect(isImageModelConfig({ groupId: 'zimage', variant: 'hyper', size: '1024x1024' })).toBe(false);
  });
});
```

`packages/llm-unified/src/tti/seedream-resolutions.test.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { SEEDREAM_RESOLUTIONS, seedreamResolution } from './seedream-resolutions.js';

describe('SEEDREAM_RESOLUTIONS', () => {
  test('covers all 7 aspects × 3 qualities', () => {
    expect(Object.keys(SEEDREAM_RESOLUTIONS)).toHaveLength(21);
  });
  test('every cell is ≥ 3,686,400 pixels and a multiple of 32', () => {
    for (const [w, h] of Object.values(SEEDREAM_RESOLUTIONS)) {
      expect(w * h).toBeGreaterThanOrEqual(3_686_400);
      expect(w % 32).toBe(0);
      expect(h % 32).toBe(0);
    }
  });
  test('spot-checks match the chatsune source table', () => {
    expect(seedreamResolution('1:1', 'standard')).toEqual([1920, 1920]);
    expect(seedreamResolution('16:9', 'ultra')).toEqual([3520, 1984]);
    expect(seedreamResolution('2:3', 'high')).toEqual([1824, 2752]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/llm-unified && bun test src/tti/`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`packages/llm-unified/src/tti/seedream-resolutions.ts` — port the chatsune table verbatim (`~/workspace/chatsune/backend/modules/llm/_adapters/_nano_gpt_image_groups.py:26-48`):

```ts
// SPDX-License-Identifier: LGPL-3.0-only

/**
 * Aspect × quality → [width, height] for Seedream 4.5 on nano-gpt. Hardcoded
 * (not computed) so the same config always hits the same upstream size —
 * deterministic tests, quotable dimensions. Every cell satisfies nano-gpt's
 * 3,686,400-pixel minimum and is a multiple of 32 in both dimensions.
 * Quality tiers target ~3.7M / ~5M / ~7M total pixels. Ported verbatim from
 * chatsune's `_nano_gpt_image_groups.py`.
 */
export const SEEDREAM_RESOLUTIONS: Record<string, [number, number]> = {
  '1:1|standard': [1920, 1920],
  '1:1|high': [2240, 2240],
  '1:1|ultra': [2656, 2656],
  '16:9|standard': [2560, 1440],
  '16:9|high': [2976, 1664],
  '16:9|ultra': [3520, 1984],
  '9:16|standard': [1440, 2560],
  '9:16|high': [1664, 2976],
  '9:16|ultra': [1984, 3520],
  '4:3|standard': [2240, 1664],
  '4:3|high': [2592, 1952],
  '4:3|ultra': [3072, 2304],
  '3:4|standard': [1664, 2240],
  '3:4|high': [1952, 2592],
  '3:4|ultra': [2304, 3072],
  '3:2|standard': [2368, 1568],
  '3:2|high': [2752, 1824],
  '3:2|ultra': [3264, 2176],
  '2:3|standard': [1568, 2368],
  '2:3|high': [1824, 2752],
  '2:3|ultra': [2176, 3264],
};

/** Look up [width, height]; throws on an unknown combination (programming error —
 *  the typed SeedreamConfig prevents it at every call site). */
export function seedreamResolution(aspect: string, quality: string): [number, number] {
  const hit = SEEDREAM_RESOLUTIONS[`${aspect}|${quality}`];
  if (!hit) throw new Error(`seedream: no resolution for ${aspect} × ${quality}`);
  return hit;
}
```

`packages/llm-unified/src/tti/config.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only

/** Grok Imagine (xAI). `tier: 'quality'` maps to `grok-imagine-image-quality`. */
export interface XaiImagineConfig {
  groupId: 'xai-imagine';
  tier: 'normal' | 'quality';
  resolution: '1k' | '2k';
  aspect: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
}

/** Z-Image (nano-gpt). `variant: 'base'` maps to `z-image-base` (~10× slower). */
export interface ZImageConfig {
  groupId: 'zimage';
  variant: 'turbo' | 'base';
  size:
    | '256x256'
    | '512x512'
    | '768x768'
    | '1024x1024'
    | '1280x720'
    | '720x1280'
    | '1536x1024'
    | '1024x1536'
    | '1536x1536';
}

/** Seedream 4.5 (nano-gpt). Aspect × quality resolves via the resolution table. */
export interface SeedreamConfig {
  groupId: 'seedream';
  aspect: '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '2:3';
  quality: 'standard' | 'high' | 'ultra';
}

export type ImageModelConfig = XaiImagineConfig | ZImageConfig | SeedreamConfig;
export type TtiGroupId = ImageModelConfig['groupId'];

const XAI_ASPECTS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4']);
const ZIMAGE_SIZES = new Set([
  '256x256', '512x512', '768x768', '1024x1024', '1280x720',
  '720x1280', '1536x1024', '1024x1536', '1536x1536',
]);
const SEEDREAM_ASPECTS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3']);

/** The defaults a freshly picked model starts from. */
export function defaultConfigFor(groupId: TtiGroupId): ImageModelConfig {
  switch (groupId) {
    case 'xai-imagine':
      return { groupId, tier: 'normal', resolution: '1k', aspect: '1:1' };
    case 'zimage':
      return { groupId, variant: 'turbo', size: '1024x1024' };
    case 'seedream':
      return { groupId, aspect: '1:1', quality: 'standard' };
  }
}

/** Hard cap for the tool's `count` parameter, per group (and Z-Image variant). */
export function maxCountFor(config: ImageModelConfig): number {
  switch (config.groupId) {
    case 'xai-imagine':
      return 10;
    case 'zimage':
      return config.variant === 'base' ? 4 : 10;
    case 'seedream':
      return 4;
  }
}

/** Runtime guard for configs deserialised from Dexie. */
export function isImageModelConfig(v: unknown): v is ImageModelConfig {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  switch (c.groupId) {
    case 'xai-imagine':
      return (
        (c.tier === 'normal' || c.tier === 'quality') &&
        (c.resolution === '1k' || c.resolution === '2k') &&
        XAI_ASPECTS.has(c.aspect as string)
      );
    case 'zimage':
      return (
        (c.variant === 'turbo' || c.variant === 'base') && ZIMAGE_SIZES.has(c.size as string)
      );
    case 'seedream':
      return (
        SEEDREAM_ASPECTS.has(c.aspect as string) &&
        (c.quality === 'standard' || c.quality === 'high' || c.quality === 'ultra')
      );
    default:
      return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/llm-unified && bun test src/tti/`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/tti/
git commit -m "Add TTI config types, count clamp, and Seedream resolution table"
```

---

## Task 2: Payload builders and response parsing (llm-unified)

**Files:**
- Create: `packages/llm-unified/src/tti/payloads.ts`
- Create: `packages/llm-unified/src/tti/payloads.test.ts`
- Create: `packages/llm-unified/src/tti/parse.ts`
- Create: `packages/llm-unified/src/tti/parse.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/llm-unified/src/tti/payloads.test.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { buildImagePayload } from './payloads.js';

describe('buildImagePayload', () => {
  test('xai quality/2k/16:9 → b64_json with quality model id', () => {
    expect(
      buildImagePayload(
        { groupId: 'xai-imagine', tier: 'quality', resolution: '2k', aspect: '16:9' },
        'a fox',
        2,
      ),
    ).toEqual({
      model: 'grok-imagine-image-quality',
      prompt: 'a fox',
      n: 2,
      response_format: 'b64_json',
      aspect_ratio: '16:9',
      resolution: '2k',
    });
  });
  test('xai normal tier uses the base model id', () => {
    const body = buildImagePayload(
      { groupId: 'xai-imagine', tier: 'normal', resolution: '1k', aspect: '1:1' },
      'a fox',
      1,
    );
    expect(body.model).toBe('grok-imagine-image');
  });
  test('zimage base → url with size passthrough', () => {
    expect(
      buildImagePayload({ groupId: 'zimage', variant: 'base', size: '1536x1024' }, 'a fox', 1),
    ).toEqual({
      model: 'z-image-base',
      prompt: 'a fox',
      n: 1,
      size: '1536x1024',
      response_format: 'url',
    });
  });
  test('seedream resolves size from the resolution table', () => {
    const body = buildImagePayload(
      { groupId: 'seedream', aspect: '16:9', quality: 'ultra' },
      'a fox',
      4,
    );
    expect(body).toEqual({
      model: 'seedream-v4.5',
      prompt: 'a fox',
      n: 4,
      size: '3520x1984',
      response_format: 'url',
    });
  });
});
```

`packages/llm-unified/src/tti/parse.test.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { parseImagesResponse } from './parse.js';

describe('parseImagesResponse — xai', () => {
  test('b64 items pass through with mime; moderated items carry the reason', () => {
    const items = parseImagesResponse('xai-imagine', {
      data: [
        { b64_json: 'AAAA', mime_type: 'image/jpeg' },
        { respect_moderation: false, reason: 'content policy' },
      ],
    });
    expect(items).toEqual([
      { kind: 'b64', b64: 'AAAA', mime: 'image/jpeg' },
      { kind: 'moderated', reason: 'content policy' },
    ]);
  });
  test('missing mime_type defaults to null (caller falls back to image/jpeg)', () => {
    const items = parseImagesResponse('xai-imagine', { data: [{ b64_json: 'AAAA' }] });
    expect(items).toEqual([{ kind: 'b64', b64: 'AAAA', mime: null }]);
  });
});

describe('parseImagesResponse — nano-gpt groups', () => {
  test('url items pass through; cost may be absent (z-image turbo)', () => {
    const items = parseImagesResponse('zimage', {
      data: [{ url: 'https://r2.example/a.jpg', storageKey: 'k' }],
    });
    expect(items).toEqual([{ kind: 'url', url: 'https://r2.example/a.jpg' }]);
  });
  test('entries without url or b64 are dropped, not crashed on', () => {
    expect(parseImagesResponse('seedream', { data: [{}] })).toEqual([]);
  });
  test('malformed payload (no data array) returns []', () => {
    expect(parseImagesResponse('seedream', { error: 'nope' })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/llm-unified && bun test src/tti/payloads.test.ts src/tti/parse.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`packages/llm-unified/src/tti/payloads.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import type { ImageModelConfig } from './config.js';
import { seedreamResolution } from './seedream-resolutions.js';

/**
 * Build the OpenAI-shaped `/images/generations` body for a config + prompt +
 * count. The `response_format` split is empirical (spec §10): xAI's image CDN
 * is CORS-closed to browsers, so bytes come inline as `b64_json`; nano-gpt's
 * R2 bucket is CORS-open, so `url` keeps the POST response small.
 */
export function buildImagePayload(
  config: ImageModelConfig,
  prompt: string,
  n: number,
): Record<string, unknown> {
  switch (config.groupId) {
    case 'xai-imagine':
      return {
        model: config.tier === 'quality' ? 'grok-imagine-image-quality' : 'grok-imagine-image',
        prompt,
        n,
        response_format: 'b64_json',
        aspect_ratio: config.aspect,
        resolution: config.resolution,
      };
    case 'zimage':
      return {
        model: config.variant === 'base' ? 'z-image-base' : 'z-image-turbo',
        prompt,
        n,
        size: config.size,
        response_format: 'url',
      };
    case 'seedream': {
      const [w, h] = seedreamResolution(config.aspect, config.quality);
      return {
        model: 'seedream-v4.5',
        prompt,
        n,
        size: `${w}x${h}`,
        response_format: 'url',
      };
    }
  }
}
```

`packages/llm-unified/src/tti/parse.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import type { TtiGroupId } from './config.js';

/** One pre-fetch item from a generations response. */
export type RawImageItem =
  | { kind: 'b64'; b64: string; mime: string | null }
  | { kind: 'url'; url: string }
  | { kind: 'moderated'; reason: string | null };

interface ResponseEntry {
  b64_json?: unknown;
  url?: unknown;
  mime_type?: unknown;
  respect_moderation?: unknown;
  reason?: unknown;
}

/**
 * Parse a `/images/generations` JSON payload into raw items. xAI marks
 * moderated entries per-item (`respect_moderation: false` + `reason`);
 * nano-gpt has no per-item moderation (a refused prompt fails the whole POST
 * with 4xx upstream of this function). Unknown entry shapes are dropped.
 */
export function parseImagesResponse(groupId: TtiGroupId, payload: unknown): RawImageItem[] {
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const items: RawImageItem[] = [];
  for (const raw of data as ResponseEntry[]) {
    if (groupId === 'xai-imagine' && raw.respect_moderation === false) {
      items.push({ kind: 'moderated', reason: typeof raw.reason === 'string' ? raw.reason : null });
      continue;
    }
    if (typeof raw.b64_json === 'string') {
      items.push({
        kind: 'b64',
        b64: raw.b64_json,
        mime: typeof raw.mime_type === 'string' ? raw.mime_type : null,
      });
      continue;
    }
    if (typeof raw.url === 'string') items.push({ kind: 'url', url: raw.url });
  }
  return items;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/llm-unified && bun test src/tti/`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/tti/
git commit -m "Add TTI payload builders and response parsing"
```

---

## Task 3: `generateImages` one-shot orchestration (llm-unified)

**Files:**
- Create: `packages/llm-unified/src/tti/generate-images.ts`
- Create: `packages/llm-unified/src/tti/generate-images.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/llm-unified/src/tti/generate-images.test.ts` — inject `fetchFn`; never hit the network:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import type { ProviderConfig, ProviderDefinition } from '../types.js';
import { ImageGenerationError, generateImages } from './generate-images.js';

const provider = { id: 'nano-gpt', baseUrl: 'https://nano-gpt.com/api/v1' } as ProviderDefinition;
const providerConfig: ProviderConfig = {
  baseUrl: 'https://nano-gpt.com/api/v1',
  routing: { kind: 'direct' },
};
const base = {
  provider,
  providerConfig,
  apiKey: 'k',
  corsProxyUrl: null,
  corsProxyKey: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('generateImages — nano-gpt url flow', () => {
  test('POSTs the payload, fetches each url WITHOUT auth headers, returns blobs', async () => {
    const calls: Array<{ url: string; hasAuth: boolean }> = [];
    const fetchFn: typeof fetch = async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      calls.push({ url: req.url, hasAuth: req.headers.has('authorization') });
      if (req.url.endsWith('/images/generations')) {
        return jsonResponse({ data: [{ url: 'https://r2.example/img.jpg' }] });
      }
      return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    };
    const result = await generateImages({
      ...base,
      config: { groupId: 'zimage', variant: 'turbo', size: '1024x1024' },
      prompt: 'a fox',
      count: 1,
      fetchFn,
    });
    expect(result.modelId).toBe('z-image-turbo');
    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    if (item?.kind !== 'image') throw new Error('expected an image item');
    expect(item.mime).toBe('image/jpeg');
    expect(item.bytes.size).toBe(3);
    // The generations POST carries auth; the R2 GET must NOT (spec §5.2).
    expect(calls[0]?.hasAuth).toBe(true);
    expect(calls[1]?.hasAuth).toBe(false);
  });

  test('a failed url fetch degrades that item to moderated, not the whole call', async () => {
    const fetchFn: typeof fetch = async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      if (req.url.endsWith('/images/generations')) {
        return jsonResponse({ data: [{ url: 'https://r2.example/a.jpg' }, { url: 'https://r2.example/b.jpg' }] });
      }
      if (req.url.endsWith('/a.jpg')) return new Response('nope', { status: 403 });
      return new Response(new Blob([new Uint8Array([1])], { type: 'image/jpeg' }), { status: 200 });
    };
    const result = await generateImages({
      ...base,
      config: { groupId: 'zimage', variant: 'turbo', size: '1024x1024' },
      prompt: 'a fox',
      count: 2,
      fetchFn,
    });
    expect(result.items.map((i) => i.kind)).toEqual(['moderated', 'image']);
  });
});

describe('generateImages — xai b64 flow', () => {
  const xaiBase = {
    ...base,
    provider: { id: 'xai', baseUrl: 'https://api.x.ai/v1' } as ProviderDefinition,
    providerConfig: { baseUrl: 'https://api.x.ai/v1', routing: { kind: 'direct' } } as ProviderConfig,
  };
  test('decodes inline b64 into a Blob and resolves the tiered model id', async () => {
    const b64 = btoa(String.fromCharCode(9, 8, 7));
    const fetchFn: typeof fetch = async () =>
      jsonResponse({ data: [{ b64_json: b64, mime_type: 'image/png' }] });
    const result = await generateImages({
      ...xaiBase,
      config: { groupId: 'xai-imagine', tier: 'quality', resolution: '1k', aspect: '1:1' },
      prompt: 'a fox',
      count: 1,
      fetchFn,
    });
    expect(result.modelId).toBe('grok-imagine-image-quality');
    const item = result.items[0];
    if (item?.kind !== 'image') throw new Error('expected an image item');
    expect(item.mime).toBe('image/png');
    expect(item.bytes.size).toBe(3);
  });
  test('per-item moderation surfaces beside successes', async () => {
    const fetchFn: typeof fetch = async () =>
      jsonResponse({
        data: [
          { b64_json: btoa('x'), mime_type: 'image/jpeg' },
          { respect_moderation: false, reason: 'blocked' },
        ],
      });
    const result = await generateImages({
      ...xaiBase,
      config: { groupId: 'xai-imagine', tier: 'normal', resolution: '1k', aspect: '1:1' },
      prompt: 'a fox',
      count: 2,
      fetchFn,
    });
    expect(result.items.map((i) => i.kind)).toEqual(['image', 'moderated']);
  });
});

describe('generateImages — errors', () => {
  test('an HTTP 4xx throws ImageGenerationError carrying the provider message', async () => {
    const fetchFn: typeof fetch = async () =>
      jsonResponse({ error: { message: 'prompt rejected' } }, 422);
    await expect(
      generateImages({
        ...base,
        config: { groupId: 'seedream', aspect: '1:1', quality: 'standard' },
        prompt: 'a fox',
        count: 1,
        fetchFn,
      }),
    ).rejects.toThrow(ImageGenerationError);
    try {
      await generateImages({
        ...base,
        config: { groupId: 'seedream', aspect: '1:1', quality: 'standard' },
        prompt: 'a fox',
        count: 1,
        fetchFn,
      });
    } catch (e) {
      const err = e as ImageGenerationError;
      expect(err.status).toBe(422);
      expect(err.providerMessage).toBe('prompt rejected');
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/llm-unified && bun test src/tti/generate-images.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/llm-unified/src/tti/generate-images.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { buildRequest } from '../transport.js';
import type { ProviderConfig, ProviderDefinition } from '../types.js';
import type { ImageModelConfig } from './config.js';
import { buildImagePayload } from './payloads.js';
import { parseImagesResponse } from './parse.js';

/** xAI returns within ~tens of seconds; Z-Image base at count 4 takes ~3 min. */
const POST_TIMEOUT_MS: Record<ImageModelConfig['groupId'], number> = {
  'xai-imagine': 60_000,
  zimage: 300_000,
  seedream: 300_000,
};
const URL_FETCH_TIMEOUT_MS = 60_000;

/** Connection-independent inputs the caller (apps/) resolves per provider row. */
export interface ImageRequestBase {
  provider: ProviderDefinition;
  providerConfig: ProviderConfig;
  apiKey: string;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
}

export interface GenerateImagesArgs extends ImageRequestBase {
  config: ImageModelConfig;
  prompt: string;
  /** Already clamped by the caller via `maxCountFor`. */
  count: number;
  signal?: AbortSignal;
  /** Test injection; defaults to global fetch. */
  fetchFn?: typeof fetch;
}

export type ImageGenItem =
  | { kind: 'image'; bytes: Blob; mime: string }
  | { kind: 'moderated'; reason: string | null };

export interface GenerateImagesResult {
  items: ImageGenItem[];
  /** The upstream model id actually used (e.g. 'grok-imagine-image-quality'). */
  modelId: string;
}

/** Typed failure for the whole generation call (HTTP error, malformed body). */
export class ImageGenerationError extends Error {
  status?: number;
  providerMessage?: string;
  constructor(message: string, opts?: { status?: number; providerMessage?: string }) {
    super(message);
    this.name = 'ImageGenerationError';
    this.status = opts?.status;
    this.providerMessage = opts?.providerMessage;
  }
}

function extractProviderMessage(json: unknown): string | undefined {
  const err = (json as { error?: { message?: unknown } })?.error;
  return typeof err?.message === 'string' ? err.message : undefined;
}

function b64ToBlob(b64: string, mime: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Synchronous one-shot image generation over the provider's
 * `/images/generations` endpoint (OpenAI-compatible). Routing (direct or
 * cors-proxy) follows the provider row, like every other call. Result URLs
 * (nano-gpt R2) are fetched with a bare GET and NO Authorization header — a
 * Bearer token collides with the AWS-V4 signature (spec §5.2). A failed
 * per-URL fetch degrades that item to `moderated`, never the whole call.
 */
export async function generateImages(args: GenerateImagesArgs): Promise<GenerateImagesResult> {
  const fetchFn = args.fetchFn ?? fetch;
  const body = buildImagePayload(args.config, args.prompt, args.count);
  const modelId = body.model as string;

  const timeoutSignal = AbortSignal.timeout(POST_TIMEOUT_MS[args.config.groupId]);
  const signal = args.signal ? AbortSignal.any([args.signal, timeoutSignal]) : timeoutSignal;

  const request = buildRequest({
    provider: args.providerConfig,
    apiKey: args.apiKey,
    corsProxyUrl: args.corsProxyUrl,
    corsProxyKey: args.corsProxyKey,
    path: '/images/generations',
    method: 'POST',
    body,
  });
  const response = await fetchFn(request, { signal });
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    json = undefined;
  }
  if (!response.ok) {
    throw new ImageGenerationError(`image generation returned ${response.status}`, {
      status: response.status,
      providerMessage: extractProviderMessage(json),
    });
  }

  const raw = parseImagesResponse(args.config.groupId, json);
  if (raw.length === 0) {
    throw new ImageGenerationError('image generation returned no items', {
      status: response.status,
      providerMessage: extractProviderMessage(json),
    });
  }

  const items: ImageGenItem[] = [];
  for (const item of raw) {
    if (item.kind === 'moderated') {
      items.push(item);
      continue;
    }
    if (item.kind === 'b64') {
      items.push({ kind: 'image', bytes: b64ToBlob(item.b64, item.mime ?? 'image/jpeg'), mime: item.mime ?? 'image/jpeg' });
      continue;
    }
    try {
      const urlSignal = args.signal
        ? AbortSignal.any([args.signal, AbortSignal.timeout(URL_FETCH_TIMEOUT_MS)])
        : AbortSignal.timeout(URL_FETCH_TIMEOUT_MS);
      // Bare GET, deliberately header-free (R2 signed URL).
      const blobResponse = await fetchFn(item.url, { signal: urlSignal });
      if (!blobResponse.ok) {
        items.push({ kind: 'moderated', reason: `image fetch returned ${blobResponse.status}` });
        continue;
      }
      const bytes = await blobResponse.blob();
      const mime = blobResponse.headers.get('content-type') ?? 'image/jpeg';
      items.push({ kind: 'image', bytes, mime });
    } catch {
      items.push({ kind: 'moderated', reason: 'image fetch failed' });
    }
  }
  return { items, modelId };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/llm-unified && bun test src/tti/`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/tti/
git commit -m "Add generateImages one-shot over the shared transport"
```

---

## Task 4: Catalogue `tti` meta, three offerings, registry helper, exports (llm-unified)

**Files:**
- Modify: `packages/llm-unified/src/catalogue/types.ts` (Offering gains `tti?`)
- Modify: `packages/llm-unified/src/providers/xai.ts` (Grok Imagine offering)
- Modify: `packages/llm-unified/src/providers/nano-gpt.ts` (Z-Image + Seedream offerings)
- Modify: `packages/llm-unified/src/registry.ts` (add `listTtiOfferings`)
- Modify: `packages/llm-unified/src/index.ts` (export the `tti/` modules + `TtiOfferingMeta`)
- Create: `packages/llm-unified/src/tti/offerings.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/llm-unified/src/tti/offerings.test.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { getOffering, listTtiOfferings } from '../registry.js';
import '../providers/_register-builtins.js';

describe('TTI offerings', () => {
  test('the three launch offerings are curated and none can do NSFW', () => {
    const ttis = listTtiOfferings();
    const refs = ttis.map((o) => `${o.providerId}:${o.upstreamSlug}`).sort();
    expect(refs).toEqual(['nano-gpt:seedream-v4.5', 'nano-gpt:z-image-turbo', 'xai:grok-imagine-image']);
    for (const o of ttis) {
      expect(o.serviceKind).toBe('tti');
      expect(o.canonicalRef).toBeNull();
      expect(o.tti?.canDoNsfw).toBe(false);
      expect(typeof o.tti?.displayName).toBe('string');
    }
  });
  test('groupIds map as designed', () => {
    expect(getOffering('xai', 'grok-imagine-image')?.tti?.groupId).toBe('xai-imagine');
    expect(getOffering('nano-gpt', 'z-image-turbo')?.tti?.groupId).toBe('zimage');
    expect(getOffering('nano-gpt', 'seedream-v4.5')?.tti?.groupId).toBe('seedream');
  });
});
```

Note: if `_register-builtins.js` is auto-imported by the registry test setup already (check `registry.offerings.test.ts` for the established import idiom), copy that idiom instead.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/tti/offerings.test.ts`
Expected: FAIL — `listTtiOfferings` not exported / offerings missing.

- [ ] **Step 3: Implement**

In `packages/llm-unified/src/catalogue/types.ts`, next to the existing `web?` field on `Offering` (line ~52), add:

```ts
/** Image-generation metadata when `serviceKind === 'tti'`; undefined otherwise. */
export interface TtiOfferingMeta {
  groupId: 'xai-imagine' | 'zimage' | 'seedream';
  /** Whether the upstream accepts adult prompts. All launch models: false. */
  canDoNsfw: boolean;
  /** Human-readable model name (TTI offerings have no CanonicalModel). */
  displayName: string;
}
```

and on the `Offering` interface:

```ts
  /** Capability metadata when `serviceKind === 'tti'`; undefined otherwise. */
  tti?: TtiOfferingMeta;
```

In `packages/llm-unified/src/providers/nano-gpt.ts`, mirror the `webSearchOffering` stub pattern (line 180) with a `ttiOffering` helper and register two offerings in the provider's `offerings` array:

```ts
import type { TtiOfferingMeta } from '../catalogue/types.js';

function ttiOffering(slug: string, tti: TtiOfferingMeta): Offering {
  return {
    canonicalRef: null,
    providerId: 'nano-gpt',
    upstreamSlug: slug,
    adapter: { kind: 'generic' }, // image calls bypass chat adapters entirely
    profile: {
      reasoning: { mode: 'none' },
      toolCalls: { supported: false, streaming: false, concurrentWithReasoning: false },
      vision: false,
      replayReasoning: false,
    },
    // Not a chat model — the context-window concept does not apply.
    context: { recommended: 0, max: 0 },
    trust: { tee: false, zdr: false },
    freedomOrientedDeployment: true,
    source: 'curated',
    confidence: 'verified', // live CORS + generation probes with Chris, 2026-06-09 (spec §10)
    serviceKind: 'tti',
    tti,
  };
}

const ttiOfferings: Offering[] = [
  ttiOffering('z-image-turbo', { groupId: 'zimage', canDoNsfw: false, displayName: 'Z-Image' }),
  ttiOffering('seedream-v4.5', { groupId: 'seedream', canDoNsfw: false, displayName: 'Seedream 4.5' }),
];
```

and append `...ttiOfferings` where the provider definition assembles its `offerings`. Note the Z-Image offering's slug is `z-image-turbo` but the *config* `variant` decides the wire model id at payload-build time (the offering represents the group).

In `packages/llm-unified/src/providers/xai.ts`, append to the `offerings` array (same stub shape, `providerId: 'xai'`):

```ts
  {
    canonicalRef: null,
    providerId: 'xai',
    upstreamSlug: 'grok-imagine-image',
    adapter: { kind: 'generic' },
    profile: {
      reasoning: { mode: 'none' },
      toolCalls: { supported: false, streaming: false, concurrentWithReasoning: false },
      vision: false,
      replayReasoning: false,
    },
    context: { recommended: 0, max: 0 },
    trust: { tee: false, zdr: false, jurisdiction: 'US' },
    freedomOrientedDeployment: true,
    source: 'curated',
    confidence: 'verified', // live CORS + generation probes with Chris, 2026-06-09 (spec §10)
    serviceKind: 'tti',
    tti: { groupId: 'xai-imagine', canDoNsfw: false, displayName: 'Grok Imagine' },
  },
```

`registerXai()` loops offerings and registers catalogue adapters — the TTI offering uses `adapter: { kind: 'generic' }` so the loop's `if (o.adapter.kind === 'catalogue')` guard already skips it. Verify the same holds in nano-gpt's registration loop (it switches on adapter kind / slug maps — ensure TTI slugs are excluded from the web/chat adapter registration branches; guard with `o.serviceKind === 'tti' ? continue` if needed).

In `packages/llm-unified/src/registry.ts`, beside `getOffering` (line 76):

```ts
/** Every curated TTI offering across all registered providers. */
export function listTtiOfferings(): Offering[] {
  return listProviders().flatMap((p) => p.offerings.filter((o) => o.serviceKind === 'tti'));
}
```

(`listProviders` exists in registry.ts; check the exact name and reuse it.)

In `packages/llm-unified/src/index.ts`, add exports:

```ts
export {
  defaultConfigFor,
  isImageModelConfig,
  maxCountFor,
  type ImageModelConfig,
  type SeedreamConfig,
  type TtiGroupId,
  type XaiImagineConfig,
  type ZImageConfig,
} from './tti/config.js';
export {
  generateImages,
  ImageGenerationError,
  type GenerateImagesArgs,
  type GenerateImagesResult,
  type ImageGenItem,
  type ImageRequestBase,
} from './tti/generate-images.js';
export type { TtiOfferingMeta } from './catalogue/types.js';
export { listTtiOfferings } from './registry.js';
```

- [ ] **Step 4: Run the full llm-unified suite**

Run: `cd packages/llm-unified && bun test`
Expected: PASS — all pre-existing tests (283+) plus the new ones. The catalogue schema tests may assert offering invariants; if one fails on the new `serviceKind: 'tti'` entries, extend the schema test the way `serviceKind: 'web'` was accommodated (look at `catalogue/schema.test.ts` / `registry.modality.test.ts` for the web precedent) — never weaken an assertion, widen it explicitly.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src
git commit -m "Curate Grok Imagine, Z-Image, and Seedream 4.5 as tti offerings"
```

---

## Task 5: Dexie v19 — `SettingsRow.imageGeneration` (user-client)

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts` (SettingsRow type + v19 block + the `ensureSettingsRow`/default-row builder if one exists — search for where a fresh `SettingsRow` literal is constructed and add the new field there too)
- Test: `apps/user-client/tests/boot/client-data-db.imagegen.test.ts`

**⚠ Pre-flight:** run `rg -n "this.version\(" apps/user-client/src/boot/client-data-db.ts | tail -2` — the head MUST still be 18. If a parallel feature claimed 19, renumber to the next free version and update this plan's references (parallel-feature Dexie version ownership rule).

- [ ] **Step 1: Write the failing test**

`apps/user-client/tests/boot/client-data-db.imagegen.test.ts` (mirror the structure of the existing settings-migration tests in `tests/boot/` — find one with `rg -l "expertWeb" apps/user-client/tests/boot/` and copy its open/seed idiom):

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { getClientDataDb } from '../../src/boot/client-data-db.js';

describe('Dexie v19 — imageGeneration settings', () => {
  it('a fresh settings row carries imageGeneration with both slots null', async () => {
    const db = getClientDataDb();
    await db.open();
    const settings = await db.settings.get(1);
    expect(settings?.imageGeneration).toEqual({ primary: null, nsfw: null });
  });
});
```

(If the boot tests use an explicit seeding helper rather than relying on first-run defaults, follow that idiom; the assertion stays the same. Also assert the upgrade path if an existing boot test demonstrates seeding an old-version row first — copy that pattern for a pre-v19 row missing the field.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/boot/client-data-db.imagegen.test.ts`
Expected: FAIL — `imageGeneration` undefined / type error.

- [ ] **Step 3: Implement**

In `SettingsRow` (client-data-db.ts:13), after `expertModel`:

```ts
  /** Global image-generation models. `ref` = "providerTemplateId:upstreamSlug".
   *  `primary` drives generate_image; `nsfw` is the NSFW-capable second slot
   *  (spec 2026-06-09 §6). Both null until the user picks. */
  imageGeneration: {
    primary: { ref: string; config: ImageModelConfig } | null;
    nsfw: { ref: string; config: ImageModelConfig } | null;
  };
```

with `import type { ImageModelConfig } from '@chatsundere/llm-unified';` at the top.

After the `this.version(18)` block (line 621), following the v17 settings-backfill template exactly:

```ts
    // Version 19 — TTI image generation. Settings gain `imageGeneration`
    // (primary + NSFW model slots, spec 2026-06-09).
    this.version(19)
      .stores({ settings: 'id' })
      .upgrade(async (tx) => {
        await tx
          .table('settings')
          .toCollection()
          .modify((s: Record<string, unknown>) => {
            if (s.imageGeneration === undefined) {
              s.imageGeneration = { primary: null, nsfw: null };
            }
          });
      });
```

Find the fresh-row default (search `rg -n "expertModel: null" apps/user-client/src` — wherever the initial `SettingsRow` literal is built, e.g. a `defaultSettings`/boot seeding function and any test fixtures) and add `imageGeneration: { primary: null, nsfw: null },` everywhere the type now demands it. Let `pnpm typecheck` find every site; fix all.

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/boot/ && pnpm typecheck --force`
Expected: boot tests PASS; typecheck 14/14 (fixture fallout fixed).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client
git commit -m "Add Dexie v19 imageGeneration settings slots"
```

---

## Task 6: Image artefacts — row fields, persist function, thumbnail helper (user-client)

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts` (ArtefactRow optional image fields — non-indexed, NO new Dexie version)
- Modify: `apps/user-client/src/data/artefacts.ts` (add `addGeneratedImageArtefact`)
- Create: `apps/user-client/src/lib/image-thumbnail.ts`
- Test: `apps/user-client/tests/unit/image-artefacts.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/user-client/tests/unit/image-artefacts.test.ts` (mirror the fake-indexeddb / db idiom of the existing `tests/unit` artefact tests — find via `rg -l "addGeneratedArtefact" apps/user-client/tests/`):

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { addGeneratedImageArtefact } from '../../src/data/artefacts.js';
import { getClientDataDb } from '../../src/boot/client-data-db.js';

describe('addGeneratedImageArtefact', () => {
  it('persists kind image with blobs, dimensions, and genMeta provenance', async () => {
    const bytes = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    const thumb = new Blob([new Uint8Array([1])], { type: 'image/jpeg' });
    const id = await addGeneratedImageArtefact({
      chatId: 'c1',
      personaId: 'p1',
      prompt: 'a small watercolour fox sitting on a mossy stone',
      modelRef: 'nano-gpt:z-image-turbo',
      modelLabel: 'Z-Image',
      configSnapshot: { groupId: 'zimage', variant: 'turbo', size: '1024x1024' },
      bytes,
      mime: 'image/jpeg',
      thumbBlob: thumb,
      width: 1024,
      height: 1024,
    });
    const row = await getClientDataDb().artefacts.get(id);
    expect(row?.kind).toBe('image');
    expect(row?.format).toBe('image');
    expect(row?.origin).toBe('generated');
    expect(row?.mime).toBe('image/jpeg');
    expect(row?.content).toBe('');
    expect(row?.title).toBe('a small watercolour fox sitting'); // first 5 words of the prompt
    expect(row?.fileName).toMatch(/\.jpg$/);
    expect(row?.width).toBe(1024);
    expect(row?.blob).toBeDefined();
    expect(row?.thumbBlob).toBeDefined();
    expect(row?.genMeta?.prompt).toContain('watercolour fox');
    expect(row?.genMeta?.modelLabel).toBe('Z-Image');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/unit/image-artefacts.test.ts`
Expected: FAIL — function not exported.

- [ ] **Step 3: Implement**

`ArtefactRow` additions (client-data-db.ts:179, all optional, all non-indexed — Dexie stores them schemalessly; NO version bump):

```ts
  /** kind === 'image' — the original provider bytes, unmodified. */
  blob?: Blob;
  /** kind === 'image' — downscaled JPEG for the chat stream + Treasury. */
  thumbBlob?: Blob;
  /** kind === 'image' — measured via createImageBitmap after fetch. */
  width?: number;
  height?: number;
  /** origin === 'generated' images — generation provenance (prompt copyable). */
  genMeta?: {
    prompt: string;
    modelRef: string;
    modelLabel: string;
    configSnapshot: ImageModelConfig;
  };
```

`apps/user-client/src/lib/image-thumbnail.ts` — canvas work, mirrors `image-normalise.ts` (and like it, is jsdom-untestable; manual verification covers it):

```ts
// SPDX-License-Identifier: AGPL-3.0-only

/** Longest-edge target for chat-stream/Treasury thumbnails (380 px bubble budget × ~2 dpr). */
export const THUMB_MAX_EDGE = 640;
const THUMB_JPEG_QUALITY = 0.8;

export interface ImageThumbnail {
  thumbBlob: Blob;
  width: number;
  height: number;
}

/**
 * Measure a generated image and produce its thumbnail. Returns the ORIGINAL
 * dimensions (width/height) plus a downscaled JPEG whose longest edge is
 * THUMB_MAX_EDGE (never upscaled). Mirrors `image-normalise.ts` canvas rules.
 * NOT unit-testable in jsdom (no real canvas) — covered by manual verification.
 */
export async function thumbnailFromBlob(bytes: Blob): Promise<ImageThumbnail> {
  const bitmap = await createImageBitmap(bytes);
  const { width, height } = bitmap;
  const longest = Math.max(width, height);
  const scale = longest > THUMB_MAX_EDGE ? THUMB_MAX_EDGE / longest : 1;
  const tw = Math.round(width * scale);
  const th = Math.round(height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, tw, th);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, tw, th);
  bitmap.close();
  const thumbBlob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', THUMB_JPEG_QUALITY),
  );
  if (!thumbBlob) throw new Error('thumbnail encoding failed (toBlob returned null)');
  return { thumbBlob, width, height };
}
```

`data/artefacts.ts` — beside `addGeneratedArtefact` (line 26):

```ts
import type { ImageModelConfig } from '@chatsundere/llm-unified';

export interface AddGeneratedImageArtefactInput {
  chatId: string;
  personaId: string;
  prompt: string;
  modelRef: string;
  modelLabel: string;
  configSnapshot: ImageModelConfig;
  bytes: Blob;
  mime: string;
  thumbBlob: Blob;
  width: number;
  height: number;
}

/** Title = the prompt's first five words (renameable later, like every artefact). */
export function titleFromPrompt(prompt: string): string {
  const words = prompt.trim().split(/\s+/).slice(0, 5).join(' ');
  return words.length > 0 ? words : 'Generated image';
}

function extensionForMime(mime: string): string {
  return mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
}

/** Insert one generated image as a kind:'image' artefact and return its id. */
export async function addGeneratedImageArtefact(
  input: AddGeneratedImageArtefactInput,
): Promise<string> {
  const id = uuidv7();
  const now = Date.now();
  const title = titleFromPrompt(input.prompt);
  const row: ArtefactRow = {
    id,
    chatId: input.chatId,
    personaId: input.personaId,
    projectId: null,
    origin: 'generated',
    kind: 'image',
    format: 'image',
    title,
    fileName: `${slugify(title)}.${extensionForMime(input.mime)}`,
    mime: input.mime,
    content: '',
    tags: [],
    favourite: false,
    createdAt: now,
    updatedAt: now,
    blob: input.bytes,
    thumbBlob: input.thumbBlob,
    width: input.width,
    height: input.height,
    genMeta: {
      prompt: input.prompt,
      modelRef: input.modelRef,
      modelLabel: input.modelLabel,
      configSnapshot: input.configSnapshot,
    },
  };
  await getClientDataDb().artefacts.add(row);
  return id;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/unit/image-artefacts.test.ts && pnpm typecheck --force`
Expected: PASS; typecheck 14/14.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client
git commit -m "Add image artefact fields and addGeneratedImageArtefact"
```

---

## Task 7: The `generate_image` context tool (user-client)

**Files:**
- Create: `apps/user-client/src/tools/generate-image.ts`
- Test: `apps/user-client/tests/tools/generate-image.test.ts`

The tool is dependency-injected like `KnowledgeContext` (closures, no direct db/network imports) so it is fully unit-testable.

- [ ] **Step 1: Write the failing tests**

`apps/user-client/tests/tools/generate-image.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import type { GenerateImagesResult } from '@chatsundere/llm-unified';
import {
  computeNsfwParamAllowed,
  contributeImageTool,
  type ImageToolContext,
} from '../../src/tools/generate-image.js';

const slot = (over: Partial<ImageToolContext['primary'] & object> = {}) => ({
  ref: 'nano-gpt:z-image-turbo',
  modelLabel: 'Z-Image',
  canDoNsfw: false,
  config: { groupId: 'zimage' as const, variant: 'turbo' as const, size: '1024x1024' as const },
  ...over,
});

function ctx(over: Partial<ImageToolContext> = {}): ImageToolContext {
  return {
    chatId: 'c1',
    personaId: 'p1',
    primary: slot(),
    nsfwSlot: null,
    nsfwParamAllowed: false,
    generate: vi.fn(async (): Promise<GenerateImagesResult> => ({
      items: [{ kind: 'image', bytes: new Blob(['x'], { type: 'image/jpeg' }), mime: 'image/jpeg' }],
      modelId: 'z-image-turbo',
    })),
    persistImage: vi.fn(async () => 'artefact-1'),
    ...over,
  };
}

describe('computeNsfwParamAllowed — the §2.6 three-way gate (8 combinations)', () => {
  it.each([
    [false, 'sfw', false, false],
    [false, 'sfw', true, false],
    [false, 'nsfw', false, false],
    [false, 'nsfw', true, false],
    [true, 'sfw', false, false],
    [true, 'sfw', true, false],
    [true, 'nsfw', false, false],
    [true, 'nsfw', true, true], // ONLY adult persona + nsfw mode + nsfw-capable model
  ] as const)('adultPersona=%s adultMode=%s nsfwCapable=%s → %s', (persona, mode, capable, want) => {
    expect(computeNsfwParamAllowed(persona, mode, capable)).toBe(want);
  });
});

describe('contributeImageTool — schema', () => {
  it('is ALWAYS offered, even with no primary model', () => {
    const tools = contributeImageTool(ctx({ primary: null }));
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('generate_image');
  });
  it('omits the nsfw property unless nsfwParamAllowed', () => {
    const off = contributeImageTool(ctx())[0];
    const on = contributeImageTool(ctx({ nsfwParamAllowed: true }))[0];
    const props = (t: typeof off) =>
      Object.keys((t?.parameters as { properties: object }).properties);
    expect(props(off)).toEqual(['prompt', 'count']);
    expect(props(on)).toEqual(['prompt', 'count', 'nsfw']);
  });
});

describe('contributeImageTool — execute', () => {
  it('unconfigured → constructive settings pointer, no generate call', async () => {
    const c = ctx({ primary: null });
    const tool = contributeImageTool(c)[0];
    if (!tool) throw new Error('tool missing');
    const r = await tool.execute({ prompt: 'a fox' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('My Settings');
    expect(c.generate).not.toHaveBeenCalled();
  });
  it('clamps count to the group maximum and persists one artefact per image', async () => {
    const c = ctx({
      generate: vi.fn(async () => ({
        items: [
          { kind: 'image' as const, bytes: new Blob(['a']), mime: 'image/jpeg' },
          { kind: 'image' as const, bytes: new Blob(['b']), mime: 'image/jpeg' },
        ],
        modelId: 'seedream-v4.5',
      })),
      primary: slot({
        ref: 'nano-gpt:seedream-v4.5',
        modelLabel: 'Seedream 4.5',
        config: { groupId: 'seedream', aspect: '1:1', quality: 'standard' },
      }),
    });
    const tool = contributeImageTool(c)[0];
    if (!tool) throw new Error('tool missing');
    const r = await tool.execute({ prompt: 'a fox', count: 9 });
    // Seedream caps at 4 (spec §4.3) — the upstream call must see the clamp.
    expect(c.generate).toHaveBeenCalledWith(c.primary, 'a fox', 4, undefined);
    expect(c.persistImage).toHaveBeenCalledTimes(2);
    expect(r.ok).toBe(true);
    expect(r.output).toContain('Generated 2 image');
    expect(r.output).toContain('refer to them in prose');
    expect(r.meta?.artefactIds).toEqual(['artefact-1', 'artefact-1']);
    expect(r.meta?.prompt).toBe('a fox');
    expect(r.meta?.modelLabel).toBe('Seedream 4.5');
  });
  it('nsfw:true routes to the nsfw slot', async () => {
    const nsfwSlot = slot({ ref: 'x:nsfw-model', modelLabel: 'NSFW Model', canDoNsfw: true });
    const c = ctx({ nsfwSlot, nsfwParamAllowed: true });
    const tool = contributeImageTool(c)[0];
    if (!tool) throw new Error('tool missing');
    await tool.execute({ prompt: 'a fox', nsfw: true });
    expect(c.generate).toHaveBeenCalledWith(nsfwSlot, 'a fox', 1, undefined);
  });
  it('hallucinated nsfw:true without an eligible model → constructive error', async () => {
    const c = ctx();
    const tool = contributeImageTool(c)[0];
    if (!tool) throw new Error('tool missing');
    const r = await tool.execute({ prompt: 'a fox', nsfw: true });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('non-explicit');
    expect(c.generate).not.toHaveBeenCalled();
  });
  it('moderated items are reported, successes still persist', async () => {
    const c = ctx({
      generate: vi.fn(async () => ({
        items: [
          { kind: 'image' as const, bytes: new Blob(['a']), mime: 'image/jpeg' },
          { kind: 'moderated' as const, reason: 'content policy' },
        ],
        modelId: 'grok-imagine-image',
      })),
    });
    const tool = contributeImageTool(c)[0];
    if (!tool) throw new Error('tool missing');
    const r = await tool.execute({ prompt: 'a fox', count: 2 });
    expect(r.ok).toBe(true);
    expect(r.output).toContain('1 image was blocked');
    expect(c.persistImage).toHaveBeenCalledTimes(1);
    expect(r.meta?.moderatedReasons).toEqual(['content policy']);
  });
  it('a thrown ImageGenerationError becomes a constructive failure', async () => {
    const c = ctx({
      generate: vi.fn(async () => {
        throw Object.assign(new Error('image generation returned 422'), {
          name: 'ImageGenerationError',
          providerMessage: 'prompt rejected',
        });
      }),
    });
    const tool = contributeImageTool(c)[0];
    if (!tool) throw new Error('tool missing');
    const r = await tool.execute({ prompt: 'a fox' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('prompt rejected');
    expect(r.error).toContain('rephras'); // "suggest rephrasing the prompt"
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/tools/generate-image.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/user-client/src/tools/generate-image.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import {
  type GenerateImagesResult,
  type ImageModelConfig,
  maxCountFor,
} from '@chatsundere/llm-unified';
import type { Tool, ToolResult } from './types.js';

/** One configured image-model slot, fully resolved by the send path. */
export interface ImageGenerationSlot {
  /** "providerTemplateId:upstreamSlug" — provenance for genMeta. */
  ref: string;
  modelLabel: string;
  canDoNsfw: boolean;
  config: ImageModelConfig;
}

/** Per-send image-generation context. Closures keep the tool free of db/network imports. */
export interface ImageToolContext {
  chatId: string;
  personaId: string;
  primary: ImageGenerationSlot | null;
  nsfwSlot: ImageGenerationSlot | null;
  /** §2.6 gate, precomputed by the send path via computeNsfwParamAllowed. */
  nsfwParamAllowed: boolean;
  generate: (
    slot: ImageGenerationSlot,
    prompt: string,
    count: number,
    signal?: AbortSignal,
  ) => Promise<GenerateImagesResult>;
  /** Persists one image as an artefact (thumbnail + Dexie row); returns its id. */
  persistImage: (
    item: { bytes: Blob; mime: string },
    meta: { prompt: string; slot: ImageGenerationSlot },
  ) => Promise<string>;
}

/** Spec §2.6: the nsfw parameter exists only when all three conditions hold. */
export function computeNsfwParamAllowed(
  adultPersona: boolean,
  adultMode: 'nsfw' | 'sfw',
  nsfwCapableModelConfigured: boolean,
): boolean {
  return adultPersona && adultMode === 'nsfw' && nsfwCapableModelConfigured;
}

const NOT_CONFIGURED =
  'No image model is configured yet. Tell the user that image generation is available once they pick a model in My Settings → Image generation.';
const NSFW_UNAVAILABLE =
  'NSFW image generation is not available — no NSFW-capable model is configured. Offer the user a non-explicit variant of their idea instead.';

function clampCount(raw: unknown, config: ImageModelConfig): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : 1;
  return Math.min(Math.max(1, n), maxCountFor(config));
}

/** The generate_image context tool — ALWAYS one tool (spec decision 7). */
export function contributeImageTool(ctx: ImageToolContext): Tool[] {
  const properties: Record<string, unknown> = {
    prompt: {
      type: 'string',
      description:
        'A detailed description of the image(s): subject, style, lighting, composition.',
    },
    count: {
      type: 'integer',
      minimum: 1,
      description:
        'How many variants to generate. Omit for the normal case of one image; only set when the user explicitly asks for multiple variants (e.g. "show me three options" → count: 3).',
    },
  };
  if (ctx.nsfwParamAllowed) {
    properties.nsfw = {
      type: 'boolean',
      description:
        'Set true only when the user asks for explicit adult imagery. Routes to the NSFW-capable model.',
    };
  }
  return [
    {
      name: 'generate_image',
      description:
        'Generate one or more images from a text prompt. The user has pre-configured the model and image dimensions; you only choose the prompt. Be descriptive — a good prompt has subject, style, lighting, and composition cues.',
      parameters: { type: 'object', properties, required: ['prompt'] },
      systemPromptInstruction: null,
      async execute(args, signal): Promise<ToolResult> {
        const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
        if (ctx.primary === null) return { ok: false, output: '', error: NOT_CONFIGURED };
        if (prompt.length === 0) {
          return { ok: false, output: '', error: 'The prompt was empty — write a detailed description and call the tool again.' };
        }
        const wantNsfw = args.nsfw === true;
        const slot = wantNsfw
          ? (ctx.nsfwSlot ?? (ctx.primary.canDoNsfw ? ctx.primary : null))
          : ctx.primary;
        if (slot === null) return { ok: false, output: '', error: NSFW_UNAVAILABLE };

        const count = clampCount(args.count, slot.config);
        let result: GenerateImagesResult;
        try {
          result = await ctx.generate(slot, prompt, count, signal);
        } catch (e) {
          const err = e as { providerMessage?: string; message?: string };
          const detail = err.providerMessage ?? err.message ?? 'unknown error';
          return {
            ok: false,
            output: '',
            error: `Image generation failed (${detail}). Tell the user, and suggest rephrasing the prompt or simply asking again.`,
          };
        }

        const artefactIds: string[] = [];
        const moderatedReasons: string[] = [];
        for (const item of result.items) {
          if (item.kind === 'moderated') {
            moderatedReasons.push(item.reason ?? 'no reason given');
            continue;
          }
          artefactIds.push(
            await ctx.persistImage({ bytes: item.bytes, mime: item.mime }, { prompt, slot }),
          );
        }

        if (artefactIds.length === 0) {
          return {
            ok: false,
            output: '',
            error: `Every image was blocked by the provider's content filter (${moderatedReasons.join('; ')}). Tell the user and suggest rephrasing the prompt.`,
          };
        }

        const lines = [
          `Generated ${artefactIds.length} image(s) from your prompt. They are already displayed to the user. Refer to them in prose; do not output URLs, file paths, or markdown images.`,
        ];
        if (moderatedReasons.length > 0) {
          lines.push(
            `${moderatedReasons.length} image was blocked by the provider's content filter (reason: ${moderatedReasons.join('; ')}).`,
          );
        }
        return {
          ok: true,
          output: lines.join(' '),
          error: null,
          meta: {
            artefactIds,
            prompt,
            modelLabel: slot.modelLabel,
            moderatedReasons,
          },
        };
      },
    },
  ];
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/tools/generate-image.test.ts`
Expected: PASS (all, including the 8-combination matrix).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client
git commit -m "Add generate_image context tool with nsfw gating and count clamp"
```

---

## Task 8: Wiring — send path, StartArgs, resolveActiveTools (user-client)

**Files:**
- Modify: `apps/user-client/src/tools/registry.ts` (5th param `images`)
- Modify: `apps/user-client/src/data/send-message.ts` (resolveImageGeneration, mirrors `resolveSubstituteVision` at line 207)
- Modify: `apps/user-client/src/state/stream-manager.store.ts` (StartArgs + the `resolveActiveTools` call at line ~502)
- Test: `apps/user-client/tests/tools/registry.images.test.ts`
- Test: extend the send-path test file that covers `resolveSubstituteVision`/StartArgs threading (find via `rg -l "substituteVisionModel" apps/user-client/tests/`) with the image-context threading case, following its mocking idiom.

- [ ] **Step 1: Write the failing registry test**

`apps/user-client/tests/tools/registry.images.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { resolveActiveTools } from '../../src/tools/registry.js';
import type { ImageToolContext } from '../../src/tools/generate-image.js';

const emptyIntegrationCtx = {} as Parameters<typeof resolveActiveTools>[0];

function imagesCtx(primary: ImageToolContext['primary']): ImageToolContext {
  return {
    chatId: 'c1',
    personaId: 'p1',
    primary,
    nsfwSlot: null,
    nsfwParamAllowed: false,
    generate: vi.fn(),
    persistImage: vi.fn(),
  };
}

describe('resolveActiveTools — images', () => {
  it('includes generate_image when an images context is present — even unconfigured', () => {
    const tools = resolveActiveTools(emptyIntegrationCtx, null, null, null, imagesCtx(null));
    expect(tools.some((t) => t.name === 'generate_image')).toBe(true);
  });
  it('omits it when images context is null (back-compat)', () => {
    const tools = resolveActiveTools(emptyIntegrationCtx, null, null, null, null);
    expect(tools.some((t) => t.name === 'generate_image')).toBe(false);
  });
});
```

(If `emptyIntegrationCtx` needs real fields, copy the IntegrationContext stub other registry tests use — `rg -l "resolveActiveTools" apps/user-client/tests/`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/tools/registry.images.test.ts`
Expected: FAIL — resolveActiveTools has no 5th parameter.

- [ ] **Step 3: Implement**

`tools/registry.ts` — extend the signature (line 28):

```ts
import { type ImageToolContext, contributeImageTool } from './generate-image.js';

export function resolveActiveTools(
  ctx: IntegrationContext,
  knowledge: KnowledgeContext | null = null,
  expert: ExpertToolContext | null = null,
  mcp: McpToolContext | null = null,
  images: ImageToolContext | null = null,
): Tool[] {
  return [
    ...STATIC_TOOLS,
    ...INTEGRATIONS.flatMap((i) => i.contributesTools(ctx)),
    ...(knowledge ? contributeKnowledgeTools(knowledge) : []),
    /* existing expert block unchanged */
    ...(mcp ? contributeMcpTools(mcp) : []),
    ...(images ? contributeImageTool(images) : []),
  ];
}
```

`data/send-message.ts` — add `resolveImageGeneration` directly below `resolveSubstituteVision` (line 207), reusing its provider-row + `openSecret` resolution verbatim per slot. Sketch (adapt names to the real local helpers in that file — `getProvider`, `getOffering`, `openSecret`, `db` are all already imported there):

```ts
import {
  type ImageRequestBase,
  generateImages,
  isImageModelConfig,
} from '@chatsundere/llm-unified';
import { computeNsfwParamAllowed, type ImageGenerationSlot, type ImageToolContext } from '../tools/generate-image.js';
import { addGeneratedImageArtefact } from './artefacts.js';
import { thumbnailFromBlob } from '../lib/image-thumbnail.js';

interface ResolvedImageSlot {
  slot: ImageGenerationSlot;
  base: ImageRequestBase;
}

/** Resolve one stored settings slot into a tool slot + request base.
 *  Mirrors resolveSubstituteVision: parse ref → provider def + offering →
 *  enabled provider row → decrypt key. Returns null when anything is missing. */
async function resolveImageSlot(
  stored: { ref: string; config: unknown } | null,
  mk: MasterKey,
  corsProxyUrl: string | null,
  corsProxyKey: string | null,
): Promise<ResolvedImageSlot | null> {
  if (!stored) return null;
  const idx = stored.ref.indexOf(':');
  if (idx < 0) return null;
  const templateId = stored.ref.slice(0, idx);
  const slug = stored.ref.slice(idx + 1);
  const providerDef = getProvider(templateId);
  const offering = getOffering(templateId, slug);
  if (!providerDef || !offering || offering.serviceKind !== 'tti' || !offering.tti) return null;
  if (!isImageModelConfig(stored.config)) return null;

  const db = getClientDataDb();
  const providerRow = (await db.providers.where('templateId').equals(templateId).toArray()).find(
    (p) => p.enabled,
  );
  if (!providerRow) return null;
  let apiKey: string;
  try {
    apiKey = await openSecret(providerRow.apiKey, mk, `provider/${providerRow.id}/api-key`);
  } catch {
    console.warn('resolveImageSlot: failed to decrypt api-key — slot unavailable');
    return null;
  }
  return {
    slot: {
      ref: stored.ref,
      modelLabel: offering.tti.displayName,
      canDoNsfw: offering.tti.canDoNsfw,
      config: stored.config,
    },
    base: {
      provider: providerDef,
      providerConfig: { baseUrl: providerDef.baseUrl, routing: providerRow.routing },
      apiKey,
      corsProxyUrl,
      corsProxyKey,
    },
  };
}

/** Build the per-send ImageToolContext. ALWAYS returns a context (decision 7 —
 *  the tool is offered even unconfigured); slots are null when unresolvable. */
async function resolveImageGeneration(
  settings: SettingsRow | undefined,
  persona: PersonaRow,
  chatId: string,
  mk: MasterKey,
  corsProxyUrl: string | null,
  corsProxyKey: string | null,
): Promise<ImageToolContext> {
  const primary = await resolveImageSlot(
    settings?.imageGeneration?.primary ?? null, mk, corsProxyUrl, corsProxyKey,
  );
  const nsfw = await resolveImageSlot(
    settings?.imageGeneration?.nsfw ?? null, mk, corsProxyUrl, corsProxyKey,
  );
  const baseByRef = new Map<string, ImageRequestBase>();
  if (primary) baseByRef.set(primary.slot.ref, primary.base);
  if (nsfw) baseByRef.set(nsfw.slot.ref, nsfw.base);
  return {
    chatId,
    personaId: persona.id,
    primary: primary?.slot ?? null,
    nsfwSlot: nsfw?.slot ?? null,
    nsfwParamAllowed: computeNsfwParamAllowed(
      persona.adultPersona,
      settings?.adultMode ?? 'sfw',
      Boolean(nsfw) || Boolean(primary?.slot.canDoNsfw),
    ),
    generate: (slot, prompt, count, signal) => {
      const base = baseByRef.get(slot.ref);
      if (!base) return Promise.reject(new Error('image slot base missing'));
      return generateImages({ ...base, config: slot.config, prompt, count, signal });
    },
    persistImage: async (item, meta) => {
      const { thumbBlob, width, height } = await thumbnailFromBlob(item.bytes);
      return addGeneratedImageArtefact({
        chatId,
        personaId: persona.id,
        prompt: meta.prompt,
        modelRef: meta.slot.ref,
        modelLabel: meta.slot.modelLabel,
        configSnapshot: meta.slot.config,
        bytes: item.bytes,
        mime: item.mime,
        thumbBlob,
        width,
        height,
      });
    },
  };
}
```

Call it where the other contexts are resolved (beside the `resolveSubstituteVision` call at line ~390) and thread it through the existing send→start call as `images`.

`state/stream-manager.store.ts` — StartArgs (line 62) gains:

```ts
  images?: import('../tools/generate-image.js').ImageToolContext | null;
```

and the call site (line ~502) becomes:

```ts
    const activeTools = toolsActive
      ? resolveActiveTools(integrationCtx, knowledge, expert, args.mcp ?? null, args.images ?? null)
      : [];
```

**Regenerate path:** check how `knowledge`/`expert` contexts reach a regenerate/re-roll (`rg -n "knowledge" apps/user-client/src/state/stream-manager.store.ts`) — thread `images` identically so a regenerate can also paint.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/tools/ && pnpm typecheck --force`
Expected: PASS; 14/14.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client
git commit -m "Wire image-generation context through the send path"
```

---

## Task 9: My Settings — Image generation section (user-client)

**Files:**
- Create: `apps/user-client/src/components/image-gen/ImageGenerationSection.tsx`
- Create: `apps/user-client/src/components/image-gen/TtiModelSelect.tsx`
- Create: `apps/user-client/src/components/image-gen/config-views.tsx` (the three group views)
- Modify: `apps/user-client/src/routes/app/settings.tsx` (mount the section)
- Test: `apps/user-client/tests/components/image-gen-section.test.tsx`

**Design (binding):**
- Follows the immediate-persist idiom of `SubstituteVisionSetting` (settings.tsx:77) — every change `update.mutate({ imageGeneration: ... })`; never the SaveBar.
- **TTI model picker is a slim dedicated component**, NOT `ModelPickerField` — TTI offerings have `canonicalRef: null`, so the canonical-grouped picker data model does not fit (plan-time call foreseen in spec §6.2). `TtiModelSelect` lists `listTtiOfferings()` filtered to enabled, configured provider templateIds (reuse `usableTemplateIds` from settings.tsx), rendered as one button row per offering (`displayName` + provider name), selected state highlighted; choosing one persists `{ ref, config: defaultConfigFor(groupId) }`.
- Below the primary select, render the group config view for the chosen config: each is a column of labelled button-groups (SegRow-style: a `<div role="radiogroup">` of small buttons; match the house button classes used in settings.tsx). `XaiImagineConfigView`: tier (Normal/Quality), resolution (1k/2k), aspect (5). `ZImageConfigView`: variant (Turbo/Base — Base labelled "~10× slower"), size (9-option select-style list). `SeedreamConfigView`: aspect (7), quality (Standard/High/Ultra). Every change merges into the stored config and persists immediately. No count control anywhere.
- **NSFW slot, always rendered** under a "NSFW model" heading: (a) no `canDoNsfw` offering exists → a disabled row with the closed-loop copy `No NSFW-capable image model exists yet — this slot lights up automatically when one is curated. Nothing for you to do.` (b) primary itself `canDoNsfw` → disabled row `Your primary model already supports NSFW.` (c) otherwise → the same select restricted to `canDoNsfw` offerings + config view. The slot's select is also disabled while no primary is set.
- A clear/"None" affordance on each slot (mirror `onClear` in the sibling sections).
- Styling minimal — mechanics only; Chris polishes later.

- [ ] **Step 1: Write the failing tests**

`apps/user-client/tests/components/image-gen-section.test.tsx` — RTL with QueryClientProvider; mock `useSettings`/`useUpdateSettings`/`useProviders` the way the existing settings tests do (copy the idiom from the test file covering `SubstituteVisionSetting` — find via `rg -l "SubstituteVisionSetting" apps/user-client/tests/`). Cover:

```ts
// Behavioural assertions (write with the house mocking idiom):
// 1. With an xai + nano-gpt provider configured, the primary select lists
//    'Grok Imagine', 'Z-Image', 'Seedream 4.5'.
// 2. Clicking 'Seedream 4.5' calls update.mutate with
//    { imageGeneration: { primary: { ref: 'nano-gpt:seedream-v4.5',
//      config: { groupId: 'seedream', aspect: '1:1', quality: 'standard' } }, nsfw: null } }.
// 3. With a primary set, clicking quality 'Ultra' persists the merged config.
// 4. The NSFW slot renders disabled with the closed-loop copy
//    ('lights up automatically') while no canDoNsfw offering exists.
// 5. No element labelled 'count' / 'Count' exists in the section.
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/components/image-gen-section.test.tsx`
Expected: FAIL — components missing.

- [ ] **Step 3: Implement the three files + mount**

Implement per the binding design above. Mount in `settings.tsx` as a new section "Image generation" placed directly after the substitute-vision section (same heading/anatomy as its siblings). The section reads `settings.imageGeneration`, validates stored configs with `isImageModelConfig` (an invalid/stale config renders as unset → the user re-picks; never crash).

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/components/image-gen-section.test.tsx && pnpm typecheck --force`
Expected: PASS; 14/14.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client
git commit -m "Add Image generation settings section with NSFW slot"
```

---

## Task 10: ImagePill — pending/completed/failed, thumbnails, lightbox, copyable prompt (user-client)

**Files:**
- Create: `apps/user-client/src/components/chat/ImagePill.tsx`
- Modify: `apps/user-client/src/components/chat/Pill.tsx` (dispatch on `payload.name === 'generate_image'`, after the `describe_image` branch at line ~80)
- Test: `apps/user-client/tests/components/ImagePill.test.tsx`

**Design (binding):**
- Dispatch: `row.kind === 'tool-call' && payload.name === 'generate_image'` → `<ImagePill row={row} />` (the VisionPill precedent).
- **Pending:** `Painting · {modelLabel}` with the live-bar markup copied from VisionPill's pending state; when `payload.argumentsJson` parses to `count > 1`, `Painting {count} images · {modelLabel}`. modelLabel falls back to `'image model'` before meta arrives (parse what is available; never crash on partial payload).
- **Failed:** collapsed `Couldn't paint`; expandable (button, like the completed state) to show `payload.error` — the §7.4 texts are constructive by construction.
- **Completed:** collapsed `Painted · {modelLabel}`; expanded detail shows the full `payload.prompt` in a `<code>` block with a **Copy** button (`navigator.clipboard.writeText(prompt)`; reuse the copy-button pattern from the existing code-block toolbar — find via `rg -n "clipboard" apps/user-client/src/components`), the model name, and one line per `moderatedReasons` entry.
- **Thumbnails render below the pill whenever `payload.artefactIds` is non-empty** (completed state): a `useQuery` over `db.artefacts.bulkGet(artefactIds)` (filter out undefined — a deleted artefact renders nothing); one `<img>` per artefact from `URL.createObjectURL(row.thumbBlob ?? row.blob)` (objectURLs created in a `useMemo` keyed on the rows and revoked in its cleanup), `alt={row.title}`, class `image-pill-thumb`, container class `image-pill-grid` (single child → full bubble width; 2+ → 2-column grid via CSS).
- Click a thumbnail → open the shared `Lightbox` (own instance inside ImagePill, the MessageBlock-attachments precedent at MessageBlock.tsx:235) with items from `artefactToViewable` (extended in Task 11) over the loaded artefact rows; index = clicked position.
- Minimal CSS additions live where the pill styles live today (find the `artefact-pill` rules: `rg -n "artefact-pill" apps/user-client/src --type css` — add `image-pill-grid`/`image-pill-thumb` beside them).

- [ ] **Step 1: Write the failing tests**

`apps/user-client/tests/components/ImagePill.test.tsx` (jsdom; mock the artefact query with seeded fake-indexeddb rows or mock the data hook, matching the house Pill test idiom — `apps/user-client/tests/components/Pill.test.tsx`):

```ts
// Behavioural assertions:
// 1. pending row (payload {name:'generate_image', argumentsJson:'{"prompt":"a fox","count":3}'})
//    → text 'Painting 3 images'.
// 2. completed row (payload {name:'generate_image', prompt:'a fox', modelLabel:'Z-Image',
//    artefactIds:['a1'], moderatedReasons:[]}) → collapsed 'Painted · Z-Image';
//    click → expanded shows 'a fox' and a Copy button; click Copy →
//    navigator.clipboard.writeText called with 'a fox' (stub clipboard).
// 3. completed row with two artefactIds whose rows exist in the db
//    → two img elements render (alt = artefact titles).
// 4. failed row (payload {name:'generate_image', error:'No image model is configured yet. …'})
//    → 'Couldn't paint'; expanding reveals the constructive error text.
// 5. Pill.tsx dispatch: a tool-call row with payload.name 'generate_image'
//    renders the ImagePill (assert via its 'Painting'/'Painted' copy).
```

Note jsdom has no `URL.createObjectURL` — stub it (`vi.stubGlobal` or assign on `URL`) returning `'blob:test'`, as the existing attachment/lightbox tests do (check their setup first and copy it).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/components/ImagePill.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement** per the binding design.

- [ ] **Step 4: Run tests + the full component dir**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/components/ && pnpm typecheck --force`
Expected: new tests PASS; no regression in the dir; 14/14.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client
git commit -m "Add ImagePill with inline thumbnails, copyable prompt, and lightbox"
```

---

## Task 11: Lightbox + Treasury image-artefact support (user-client)

**Files:**
- Modify: `apps/user-client/src/components/lightbox/viewable-item.ts` (`artefactToViewable` image branch)
- Modify: `apps/user-client/src/components/lightbox/Lightbox.tsx` ONLY if the image render branch (line 434) needs the provenance line added
- Test: `apps/user-client/tests/unit/viewable-item.test.ts` (extend the existing file if present — `rg -l "artefactToViewable" apps/user-client/tests/`)

**Design (binding):**
- `artefactToViewable(row)` returns, for `row.kind === 'image'`:
  - `kind: 'image'`, `imageUrl` from `URL.createObjectURL(row.blob ?? row.thumbBlob ?? new Blob())` — the full blob, falling back to the thumb. **Check how `attachmentToViewable` manages objectURL lifecycle and mirror it exactly** (if the caller revokes, keep that contract; if not, follow suit — do not invent a new lifecycle).
  - `provenance`: `row.genMeta ? `${row.genMeta.prompt} — via ${row.genMeta.modelLabel}` : undefined` (the existing `provenance` field renders in the lightbox already — verify and reuse; the prompt is selectable/copyable there).
  - `caps`: like the text-artefact caps but `editSource: false` (no source view for pixels), `download: true`, `copy: false` (binary), rename/tags/delete unchanged.
- Treasury needs **no row change** (`formatToType` already maps `image` → the `Img` tab; `TreasuryRow` glyphs by format) — but verify the Treasury lightbox path renders the image (it maps `artefactToViewable` over rows at treasury.tsx:71, so the new branch flows through automatically). Verify download uses `imageUrl`/blob for image kind (check the Lightbox download handler; if it writes `text`, branch it on kind to use the blob).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/viewable-item.test.ts — extend:
// 1. an image ArtefactRow (kind 'image', blob set, genMeta {prompt:'a fox', modelLabel:'Z-Image'})
//    → viewable.kind === 'image', imageUrl 'blob:test' (stubbed), provenance contains
//    'a fox' and 'Z-Image', caps.editSource === false, caps.download === true.
// 2. a text ArtefactRow still maps exactly as before (regression pin).
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/unit/viewable-item.test.ts`
Expected: FAIL — image branch missing.

- [ ] **Step 3: Implement** per the binding design.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/unit/ && pnpm typecheck --force`
Expected: PASS; 14/14.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client
git commit -m "Render image artefacts in the lightbox and Treasury"
```

---

## Task 12: Full gate verification

- [ ] **Step 1: Full typecheck (forced — Turbo caches lie on test-only changes)**

Run: `pnpm typecheck --force`
Expected: **14/14 green.**

- [ ] **Step 2: llm-unified full suite**

Run: `cd packages/llm-unified && bun test`
Expected: all pass (283 pre-existing + the new tti tests), 0 fail.

- [ ] **Step 3: user-client FULL vitest (never just the touched dirs)**

Run: `pnpm --filter @chatsundere/user-client exec vitest run`
Expected: the only failures are the known pre-existing `cockpit-draft`/`chat-page`/`chat-route` localStorage-jsdom baseline (8 files-worth — verify the failing FILES are exactly those three and the count matches the current master baseline). **Zero new failures.** If a failure looks pre-existing, verify it fails identically on master before claiming so.

- [ ] **Step 4: Build + biome**

Run: `pnpm run build && pnpm exec biome check apps/user-client/src packages/llm-unified/src`
Expected: build 9/9; biome clean on the touched trees (the lone pre-existing `index.css` format drift on master is not ours).

- [ ] **Step 5: Commit any stragglers; report**

Report the verification numbers verbatim (no rounding, no "should pass").

---

## Manual verification (Chris, on device — spec §13)

After squash: the nine spec §13 steps, unchanged. Prerequisite: none beyond a configured xAI and/or nano-gpt provider (no `packages/*` HMR caveat applies at runtime — but **restart `pnpm dev` after the squash** since `packages/llm-unified` changed).
