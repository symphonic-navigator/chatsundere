# Unified Image Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Chatsundere's four bespoke text-to-image (TTI) groups with one data-driven descriptor per offering, add nine new nano-gpt image models, and rebuild the image-model picker as a family-first picker with a Variant row, an identity line and honest prices.

**Architecture:** Every TTI offering carries a `TtiDescriptor` (family, variant, aspects, resolutions, qualities, prices, wire shape). The stored per-slot config shrinks to `{ aspect, resolution, quality }`; the model lives only in the slot's `ref`. One payload builder, one config view, one validation function. Stored legacy configs are upgraded lazily at read time (no Dexie version). Generated PNGs are transcoded to JPEG client-side at full resolution.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Bun test runner (`packages/llm-unified`), Vitest + Testing Library (`apps/user-client`), React 18, Tailwind v4, Biome, pnpm + Turborepo.

**Spec:** `superpowers/specs/2026-10-07-unified-image-models-design.md` — read it before Task 1. Where this plan and the spec differ, **this plan wins**; the deliberate refinements are listed under "Spec refinements" below.

---

## Operating rules for the overnight worker (READ FIRST)

These rules are binding and override your defaults. You cannot ask questions; if something is genuinely ambiguous, choose the option that keeps existing behaviour and note it in your final report.

1. **Language.** Every text artefact you write into the repo is **British English**: code, identifiers, comments, test names, commit messages, log strings, user-facing copy, Markdown (`colour`, `behaviour`, `initialise`, `licence` as a noun, `normalise`). No German anywhere in the repo.
2. **TDD per task.** For each task: write the failing test → run it and confirm it fails for the expected reason → write the minimal implementation → run it and confirm it passes → commit. Never write implementation before its test.
3. **Execution discipline.** Use superpowers:subagent-driven-development: one fresh implementer subagent per task, then a spec-compliance review and a code-quality review before the next task. **Subagents never merge, push, or switch branches.** Tell every subagent this explicitly in its prompt. After each subagent commit, verify the commit landed on `feat/unified-image-models` with `git branch --contains <sha>`.
4. **Branch.** Before Task 1: `git checkout -b feat/unified-image-models` from the current `master`. All commits go on that branch. **Do NOT merge to `master`. Do NOT push. Do NOT create any tag or release** (no `git tag`, no GitHub release, no version bump in any `package.json` or `version.txt`). This work joins a larger bundle that Chris releases later as one version; the human device-tests and integrates.
5. **Commit messages.** Free-form imperative, capitalised subject, no Conventional-Commits prefix (`Add TTI descriptor types`, not `feat: add …`). Every commit ends with a blank line and:
   ```
   Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
   ```
   Doc-only commits (Markdown only, no code) append ` [skip ci]` to the subject.
6. **No non-null assertions.** Biome bans the `!` postfix operator; the pre-commit hook runs Biome and will reject it. Narrow with `if`, `??` or optional chaining instead. No `any` without an inline comment explaining why.
7. **Exact commands** (run from the repo root unless stated):
   - llm-unified tests, one file: `cd packages/llm-unified && bun test src/tti/<file>.test.ts`
   - llm-unified tests, all: `cd packages/llm-unified && bun test`
   - user-client tests, one file: `cd apps/user-client && pnpm vitest run tests/<path>.test.ts(x)`
   - user-client tests, all: `cd apps/user-client && pnpm vitest run`
   - Typecheck gate (the CI gate; covers tests): `pnpm turbo run typecheck --force` (`--force` matters — Turbo caches typecheck and can report a stale pass).
   - Build: `pnpm run build`
   - Lint: `pnpm biome check .` (fix formatting with `pnpm biome check --write <files>`).
8. **Expected red window.** Task 3 changes the `@chatsundere/llm-unified` TTI API. From Task 3 until Task 9 is complete, **`apps/user-client` does not typecheck** — that is expected. During Tasks 3–5 the per-task gate is: the task's own tests pass, `cd packages/llm-unified && bun test` passes fully, and `cd packages/llm-unified && pnpm exec tsc -p tsconfig.test.json --noEmit` passes. From Task 6 onwards also run the task's own Vitest files. After Task 9 the full typecheck gate must be green again and stays green.
9. **Known-green baseline** (confirm on `master` before Task 1 and write the numbers down):
   - `cd packages/llm-unified && bun test` → **0 failures** (477 tests on 2026-10-07).
   - `cd apps/user-client && pnpm vitest run` → **0 failures** on Node 26 (3340 tests on 2026-10-07). On Node 22–25 you may instead see **exactly 8 failures** caused by Node's experimental `localStorage` global; if so, confirm the same 8 fail on `master` and treat them as baseline. A 9th failure is real.
   - `pnpm turbo run typecheck --force` and `pnpm run build` → green.
10. **Full verification at the end** (Task 11), never only the touched directories.
11. **Security gate.** Larissa (the security auditor) is **not triggered**: nothing under `apps/auth-service`, `apps/sync-service`, `apps/proxy-service` or `packages/crypto` changes. If you find yourself editing any of those paths, stop and report instead. The UX auditor (Laura) pre-squash pass is run by Liz after hand-off — not by you.
12. **No live provider calls.** You have no provider keys. Never call a provider API. Task 10 writes a live harness but does **not** run it.
13. **Do not squash.** Leave the per-task commits on the branch; Liz squashes after review.
14. **STATUS update** at the end (Task 11): `obsidian/STATUS-CLIENT-ONLY.md`, as described there.

## Spec refinements (this plan wins)

- **Fourteen offerings, not thirteen**: Z-Image Turbo and Z-Image Base are two offerings of one family, so there are 14 TTI offerings across 13 models.
- **File names**: the new logic lives in `tti/descriptor.ts` (types), `tti/image-config.ts` (pure config logic), `tti/size-tables.ts`, `tti/build-payload.ts`, `tti/upgrade.ts`, `tti/lookup.ts`. The old `tti/config.ts`, `tti/payloads.ts`, `tti/gpt-image-2-resolutions.ts` and `tti/seedream-resolutions.ts` are deleted in Task 3.
- **Latency hints are keyed like prices** (`${resolution ?? '-'}|${quality ?? '-'}`), field name `latency`, because GPT Image 2 low takes ~25 s at 1k but ~2 min at 2k. A Quality button shows the latency for the *current* resolution and *that* quality.
- **Grok Imagine via xAI defaults to 2k**: at quality Normal both tiers cost 2¢ (flat), so §3.4's "flat → highest tier" applies.
- **Invalid stored configs use `carryOverConfig`** against the offering (keeps whatever still fits, defaults the rest) rather than resetting everything to defaults.
- **Unusable-provider reason text** is one string used everywhere: `"<Provider> is not set up — add it under Upstream Providers above"`, or `"<Provider> needs the relay server"` when the provider row exists but needs the CORS relay that is not configured.

## Review Focus

The inputs most likely to bite a real user that no single task's happy-path test covers. Each has a pinned test in the named task.

1. **A stored legacy slot synced from an older device** (e.g. `{ groupId: 'zimage', variant: 'base', size: '1536x1024' }`) must upgrade to a valid slot, never crash the settings page or the send path → Task 5 (`upgradeImageSlot` table) and Task 9 (section renders a legacy slot).
2. **A saved offering whose provider became unusable** must stay visible, greyed, with its reason, and a family tap must move to a usable variant — never a no-op loop → Task 8 (`familyTapTarget`) and Task 9 (stale xAI test).
3. **A tool call asking for more images than the model allows** (e.g. `count: 10` on FLUX.3) must clamp to the descriptor's `maxCount` (4) → Task 6.
4. **A PNG that cannot be transcoded** (decode failure, no `OffscreenCanvas`) must still be saved as the original PNG → Task 7.
5. **A `lastConfigByRef` entry that no longer fits its offering** (descriptor changed between releases) must be dropped, not applied → Task 5 and Task 9.

---

## File Structure

**`packages/llm-unified/src/tti/`**
- `descriptor.ts` — *create.* Types only: `TtiOption`, `ImageModelConfig`, `TtiWire`, `TtiDescriptor`.
- `image-config.ts` — *create.* Pure config logic: `priceKey`, `isImageModelConfig`, `isValidConfigFor`, `carryOverConfig`, `priceCentsFor`, `latencyFor`, `formatPriceCents`.
- `size-tables.ts` — *create.* Every pixel table (six).
- `build-payload.ts` — *create.* `buildImagePayload(slug, meta, config, prompt, n)`.
- `upgrade.ts` — *create.* `LegacyImageModelConfig`, `ImageSlot`, `upgradeImageSlot`.
- `lookup.ts` — *create.* `getTtiDescriptor(ref)`.
- `parse.ts` — *modify.* Takes `perItemModeration: boolean` instead of a group id.
- `generate-images.ts` — *modify.* Takes `{ slug, meta, config }`.
- `config.ts`, `payloads.ts`, `gpt-image-2-resolutions.ts`, `seedream-resolutions.ts` and their `.test.ts` — *delete* (Task 3).
- `descriptor-consistency.test.ts` — *create* (Task 4).

**`packages/llm-unified/src/`**
- `catalogue/types.ts` — *modify.* `TtiOfferingMeta` becomes an alias of `TtiDescriptor`.
- `providers/nano-gpt.ts`, `providers/xai.ts` — *modify.* Descriptor data.
- `index.ts` — *modify.* Exports.
- `providers/builtins.test.ts` — *modify.* nano-gpt offering count.

**`apps/user-client/src/`**
- `boot/client-data-db.ts`, `data/artefacts.ts` — *modify.* Slot and snapshot types.
- `tools/generate-image.ts` — *modify.* `maxCount` on the slot.
- `data/send-message.ts` — *modify.* Upgrade on read, descriptor-driven generate, transcode before persisting.
- `attachments/image-transcode.ts` — *create.*
- `components/image-gen/tti-picker-model.ts` — *create.* Pure picker logic.
- `components/image-gen/TtiModelSelect.tsx`, `config-views.tsx`, `ImageGenerationSection.tsx` — *rewrite.*

**`packages/llm-unified/curation/run-tti-suite.ts`** — *create* (Task 10, not run).

---

### Task 1: Descriptor types and pure config logic

**Files:**
- Create: `packages/llm-unified/src/tti/descriptor.ts`
- Create: `packages/llm-unified/src/tti/image-config.ts`
- Test: `packages/llm-unified/src/tti/image-config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (later tasks rely on these exact names):
  - `interface TtiOption { id: string; label: string }`
  - `interface ImageModelConfig { aspect: string; resolution: string | null; quality: string | null }`
  - `type TtiWire` (two kinds, below)
  - `interface TtiDescriptor` (below)
  - `priceKey(c: Pick<ImageModelConfig, 'resolution' | 'quality'>): string`
  - `isImageModelConfig(v: unknown): v is ImageModelConfig`
  - `isValidConfigFor(meta: TtiDescriptor, c: ImageModelConfig): boolean`
  - `carryOverConfig(prev: ImageModelConfig, next: TtiDescriptor): ImageModelConfig`
  - `priceCentsFor(meta: TtiDescriptor, c: ImageModelConfig): number | undefined`
  - `latencyFor(meta: TtiDescriptor, c: ImageModelConfig): string | undefined`
  - `formatPriceCents(cents: number, billing: 'fixed' | 'usage'): string`

- [ ] **Step 1: Create the types file**

`packages/llm-unified/src/tti/descriptor.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only

/** One selectable value in a config row. `id` is the wire value or table key. */
export interface TtiOption {
  id: string;
  label: string;
}

/**
 * The user's three choices for an image offering. Which model is meant lives
 * only in the slot's `ref`; `resolution` / `quality` are null exactly when the
 * offering has no such row.
 */
export interface ImageModelConfig {
  aspect: string;
  resolution: string | null;
  quality: string | null;
}

/** How an offering's `/images/generations` body is shaped (see build-payload.ts). */
export type TtiWire =
  | {
      kind: 'aspect-resolution';
      /** false = the model ignores resolution (Seedream 5.0 Pro), so none is sent. */
      sendResolution: boolean;
      /** Body field that carries `config.quality`, when the model has a quality row. */
      qualityParam?: 'quality' | 'thinking_level';
      /** xAI direct: the quality picks the upstream model instead of a body field. */
      modelByQuality?: Readonly<Record<string, string>>;
      /** Fixed extra body fields, e.g. `{ output_format: 'jpeg' }`. */
      extra?: Readonly<Record<string, string>>;
      /** xAI's CDN is closed to browsers, so xAI returns inline base64. */
      responseFormat: 'url' | 'b64_json';
    }
  | {
      kind: 'size-table';
      /** `${aspect}|${resolution ?? '-'}` → [width, height]; sent as `size: 'WxH'`. */
      sizes: Readonly<Record<string, readonly [number, number]>>;
      qualityParam?: 'quality';
      responseFormat: 'url';
    };

/**
 * Everything the app needs to know about one TTI offering: how the picker
 * groups it, which choices it offers, what they cost, and how its request is
 * built. A new image model is one of these — no new code.
 */
export interface TtiDescriptor {
  /** Picker button, e.g. 'Seedream'. */
  family: string;
  /** Variant-row label; null when the offering is its family's only member. */
  variant: string | null;
  /** Full human-readable name, e.g. 'Seedream 5.0 Flash'. */
  displayName: string;
  canDoNsfw: boolean;
  /** Hard cap for the generate_image tool's `count`. */
  maxCount: number;
  timeoutMs: number;
  aspects: readonly string[];
  /** null = no Resolution row. */
  resolutions: readonly TtiOption[] | null;
  /** null = no Quality row. */
  qualities: readonly TtiOption[] | null;
  /** Estimated US cents per image, keyed `${resolution ?? '-'}|${quality ?? '-'}`. */
  priceCents: Readonly<Record<string, number>>;
  /** Optional wait-time hints, keyed like `priceCents`. */
  latency?: Readonly<Record<string, string>>;
  /** Optional hint on the Variant button, e.g. '~10× slower'. */
  latencyHint?: string;
  /** 'usage' = billed by actual usage, so prices render with a leading '~'. */
  billing: 'fixed' | 'usage';
  /** The family's default pick when its button is tapped. At most one per family. */
  recommended?: boolean;
  defaults: ImageModelConfig;
  wire: TtiWire;
  /** xAI marks refused items per entry (`respect_moderation: false`). */
  perItemModeration: boolean;
}
```

- [ ] **Step 2: Write the failing tests**

`packages/llm-unified/src/tti/image-config.test.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import type { TtiDescriptor } from './descriptor.js';
import {
  carryOverConfig,
  formatPriceCents,
  isImageModelConfig,
  isValidConfigFor,
  latencyFor,
  priceCentsFor,
  priceKey,
} from './image-config.js';

function meta(over: Partial<TtiDescriptor> = {}): TtiDescriptor {
  return {
    family: 'Test',
    variant: null,
    displayName: 'Test',
    canDoNsfw: false,
    maxCount: 4,
    timeoutMs: 300_000,
    aspects: ['1:1', '16:9'],
    resolutions: [
      { id: '1k', label: '1k' },
      { id: '2k', label: '2k' },
    ],
    qualities: [
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
    ],
    priceCents: { '1k|low': 4, '1k|medium': 6, '2k|low': 6, '2k|medium': 8 },
    latency: { '1k|low': '~20 s' },
    billing: 'fixed',
    defaults: { aspect: '1:1', resolution: '1k', quality: 'low' },
    wire: { kind: 'aspect-resolution', sendResolution: true, responseFormat: 'url' },
    perItemModeration: false,
    ...over,
  };
}

const flat = meta({
  resolutions: null,
  qualities: null,
  priceCents: { '-|-': 9 },
  latency: undefined,
  defaults: { aspect: '1:1', resolution: null, quality: null },
});

describe('priceKey', () => {
  test('joins resolution and quality, using - for absent rows', () => {
    expect(priceKey({ resolution: '2k', quality: 'low' })).toBe('2k|low');
    expect(priceKey({ resolution: null, quality: null })).toBe('-|-');
    expect(priceKey({ resolution: '1k', quality: null })).toBe('1k|-');
  });
});

describe('isImageModelConfig', () => {
  test('accepts the new shape', () => {
    expect(isImageModelConfig({ aspect: '1:1', resolution: null, quality: null })).toBe(true);
    expect(isImageModelConfig({ aspect: '16:9', resolution: '2k', quality: 'low' })).toBe(true);
  });
  test('rejects legacy and malformed shapes', () => {
    expect(isImageModelConfig({ groupId: 'seedream', aspect: '1:1', quality: 'high' })).toBe(false);
    expect(isImageModelConfig({ aspect: '1:1' })).toBe(false);
    expect(isImageModelConfig(null)).toBe(false);
    expect(isImageModelConfig('1:1')).toBe(false);
  });
});

describe('isValidConfigFor', () => {
  test('accepts the defaults', () => {
    expect(isValidConfigFor(meta(), meta().defaults)).toBe(true);
    expect(isValidConfigFor(flat, flat.defaults)).toBe(true);
  });
  test('rejects an aspect the model lacks', () => {
    expect(isValidConfigFor(meta(), { aspect: '21:9', resolution: '1k', quality: 'low' })).toBe(false);
  });
  test('rejects a resolution on a model without a Resolution row, and vice versa', () => {
    expect(isValidConfigFor(flat, { aspect: '1:1', resolution: '1k', quality: null })).toBe(false);
    expect(isValidConfigFor(meta(), { aspect: '1:1', resolution: null, quality: 'low' })).toBe(false);
  });
  test('rejects an unknown quality', () => {
    expect(isValidConfigFor(meta(), { aspect: '1:1', resolution: '1k', quality: 'high' })).toBe(false);
  });
});

describe('carryOverConfig', () => {
  test('keeps every field the next model supports', () => {
    const prev = { aspect: '16:9', resolution: '2k', quality: 'medium' };
    expect(carryOverConfig(prev, meta())).toEqual(prev);
  });
  test('falls back field by field to the next model defaults', () => {
    const prev = { aspect: '21:9', resolution: '4k', quality: 'medium' };
    expect(carryOverConfig(prev, meta())).toEqual({
      aspect: '1:1',
      resolution: '1k',
      quality: 'medium',
    });
  });
  test('switching to a model without rows nulls them', () => {
    const prev = { aspect: '16:9', resolution: '2k', quality: 'low' };
    expect(carryOverConfig(prev, flat)).toEqual({ aspect: '16:9', resolution: null, quality: null });
  });
  test('switching from a model without rows takes the next defaults', () => {
    const prev = { aspect: '16:9', resolution: null, quality: null };
    expect(carryOverConfig(prev, meta())).toEqual({
      aspect: '16:9',
      resolution: '1k',
      quality: 'low',
    });
  });
});

describe('priceCentsFor / latencyFor', () => {
  test('look up by the config key', () => {
    expect(priceCentsFor(meta(), { aspect: '1:1', resolution: '2k', quality: 'medium' })).toBe(8);
    expect(priceCentsFor(flat, flat.defaults)).toBe(9);
    expect(latencyFor(meta(), { aspect: '1:1', resolution: '1k', quality: 'low' })).toBe('~20 s');
    expect(latencyFor(meta(), { aspect: '1:1', resolution: '2k', quality: 'low' })).toBeUndefined();
  });
});

describe('formatPriceCents', () => {
  test('whole, fractional and dollar amounts', () => {
    expect(formatPriceCents(5, 'fixed')).toBe('5¢');
    expect(formatPriceCents(2.7, 'fixed')).toBe('2.7¢');
    expect(formatPriceCents(1.19, 'fixed')).toBe('1.2¢');
    expect(formatPriceCents(65, 'fixed')).toBe('65¢');
    expect(formatPriceCents(120, 'fixed')).toBe('$1.20');
  });
  test('usage billing gets a leading tilde', () => {
    expect(formatPriceCents(6.1, 'usage')).toBe('~6.1¢');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd packages/llm-unified && bun test src/tti/image-config.test.ts`
Expected: FAIL — `Cannot find module './image-config.js'`.

- [ ] **Step 4: Implement**

`packages/llm-unified/src/tti/image-config.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import type { ImageModelConfig, TtiDescriptor, TtiOption } from './descriptor.js';

/** The key under which `priceCents` and `latency` store a config's values. */
export function priceKey(c: Pick<ImageModelConfig, 'resolution' | 'quality'>): string {
  return `${c.resolution ?? '-'}|${c.quality ?? '-'}`;
}

/** Shape guard for configs deserialised from Dexie or sync. */
export function isImageModelConfig(v: unknown): v is ImageModelConfig {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.aspect === 'string' &&
    (c.resolution === null || typeof c.resolution === 'string') &&
    (c.quality === null || typeof c.quality === 'string')
  );
}

function rowAccepts(options: readonly TtiOption[] | null, value: string | null): boolean {
  if (options === null) return value === null;
  return value !== null && options.some((o) => o.id === value);
}

/** True when every choice in `c` is one the offering actually offers. */
export function isValidConfigFor(meta: TtiDescriptor, c: ImageModelConfig): boolean {
  return (
    meta.aspects.includes(c.aspect) &&
    rowAccepts(meta.resolutions, c.resolution) &&
    rowAccepts(meta.qualities, c.quality)
  );
}

/**
 * Carry the previous choices onto another offering: each field survives when
 * the next offering supports it, otherwise it takes the next offering's default.
 */
export function carryOverConfig(prev: ImageModelConfig, next: TtiDescriptor): ImageModelConfig {
  return {
    aspect: next.aspects.includes(prev.aspect) ? prev.aspect : next.defaults.aspect,
    resolution: next.resolutions?.some((r) => r.id === prev.resolution)
      ? prev.resolution
      : next.defaults.resolution,
    quality: next.qualities?.some((q) => q.id === prev.quality) ? prev.quality : next.defaults.quality,
  };
}

/** Estimated cents per image for a config, if the descriptor prices it. */
export function priceCentsFor(meta: TtiDescriptor, c: ImageModelConfig): number | undefined {
  return meta.priceCents[priceKey(c)];
}

/** Wait-time hint for a config, if the descriptor has one. */
export function latencyFor(meta: TtiDescriptor, c: ImageModelConfig): string | undefined {
  return meta.latency?.[priceKey(c)];
}

/** `5¢`, `2.7¢`, `$1.20`; a leading `~` marks usage-billed estimates. */
export function formatPriceCents(cents: number, billing: 'fixed' | 'usage'): string {
  const body = cents >= 100 ? `$${(cents / 100).toFixed(2)}` : `${Number(cents.toFixed(1))}¢`;
  return billing === 'usage' ? `~${body}` : body;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/llm-unified && bun test src/tti/image-config.test.ts`
Expected: PASS (all tests).

Then: `cd packages/llm-unified && bun test` → 0 failures; `pnpm turbo run typecheck --force` → green (nothing consumes the new files yet).

- [ ] **Step 6: Commit**

```bash
git add packages/llm-unified/src/tti/descriptor.ts packages/llm-unified/src/tti/image-config.ts packages/llm-unified/src/tti/image-config.test.ts
git commit -m "Add TTI descriptor types and pure config logic" -m "Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 2: Size tables and the descriptor-driven payload builder

**Files:**
- Create: `packages/llm-unified/src/tti/size-tables.ts`
- Create: `packages/llm-unified/src/tti/build-payload.ts`
- Test: `packages/llm-unified/src/tti/build-payload.test.ts`

**Interfaces:**
- Consumes: `TtiDescriptor`, `ImageModelConfig` from `./descriptor.js` (Task 1).
- Produces:
  - `SEEDREAM_4_5_SIZES`, `GPT_IMAGE_2_SIZES`, `Z_IMAGE_TURBO_SIZES`, `Z_IMAGE_BASE_SIZES`, `SEEDREAM_5_LITE_SIZES`, `QWEN_IMAGE_2_1_PRO_SIZES` — each `Readonly<Record<string, readonly [number, number]>>`, keyed `${aspect}|${resolution ?? '-'}`.
  - `buildImagePayload(slug: string, meta: TtiDescriptor, config: ImageModelConfig, prompt: string, n: number): Record<string, unknown>`

- [ ] **Step 1: Create the size tables**

`packages/llm-unified/src/tti/size-tables.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only

/**
 * Pixel tables for the `size-table` wire, keyed `${aspect}|${resolution ?? '-'}`.
 * Hardcoded so the same config always hits the same upstream size —
 * deterministic tests, quotable dimensions.
 */
type SizeTable = Readonly<Record<string, readonly [number, number]>>;

/**
 * Seedream 4.5 (nano-gpt). Every cell meets nano-gpt's 3,686,400-pixel minimum
 * and is a multiple of 32. The tiers target ~3.7M / ~5M / ~7M pixels; they were
 * labelled standard / high / ultra before the 2026-10-07 unification. Ported
 * from chatsune's `_nano_gpt_image_groups.py`.
 */
export const SEEDREAM_4_5_SIZES: SizeTable = {
  '1:1|2k': [1920, 1920],
  '1:1|2.2k': [2240, 2240],
  '1:1|2.7k': [2656, 2656],
  '16:9|2k': [2560, 1440],
  '16:9|2.2k': [2976, 1664],
  '16:9|2.7k': [3520, 1984],
  '9:16|2k': [1440, 2560],
  '9:16|2.2k': [1664, 2976],
  '9:16|2.7k': [1984, 3520],
  '4:3|2k': [2240, 1664],
  '4:3|2.2k': [2592, 1952],
  '4:3|2.7k': [3072, 2304],
  '3:4|2k': [1664, 2240],
  '3:4|2.2k': [1952, 2592],
  '3:4|2.7k': [2304, 3072],
  '3:2|2k': [2368, 1568],
  '3:2|2.2k': [2752, 1824],
  '3:2|2.7k': [3264, 2176],
  '2:3|2k': [1568, 2368],
  '2:3|2.2k': [1824, 2752],
  '2:3|2.7k': [2176, 3264],
};

/**
 * GPT Image 2 (nano-gpt, wavespeed-routed). The upstream accepts 512–2560 px per
 * side and 655,360–3,686,400 pixels, and is pixel-exact only when both sides are
 * multiples of 32; every cell is, and was delivered exactly in the 2026-06-10
 * sweep. The 2k 21:9 cell is width-capped at 2560 px.
 */
export const GPT_IMAGE_2_SIZES: SizeTable = {
  '1:1|1k': [1024, 1024],
  '1:1|2k': [1920, 1920],
  '16:9|1k': [1536, 864],
  '16:9|2k': [2560, 1440],
  '9:16|1k': [864, 1536],
  '9:16|2k': [1440, 2560],
  '4:3|1k': [1152, 864],
  '4:3|2k': [2176, 1632],
  '3:4|1k': [864, 1152],
  '3:4|2k': [1632, 2176],
  '3:2|1k': [1248, 832],
  '3:2|2k': [2304, 1536],
  '2:3|1k': [832, 1248],
  '2:3|2k': [1536, 2304],
  '21:9|1k': [1568, 672],
  '21:9|2k': [2464, 1056],
};

/** Z-Image Turbo (nano-gpt): one catalogue size per aspect. */
export const Z_IMAGE_TURBO_SIZES: SizeTable = {
  '1:1|-': [1024, 1024],
  '16:9|-': [1280, 720],
  '9:16|-': [720, 1280],
  '3:2|-': [1536, 1024],
  '2:3|-': [1024, 1536],
};

/** Z-Image Base (nano-gpt): its catalogue sizes top out at 1024 px. */
export const Z_IMAGE_BASE_SIZES: SizeTable = {
  '1:1|-': [1024, 1024],
  '16:9|-': [1024, 576],
  '9:16|-': [576, 1024],
  '4:3|-': [1024, 768],
  '3:4|-': [768, 1024],
};

/** Seedream 5.0 Lite (nano-gpt): catalogue sizes, pixel-exact in the 2026-10-07 probe. */
export const SEEDREAM_5_LITE_SIZES: SizeTable = {
  '1:1|-': [2048, 2048],
  '16:9|-': [2560, 1440],
  '9:16|-': [1440, 2560],
  '3:2|-': [3072, 2048],
  '2:3|-': [2048, 3072],
};

/** Qwen Image 2.1 Pro (nano-gpt): catalogue sizes, pixel-exact in the 2026-10-07 probe. */
export const QWEN_IMAGE_2_1_PRO_SIZES: SizeTable = {
  '1:1|-': [2048, 2048],
  '16:9|-': [2730, 1536],
  '9:16|-': [1536, 2730],
  '4:3|-': [2364, 1773],
  '3:4|-': [1773, 2364],
  '3:2|-': [2508, 1672],
  '2:3|-': [1672, 2508],
};
```

- [ ] **Step 2: Write the failing tests**

`packages/llm-unified/src/tti/build-payload.test.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { buildImagePayload } from './build-payload.js';
import type { TtiDescriptor } from './descriptor.js';
import { Z_IMAGE_TURBO_SIZES } from './size-tables.js';

function meta(over: Partial<TtiDescriptor>): TtiDescriptor {
  return {
    family: 'Test',
    variant: null,
    displayName: 'Test',
    canDoNsfw: false,
    maxCount: 4,
    timeoutMs: 300_000,
    aspects: ['1:1', '16:9'],
    resolutions: null,
    qualities: null,
    priceCents: { '-|-': 1 },
    billing: 'fixed',
    defaults: { aspect: '1:1', resolution: null, quality: null },
    wire: { kind: 'aspect-resolution', sendResolution: true, responseFormat: 'url' },
    perItemModeration: false,
    ...over,
  };
}

describe('buildImagePayload — aspect-resolution', () => {
  test('sends aspect_ratio and resolution', () => {
    const m = meta({ resolutions: [{ id: '1k', label: '1k' }] });
    expect(
      buildImagePayload('minimax-h3/text-to-image', m, { aspect: '16:9', resolution: '1k', quality: null }, 'a fox', 1),
    ).toEqual({
      model: 'minimax-h3/text-to-image',
      prompt: 'a fox',
      n: 1,
      response_format: 'url',
      aspect_ratio: '16:9',
      resolution: '1k',
    });
  });
  test('omits resolution when the wire says the model ignores it', () => {
    const m = meta({
      wire: { kind: 'aspect-resolution', sendResolution: false, responseFormat: 'url' },
    });
    expect(
      buildImagePayload('bytedance/seedream-v5.0-pro', m, { aspect: '3:4', resolution: null, quality: null }, 'p', 2),
    ).toEqual({
      model: 'bytedance/seedream-v5.0-pro',
      prompt: 'p',
      n: 2,
      response_format: 'url',
      aspect_ratio: '3:4',
    });
  });
  test('sends the quality under the descriptor field name, plus fixed extras', () => {
    const m = meta({
      wire: {
        kind: 'aspect-resolution',
        sendResolution: true,
        qualityParam: 'thinking_level',
        extra: { output_format: 'jpeg' },
        responseFormat: 'url',
      },
    });
    expect(
      buildImagePayload('nano-banana-2.1', m, { aspect: '1:1', resolution: '2k', quality: 'high' }, 'p', 1),
    ).toEqual({
      model: 'nano-banana-2.1',
      prompt: 'p',
      n: 1,
      response_format: 'url',
      aspect_ratio: '1:1',
      resolution: '2k',
      thinking_level: 'high',
      output_format: 'jpeg',
    });
  });
  test('modelByQuality swaps the upstream model and sends no quality field', () => {
    const m = meta({
      wire: {
        kind: 'aspect-resolution',
        sendResolution: true,
        modelByQuality: { normal: 'grok-imagine-image', quality: 'grok-imagine-image-quality' },
        responseFormat: 'b64_json',
      },
    });
    expect(
      buildImagePayload('grok-imagine-image', m, { aspect: '4:3', resolution: '2k', quality: 'quality' }, 'p', 3),
    ).toEqual({
      model: 'grok-imagine-image-quality',
      prompt: 'p',
      n: 3,
      response_format: 'b64_json',
      aspect_ratio: '4:3',
      resolution: '2k',
    });
  });
});

describe('buildImagePayload — size-table', () => {
  test('looks the size up and sends it as WxH', () => {
    const m = meta({
      aspects: ['1:1', '16:9'],
      wire: { kind: 'size-table', sizes: Z_IMAGE_TURBO_SIZES, responseFormat: 'url' },
    });
    expect(
      buildImagePayload('z-image-turbo', m, { aspect: '16:9', resolution: null, quality: null }, 'p', 1),
    ).toEqual({
      model: 'z-image-turbo',
      prompt: 'p',
      n: 1,
      response_format: 'url',
      size: '1280x720',
    });
  });
  test('sends the quality param when the table model has one', () => {
    const m = meta({
      resolutions: [{ id: '1k', label: '1k' }],
      qualities: [{ id: 'low', label: 'Low' }],
      wire: { kind: 'size-table', sizes: { '1:1|1k': [1024, 1024] }, qualityParam: 'quality', responseFormat: 'url' },
    });
    expect(
      buildImagePayload('gpt-image-2', m, { aspect: '1:1', resolution: '1k', quality: 'low' }, 'p', 1),
    ).toEqual({
      model: 'gpt-image-2',
      prompt: 'p',
      n: 1,
      response_format: 'url',
      size: '1024x1024',
      quality: 'low',
    });
  });
  test('throws on a combination the table lacks (programming error)', () => {
    const m = meta({ wire: { kind: 'size-table', sizes: Z_IMAGE_TURBO_SIZES, responseFormat: 'url' } });
    expect(() =>
      buildImagePayload('z-image-turbo', m, { aspect: '4:3', resolution: null, quality: null }, 'p', 1),
    ).toThrow('z-image-turbo: no size for 4:3 x -');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd packages/llm-unified && bun test src/tti/build-payload.test.ts`
Expected: FAIL — `Cannot find module './build-payload.js'`.

- [ ] **Step 4: Implement**

`packages/llm-unified/src/tti/build-payload.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import type { ImageModelConfig, TtiDescriptor } from './descriptor.js';

/**
 * Build the OpenAI-shaped `/images/generations` body for one offering. The
 * descriptor's `wire` decides the shape; nothing here knows about specific
 * models. `response_format` follows the provider: nano-gpt's R2 bucket is
 * fetched by URL, xAI's CDN is closed to browsers so it returns base64.
 */
export function buildImagePayload(
  slug: string,
  meta: TtiDescriptor,
  config: ImageModelConfig,
  prompt: string,
  n: number,
): Record<string, unknown> {
  const wire = meta.wire;
  const swapped =
    wire.kind === 'aspect-resolution' && config.quality !== null
      ? wire.modelByQuality?.[config.quality]
      : undefined;
  const body: Record<string, unknown> = {
    model: swapped ?? slug,
    prompt,
    n,
    response_format: wire.responseFormat,
  };

  if (wire.kind === 'aspect-resolution') {
    body.aspect_ratio = config.aspect;
    if (wire.sendResolution && config.resolution !== null) body.resolution = config.resolution;
    if (wire.qualityParam && config.quality !== null) body[wire.qualityParam] = config.quality;
    if (wire.extra) Object.assign(body, wire.extra);
    return body;
  }

  const key = `${config.aspect}|${config.resolution ?? '-'}`;
  const size = wire.sizes[key];
  if (!size) throw new Error(`${slug}: no size for ${config.aspect} x ${config.resolution ?? '-'}`);
  body.size = `${size[0]}x${size[1]}`;
  if (wire.qualityParam && config.quality !== null) body[wire.qualityParam] = config.quality;
  return body;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `cd packages/llm-unified && bun test src/tti/build-payload.test.ts` → PASS.
Then `cd packages/llm-unified && bun test` → 0 failures; `pnpm biome check packages/llm-unified/src/tti` → clean (run `pnpm biome check --write` on the new files if it only reports formatting).

- [ ] **Step 6: Commit**

```bash
git add packages/llm-unified/src/tti/size-tables.ts packages/llm-unified/src/tti/build-payload.ts packages/llm-unified/src/tti/build-payload.test.ts
git commit -m "Add TTI size tables and descriptor-driven payload builder" -m "Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 3: Switch the TTI module and the existing offerings to descriptors

This task changes the package's public TTI API. **`apps/user-client` stops typechecking from here until Task 9** (expected — see operating rule 8).

**Files:**
- Modify: `packages/llm-unified/src/catalogue/types.ts` (the `TtiOfferingMeta` interface, currently lines ~147–154)
- Modify: `packages/llm-unified/src/tti/parse.ts`, `packages/llm-unified/src/tti/parse.test.ts`
- Modify: `packages/llm-unified/src/tti/generate-images.ts`, `packages/llm-unified/src/tti/generate-images.test.ts`
- Modify: `packages/llm-unified/src/providers/nano-gpt.ts` (the `ttiOfferings` array, currently lines ~423–435)
- Modify: `packages/llm-unified/src/providers/xai.ts` (`TTI_META`, currently lines ~14–18)
- Modify: `packages/llm-unified/src/tti/offerings.test.ts`
- Modify: `packages/llm-unified/src/providers/builtins.test.ts` (nano-gpt count)
- Modify: `packages/llm-unified/src/index.ts` (the `./tti/config.js` export block)
- Delete: `packages/llm-unified/src/tti/config.ts`, `config.test.ts`, `payloads.ts`, `payloads.test.ts`, `gpt-image-2-resolutions.ts`, `gpt-image-2-resolutions.test.ts`, `seedream-resolutions.ts`, `seedream-resolutions.test.ts`

**Interfaces:**
- Consumes: Task 1 types and functions; Task 2 tables and `buildImagePayload`.
- Produces:
  - `type TtiOfferingMeta = TtiDescriptor` (catalogue/types.ts)
  - `parseImagesResponse(perItemModeration: boolean, payload: unknown): RawImageItem[]`
  - `GenerateImagesArgs` = `ImageRequestBase & { slug: string; meta: TtiDescriptor; config: ImageModelConfig; prompt: string; count: number; signal?: AbortSignal; fetchFn?: typeof fetch }`
  - New offering `nano-gpt:z-image-base`.
  - Package exports: types `ImageModelConfig`, `TtiDescriptor`, `TtiOption`, `TtiWire`; functions `isImageModelConfig`, `isValidConfigFor`, `carryOverConfig`, `priceKey`, `priceCentsFor`, `latencyFor`, `formatPriceCents`, `buildImagePayload`.

- [ ] **Step 1: Rewrite the offerings test (failing)**

Replace the whole of `packages/llm-unified/src/tti/offerings.test.ts` with:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { _resetAdapterRegistryForTests } from '../adapter-registry.js';
import { registerBuiltinProviders } from '../providers/_register-builtins.js';
import { _resetRegistryForTests, getOffering, listTtiOfferings } from '../registry.js';

describe('TTI offerings', () => {
  beforeAll(() => {
    _resetRegistryForTests();
    _resetAdapterRegistryForTests();
    registerBuiltinProviders();
  });
  afterAll(() => {
    _resetRegistryForTests();
    _resetAdapterRegistryForTests();
  });

  test('the migrated offerings are present and none can do NSFW', () => {
    const refs = listTtiOfferings().map((o) => `${o.providerId}:${o.upstreamSlug}`);
    for (const ref of [
      'xai:grok-imagine-image',
      'nano-gpt:z-image-turbo',
      'nano-gpt:z-image-base',
      'nano-gpt:seedream-v4.5',
      'nano-gpt:gpt-image-2',
    ]) {
      expect(refs).toContain(ref);
    }
    for (const o of listTtiOfferings()) {
      expect(o.serviceKind).toBe('tti');
      expect(o.canonicalRef).toBeNull();
      expect(o.tti?.canDoNsfw).toBe(false);
    }
  });

  test('families and variants map as designed', () => {
    const z = getOffering('nano-gpt', 'z-image-turbo')?.tti;
    const zb = getOffering('nano-gpt', 'z-image-base')?.tti;
    expect([z?.family, z?.variant, z?.recommended]).toEqual(['Z-Image', 'Turbo', true]);
    expect([zb?.family, zb?.variant, zb?.latencyHint]).toEqual(['Z-Image', 'Base', '~10× slower']);
    expect(getOffering('nano-gpt', 'seedream-v4.5')?.tti?.variant).toBe('4.5');
    expect(getOffering('nano-gpt', 'gpt-image-2')?.tti?.variant).toBeNull();
    const xai = getOffering('xai', 'grok-imagine-image')?.tti;
    expect([xai?.family, xai?.variant, xai?.perItemModeration]).toEqual(['Grok Imagine', '1', true]);
  });
});
```

Run: `cd packages/llm-unified && bun test src/tti/offerings.test.ts`
Expected: FAIL (`family` is undefined, `z-image-base` missing).

- [ ] **Step 2: Switch the meta type**

In `packages/llm-unified/src/catalogue/types.ts`, replace the whole `export interface TtiOfferingMeta { … }` block (the one with `groupId: 'xai-imagine' | 'zimage' | 'seedream' | 'gpt-image-2';`) with:

```ts
/**
 * Metadata carried by a `serviceKind: 'tti'` offering — the full data-driven
 * descriptor (family, choices, prices, wire shape). See `tti/descriptor.ts`.
 */
export type TtiOfferingMeta = TtiDescriptor;
```

and add at the top of the file, with the other imports:

```ts
import type { TtiDescriptor } from '../tti/descriptor.js';
```

- [ ] **Step 3: Rewrite the xAI descriptor**

In `packages/llm-unified/src/providers/xai.ts`, replace the `TTI_META` constant with:

```ts
// Grok Imagine (xAI direct), probed 2026-10-07. Quality picks the upstream model
// (`grok-imagine-image` / `-quality`) rather than a body field. Billed: Normal
// 2¢ at 1k and 2k; Quality 5¢ at 1k but 7¢ at 2k. Both answer in ~12 s.
// Normal is flat across tiers, so the default resolution is the higher one.
const TTI_META: TtiOfferingMeta = {
  family: 'Grok Imagine',
  variant: '1',
  displayName: 'Grok Imagine',
  canDoNsfw: false,
  maxCount: 10,
  timeoutMs: 60_000,
  aspects: ['1:1', '16:9', '9:16', '4:3', '3:4'],
  resolutions: [
    { id: '1k', label: '1k' },
    { id: '2k', label: '2k' },
  ],
  qualities: [
    { id: 'normal', label: 'Normal' },
    { id: 'quality', label: 'High' },
  ],
  priceCents: { '1k|normal': 2, '2k|normal': 2, '1k|quality': 5, '2k|quality': 7 },
  latency: {
    '1k|normal': '~12 s',
    '2k|normal': '~12 s',
    '1k|quality': '~12 s',
    '2k|quality': '~12 s',
  },
  billing: 'fixed',
  defaults: { aspect: '1:1', resolution: '2k', quality: 'normal' },
  wire: {
    kind: 'aspect-resolution',
    sendResolution: true,
    modelByQuality: { normal: 'grok-imagine-image', quality: 'grok-imagine-image-quality' },
    responseFormat: 'b64_json',
  },
  perItemModeration: true,
};
```

(`TtiOfferingMeta` is already imported in that file.)

- [ ] **Step 4: Rewrite the existing nano-gpt descriptors**

In `packages/llm-unified/src/providers/nano-gpt.ts`:

1. Add to the imports:

```ts
import {
  GPT_IMAGE_2_SIZES,
  SEEDREAM_4_5_SIZES,
  Z_IMAGE_BASE_SIZES,
  Z_IMAGE_TURBO_SIZES,
} from '../tti/size-tables.js';
```

(`TtiOfferingMeta` is already imported via `../catalogue/types.js`; if not, add it to that import.)

2. Directly above `const ttiOfferings`, add:

```ts
// The aspect palette shared by the image models (calm rows; exotic ratios such
// as 1:8 are left out on purpose). Each descriptor takes the subset its model
// supports.
const TTI_PALETTE = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'] as const;
const TTI_SEVEN = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'] as const;
```

3. Replace the whole `const ttiOfferings: Offering[] = [ … ];` array with:

```ts
const ttiOfferings: Offering[] = [
  ttiOffering('z-image-turbo', {
    family: 'Z-Image',
    variant: 'Turbo',
    displayName: 'Z-Image Turbo',
    canDoNsfw: false,
    maxCount: 10,
    timeoutMs: 300_000,
    aspects: ['1:1', '16:9', '9:16', '3:2', '2:3'],
    resolutions: null,
    qualities: null,
    priceCents: { '-|-': 1.19 },
    billing: 'fixed',
    recommended: true,
    defaults: { aspect: '1:1', resolution: null, quality: null },
    wire: { kind: 'size-table', sizes: Z_IMAGE_TURBO_SIZES, responseFormat: 'url' },
    perItemModeration: false,
  }),
  // Z-Image Base: ~37 s against Turbo's ~4 s at 1024² (probed 2026-10-07).
  ttiOffering('z-image-base', {
    family: 'Z-Image',
    variant: 'Base',
    displayName: 'Z-Image Base',
    canDoNsfw: false,
    maxCount: 4,
    timeoutMs: 300_000,
    aspects: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    resolutions: null,
    qualities: null,
    priceCents: { '-|-': 1.7 },
    latencyHint: '~10× slower',
    billing: 'fixed',
    defaults: { aspect: '1:1', resolution: null, quality: null },
    wire: { kind: 'size-table', sizes: Z_IMAGE_BASE_SIZES, responseFormat: 'url' },
    perItemModeration: false,
  }),
  ttiOffering('seedream-v4.5', {
    family: 'Seedream',
    variant: '4.5',
    displayName: 'Seedream 4.5',
    canDoNsfw: false,
    maxCount: 4,
    timeoutMs: 300_000,
    aspects: [...TTI_SEVEN],
    resolutions: [
      { id: '2k', label: '2k' },
      { id: '2.2k', label: '2.2k' },
      { id: '2.7k', label: '2.7k' },
    ],
    qualities: null,
    priceCents: { '2k|-': 4, '2.2k|-': 4, '2.7k|-': 4 },
    billing: 'fixed',
    defaults: { aspect: '1:1', resolution: '2.7k', quality: null },
    wire: { kind: 'size-table', sizes: SEEDREAM_4_5_SIZES, responseFormat: 'url' },
    perItemModeration: false,
  }),
  // GPT Image 2: `quality` passes through nano-gpt and steers cost and wait.
  // Billed 1k: low 1.8¢ / medium 6.6¢ / high 15.6¢ (2026-06-10); 2k: low 2.5¢
  // (~2 min), medium 12.2¢ (~2 min), high 31.3¢ (~2.5 min) (2026-10-07).
  ttiOffering('gpt-image-2', {
    family: 'GPT Image 2',
    variant: null,
    displayName: 'GPT Image 2',
    canDoNsfw: false,
    maxCount: 4,
    timeoutMs: 600_000,
    aspects: [...TTI_PALETTE],
    resolutions: [
      { id: '1k', label: '1k' },
      { id: '2k', label: '2k' },
    ],
    qualities: [
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
    ],
    priceCents: {
      '1k|low': 1.8,
      '1k|medium': 6.6,
      '1k|high': 15.6,
      '2k|low': 2.5,
      '2k|medium': 12.2,
      '2k|high': 31.3,
    },
    latency: {
      '1k|low': '~25 s',
      '1k|medium': '~70 s',
      '1k|high': '~3.5 min',
      '2k|low': '~2 min',
      '2k|medium': '~2 min',
      '2k|high': '~2.5 min',
    },
    billing: 'fixed',
    defaults: { aspect: '1:1', resolution: '1k', quality: 'medium' },
    wire: {
      kind: 'size-table',
      sizes: GPT_IMAGE_2_SIZES,
      qualityParam: 'quality',
      responseFormat: 'url',
    },
    perItemModeration: false,
  }),
];
```

4. In the `ttiOffering(slug, tti)` helper, change the trailing comment on `confidence` to `// live probes 2026-06-09/10 and 2026-10-07 (unified image models spec §4)`.

- [ ] **Step 5: Parse and generate take descriptor data**

Replace `packages/llm-unified/src/tti/parse.ts` with:

```ts
// SPDX-License-Identifier: LGPL-3.0-only

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
 * Parse a `/images/generations` JSON payload into raw items. Providers with
 * per-item moderation (xAI) mark refused entries with
 * `respect_moderation: false` + `reason`; nano-gpt fails the whole POST
 * instead, upstream of this function. Unknown entry shapes are dropped.
 */
export function parseImagesResponse(perItemModeration: boolean, payload: unknown): RawImageItem[] {
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const items: RawImageItem[] = [];
  for (const raw of data as ResponseEntry[]) {
    if (perItemModeration && raw.respect_moderation === false) {
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

In `packages/llm-unified/src/tti/parse.test.ts`, replace every first argument `'xai-imagine'` with `true` and every other group id (`'zimage'`, `'seedream'`, `'gpt-image-2'`) with `false`. Keep the assertions.

In `packages/llm-unified/src/tti/generate-images.ts`:

1. Replace the imports of `ImageModelConfig` from `./config.js` and `buildImagePayload` from `./payloads.js` with:

```ts
import { buildImagePayload } from './build-payload.js';
import type { ImageModelConfig, TtiDescriptor } from './descriptor.js';
```

2. Delete the `POST_TIMEOUT_MS` constant and its comment.
3. In `GenerateImagesArgs`, replace `config: ImageModelConfig;` with:

```ts
  /** Upstream slug of the offering (the part of the ref after the provider). */
  slug: string;
  meta: TtiDescriptor;
  config: ImageModelConfig;
```

4. In `generateImages`, change the body line to `const body = buildImagePayload(args.slug, args.meta, args.config, args.prompt, args.count);`, the timeout line to `const timeoutSignal = AbortSignal.timeout(args.meta.timeoutMs);`, and the parse line to `const raw = parseImagesResponse(args.meta.perItemModeration, json);`.

In `packages/llm-unified/src/tti/generate-images.test.ts`, add near the top:

```ts
import { getOffering } from '../registry.js';
import { registerBuiltinProviders } from '../providers/_register-builtins.js';
import { _resetRegistryForTests } from '../registry.js';
import { beforeAll } from 'bun:test';

beforeAll(() => {
  _resetRegistryForTests();
  registerBuiltinProviders();
});

function offeringArgs(providerId: string, slug: string) {
  const meta = getOffering(providerId, slug)?.tti;
  if (!meta) throw new Error(`missing TTI offering ${providerId}:${slug}`);
  return { slug, meta };
}
```

(merge the `bun:test` and `../registry.js` imports with the existing ones so Biome's `noDuplicateImports`/organise-imports is satisfied), then replace each `config: { groupId: 'zimage', variant: 'turbo', size: '1024x1024' },` with `...offeringArgs('nano-gpt', 'z-image-turbo'), config: { aspect: '1:1', resolution: null, quality: null },`, and each xAI config (`groupId: 'xai-imagine'`) with `...offeringArgs('xai', 'grok-imagine-image'), config: { aspect: '1:1', resolution: '1k', quality: 'normal' },`. Any other legacy config in that file maps the same way (`seedream` → `offeringArgs('nano-gpt', 'seedream-v4.5')` with `{ aspect: '1:1', resolution: '2k', quality: null }`; `gpt-image-2` → `offeringArgs('nano-gpt', 'gpt-image-2')` with `{ aspect: '1:1', resolution: '1k', quality: 'medium' }`). Assertions on `modelId` stay as they are (`'z-image-turbo'`, `'grok-imagine-image'`).

- [ ] **Step 6: Delete the old modules and update exports**

```bash
git rm packages/llm-unified/src/tti/config.ts packages/llm-unified/src/tti/config.test.ts \
  packages/llm-unified/src/tti/payloads.ts packages/llm-unified/src/tti/payloads.test.ts \
  packages/llm-unified/src/tti/gpt-image-2-resolutions.ts packages/llm-unified/src/tti/gpt-image-2-resolutions.test.ts \
  packages/llm-unified/src/tti/seedream-resolutions.ts packages/llm-unified/src/tti/seedream-resolutions.test.ts
```

In `packages/llm-unified/src/index.ts`, replace the block

```ts
export {
  defaultConfigFor,
  isImageModelConfig,
  maxCountFor,
  type GptImage2Config,
  type ImageModelConfig,
  type SeedreamConfig,
  type TtiGroupId,
  type XaiImagineConfig,
  type ZImageConfig,
} from './tti/config.js';
```

with

```ts
export type { ImageModelConfig, TtiDescriptor, TtiOption, TtiWire } from './tti/descriptor.js';
export {
  carryOverConfig,
  formatPriceCents,
  isImageModelConfig,
  isValidConfigFor,
  latencyFor,
  priceCentsFor,
  priceKey,
} from './tti/image-config.js';
export { buildImagePayload } from './tti/build-payload.js';
```

Search for leftovers: `rg -n "groupId|TtiGroupId|defaultConfigFor|maxCountFor|seedreamResolution|gptImage2Resolution" packages/llm-unified/src` must print nothing.

- [ ] **Step 7: Update the nano-gpt offering count**

In `packages/llm-unified/src/providers/builtins.test.ts`, in the `nano-gpt has inofficial CORS hint …` test, change the comment line `// + 11 September 2026 additions = 52.` to `// + 11 September 2026 additions + Z-Image Base = 53.` and `toHaveLength(52)` to `toHaveLength(53)`.

- [ ] **Step 8: Run the package gate**

Run: `cd packages/llm-unified && bun test` → 0 failures.
Run: `cd packages/llm-unified && pnpm exec tsc -p tsconfig.test.json --noEmit` → no errors.
(`apps/user-client` typecheck failing now is expected.)

- [ ] **Step 9: Commit**

```bash
git add -A packages/llm-unified
git commit -m "Describe TTI offerings by data and drop the bespoke groups" -m "Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 4: The nine new nano-gpt image offerings and the consistency test

**Files:**
- Modify: `packages/llm-unified/src/providers/nano-gpt.ts` (append to `ttiOfferings`)
- Modify: `packages/llm-unified/src/providers/builtins.test.ts` (count 53 → 62)
- Create: `packages/llm-unified/src/tti/descriptor-consistency.test.ts`

**Interfaces:**
- Consumes: `TtiDescriptor`, `isValidConfigFor`, `priceKey` (Task 1); `SEEDREAM_5_LITE_SIZES`, `QWEN_IMAGE_2_1_PRO_SIZES`, `buildImagePayload` (Task 2); `TTI_PALETTE`, `TTI_SEVEN`, `ttiOffering` (Task 3, in nano-gpt.ts).
- Produces: nine offerings with refs
  `nano-gpt:minimax-h3/text-to-image`, `nano-gpt:qwen-image-2.1/text-to-image`, `nano-gpt:qwen-image-2.1-pro`, `nano-gpt:black-forest-labs/flux-3/text-to-image`, `nano-gpt:bytedance/seedream-v5.0-flash`, `nano-gpt:seedream-v5.0-lite`, `nano-gpt:bytedance/seedream-v5.0-pro`, `nano-gpt:xai/grok-imagine-image/v2.0/text-to-image`, `nano-gpt:nano-banana-2.1`.

- [ ] **Step 1: Write the failing consistency test**

`packages/llm-unified/src/tti/descriptor-consistency.test.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { _resetAdapterRegistryForTests } from '../adapter-registry.js';
import { registerBuiltinProviders } from '../providers/_register-builtins.js';
import { _resetRegistryForTests, listTtiOfferings } from '../registry.js';
import { buildImagePayload } from './build-payload.js';
import { isValidConfigFor, priceKey } from './image-config.js';

beforeAll(() => {
  _resetRegistryForTests();
  _resetAdapterRegistryForTests();
  registerBuiltinProviders();
});
afterAll(() => {
  _resetRegistryForTests();
  _resetAdapterRegistryForTests();
});

function all() {
  return listTtiOfferings().map((o) => {
    if (!o.tti) throw new Error(`${o.providerId}:${o.upstreamSlug} has no tti descriptor`);
    return { ref: `${o.providerId}:${o.upstreamSlug}`, slug: o.upstreamSlug, meta: o.tti };
  });
}

describe('TTI descriptor consistency (every offering, every provider)', () => {
  test('there are fourteen TTI offerings', () => {
    expect(all().map((o) => o.ref).sort()).toEqual([
      'nano-gpt:black-forest-labs/flux-3/text-to-image',
      'nano-gpt:bytedance/seedream-v5.0-flash',
      'nano-gpt:bytedance/seedream-v5.0-pro',
      'nano-gpt:gpt-image-2',
      'nano-gpt:minimax-h3/text-to-image',
      'nano-gpt:nano-banana-2.1',
      'nano-gpt:qwen-image-2.1-pro',
      'nano-gpt:qwen-image-2.1/text-to-image',
      'nano-gpt:seedream-v4.5',
      'nano-gpt:seedream-v5.0-lite',
      'nano-gpt:xai/grok-imagine-image/v2.0/text-to-image',
      'nano-gpt:z-image-base',
      'nano-gpt:z-image-turbo',
      'xai:grok-imagine-image',
    ]);
  });

  test('defaults are valid, maxCount is positive, nothing claims NSFW', () => {
    for (const { ref, meta } of all()) {
      expect({ ref, valid: isValidConfigFor(meta, meta.defaults) }).toEqual({ ref, valid: true });
      expect(meta.maxCount).toBeGreaterThanOrEqual(1);
      expect({ ref, nsfw: meta.canDoNsfw }).toEqual({ ref, nsfw: false });
    }
  });

  test('every resolution × quality combination has a price, latency keys are priced', () => {
    for (const { ref, meta } of all()) {
      const resolutions = meta.resolutions?.map((r) => r.id) ?? [null];
      const qualities = meta.qualities?.map((q) => q.id) ?? [null];
      for (const resolution of resolutions) {
        for (const quality of qualities) {
          const key = priceKey({ resolution, quality });
          expect({ ref, key, priced: typeof meta.priceCents[key] === 'number' }).toEqual({
            ref,
            key,
            priced: true,
          });
        }
      }
      for (const key of Object.keys(meta.latency ?? {})) {
        expect({ ref, key, priced: key in meta.priceCents }).toEqual({ ref, key, priced: true });
      }
    }
  });

  test('every aspect × resolution cell exists in a size table', () => {
    for (const { ref, meta } of all()) {
      if (meta.wire.kind !== 'size-table') continue;
      for (const aspect of meta.aspects) {
        for (const resolution of meta.resolutions?.map((r) => r.id) ?? [null]) {
          const key = `${aspect}|${resolution ?? '-'}`;
          expect({ ref, key, sized: key in meta.wire.sizes }).toEqual({ ref, key, sized: true });
        }
      }
    }
  });

  test('variants are labelled in multi-member families, at most one recommended', () => {
    const byFamily = new Map<string, Array<{ ref: string; variant: string | null; rec: boolean }>>();
    for (const { ref, meta } of all()) {
      const list = byFamily.get(meta.family) ?? [];
      list.push({ ref, variant: meta.variant, rec: meta.recommended === true });
      byFamily.set(meta.family, list);
    }
    for (const [family, members] of byFamily) {
      if (members.length > 1) {
        for (const m of members) expect({ family, ref: m.ref, variant: m.variant !== null }).toEqual({ family, ref: m.ref, variant: true });
      }
      expect({ family, recommended: members.filter((m) => m.rec).length <= 1 }).toEqual({
        family,
        recommended: true,
      });
    }
    expect([...byFamily.keys()].sort()).toEqual([
      'FLUX.3',
      'GPT Image 2',
      'Grok Imagine',
      'MiniMax H3',
      'Nano Banana 2.1',
      'Qwen Image',
      'Seedream',
      'Z-Image',
    ]);
  });

  test('default payloads match the bodies probed live on 2026-10-07', () => {
    const expected: Record<string, Record<string, unknown>> = {
      'nano-gpt:minimax-h3/text-to-image': { aspect_ratio: '1:1', resolution: '1k' },
      'nano-gpt:qwen-image-2.1/text-to-image': { aspect_ratio: '1:1', resolution: '1k' },
      'nano-gpt:qwen-image-2.1-pro': { size: '2048x2048' },
      'nano-gpt:black-forest-labs/flux-3/text-to-image': { aspect_ratio: '1:1', resolution: '1k' },
      'nano-gpt:bytedance/seedream-v5.0-flash': { aspect_ratio: '1:1', resolution: '2k' },
      'nano-gpt:seedream-v5.0-lite': { size: '2048x2048' },
      'nano-gpt:bytedance/seedream-v5.0-pro': { aspect_ratio: '1:1' },
      'nano-gpt:xai/grok-imagine-image/v2.0/text-to-image': {
        aspect_ratio: '1:1',
        resolution: '1k',
        quality: 'low',
      },
      'nano-gpt:nano-banana-2.1': {
        aspect_ratio: '1:1',
        resolution: '1k',
        thinking_level: 'minimal',
        output_format: 'jpeg',
      },
      'nano-gpt:z-image-turbo': { size: '1024x1024' },
      'nano-gpt:z-image-base': { size: '1024x1024' },
      'nano-gpt:seedream-v4.5': { size: '2656x2656' },
      'nano-gpt:gpt-image-2': { size: '1024x1024', quality: 'medium' },
    };
    for (const { ref, slug, meta } of all()) {
      if (ref === 'xai:grok-imagine-image') {
        expect(buildImagePayload(slug, meta, meta.defaults, 'p', 1)).toEqual({
          model: 'grok-imagine-image',
          prompt: 'p',
          n: 1,
          response_format: 'b64_json',
          aspect_ratio: '1:1',
          resolution: '2k',
        });
        continue;
      }
      expect({ ref, body: buildImagePayload(slug, meta, meta.defaults, 'p', 1) }).toEqual({
        ref,
        body: { model: slug, prompt: 'p', n: 1, response_format: 'url', ...expected[ref] },
      });
    }
  });

  test('FLUX.3 caps a request at four images', () => {
    const flux = all().find((o) => o.ref === 'nano-gpt:black-forest-labs/flux-3/text-to-image');
    expect(flux?.meta.maxCount).toBe(4);
  });
});
```

Run: `cd packages/llm-unified && bun test src/tti/descriptor-consistency.test.ts`
Expected: FAIL (only five offerings exist; family list incomplete).

- [ ] **Step 2: Add the nine offerings**

In `packages/llm-unified/src/providers/nano-gpt.ts`, extend the size-tables import with `QWEN_IMAGE_2_1_PRO_SIZES` and `SEEDREAM_5_LITE_SIZES`, then append these entries inside the `ttiOfferings` array, after `gpt-image-2`:

```ts
  // ── October 2026 additions (probed live 2026-10-07; billed costs, wall-clock
  // waits). nano-gpt's catalogue listings are suggestions; these are measured.
  ttiOffering('minimax-h3/text-to-image', {
    family: 'MiniMax H3',
    variant: null,
    displayName: 'MiniMax H3',
    canDoNsfw: false,
    maxCount: 4,
    timeoutMs: 300_000,
    aspects: [...TTI_PALETTE],
    resolutions: [
      { id: '1k', label: '1k' },
      { id: '2k', label: '2k' },
    ],
    qualities: null,
    priceCents: { '1k|-': 2, '2k|-': 6 },
    billing: 'fixed',
    defaults: { aspect: '1:1', resolution: '1k', quality: null },
    wire: { kind: 'aspect-resolution', sendResolution: true, responseFormat: 'url' },
    perItemModeration: false,
  }),
  ttiOffering('qwen-image-2.1/text-to-image', {
    family: 'Qwen Image',
    variant: '2.1',
    displayName: 'Qwen Image 2.1',
    canDoNsfw: false,
    maxCount: 4,
    timeoutMs: 300_000,
    aspects: [...TTI_PALETTE],
    resolutions: [
      { id: '1k', label: '1k' },
      { id: '1.5k', label: '1.5k' },
      { id: '2k', label: '2k' },
    ],
    qualities: null,
    priceCents: { '1k|-': 2, '1.5k|-': 4, '2k|-': 6 },
    billing: 'fixed',
    recommended: true,
    defaults: { aspect: '1:1', resolution: '1k', quality: null },
    wire: { kind: 'aspect-resolution', sendResolution: true, responseFormat: 'url' },
    perItemModeration: false,
  }),
  // Qwen Image 2.1 Pro returns PNGs of ~9 MB; the client transcodes them.
  ttiOffering('qwen-image-2.1-pro', {
    family: 'Qwen Image',
    variant: '2.1 Pro',
    displayName: 'Qwen Image 2.1 Pro',
    canDoNsfw: false,
    maxCount: 4,
    timeoutMs: 300_000,
    aspects: [...TTI_SEVEN],
    resolutions: null,
    qualities: null,
    priceCents: { '-|-': 7.5 },
    billing: 'fixed',
    defaults: { aspect: '1:1', resolution: null, quality: null },
    wire: { kind: 'size-table', sizes: QWEN_IMAGE_2_1_PRO_SIZES, responseFormat: 'url' },
    perItemModeration: false,
  }),
  // FLUX.3: 4k is 5456×3072 at 65¢ and ~90 s. maxCount is 4, not the
  // catalogue's 10, so one tool call can never bill $6.50.
  ttiOffering('black-forest-labs/flux-3/text-to-image', {
    family: 'FLUX.3',
    variant: null,
    displayName: 'FLUX.3',
    canDoNsfw: false,
    maxCount: 4,
    timeoutMs: 300_000,
    aspects: [...TTI_PALETTE],
    resolutions: [
      { id: '1k', label: '1k' },
      { id: '2k', label: '2k' },
      { id: '4k', label: '4k' },
    ],
    qualities: null,
    priceCents: { '1k|-': 5, '2k|-': 12, '4k|-': 65 },
    billing: 'fixed',
    defaults: { aspect: '1:1', resolution: '1k', quality: null },
    wire: { kind: 'aspect-resolution', sendResolution: true, responseFormat: 'url' },
    perItemModeration: false,
  }),
  ttiOffering('bytedance/seedream-v5.0-flash', {
    family: 'Seedream',
    variant: '5.0 Flash',
    displayName: 'Seedream 5.0 Flash',
    canDoNsfw: false,
    maxCount: 4,
    timeoutMs: 300_000,
    aspects: [...TTI_SEVEN],
    resolutions: [
      { id: '1k', label: '1k' },
      { id: '1.5k', label: '1.5k' },
      { id: '2k', label: '2k' },
    ],
    qualities: null,
    priceCents: { '1k|-': 2.7, '1.5k|-': 2.7, '2k|-': 2.7 },
    billing: 'fixed',
    recommended: true,
    defaults: { aspect: '1:1', resolution: '2k', quality: null },
    wire: { kind: 'aspect-resolution', sendResolution: true, responseFormat: 'url' },
    perItemModeration: false,
  }),
  ttiOffering('seedream-v5.0-lite', {
    family: 'Seedream',
    variant: '5.0 Lite',
    displayName: 'Seedream 5.0 Lite',
    canDoNsfw: false,
    maxCount: 4,
    timeoutMs: 300_000,
    aspects: ['1:1', '16:9', '9:16', '3:2', '2:3'],
    resolutions: null,
    qualities: null,
    priceCents: { '-|-': 3.5 },
    billing: 'fixed',
    defaults: { aspect: '1:1', resolution: null, quality: null },
    wire: { kind: 'size-table', sizes: SEEDREAM_5_LITE_SIZES, responseFormat: 'url' },
    perItemModeration: false,
  }),
  // Seedream 5.0 Pro always renders and bills 2k (~2730×1536 at 16:9, 9¢):
  // `resolution: '1k'`, `'1K'` and `size: '1k'` were all ignored, so no
  // Resolution row and no resolution param. The catalogue's 1k price is wrong.
  ttiOffering('bytedance/seedream-v5.0-pro', {
    family: 'Seedream',
    variant: '5.0 Pro',
    displayName: 'Seedream 5.0 Pro',
    canDoNsfw: false,
    maxCount: 4,
    timeoutMs: 300_000,
    aspects: [...TTI_SEVEN],
    resolutions: null,
    qualities: null,
    priceCents: { '-|-': 9 },
    billing: 'fixed',
    defaults: { aspect: '1:1', resolution: null, quality: null },
    wire: { kind: 'aspect-resolution', sendResolution: false, responseFormat: 'url' },
    perItemModeration: false,
  }),
  // Grok Imagine 2.0 via nano-gpt: `quality` steers cost and wait. nano-gpt's
  // catalogue warns that prompts refused under xAI's terms may still be billed.
  ttiOffering('xai/grok-imagine-image/v2.0/text-to-image', {
    family: 'Grok Imagine',
    variant: '2.0',
    displayName: 'Grok Imagine 2.0',
    canDoNsfw: false,
    maxCount: 4,
    timeoutMs: 300_000,
    aspects: [...TTI_SEVEN],
    resolutions: [
      { id: '1k', label: '1k' },
      { id: '2k', label: '2k' },
    ],
    qualities: [
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
    ],
    priceCents: { '1k|low': 4, '1k|medium': 6, '2k|low': 6, '2k|medium': 8 },
    latency: { '1k|low': '~20 s', '1k|medium': '~70 s', '2k|low': '~30 s', '2k|medium': '~80 s' },
    billing: 'fixed',
    recommended: true,
    defaults: { aspect: '1:1', resolution: '1k', quality: 'low' },
    wire: {
      kind: 'aspect-resolution',
      sendResolution: true,
      qualityParam: 'quality',
      responseFormat: 'url',
    },
    perItemModeration: false,
  }),
  // Nano Banana 2.1 bills actual usage (thinking tokens included), hence
  // `billing: 'usage'`. Without `output_format` it returns ~10 MB PNGs.
  ttiOffering('nano-banana-2.1', {
    family: 'Nano Banana 2.1',
    variant: null,
    displayName: 'Nano Banana 2.1',
    canDoNsfw: false,
    maxCount: 4,
    timeoutMs: 300_000,
    aspects: [...TTI_PALETTE],
    resolutions: [
      { id: '1k', label: '1k' },
      { id: '2k', label: '2k' },
    ],
    qualities: [
      { id: 'minimal', label: 'Quick' },
      { id: 'high', label: 'Considered' },
    ],
    priceCents: { '1k|minimal': 6.1, '1k|high': 6.9, '2k|minimal': 8.9, '2k|high': 9.8 },
    latency: {
      '1k|minimal': '~15 s',
      '1k|high': '~20 s',
      '2k|minimal': '~20 s',
      '2k|high': '~25 s',
    },
    billing: 'usage',
    defaults: { aspect: '1:1', resolution: '1k', quality: 'minimal' },
    wire: {
      kind: 'aspect-resolution',
      sendResolution: true,
      qualityParam: 'thinking_level',
      extra: { output_format: 'jpeg' },
      responseFormat: 'url',
    },
    perItemModeration: false,
  }),
```

- [ ] **Step 3: Update the nano-gpt offering count**

In `packages/llm-unified/src/providers/builtins.test.ts`, change `// + 11 September 2026 additions + Z-Image Base = 53.` to `// + 11 September 2026 additions + Z-Image Base + 9 October 2026 image models = 62.` and `toHaveLength(53)` to `toHaveLength(62)`.

- [ ] **Step 4: Run to verify pass**

Run: `cd packages/llm-unified && bun test src/tti/descriptor-consistency.test.ts` → PASS.
Run: `cd packages/llm-unified && bun test` → 0 failures.
Run: `cd packages/llm-unified && pnpm exec tsc -p tsconfig.test.json --noEmit` → no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified
git commit -m "Add nine nano-gpt image models as TTI descriptors" -m "Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 5: Lazy upgrade of stored slots and the descriptor lookup

**Files:**
- Create: `packages/llm-unified/src/tti/lookup.ts`
- Create: `packages/llm-unified/src/tti/upgrade.ts`
- Test: `packages/llm-unified/src/tti/upgrade.test.ts`
- Modify: `packages/llm-unified/src/index.ts`

**Interfaces:**
- Consumes: `TtiDescriptor`, `ImageModelConfig` (Task 1); `isImageModelConfig`, `isValidConfigFor`, `carryOverConfig` (Task 1); `getOffering` from `../registry.js`.
- Produces:
  - `getTtiDescriptor(ref: string): TtiDescriptor | undefined`
  - `type LegacyImageModelConfig` (the four pre-2026-10-07 shapes)
  - `interface ImageSlot { ref: string; config: ImageModelConfig; lastConfigByRef?: Record<string, ImageModelConfig> }`
  - `upgradeImageSlot(stored: unknown, lookup: (ref: string) => TtiDescriptor | undefined): ImageSlot | null`
  - All three plus `LegacyImageModelConfig` exported from the package.

- [ ] **Step 1: Write the failing tests**

`packages/llm-unified/src/tti/upgrade.test.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { _resetAdapterRegistryForTests } from '../adapter-registry.js';
import { registerBuiltinProviders } from '../providers/_register-builtins.js';
import { _resetRegistryForTests } from '../registry.js';
import { getTtiDescriptor } from './lookup.js';
import { upgradeImageSlot } from './upgrade.js';

beforeAll(() => {
  _resetRegistryForTests();
  _resetAdapterRegistryForTests();
  registerBuiltinProviders();
});
afterAll(() => {
  _resetRegistryForTests();
  _resetAdapterRegistryForTests();
});

const up = (stored: unknown) => upgradeImageSlot(stored, getTtiDescriptor);

describe('getTtiDescriptor', () => {
  test('resolves a ref whose slug contains slashes and colons-free paths', () => {
    expect(getTtiDescriptor('nano-gpt:xai/grok-imagine-image/v2.0/text-to-image')?.displayName).toBe(
      'Grok Imagine 2.0',
    );
    expect(getTtiDescriptor('nano-gpt:nope')).toBeUndefined();
    expect(getTtiDescriptor('no-colon')).toBeUndefined();
    expect(getTtiDescriptor('mistral:mistral-large-4')).toBeUndefined(); // not a TTI offering
  });
});

describe('upgradeImageSlot — legacy shapes', () => {
  test('xai-imagine: tier becomes quality', () => {
    expect(
      up({
        ref: 'xai:grok-imagine-image',
        config: { groupId: 'xai-imagine', tier: 'quality', resolution: '1k', aspect: '16:9' },
      }),
    ).toEqual({
      ref: 'xai:grok-imagine-image',
      config: { aspect: '16:9', resolution: '1k', quality: 'quality' },
    });
  });
  test('zimage turbo: size becomes aspect', () => {
    expect(
      up({
        ref: 'nano-gpt:z-image-turbo',
        config: { groupId: 'zimage', variant: 'turbo', size: '1280x720' },
      }),
    ).toEqual({
      ref: 'nano-gpt:z-image-turbo',
      config: { aspect: '16:9', resolution: null, quality: null },
    });
  });
  test('zimage turbo: a small square becomes 1:1', () => {
    expect(
      up({ ref: 'nano-gpt:z-image-turbo', config: { groupId: 'zimage', variant: 'turbo', size: '512x512' } })
        ?.config,
    ).toEqual({ aspect: '1:1', resolution: null, quality: null });
  });
  test('zimage base: the ref moves to the Base offering, an unsupported aspect falls back', () => {
    expect(
      up({
        ref: 'nano-gpt:z-image-turbo',
        config: { groupId: 'zimage', variant: 'base', size: '1536x1024' },
      }),
    ).toEqual({
      ref: 'nano-gpt:z-image-base',
      config: { aspect: '1:1', resolution: null, quality: null },
    });
  });
  test('seedream: standard/high/ultra become 2k/2.2k/2.7k', () => {
    const map = { standard: '2k', high: '2.2k', ultra: '2.7k' } as const;
    for (const [quality, resolution] of Object.entries(map)) {
      expect(
        up({ ref: 'nano-gpt:seedream-v4.5', config: { groupId: 'seedream', aspect: '3:2', quality } })
          ?.config,
      ).toEqual({ aspect: '3:2', resolution, quality: null });
    }
  });
  test('gpt-image-2: fields copied', () => {
    expect(
      up({
        ref: 'nano-gpt:gpt-image-2',
        config: { groupId: 'gpt-image-2', aspect: '21:9', resolution: '2k', quality: 'high' },
      })?.config,
    ).toEqual({ aspect: '21:9', resolution: '2k', quality: 'high' });
  });
});

describe('upgradeImageSlot — new shapes and failure cases', () => {
  test('a valid new slot is unchanged', () => {
    const slot = {
      ref: 'nano-gpt:bytedance/seedream-v5.0-flash',
      config: { aspect: '16:9', resolution: '1k', quality: null },
    };
    expect(up(slot)).toEqual(slot);
  });
  test('an invalid config on a known ref keeps what fits and defaults the rest', () => {
    expect(
      up({
        ref: 'nano-gpt:black-forest-labs/flux-3/text-to-image',
        config: { aspect: '16:9', resolution: '8k', quality: 'ultra' },
      }),
    ).toEqual({
      ref: 'nano-gpt:black-forest-labs/flux-3/text-to-image',
      config: { aspect: '16:9', resolution: '1k', quality: null },
    });
  });
  test('an unparseable config on a known ref takes the defaults', () => {
    expect(up({ ref: 'nano-gpt:seedream-v5.0-lite', config: 'garbage' })).toEqual({
      ref: 'nano-gpt:seedream-v5.0-lite',
      config: { aspect: '1:1', resolution: null, quality: null },
    });
  });
  test('an unknown ref, a null slot or junk yields null', () => {
    expect(up({ ref: 'nano-gpt:retired-model', config: { aspect: '1:1', resolution: null, quality: null } })).toBeNull();
    expect(up(null)).toBeNull();
    expect(up({ config: {} })).toBeNull();
  });
  test('lastConfigByRef keeps only entries that still fit their offering', () => {
    const slot = up({
      ref: 'nano-gpt:gpt-image-2',
      config: { aspect: '1:1', resolution: '1k', quality: 'medium' },
      lastConfigByRef: {
        'nano-gpt:gpt-image-2': { aspect: '16:9', resolution: '2k', quality: 'high' },
        'nano-gpt:black-forest-labs/flux-3/text-to-image': { aspect: '1:1', resolution: '8k', quality: null },
        'nano-gpt:retired-model': { aspect: '1:1', resolution: null, quality: null },
        'nano-gpt:seedream-v5.0-lite': 'junk',
      },
    });
    expect(slot?.lastConfigByRef).toEqual({
      'nano-gpt:gpt-image-2': { aspect: '16:9', resolution: '2k', quality: 'high' },
    });
  });
  test('an absent or empty lastConfigByRef is omitted', () => {
    const slot = up({
      ref: 'nano-gpt:gpt-image-2',
      config: { aspect: '1:1', resolution: '1k', quality: 'medium' },
      lastConfigByRef: {},
    });
    expect(slot).toEqual({
      ref: 'nano-gpt:gpt-image-2',
      config: { aspect: '1:1', resolution: '1k', quality: 'medium' },
    });
  });
});
```

Run: `cd packages/llm-unified && bun test src/tti/upgrade.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 2: Implement the lookup**

`packages/llm-unified/src/tti/lookup.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { getOffering } from '../registry.js';
import type { TtiDescriptor } from './descriptor.js';

/** Resolve a stored "providerId:upstreamSlug" ref to its TTI descriptor. */
export function getTtiDescriptor(ref: string): TtiDescriptor | undefined {
  const idx = ref.indexOf(':');
  if (idx < 0) return undefined;
  const offering = getOffering(ref.slice(0, idx), ref.slice(idx + 1));
  return offering?.serviceKind === 'tti' ? offering.tti : undefined;
}
```

- [ ] **Step 3: Implement the upgrade**

`packages/llm-unified/src/tti/upgrade.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import type { ImageModelConfig, TtiDescriptor } from './descriptor.js';
import { carryOverConfig, isImageModelConfig, isValidConfigFor } from './image-config.js';

/**
 * The four per-group config shapes stored before the 2026-10-07 unification.
 * They still exist in synced settings from older devices and in the
 * `configSnapshot` of older generated-image artefacts.
 */
export type LegacyImageModelConfig =
  | { groupId: 'xai-imagine'; tier: 'normal' | 'quality'; resolution: '1k' | '2k'; aspect: string }
  | { groupId: 'zimage'; variant: 'turbo' | 'base'; size: string }
  | { groupId: 'seedream'; aspect: string; quality: 'standard' | 'high' | 'ultra' }
  | {
      groupId: 'gpt-image-2';
      aspect: string;
      resolution: '1k' | '2k';
      quality: 'low' | 'medium' | 'high';
    };

/** One image-generation settings slot as stored after the unification. */
export interface ImageSlot {
  ref: string;
  config: ImageModelConfig;
  /** Last config per offering picked in this slot — restored on return. */
  lastConfigByRef?: Record<string, ImageModelConfig>;
}

const SEEDREAM_TIER: Record<string, string> = { standard: '2k', high: '2.2k', ultra: '2.7k' };

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** '1280x720' → '16:9'; squares → '1:1'. Accepts `x` or `*` as separator. */
function aspectOfSize(size: string): string {
  const [w, h] = size.split(/[x*]/).map(Number);
  if (!w || !h) return '1:1';
  const d = gcd(w, h);
  return `${w / d}:${h / d}`;
}

/** Translate a legacy config (and, for Z-Image, its ref) into the new shape. */
function fromLegacy(
  ref: string,
  c: Record<string, unknown>,
): { ref: string; config: ImageModelConfig } | null {
  const s = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  switch (c.groupId) {
    case 'xai-imagine':
      return { ref, config: { aspect: s(c.aspect) ?? '1:1', resolution: s(c.resolution), quality: s(c.tier) } };
    case 'zimage':
      return {
        ref: c.variant === 'base' ? 'nano-gpt:z-image-base' : 'nano-gpt:z-image-turbo',
        config: { aspect: aspectOfSize(s(c.size) ?? ''), resolution: null, quality: null },
      };
    case 'seedream':
      return {
        ref,
        config: {
          aspect: s(c.aspect) ?? '1:1',
          resolution: SEEDREAM_TIER[s(c.quality) ?? ''] ?? null,
          quality: null,
        },
      };
    case 'gpt-image-2':
      return {
        ref,
        config: { aspect: s(c.aspect) ?? '1:1', resolution: s(c.resolution), quality: s(c.quality) },
      };
    default:
      return null;
  }
}

/**
 * Upgrade a stored slot of any vintage to the current shape. Runs wherever a
 * slot is read; the result is written back on the next save, so no Dexie
 * version is needed. Returns null only when the slot is junk or its offering no
 * longer exists — a known offering always yields a usable config.
 */
export function upgradeImageSlot(
  stored: unknown,
  lookup: (ref: string) => TtiDescriptor | undefined,
): ImageSlot | null {
  if (typeof stored !== 'object' || stored === null) return null;
  const raw = stored as Record<string, unknown>;
  if (typeof raw.ref !== 'string') return null;

  let ref = raw.ref;
  let candidate: ImageModelConfig | null = null;
  if (isImageModelConfig(raw.config)) {
    candidate = raw.config;
  } else if (typeof raw.config === 'object' && raw.config !== null) {
    const legacy = fromLegacy(ref, raw.config as Record<string, unknown>);
    if (legacy) {
      ref = legacy.ref;
      candidate = legacy.config;
    }
  }

  const meta = lookup(ref);
  if (!meta) return null;
  let config = meta.defaults;
  if (candidate) config = isValidConfigFor(meta, candidate) ? candidate : carryOverConfig(candidate, meta);

  const slot: ImageSlot = { ref, config };
  if (typeof raw.lastConfigByRef === 'object' && raw.lastConfigByRef !== null) {
    const kept: Record<string, ImageModelConfig> = {};
    for (const [key, value] of Object.entries(raw.lastConfigByRef as Record<string, unknown>)) {
      const m = lookup(key);
      if (m && isImageModelConfig(value) && isValidConfigFor(m, value)) kept[key] = value;
    }
    if (Object.keys(kept).length > 0) slot.lastConfigByRef = kept;
  }
  return slot;
}
```

- [ ] **Step 4: Export**

In `packages/llm-unified/src/index.ts`, directly after the `buildImagePayload` export added in Task 3, add:

```ts
export { getTtiDescriptor } from './tti/lookup.js';
export { upgradeImageSlot, type ImageSlot, type LegacyImageModelConfig } from './tti/upgrade.js';
```

- [ ] **Step 5: Run to verify pass**

Run: `cd packages/llm-unified && bun test src/tti/upgrade.test.ts` → PASS.
Run: `cd packages/llm-unified && bun test` → 0 failures; `cd packages/llm-unified && pnpm exec tsc -p tsconfig.test.json --noEmit` → clean; `pnpm biome check packages/llm-unified` → clean.
Then build the package so the app sees the new API: `pnpm --filter @chatsundere/llm-unified run build`.

- [ ] **Step 6: Commit**

```bash
git add packages/llm-unified
git commit -m "Upgrade stored image slots lazily to the descriptor shape" -m "Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 6: Slot types, send path and the generate_image tool

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts` (the `imageGeneration` field of the settings row type, ~line 53; the `configSnapshot` field of the generated-image artefact type, ~line 418)
- Modify: `apps/user-client/src/data/artefacts.ts` (~line 104, `configSnapshot`)
- Modify: `apps/user-client/src/tools/generate-image.ts`
- Modify: `apps/user-client/src/data/send-message.ts` (`resolveImageSlot` and `resolveImageGeneration`, ~lines 290–390)
- Test: `apps/user-client/tests/tools/generate-image.test.ts`

**Interfaces:**
- Consumes: from `@chatsundere/llm-unified`: `ImageModelConfig`, `LegacyImageModelConfig`, `TtiDescriptor`, `upgradeImageSlot`, `getTtiDescriptor`, `generateImages` (now `{ slug, meta, config, … }`).
- Produces:
  - `type StoredImageSlot = { ref: string; config: ImageModelConfig | LegacyImageModelConfig; lastConfigByRef?: Record<string, ImageModelConfig> }` (exported from `client-data-db.ts`)
  - `ImageGenerationSlot` gains `maxCount: number` (tools/generate-image.ts)

- [ ] **Step 1: Update the tool test (failing)**

In `apps/user-client/tests/tools/generate-image.test.ts`:

1. In the `slot()` helper, replace `config: { groupId: 'zimage', variant: 'turbo', size: '1024x1024' },` with:

```ts
    config: { aspect: '1:1', resolution: null, quality: null },
    maxCount: 10,
```

2. In the test `clamps count to the group maximum and persists one artefact per image`, rename it to `clamps count to the slot maximum and persists one artefact per image` and replace the `seedreamSlot` config line `config: { groupId: 'seedream', aspect: '1:1', quality: 'standard' },` with:

```ts
      config: { aspect: '1:1', resolution: '2.7k', quality: null },
      maxCount: 4,
```

3. Append this test inside the same top-level `describe`:

```ts
  it('clamps an oversized count to the descriptor maxCount (FLUX.3 → 4)', async () => {
    const fluxSlot = slot({
      ref: 'nano-gpt:black-forest-labs/flux-3/text-to-image',
      modelLabel: 'FLUX.3',
      config: { aspect: '1:1', resolution: '4k', quality: null },
      maxCount: 4,
    });
    const generate = vi.fn(
      async (): Promise<GenerateImagesResult> => ({ items: [], modelId: 'flux' }),
    );
    const c = ctx({ primary: fluxSlot, generate });
    await getTool(c).execute({ prompt: 'a fox', count: 10 });
    expect(generate).toHaveBeenCalledWith(fluxSlot, 'a fox', 4, undefined);
  });
```

(If `getTool` is defined under another name in that file, use the existing helper that returns the `generate_image` tool from `contributeImageTool(c)`. If `execute` takes a second `signal` argument in the existing tests, mirror their call shape; the assertion's fourth argument is whatever `signal` the existing tests pass through — `undefined` when none.)

Run: `cd apps/user-client && pnpm vitest run tests/tools/generate-image.test.ts`
Expected: FAIL (type error or the clamp still uses the old `maxCountFor`).

- [ ] **Step 2: Tool uses the slot's maxCount**

In `apps/user-client/src/tools/generate-image.ts`:

1. Replace the import block

```ts
import {
  type GenerateImagesResult,
  type ImageModelConfig,
  maxCountFor,
} from '@chatsundere/llm-unified';
```

with

```ts
import type { GenerateImagesResult, ImageModelConfig } from '@chatsundere/llm-unified';
```

2. In `interface ImageGenerationSlot`, after `config: ImageModelConfig;` add:

```ts
  /** Per-call image cap from the offering's descriptor. */
  maxCount: number;
```

3. Replace `clampCount`:

```ts
function clampCount(raw: unknown, max: number): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : 1;
  return Math.min(Math.max(1, n), max);
}
```

4. Change its call site from `clampCount(args.count, slot.config)` to `clampCount(args.count, slot.maxCount)`.

- [ ] **Step 3: Row and artefact types**

In `apps/user-client/src/boot/client-data-db.ts`:

1. Extend the existing `@chatsundere/llm-unified` type import with `LegacyImageModelConfig`.
2. Directly above the settings row interface that contains `imageGeneration`, add:

```ts
/**
 * One stored image-generation slot. `config` may still be a pre-2026-10-07
 * legacy shape (synced from an older device); readers pass the slot through
 * `upgradeImageSlot` before use.
 */
export interface StoredImageSlot {
  ref: string;
  config: ImageModelConfig | LegacyImageModelConfig;
  lastConfigByRef?: Record<string, ImageModelConfig>;
}
```

3. Replace

```ts
  imageGeneration: {
    primary: { ref: string; config: ImageModelConfig } | null;
    nsfw: { ref: string; config: ImageModelConfig } | null;
  };
```

with

```ts
  imageGeneration: {
    primary: StoredImageSlot | null;
    nsfw: StoredImageSlot | null;
  };
```

4. In the generated-image artefact type, change `configSnapshot: ImageModelConfig;` to `configSnapshot: ImageModelConfig | LegacyImageModelConfig;` (older rows carry legacy snapshots; the field is provenance only and is never read back).

In `apps/user-client/src/data/artefacts.ts` (~line 104) make the same change to `configSnapshot`, importing `LegacyImageModelConfig` from `@chatsundere/llm-unified` alongside `ImageModelConfig`.

- [ ] **Step 4: Send path resolves through the descriptor**

In `apps/user-client/src/data/send-message.ts`:

1. In the `@chatsundere/llm-unified` value import, remove `isImageModelConfig` and add `getTtiDescriptor` and `upgradeImageSlot`. In the type import, add `TtiDescriptor`.
2. Change `ResolvedImageSlot` to:

```ts
interface ResolvedImageSlot {
  slot: ImageGenerationSlot;
  base: ImageRequestBase;
  slug: string;
  meta: TtiDescriptor;
}
```

3. Replace the start of `resolveImageSlot` — its signature and everything up to and including the line `if (!isImageModelConfig(stored.config)) return null;` — with:

```ts
async function resolveImageSlot(
  stored: unknown,
  mk: MasterKey,
): Promise<ResolvedImageSlot | null> {
  // Upgrades legacy shapes synced from older devices; null = junk or retired model.
  const upgraded = upgradeImageSlot(stored, getTtiDescriptor);
  if (!upgraded) return null;
  const idx = upgraded.ref.indexOf(':');
  const templateId = upgraded.ref.slice(0, idx);
  const slug = upgraded.ref.slice(idx + 1);

  const providerDef = getProvider(templateId);
  const offering = getOffering(templateId, slug);
  if (!providerDef || !offering || offering.serviceKind !== 'tti' || !offering.tti) return null;
  const meta = offering.tti;
```

4. In the `return { slot: { … }, base: { … } }` at the end of `resolveImageSlot`, change the `slot` object to:

```ts
    slot: {
      ref: upgraded.ref,
      modelLabel: meta.displayName,
      canDoNsfw: meta.canDoNsfw,
      config: upgraded.config,
      maxCount: meta.maxCount,
    },
```

and add `slug,` and `meta,` as siblings of `slot` and `base` in that returned object.

5. In `resolveImageGeneration`, replace

```ts
  const baseByRef = new Map<string, ImageRequestBase>();
  if (primary) baseByRef.set(primary.slot.ref, primary.base);
  if (nsfw) baseByRef.set(nsfw.slot.ref, nsfw.base);
```

with

```ts
  const resolvedByRef = new Map<string, ResolvedImageSlot>();
  if (primary) resolvedByRef.set(primary.slot.ref, primary);
  if (nsfw) resolvedByRef.set(nsfw.slot.ref, nsfw);
```

and the `generate` closure with:

```ts
    generate: (slot, prompt, count, signal) => {
      const resolved = resolvedByRef.get(slot.ref);
      if (!resolved) return Promise.reject(new Error('image slot base missing'));
      return generateImages({
        ...resolved.base,
        slug: resolved.slug,
        meta: resolved.meta,
        config: slot.config,
        prompt,
        count,
        signal,
      });
    },
```

Leave `persistImage` unchanged in this task (Task 7 adds transcoding).

- [ ] **Step 5: Run to verify pass**

Run: `cd apps/user-client && pnpm vitest run tests/tools/generate-image.test.ts` → PASS.
Run: `cd apps/user-client && pnpm vitest run tests/unit tests/tools tests/components/ImagePill.test.tsx tests/components/lightbox-artefact.test.tsx` → PASS (their legacy `configSnapshot` fixtures still type as `LegacyImageModelConfig`).
`apps/user-client` typecheck still fails in `components/image-gen/*` — expected until Task 9.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client
git commit -m "Resolve image slots through TTI descriptors in the send path" -m "Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 7: Transcode generated PNGs to JPEG at full resolution

**Files:**
- Create: `apps/user-client/src/attachments/image-transcode.ts`
- Test: `apps/user-client/tests/unit/image-transcode.test.ts`
- Modify: `apps/user-client/src/data/send-message.ts` (`persistImage` in `resolveImageGeneration`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `shouldTranscode(mime: string): boolean`
  - `type JpegEncoder = (blob: Blob) => Promise<Blob>`
  - `canvasJpegEncoder: JpegEncoder`
  - `transcodeGeneratedImage(item: { bytes: Blob; mime: string }, encode?: JpegEncoder): Promise<{ bytes: Blob; mime: string }>`

- [ ] **Step 1: Write the failing tests**

`apps/user-client/tests/unit/image-transcode.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { shouldTranscode, transcodeGeneratedImage } from '../../src/attachments/image-transcode.js';

describe('shouldTranscode', () => {
  it('only PNG is transcoded', () => {
    expect(shouldTranscode('image/png')).toBe(true);
    expect(shouldTranscode('IMAGE/PNG')).toBe(true);
    expect(shouldTranscode('image/png; charset=binary')).toBe(true);
    expect(shouldTranscode('image/jpeg')).toBe(false);
    expect(shouldTranscode('image/webp')).toBe(false);
    expect(shouldTranscode('application/octet-stream')).toBe(false);
  });
});

describe('transcodeGeneratedImage', () => {
  it('sends a PNG through the encoder and returns a JPEG', async () => {
    const png = new Blob([new Uint8Array(10)], { type: 'image/png' });
    const jpeg = new Blob([new Uint8Array(3)], { type: 'image/jpeg' });
    const encode = vi.fn(async () => jpeg);
    const out = await transcodeGeneratedImage({ bytes: png, mime: 'image/png' }, encode);
    expect(encode).toHaveBeenCalledWith(png);
    expect(out).toEqual({ bytes: jpeg, mime: 'image/jpeg' });
  });

  it('passes a JPEG through untouched without calling the encoder', async () => {
    const jpeg = new Blob([new Uint8Array(3)], { type: 'image/jpeg' });
    const encode = vi.fn(async () => jpeg);
    const item = { bytes: jpeg, mime: 'image/jpeg' };
    expect(await transcodeGeneratedImage(item, encode)).toBe(item);
    expect(encode).not.toHaveBeenCalled();
  });

  it('keeps the original PNG when the encoder fails', async () => {
    const png = new Blob([new Uint8Array(10)], { type: 'image/png' });
    const item = { bytes: png, mime: 'image/png' };
    const out = await transcodeGeneratedImage(item, async () => {
      throw new Error('out of memory');
    });
    expect(out).toBe(item);
  });

  it('keeps the original PNG when OffscreenCanvas is missing (default encoder)', async () => {
    // jsdom has neither createImageBitmap nor OffscreenCanvas, so the real
    // encoder throws — the fallback must still return the original.
    const png = new Blob([new Uint8Array(10)], { type: 'image/png' });
    const item = { bytes: png, mime: 'image/png' };
    expect(await transcodeGeneratedImage(item)).toBe(item);
  });
});
```

Run: `cd apps/user-client && pnpm vitest run tests/unit/image-transcode.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement**

`apps/user-client/src/attachments/image-transcode.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

/** JPEG quality for transcoded generated images — high, since this is art. */
const JPEG_QUALITY = 0.92;

/** Turns an image blob into a JPEG blob; injectable for tests. */
export type JpegEncoder = (blob: Blob) => Promise<Blob>;

/** Only PNGs are transcoded; JPEG and WebP are already compact. */
export function shouldTranscode(mime: string): boolean {
  return mime.toLowerCase().startsWith('image/png');
}

/**
 * Decode and re-encode as JPEG at the ORIGINAL size (no downscaling — unlike
 * attachment normalisation, a generated image is the user's artwork). Alpha is
 * flattened onto white, as in image-normalise.ts. Not testable in jsdom (no
 * canvas); covered by manual verification.
 */
export const canvasJpegEncoder: JpegEncoder = async (blob) => {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, 0, 0);
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
  } finally {
    bitmap.close();
  }
};

/**
 * Some image models answer with 7–10 MB PNGs; as JPEG they shrink roughly
 * tenfold, which matters for storage and the encrypted sync quota. Any failure
 * (decode, memory, missing OffscreenCanvas) keeps the original — the image is
 * never lost, only larger.
 */
export async function transcodeGeneratedImage(
  item: { bytes: Blob; mime: string },
  encode: JpegEncoder = canvasJpegEncoder,
): Promise<{ bytes: Blob; mime: string }> {
  if (!shouldTranscode(item.mime)) return item;
  try {
    return { bytes: await encode(item.bytes), mime: 'image/jpeg' };
  } catch {
    return item;
  }
}
```

- [ ] **Step 3: Transcode before persisting**

In `apps/user-client/src/data/send-message.ts`, import `transcodeGeneratedImage` from `'../attachments/image-transcode.js'`, then replace the `persistImage` closure in `resolveImageGeneration` with:

```ts
    persistImage: async (item, meta) => {
      // Sequential by construction: the tool awaits each persist in turn, so
      // at most one full-size bitmap is decoded at a time.
      const stored = await transcodeGeneratedImage(item);
      const { thumbBlob, width, height } = await thumbnailFromBlob(stored.bytes);
      return addGeneratedImageArtefact({
        chatId,
        personaId: persona.id,
        prompt: meta.prompt,
        modelRef: meta.slot.ref,
        modelLabel: meta.slot.modelLabel,
        configSnapshot: meta.slot.config,
        bytes: stored.bytes,
        mime: stored.mime,
        thumbBlob,
        width,
        height,
      });
    },
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/user-client && pnpm vitest run tests/unit/image-transcode.test.ts tests/tools/generate-image.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client
git commit -m "Transcode generated PNG images to JPEG at full resolution" -m "Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 8: Pure picker model (families, variants, stale slots)

**Files:**
- Create: `apps/user-client/src/components/image-gen/tti-picker-model.ts`
- Test: `apps/user-client/tests/components/tti-picker-model.test.ts`

**Interfaces:**
- Consumes: `TtiDescriptor` type; `listTtiOfferings`, `getProvider` from `@chatsundere/llm-unified` (passed in as data, not imported by the pure functions).
- Produces:

```ts
export interface PickerOffering {
  ref: string;
  providerId: string;
  providerName: string;
  meta: TtiDescriptor;
  usable: boolean;
  /** null when usable. */
  reason: string | null;
}
export interface PickerFamily {
  family: string;
  /** Every offering of the family (after the nsfw filter), in catalogue order. */
  offerings: PickerOffering[];
  usable: boolean;
  /** The saved slot's offering is in this family. */
  selected: boolean;
  /** Why the family is unusable (its first offering's reason); null when usable. */
  reason: string | null;
}
export interface VariantEntry {
  ref: string;
  label: string;
  disabled: boolean;
  selected: boolean;
  reason: string | null;
}
export function buildPickerFamilies(input: {
  offerings: ReadonlyArray<{ providerId: string; upstreamSlug: string; tti?: TtiDescriptor }>;
  usableTemplateIds: readonly string[];
  providerName: (providerId: string) => string;
  reasonFor: (providerId: string) => string;
  nsfwOnly: boolean;
  savedRef: string | null;
}): PickerFamily[];
export function familyTapTarget(family: PickerFamily, savedRef: string | null): string | null;
export function variantEntries(family: PickerFamily, savedRef: string | null): VariantEntry[];
```

- [ ] **Step 1: Write the failing tests**

`apps/user-client/tests/components/tti-picker-model.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { TtiDescriptor } from '@chatsundere/llm-unified';
import { describe, expect, it } from 'vitest';
import {
  buildPickerFamilies,
  familyTapTarget,
  variantEntries,
} from '../../src/components/image-gen/tti-picker-model.js';

function d(family: string, variant: string | null, over: Partial<TtiDescriptor> = {}): TtiDescriptor {
  return {
    family,
    variant,
    displayName: variant ? `${family} ${variant}` : family,
    canDoNsfw: false,
    maxCount: 4,
    timeoutMs: 1000,
    aspects: ['1:1'],
    resolutions: null,
    qualities: null,
    priceCents: { '-|-': 1 },
    billing: 'fixed',
    defaults: { aspect: '1:1', resolution: null, quality: null },
    wire: { kind: 'aspect-resolution', sendResolution: false, responseFormat: 'url' },
    perItemModeration: false,
    ...over,
  };
}

const OFFERINGS = [
  { providerId: 'xai', upstreamSlug: 'grok-1', tti: d('Grok Imagine', '1') },
  { providerId: 'nano', upstreamSlug: 'sd-45', tti: d('Seedream', '4.5') },
  { providerId: 'nano', upstreamSlug: 'sd-flash', tti: d('Seedream', '5.0 Flash', { recommended: true }) },
  { providerId: 'nano', upstreamSlug: 'sd-pro', tti: d('Seedream', '5.0 Pro', { canDoNsfw: true }) },
  { providerId: 'nano', upstreamSlug: 'flux', tti: d('FLUX.3', null) },
  { providerId: 'nano', upstreamSlug: 'grok-2', tti: d('Grok Imagine', '2.0', { recommended: true }) },
];

const NAMES: Record<string, string> = { xai: 'xAI', nano: 'nano-gpt' };
const base = {
  offerings: OFFERINGS,
  providerName: (id: string) => NAMES[id] ?? id,
  reasonFor: (id: string) => `${NAMES[id] ?? id} is not set up — add it under Upstream Providers above`,
  nsfwOnly: false,
};

describe('buildPickerFamilies', () => {
  it('groups by family, alphabetically, keeping catalogue order inside', () => {
    const fams = buildPickerFamilies({ ...base, usableTemplateIds: ['xai', 'nano'], savedRef: null });
    expect(fams.map((f) => f.family)).toEqual(['FLUX.3', 'Grok Imagine', 'Seedream']);
    expect(fams[1]?.offerings.map((o) => o.ref)).toEqual(['xai:grok-1', 'nano:grok-2']);
  });

  it('keeps families without a usable provider, marked unusable with a reason', () => {
    const fams = buildPickerFamilies({ ...base, usableTemplateIds: ['xai'], savedRef: null });
    const flux = fams.find((f) => f.family === 'FLUX.3');
    expect(flux?.usable).toBe(false);
    expect(flux?.reason).toBe('nano-gpt is not set up — add it under Upstream Providers above');
    expect(fams.find((f) => f.family === 'Grok Imagine')?.usable).toBe(true);
  });

  it('nsfwOnly drops incapable offerings and empty families', () => {
    const fams = buildPickerFamilies({
      ...base,
      nsfwOnly: true,
      usableTemplateIds: ['xai', 'nano'],
      savedRef: null,
    });
    expect(fams.map((f) => f.family)).toEqual(['Seedream']);
    expect(fams[0]?.offerings.map((o) => o.ref)).toEqual(['nano:sd-pro']);
  });

  it('marks the family holding the saved ref as selected', () => {
    const fams = buildPickerFamilies({ ...base, usableTemplateIds: ['nano'], savedRef: 'nano:sd-45' });
    expect(fams.find((f) => f.selected)?.family).toBe('Seedream');
  });
});

describe('familyTapTarget', () => {
  const usable = buildPickerFamilies({ ...base, usableTemplateIds: ['xai', 'nano'], savedRef: null });
  const seedream = usable.find((f) => f.family === 'Seedream');
  const grok = usable.find((f) => f.family === 'Grok Imagine');

  it('picks the recommended usable variant', () => {
    if (!seedream) throw new Error('fixture');
    expect(familyTapTarget(seedream, null)).toBe('nano:sd-flash');
  });
  it('is a no-op when the saved offering is in the family and usable', () => {
    if (!seedream) throw new Error('fixture');
    expect(familyTapTarget(seedream, 'nano:sd-45')).toBeNull();
  });
  it('falls back to the first usable variant when nothing is recommended', () => {
    const flux = usable.find((f) => f.family === 'FLUX.3');
    if (!flux) throw new Error('fixture');
    expect(familyTapTarget(flux, null)).toBe('nano:flux');
  });
  it('moves a stale saved offering to a usable variant (no closed loop)', () => {
    const stale = buildPickerFamilies({ ...base, usableTemplateIds: ['nano'], savedRef: 'xai:grok-1' }).find(
      (f) => f.family === 'Grok Imagine',
    );
    if (!stale || !grok) throw new Error('fixture');
    expect(familyTapTarget(stale, 'xai:grok-1')).toBe('nano:grok-2');
  });
  it('returns null for a family with no usable offering', () => {
    const flux = buildPickerFamilies({ ...base, usableTemplateIds: ['xai'], savedRef: null }).find(
      (f) => f.family === 'FLUX.3',
    );
    if (!flux) throw new Error('fixture');
    expect(familyTapTarget(flux, null)).toBeNull();
  });
});

describe('variantEntries', () => {
  it('lists usable variants, suffixing the provider when the row spans providers', () => {
    const grok = buildPickerFamilies({ ...base, usableTemplateIds: ['xai', 'nano'], savedRef: 'nano:grok-2' }).find(
      (f) => f.family === 'Grok Imagine',
    );
    if (!grok) throw new Error('fixture');
    expect(variantEntries(grok, 'nano:grok-2')).toEqual([
      { ref: 'xai:grok-1', label: '1 · xAI', disabled: false, selected: false, reason: null },
      { ref: 'nano:grok-2', label: '2.0 · nano-gpt', disabled: false, selected: true, reason: null },
    ]);
  });
  it('omits unusable variants but keeps the stale saved one, greyed, with its reason', () => {
    const grok = buildPickerFamilies({ ...base, usableTemplateIds: ['nano'], savedRef: 'xai:grok-1' }).find(
      (f) => f.family === 'Grok Imagine',
    );
    if (!grok) throw new Error('fixture');
    expect(variantEntries(grok, 'xai:grok-1')).toEqual([
      {
        ref: 'xai:grok-1',
        label: '1 · xAI',
        disabled: true,
        selected: true,
        reason: 'xAI is not set up — add it under Upstream Providers above',
      },
      { ref: 'nano:grok-2', label: '2.0 · nano-gpt', disabled: false, selected: false, reason: null },
    ]);
  });
  it('single-provider rows carry no suffix; latencyHint is appended', () => {
    const fams = buildPickerFamilies({
      ...base,
      offerings: [
        { providerId: 'nano', upstreamSlug: 'zt', tti: d('Z-Image', 'Turbo') },
        { providerId: 'nano', upstreamSlug: 'zb', tti: d('Z-Image', 'Base', { latencyHint: '~10× slower' }) },
      ],
      usableTemplateIds: ['nano'],
      savedRef: 'nano:zt',
    });
    const z = fams[0];
    if (!z) throw new Error('fixture');
    expect(variantEntries(z, 'nano:zt').map((e) => e.label)).toEqual(['Turbo', 'Base · ~10× slower']);
  });
});
```

Run: `cd apps/user-client && pnpm vitest run tests/components/tti-picker-model.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement**

`apps/user-client/src/components/image-gen/tti-picker-model.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { TtiDescriptor } from '@chatsundere/llm-unified';

export interface PickerOffering {
  ref: string;
  providerId: string;
  providerName: string;
  meta: TtiDescriptor;
  usable: boolean;
  /** null when usable. */
  reason: string | null;
}

export interface PickerFamily {
  family: string;
  /** Every offering of the family (after the nsfw filter), in catalogue order. */
  offerings: PickerOffering[];
  usable: boolean;
  /** The saved slot's offering is in this family. */
  selected: boolean;
  /** Why the family is unusable (its first offering's reason); null when usable. */
  reason: string | null;
}

export interface VariantEntry {
  ref: string;
  label: string;
  disabled: boolean;
  selected: boolean;
  reason: string | null;
}

/**
 * Group TTI offerings into picker families (spec §3.1). Families without a
 * usable provider are kept and marked unusable — disabled over hidden.
 */
export function buildPickerFamilies(input: {
  offerings: ReadonlyArray<{ providerId: string; upstreamSlug: string; tti?: TtiDescriptor }>;
  usableTemplateIds: readonly string[];
  providerName: (providerId: string) => string;
  reasonFor: (providerId: string) => string;
  nsfwOnly: boolean;
  savedRef: string | null;
}): PickerFamily[] {
  const byFamily = new Map<string, PickerOffering[]>();
  for (const o of input.offerings) {
    const meta = o.tti;
    if (!meta) continue;
    if (input.nsfwOnly && !meta.canDoNsfw) continue;
    const usable = input.usableTemplateIds.includes(o.providerId);
    const entry: PickerOffering = {
      ref: `${o.providerId}:${o.upstreamSlug}`,
      providerId: o.providerId,
      providerName: input.providerName(o.providerId),
      meta,
      usable,
      reason: usable ? null : input.reasonFor(o.providerId),
    };
    const list = byFamily.get(meta.family) ?? [];
    list.push(entry);
    byFamily.set(meta.family, list);
  }
  return [...byFamily.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([family, offerings]) => {
      const usable = offerings.some((o) => o.usable);
      return {
        family,
        offerings,
        usable,
        selected: offerings.some((o) => o.ref === input.savedRef),
        reason: usable ? null : (offerings[0]?.reason ?? null),
      };
    });
}

/**
 * The ref a tap on `family` should select, or null for "no change". A tap is a
 * no-op only when the saved offering is in this family AND usable — a stale
 * saved offering moves to a usable variant, so the user is never stuck.
 */
export function familyTapTarget(family: PickerFamily, savedRef: string | null): string | null {
  const saved = family.offerings.find((o) => o.ref === savedRef);
  if (saved?.usable) return null;
  const usable = family.offerings.filter((o) => o.usable);
  return (usable.find((o) => o.meta.recommended) ?? usable[0])?.ref ?? null;
}

/**
 * The Variant row: usable offerings plus the saved one when stale (greyed,
 * with its reason). The provider is appended only when the row spans several
 * providers; a latency hint is appended when the descriptor has one.
 */
export function variantEntries(family: PickerFamily, savedRef: string | null): VariantEntry[] {
  const shown = family.offerings.filter((o) => o.usable || o.ref === savedRef);
  const spansProviders = new Set(shown.map((o) => o.providerId)).size > 1;
  return shown.map((o) => {
    const parts = [o.meta.variant ?? o.meta.displayName];
    if (spansProviders) parts.push(o.providerName);
    if (o.meta.latencyHint) parts.push(o.meta.latencyHint);
    return {
      ref: o.ref,
      label: parts.join(' · '),
      disabled: !o.usable,
      selected: o.ref === savedRef,
      reason: o.reason,
    };
  });
}
```

- [ ] **Step 3: Run to verify pass**

Run: `cd apps/user-client && pnpm vitest run tests/components/tti-picker-model.test.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/components/image-gen/tti-picker-model.ts apps/user-client/tests/components/tti-picker-model.test.ts
git commit -m "Add the family-first image picker model" -m "Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 9: Picker, config view and section UI

After this task the full typecheck gate is green again.

**Files:**
- Rewrite: `apps/user-client/src/components/image-gen/TtiModelSelect.tsx`
- Rewrite: `apps/user-client/src/components/image-gen/config-views.tsx`
- Rewrite: `apps/user-client/src/components/image-gen/ImageGenerationSection.tsx`
- Rewrite: `apps/user-client/tests/components/image-gen-section.test.tsx`

**Interfaces:**
- Consumes: Task 8 (`buildPickerFamilies`, `familyTapTarget`, `variantEntries`, `PickerFamily`, `VariantEntry`); from `@chatsundere/llm-unified`: `listTtiOfferings`, `getProvider`, `getTtiDescriptor`, `upgradeImageSlot`, `carryOverConfig`, `isValidConfigFor`, `priceCentsFor`, `latencyFor`, `formatPriceCents`, `ImageModelConfig`, `ImageSlot`, `TtiDescriptor`; `usableTemplateIds` from `../../lib/usable-providers.js`; `StoredImageSlot` from `../../boot/client-data-db.js`.
- Produces: the UI. Persisted value per slot is an `ImageSlot` (`{ ref, config, lastConfigByRef? }`).

- [ ] **Step 1: Write the failing section tests**

Replace the whole of `apps/user-client/tests/components/image-gen-section.test.tsx` with:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mutateMock = vi.fn();
let settingsRow: Record<string, unknown> | undefined;
let providerRows: Array<{ templateId: string; enabled: boolean; createdAt: number; apiKey?: unknown }>;

vi.mock('../../src/data/settings.js', () => ({
  useSettings: () => ({ data: settingsRow }),
  useUpdateSettings: () => ({ mutate: mutateMock, mutateAsync: vi.fn() }),
}));
vi.mock('../../src/data/providers.js', () => ({ useProviders: () => ({ data: providerRows }) }));
vi.mock('../../src/lib/server-gate.js', () => ({
  // xai requires the relay; an enabled 'proxy' gate makes it usable.
  useServerGate: () => ({ enabled: true, reason: null, tooltip: null }),
}));

import { ImageGenerationSection } from '../../src/components/image-gen/ImageGenerationSection.js';

const PROXY = { url: 'https://proxy.example', sharedKey: { version: 1 } };

function providers(...ids: string[]) {
  providerRows = ids.map((templateId, i) => ({ templateId, enabled: true, createdAt: i, apiKey: {} }));
}

function lastPersisted(): { primary: Record<string, unknown> | null; nsfw: unknown } {
  const call = mutateMock.mock.calls.at(-1);
  if (!call) throw new Error('nothing persisted');
  return (call[0] as { imageGeneration: { primary: Record<string, unknown> | null; nsfw: unknown } })
    .imageGeneration;
}

function primarySection(): HTMLElement {
  return screen.getByTestId('image-slot-primary');
}

beforeEach(() => {
  mutateMock.mockClear();
  settingsRow = { corsProxy: PROXY, imageGeneration: { primary: null, nsfw: null } };
  providers('xai', 'nano-gpt');
});

describe('ImageGenerationSection — picker', () => {
  it('shows one button per family, alphabetically', () => {
    render(<ImageGenerationSection />);
    const names = within(primarySection())
      .getAllByRole('button', { name: /^(FLUX\.3|GPT Image 2|Grok Imagine|MiniMax H3|Nano Banana 2\.1|Qwen Image|Seedream|Z-Image)$/ })
      .map((b) => b.textContent);
    expect(names).toEqual([
      'FLUX.3',
      'GPT Image 2',
      'Grok Imagine',
      'MiniMax H3',
      'Nano Banana 2.1',
      'Qwen Image',
      'Seedream',
      'Z-Image',
    ]);
  });

  it('a family tap persists its recommended variant with that variant defaults', () => {
    render(<ImageGenerationSection />);
    fireEvent.click(within(primarySection()).getByRole('button', { name: 'Seedream' }));
    expect(lastPersisted().primary).toEqual({
      ref: 'nano-gpt:bytedance/seedream-v5.0-flash',
      config: { aspect: '1:1', resolution: '2k', quality: null },
      lastConfigByRef: {
        'nano-gpt:bytedance/seedream-v5.0-flash': { aspect: '1:1', resolution: '2k', quality: null },
      },
    });
  });

  it('greys out families whose provider is missing and explains on tap', () => {
    providers('xai');
    render(<ImageGenerationSection />);
    const flux = within(primarySection()).getByRole('button', { name: 'FLUX.3' });
    expect(flux).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(flux);
    expect(mutateMock).not.toHaveBeenCalled();
    expect(
      within(primarySection()).getByText(
        'FLUX.3 — nano-gpt is not set up — add it under Upstream Providers above.',
      ),
    ).toBeInTheDocument();
  });
});

describe('ImageGenerationSection — config view', () => {
  it('shows the identity line, a Variant row and priced resolutions', () => {
    settingsRow = {
      corsProxy: PROXY,
      imageGeneration: {
        primary: {
          ref: 'nano-gpt:bytedance/seedream-v5.0-flash',
          config: { aspect: '1:1', resolution: '2k', quality: null },
        },
        nsfw: null,
      },
    };
    render(<ImageGenerationSection />);
    const s = primarySection();
    expect(within(s).getByText('Seedream 5.0 Flash · nano-gpt · 2.7¢ per image')).toBeInTheDocument();
    expect(within(s).getByRole('button', { name: '5.0 Lite' })).toBeInTheDocument();
    expect(within(s).getByRole('button', { name: '2k · 2.7¢' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(s).getByText('Estimated price per image, billed by the provider.')).toBeInTheDocument();
  });

  it('hides single-choice rows; a flat price lives in the identity line', () => {
    settingsRow = {
      corsProxy: PROXY,
      imageGeneration: {
        primary: {
          ref: 'nano-gpt:bytedance/seedream-v5.0-pro',
          config: { aspect: '1:1', resolution: null, quality: null },
        },
        nsfw: null,
      },
    };
    render(<ImageGenerationSection />);
    const s = primarySection();
    expect(within(s).getByText('Seedream 5.0 Pro · nano-gpt · 9¢ per image')).toBeInTheDocument();
    expect(within(s).queryByText('Resolution')).toBeNull();
    expect(within(s).queryByText('Quality')).toBeNull();
  });

  it('quality buttons carry latency hints and resolution prices follow quality', () => {
    settingsRow = {
      corsProxy: PROXY,
      imageGeneration: {
        primary: {
          ref: 'nano-gpt:xai/grok-imagine-image/v2.0/text-to-image',
          config: { aspect: '1:1', resolution: '1k', quality: 'medium' },
        },
        nsfw: null,
      },
    };
    render(<ImageGenerationSection />);
    const s = primarySection();
    expect(within(s).getByRole('button', { name: 'Low · ~20 s' })).toBeInTheDocument();
    expect(within(s).getByRole('button', { name: 'Medium · ~70 s' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(s).getByRole('button', { name: '2k · 8¢' })).toBeInTheDocument();
  });

  it('usage-billed prices carry a tilde', () => {
    settingsRow = {
      corsProxy: PROXY,
      imageGeneration: {
        primary: {
          ref: 'nano-gpt:nano-banana-2.1',
          config: { aspect: '1:1', resolution: '1k', quality: 'minimal' },
        },
        nsfw: null,
      },
    };
    render(<ImageGenerationSection />);
    expect(within(primarySection()).getByText('Nano Banana 2.1 · nano-gpt · ~6.1¢ per image')).toBeInTheDocument();
  });

  it('a config change merges into the slot and remembers it per offering', () => {
    settingsRow = {
      corsProxy: PROXY,
      imageGeneration: {
        primary: {
          ref: 'nano-gpt:black-forest-labs/flux-3/text-to-image',
          config: { aspect: '1:1', resolution: '1k', quality: null },
        },
        nsfw: null,
      },
    };
    render(<ImageGenerationSection />);
    fireEvent.click(within(primarySection()).getByRole('button', { name: '16:9' }));
    expect(lastPersisted().primary).toEqual({
      ref: 'nano-gpt:black-forest-labs/flux-3/text-to-image',
      config: { aspect: '16:9', resolution: '1k', quality: null },
      lastConfigByRef: {
        'nano-gpt:black-forest-labs/flux-3/text-to-image': { aspect: '16:9', resolution: '1k', quality: null },
      },
    });
  });

  it('a variant switch carries over what fits', () => {
    settingsRow = {
      corsProxy: PROXY,
      imageGeneration: {
        primary: {
          ref: 'nano-gpt:bytedance/seedream-v5.0-flash',
          config: { aspect: '16:9', resolution: '2k', quality: null },
        },
        nsfw: null,
      },
    };
    render(<ImageGenerationSection />);
    fireEvent.click(within(primarySection()).getByRole('button', { name: '5.0 Lite' }));
    expect(lastPersisted().primary).toMatchObject({
      ref: 'nano-gpt:seedream-v5.0-lite',
      config: { aspect: '16:9', resolution: null, quality: null },
    });
  });

  it('coming back to an offering restores its remembered config', () => {
    settingsRow = {
      corsProxy: PROXY,
      imageGeneration: {
        primary: {
          ref: 'nano-gpt:qwen-image-2.1/text-to-image',
          config: { aspect: '1:1', resolution: '1k', quality: null },
          lastConfigByRef: {
            'nano-gpt:gpt-image-2': { aspect: '16:9', resolution: '2k', quality: 'high' },
          },
        },
        nsfw: null,
      },
    };
    render(<ImageGenerationSection />);
    fireEvent.click(within(primarySection()).getByRole('button', { name: 'GPT Image 2' }));
    expect(lastPersisted().primary).toMatchObject({
      ref: 'nano-gpt:gpt-image-2',
      config: { aspect: '16:9', resolution: '2k', quality: 'high' },
    });
  });

  it('a remembered config that no longer fits is ignored (carry-over instead)', () => {
    settingsRow = {
      corsProxy: PROXY,
      imageGeneration: {
        primary: {
          ref: 'nano-gpt:qwen-image-2.1/text-to-image',
          config: { aspect: '16:9', resolution: '1k', quality: null },
          lastConfigByRef: {
            'nano-gpt:gpt-image-2': { aspect: '16:9', resolution: '8k', quality: 'ultra' },
          },
        },
        nsfw: null,
      },
    };
    render(<ImageGenerationSection />);
    fireEvent.click(within(primarySection()).getByRole('button', { name: 'GPT Image 2' }));
    expect(lastPersisted().primary).toMatchObject({
      ref: 'nano-gpt:gpt-image-2',
      config: { aspect: '16:9', resolution: '1k', quality: 'medium' },
    });
  });
});

describe('ImageGenerationSection — stale and legacy slots', () => {
  it('a stale xAI slot stays visible, greyed, and a family tap moves to nano-gpt', () => {
    providers('nano-gpt');
    settingsRow = {
      corsProxy: PROXY,
      imageGeneration: {
        primary: { ref: 'xai:grok-imagine-image', config: { aspect: '1:1', resolution: '2k', quality: 'normal' } },
        nsfw: null,
      },
    };
    render(<ImageGenerationSection />);
    const s = primarySection();
    const family = within(s).getByRole('button', { name: 'Grok Imagine' });
    expect(family).toHaveAttribute('aria-pressed', 'true');
    const stale = within(s).getByRole('button', { name: '1 · xAI' });
    expect(stale).toHaveAttribute('aria-disabled', 'true');
    expect(
      within(s).getByText('Grok Imagine · xAI — xAI is not set up — add it under Upstream Providers above'),
    ).toBeInTheDocument();
    fireEvent.click(family);
    expect(lastPersisted().primary).toMatchObject({
      ref: 'nano-gpt:xai/grok-imagine-image/v2.0/text-to-image',
    });
  });

  it('renders a legacy slot synced from an older device', () => {
    settingsRow = {
      corsProxy: PROXY,
      imageGeneration: {
        primary: { ref: 'nano-gpt:seedream-v4.5', config: { groupId: 'seedream', aspect: '1:1', quality: 'high' } },
        nsfw: null,
      },
    };
    render(<ImageGenerationSection />);
    expect(within(primarySection()).getByRole('button', { name: '2.2k · 4¢' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('the NSFW slot still says it lights up automatically', () => {
    render(<ImageGenerationSection />);
    expect(screen.getByText(/lights up automatically/)).toBeInTheDocument();
  });

  it('clearing the primary slot persists null and keeps the nsfw slot', () => {
    settingsRow = {
      corsProxy: PROXY,
      imageGeneration: {
        primary: { ref: 'nano-gpt:gpt-image-2', config: { aspect: '1:1', resolution: '1k', quality: 'medium' } },
        nsfw: null,
      },
    };
    render(<ImageGenerationSection />);
    fireEvent.click(within(primarySection()).getByRole('button', { name: 'Clear selection' }));
    expect(mutateMock).toHaveBeenCalledWith({ imageGeneration: { primary: null, nsfw: null } });
  });
});
```

Run: `cd apps/user-client && pnpm vitest run tests/components/image-gen-section.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Rewrite the picker component**

Replace `apps/user-client/src/components/image-gen/TtiModelSelect.tsx` with:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from 'react';
import type { PickerFamily } from './tti-picker-model.js';

interface Props {
  families: PickerFamily[];
  /** True when no image provider is usable at all (shows the empty-state copy). */
  noUsableProvider: boolean;
  onTapFamily: (family: PickerFamily) => void;
  onClear: () => void;
  hasSelection: boolean;
  disabled?: boolean;
}

/**
 * Family-first picker (spec §3.1): one button per family. Unusable families
 * stay visible (disabled over hidden); a tap on one explains why instead of
 * selecting. The selected family is marked with aria-pressed.
 */
export function TtiModelSelect({
  families,
  noUsableProvider,
  onTapFamily,
  onClear,
  hasSelection,
  disabled = false,
}: Props): JSX.Element {
  const [explained, setExplained] = useState<string | null>(null);

  return (
    <div>
      {noUsableProvider ? (
        <p className="mb-2 rounded-md border border-white/5 bg-white/[0.02] p-3 text-sm text-paper-soft">
          No image-capable provider configured yet — add one under Upstream Providers above to begin.
        </p>
      ) : null}
      <div className="flex items-start gap-2">
        <div className="flex flex-1 flex-wrap gap-1.5">
          {families.map((f) => (
            <button
              key={f.family}
              type="button"
              disabled={disabled}
              aria-pressed={f.selected}
              aria-disabled={f.usable ? undefined : true}
              onClick={() => {
                if (!f.usable) {
                  setExplained(`${f.family} — ${f.reason ?? 'unavailable'}.`);
                  return;
                }
                setExplained(null);
                onTapFamily(f);
              }}
              className={`rounded-md border px-3 py-2 text-left text-sm disabled:opacity-50 ${
                f.selected
                  ? 'border-paper/40 bg-white/[0.08] text-paper'
                  : 'border-white/5 bg-white/[0.02] text-paper-soft hover:bg-white/[0.04]'
              } ${f.usable ? '' : 'opacity-50'}`}
            >
              <span className="font-display">{f.family}</span>
            </button>
          ))}
        </div>
        {hasSelection ? (
          <button
            type="button"
            aria-label="Clear selection"
            disabled={disabled}
            onClick={onClear}
            className="rounded-full p-2 text-paper-soft hover:text-paper disabled:opacity-50"
          >
            ×
          </button>
        ) : null}
      </div>
      {explained ? <p className="mt-1.5 text-[11px] text-paper-soft">{explained}</p> : null}
    </div>
  );
}
```

- [ ] **Step 3: Rewrite the config view**

Replace `apps/user-client/src/components/image-gen/config-views.tsx` with:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import {
  type ImageModelConfig,
  type TtiDescriptor,
  formatPriceCents,
  latencyFor,
  priceCentsFor,
} from '@chatsundere/llm-unified';
import type { VariantEntry } from './tti-picker-model.js';

interface RowOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** One labelled row of mutually exclusive option buttons (aria-pressed marks the pick). */
function OptionRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<RowOption>;
  value: string | null;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-24 shrink-0 text-[11px] uppercase tracking-widest text-paper-soft">
        {label}
      </span>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          aria-disabled={o.disabled ? true : undefined}
          onClick={() => {
            if (!o.disabled) onChange(o.value);
          }}
          className={`rounded-md border px-2.5 py-1 text-xs ${
            o.value === value
              ? 'border-paper/40 bg-white/[0.08] text-paper'
              : 'border-white/5 bg-white/[0.02] text-paper-soft hover:bg-white/[0.04]'
          } ${o.disabled ? 'opacity-50' : ''}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface Props {
  meta: TtiDescriptor;
  providerName: string;
  config: ImageModelConfig;
  /** Set when the saved offering's provider is unusable. */
  staleReason: string | null;
  variants: VariantEntry[];
  onSelectVariant: (ref: string) => void;
  onChange: (config: ImageModelConfig) => void;
}

/**
 * The one config view for every image model (spec §3.2): identity line, then
 * Variant / Aspect / Resolution / Quality rows — each only when it offers more
 * than one choice.
 */
export function ImageModelConfigView({
  meta,
  providerName,
  config,
  staleReason,
  variants,
  onSelectVariant,
  onChange,
}: Props): JSX.Element {
  const price = priceCentsFor(meta, config);
  const identity = staleReason
    ? `${meta.displayName} · ${providerName} — ${staleReason}`
    : `${meta.displayName} · ${providerName}${
        price === undefined ? '' : ` · ${formatPriceCents(price, meta.billing)} per image`
      }`;

  const selectedVariant = variants.find((v) => v.selected)?.ref ?? null;
  const resolutions = meta.resolutions ?? [];
  const qualities = meta.qualities ?? [];

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-paper-soft">{identity}</p>
      {variants.length > 1 ? (
        <OptionRow
          label="Variant"
          options={variants.map((v) => ({ value: v.ref, label: v.label, disabled: v.disabled }))}
          value={selectedVariant}
          onChange={onSelectVariant}
        />
      ) : null}
      {meta.aspects.length > 1 ? (
        <OptionRow
          label="Aspect"
          options={meta.aspects.map((a) => ({ value: a, label: a }))}
          value={config.aspect}
          onChange={(aspect) => onChange({ ...config, aspect })}
        />
      ) : null}
      {resolutions.length > 1 ? (
        <OptionRow
          label="Resolution"
          options={resolutions.map((r) => {
            const cents = priceCentsFor(meta, { ...config, resolution: r.id });
            return {
              value: r.id,
              label: cents === undefined ? r.label : `${r.label} · ${formatPriceCents(cents, meta.billing)}`,
            };
          })}
          value={config.resolution}
          onChange={(resolution) => onChange({ ...config, resolution })}
        />
      ) : null}
      {qualities.length > 1 ? (
        <OptionRow
          label="Quality"
          options={qualities.map((q) => {
            const wait = latencyFor(meta, { ...config, quality: q.id });
            return { value: q.id, label: wait ? `${q.label} · ${wait}` : q.label };
          })}
          value={config.quality}
          onChange={(quality) => onChange({ ...config, quality })}
        />
      ) : null}
      <p className="text-[11px] text-paper-soft">Estimated price per image, billed by the provider.</p>
    </div>
  );
}
```

- [ ] **Step 4: Rewrite the section**

Replace `apps/user-client/src/components/image-gen/ImageGenerationSection.tsx` with:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import {
  type ImageModelConfig,
  type ImageSlot,
  carryOverConfig,
  getProvider,
  getTtiDescriptor,
  isValidConfigFor,
  listTtiOfferings,
  upgradeImageSlot,
} from '@chatsundere/llm-unified';
import type { StoredImageSlot } from '../../boot/client-data-db.js';
import { useProviders } from '../../data/providers.js';
import { useSettings, useUpdateSettings } from '../../data/settings.js';
import { useServerGate } from '../../lib/server-gate.js';
import { usableTemplateIds } from '../../lib/usable-providers.js';
import { TtiModelSelect } from './TtiModelSelect.js';
import { ImageModelConfigView } from './config-views.js';
import {
  type PickerFamily,
  buildPickerFamilies,
  familyTapTarget,
  variantEntries,
} from './tti-picker-model.js';

type Slot = ImageSlot | null;

const disabledRowClass =
  'rounded-md border border-white/5 bg-white/[0.02] p-3 text-sm text-paper-soft';

function providerName(id: string): string {
  return getProvider(id)?.displayName ?? id;
}

/** Select `ref` in a slot: remembered config if it still fits, else carry-over. */
function selectRef(prev: Slot, ref: string): Slot {
  const meta = getTtiDescriptor(ref);
  if (!meta) return prev;
  const remembered = prev?.lastConfigByRef?.[ref];
  const config: ImageModelConfig =
    remembered && isValidConfigFor(meta, remembered)
      ? remembered
      : prev
        ? carryOverConfig(prev.config, meta)
        : meta.defaults;
  return withConfig(prev, ref, config);
}

/** Store `config` as the slot's current config and remember it for `ref`. */
function withConfig(prev: Slot, ref: string, config: ImageModelConfig): ImageSlot {
  return { ref, config, lastConfigByRef: { ...(prev?.lastConfigByRef ?? {}), [ref]: config } };
}

/**
 * My Settings — image generation. Picks the global primary image model (and,
 * once one is curated, an NSFW-capable second slot) plus its config. Every
 * change persists immediately — not governed by the SaveBar (spec 2026-06-09
 * §6). Family-first picker per spec 2026-10-07 §3.
 */
export function ImageGenerationSection(): JSX.Element {
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  const { data: providerRows } = useProviders();
  const rows = providerRows ?? [];
  const hasProxy = useServerGate('proxy').enabled;
  const usable = usableTemplateIds(rows, hasProxy);

  const reasonFor = (id: string): string => {
    const name = providerName(id);
    const configured = rows.some((r) => r.templateId === id && r.enabled && r.apiKey !== null);
    return configured && getProvider(id)?.corsHint === 'requires-proxy' && !hasProxy
      ? `${name} needs the relay server`
      : `${name} is not set up — add it under Upstream Providers above`;
  };

  // Defensive: an older row may predate the v19 migration.
  const stored = settings?.imageGeneration ?? { primary: null, nsfw: null };
  const primary = upgradeImageSlot(stored.primary, getTtiDescriptor);
  const nsfw = upgradeImageSlot(stored.nsfw, getTtiDescriptor);

  const persist = (next: { primary: Slot | StoredImageSlot; nsfw: Slot | StoredImageSlot }) =>
    update.mutate({ imageGeneration: next });

  const offerings = listTtiOfferings();
  const nsfwOfferingExists = offerings.some((o) => o.tti?.canDoNsfw === true);
  const primaryCanDoNsfw = primary ? getTtiDescriptor(primary.ref)?.canDoNsfw === true : false;

  const renderSlot = (
    which: 'primary' | 'nsfw',
    slot: Slot,
    save: (next: Slot) => void,
    opts: { nsfwOnly: boolean; disabled: boolean },
  ): JSX.Element => {
    const families = buildPickerFamilies({
      offerings,
      usableTemplateIds: usable,
      providerName,
      reasonFor,
      nsfwOnly: opts.nsfwOnly,
      savedRef: slot?.ref ?? null,
    });
    const meta = slot ? getTtiDescriptor(slot.ref) : undefined;
    const family: PickerFamily | undefined = families.find((f) => f.selected);
    const saved = family?.offerings.find((o) => o.ref === slot?.ref);

    return (
      <div data-testid={`image-slot-${which}`}>
        <TtiModelSelect
          families={families}
          noUsableProvider={!families.some((f) => f.usable)}
          hasSelection={slot !== null}
          disabled={opts.disabled}
          onTapFamily={(f) => {
            const target = familyTapTarget(f, slot?.ref ?? null);
            if (target) save(selectRef(slot, target));
          }}
          onClear={() => save(null)}
        />
        {slot && meta && family ? (
          <div className="mt-3">
            <ImageModelConfigView
              meta={meta}
              providerName={providerName(slot.ref.slice(0, slot.ref.indexOf(':')))}
              config={slot.config}
              staleReason={saved && !saved.usable ? saved.reason : null}
              variants={variantEntries(family, slot.ref)}
              onSelectVariant={(ref) => save(selectRef(slot, ref))}
              onChange={(config) => save(withConfig(slot, slot.ref, config))}
            />
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div>
      <p className="mb-3 text-[11px] text-paper-soft">
        The model your Circle paints with when a persona generates an image. One global choice for
        all personas — changes apply immediately.
      </p>

      <div className="mb-1.5 text-[11px] uppercase tracking-widest text-paper-soft">
        Primary model
      </div>
      {renderSlot('primary', primary, (next) => persist({ primary: next, nsfw: stored.nsfw }), {
        nsfwOnly: false,
        disabled: false,
      })}

      <div className="mt-4">
        <div className="mb-1.5 text-[11px] uppercase tracking-widest text-paper-soft">
          NSFW model
        </div>
        {!nsfwOfferingExists ? (
          <p className={disabledRowClass}>
            No NSFW-capable image model exists yet — this slot lights up automatically when one is
            curated. Nothing for you to do.
          </p>
        ) : primaryCanDoNsfw ? (
          <p className={disabledRowClass}>Your primary model already supports NSFW.</p>
        ) : (
          <>
            {primary === null ? (
              <p className="mb-2 text-[11px] text-paper-soft">Pick a primary model first.</p>
            ) : null}
            {renderSlot('nsfw', nsfw, (next) => persist({ primary: stored.primary, nsfw: next }), {
              nsfwOnly: true,
              disabled: primary === null,
            })}
          </>
        )}
      </div>
    </div>
  );
}
```

Notes for the implementer:
- `rows[].apiKey` is the encrypted key envelope (non-null when a key is stored); the `reasonFor` check mirrors `usableTemplateIds` in `src/lib/usable-providers.ts`.
- If `useUpdateSettings().mutate` is typed to accept only the settings row's `imageGeneration` type, `ImageSlot` is assignable to `StoredImageSlot` (its `config` is the new shape, which is part of the union); no cast is needed.

- [ ] **Step 5: Run to verify pass, and the full gate**

Run: `cd apps/user-client && pnpm vitest run tests/components/image-gen-section.test.tsx tests/components/tti-picker-model.test.ts tests/component/settings-images.test.tsx` → PASS.
Run: `pnpm turbo run typecheck --force` → **green** (the red window closes here). Fix any remaining type errors in `apps/user-client` — e.g. a test fixture still typed with the old `ImageModelConfig` — by using the new shape or `LegacyImageModelConfig` for historical artefact fixtures.
Run: `pnpm biome check .` → clean.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client
git commit -m "Rebuild the image-model picker family-first with an identity line" -m "Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 10: Live TTI harness (written, not run)

**Files:**
- Create: `packages/llm-unified/curation/run-tti-suite.ts`

**Interfaces:**
- Consumes: `registerBuiltinProviders`, `listTtiOfferings`, `getProvider`, `generateImages`, `priceKey`, `priceCentsFor`, `latencyFor`, `TtiDescriptor`, `ImageModelConfig`.
- Produces: a script Liz runs locally with keys. **Do not run it** (operating rule 12).

- [ ] **Step 1: Write the harness**

`packages/llm-unified/curation/run-tti-suite.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
//
// Live TTI verification harness (run via the /curate skill, NEVER in CI — it
// needs keys/.nano-test-key and keys/.xai-test-key and spends real money,
// about $2.50 for the full matrix including FLUX.3 4k). For every TTI offering
// it generates one image per priced resolution × quality cell at the default
// aspect through the real generateImages(), checks the returned pixel
// dimensions against the descriptor, and prints wall-clock time and image
// size. Billed cost is printed by the provider dashboards, not here.
//
//   bun run curation/run-tti-suite.ts              (from packages/llm-unified)
//   bun run curation/run-tti-suite.ts flux         (slug substring filter)
import { readFileSync } from 'node:fs';
import { registerBuiltinProviders } from '../src/providers/_register-builtins.js';
import { getProvider, listTtiOfferings } from '../src/registry.js';
import type { ImageModelConfig, TtiDescriptor } from '../src/tti/descriptor.js';
import { generateImages } from '../src/tti/generate-images.js';
import { latencyFor, priceCentsFor } from '../src/tti/image-config.js';

const KEY_FILES: Record<string, string> = { 'nano-gpt': '.nano-test-key', xai: '.xai-test-key' };

function readKey(providerId: string): string {
  const file = KEY_FILES[providerId];
  if (!file) throw new Error(`no key file mapped for ${providerId}`);
  return readFileSync(new URL(`../../../keys/${file}`, import.meta.url), 'utf8').trim();
}

/** Width × height from PNG / JPEG / WebP bytes; [0, 0] when unknown. */
function dimensions(bytes: Uint8Array): [number, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return [view.getUint32(16), view.getUint32(20)];
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1] ?? 0;
      if (marker >= 0xc0 && marker <= 0xc2) return [view.getUint16(i + 7), view.getUint16(i + 5)];
      i += 2 + view.getUint16(i + 2);
    }
  }
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[12] === 0x56 && bytes[15] === 0x58) {
    const w = 1 + ((bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16));
    const h = 1 + ((bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16));
    return [w, h];
  }
  return [0, 0];
}

function ratioOf(aspect: string): number {
  const [w, h] = aspect.split(':').map(Number);
  return (w ?? 1) / (h ?? 1);
}

/** Exact for size tables; within 3 % of the aspect ratio otherwise. */
function dimensionVerdict(meta: TtiDescriptor, config: ImageModelConfig, w: number, h: number): string {
  if (meta.wire.kind === 'size-table') {
    const want = meta.wire.sizes[`${config.aspect}|${config.resolution ?? '-'}`];
    return want && want[0] === w && want[1] === h ? 'PASS exact' : `FAIL want ${want?.join('x')}`;
  }
  const drift = Math.abs(w / h - ratioOf(config.aspect)) / ratioOf(config.aspect);
  return drift <= 0.03 ? 'PASS ratio' : `FAIL ratio drift ${(drift * 100).toFixed(1)} %`;
}

function cells(meta: TtiDescriptor): ImageModelConfig[] {
  const out: ImageModelConfig[] = [];
  for (const resolution of meta.resolutions?.map((r) => r.id) ?? [null]) {
    for (const quality of meta.qualities?.map((q) => q.id) ?? [null]) {
      out.push({ aspect: meta.defaults.aspect, resolution, quality });
    }
  }
  return out;
}

registerBuiltinProviders();
const filter = process.argv[2];
let failures = 0;

for (const o of listTtiOfferings()) {
  const meta = o.tti;
  if (!meta) continue;
  if (filter && !o.upstreamSlug.includes(filter)) continue;
  const provider = getProvider(o.providerId);
  if (!provider) continue;
  const apiKey = readKey(o.providerId);
  for (const config of cells(meta)) {
    const label = `${o.providerId}:${o.upstreamSlug} ${config.resolution ?? '-'}|${config.quality ?? '-'}`;
    const t0 = performance.now();
    try {
      const result = await generateImages({
        providerConfig: { baseUrl: provider.baseUrl, routing: { kind: 'direct' } },
        apiKey,
        slug: o.upstreamSlug,
        meta,
        config,
        prompt: 'A small red fox sitting in a snowy birch forest at dawn, soft watercolour',
        count: 1,
      });
      const seconds = ((performance.now() - t0) / 1000).toFixed(0);
      const item = result.items[0];
      if (item?.kind !== 'image') {
        failures++;
        console.log(`FAIL ${label}: ${item?.kind ?? 'no item'} after ${seconds} s`);
        continue;
      }
      const bytes = new Uint8Array(await item.bytes.arrayBuffer());
      const [w, h] = dimensions(bytes);
      const verdict = dimensionVerdict(meta, config, w, h);
      if (verdict.startsWith('FAIL')) failures++;
      console.log(
        `${verdict} ${label}: ${w}x${h} ${item.mime} ${Math.round(bytes.length / 1024)} KiB in ${seconds} s` +
          ` (descriptor: ${priceCentsFor(meta, config)}¢, ${latencyFor(meta, config) ?? 'no latency hint'})`,
      );
    } catch (e) {
      failures++;
      console.log(`FAIL ${label}: ${(e as Error).message}`);
    }
  }
}

console.log(`\nDONE — ${failures} failure(s).`);
```

- [ ] **Step 2: Typecheck only**

Run: `cd packages/llm-unified && pnpm exec tsc --noEmit --skipLibCheck -p tsconfig.test.json` (if `curation/` is not part of that project, run `cd packages/llm-unified && bunx tsc --noEmit --strict --noUncheckedIndexedAccess --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck curation/run-tti-suite.ts`). Expected: no errors. **Do not execute the script.**
Run: `pnpm biome check packages/llm-unified/curation/run-tti-suite.ts` → clean.

- [ ] **Step 3: Commit**

```bash
git add packages/llm-unified/curation/run-tti-suite.ts
git commit -m "Add the live TTI curation harness" -m "Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 11: Full verification, STATUS and hand-off

**Files:**
- Modify: `obsidian/STATUS-CLIENT-ONLY.md`

- [ ] **Step 1: Full verification (never only the touched directories)**

Run each and record the numbers:

```bash
cd packages/llm-unified && bun test            # expect 0 failures
cd ../../apps/user-client && pnpm vitest run   # expect 0 failures (or exactly the 8 Node-localStorage baseline, see rule 9)
cd ../.. && pnpm turbo run typecheck --force   # expect green
pnpm run build                                 # expect green
pnpm biome check .                             # expect clean
```

Leftover scan — each must print nothing:

```bash
rg -n "groupId" packages/llm-unified/src apps/user-client/src --type ts -g '!**/upgrade.ts'
rg -n "defaultConfigFor|maxCountFor|TtiGroupId|isImageModelConfig\(slot\.config\)" packages apps --type ts
```

If anything fails, fix it in a new commit on the branch before continuing.

- [ ] **Step 2: STATUS update**

In `obsidian/STATUS-CLIENT-ONLY.md`, insert directly under the `## Current` heading (above the existing `**Last updated:** …` paragraph, which becomes `**Also …**` by replacing its leading `**Last updated:**` with `**Also`):

```markdown
**Last updated:** 2026-10-08 — **UNIFIED IMAGE MODELS BUILT (overnight), AWAITING
REVIEW.** Branch `feat/unified-image-models`, **not squashed, not merged, not
pushed**. Spec `superpowers/specs/2026-10-07-unified-image-models-design.md`, plan
`superpowers/plans/2026-10-07-unified-image-models.md`. Every TTI offering is now a
data descriptor (family, variant, aspects, resolutions, qualities, prices, wire);
the four bespoke groups are gone; nine nano-gpt models added (MiniMax H3, Qwen Image
2.1 + Pro, FLUX.3, Seedream 5.0 Flash/Lite/Pro, Grok Imagine 2.0, Nano Banana 2.1)
plus Z-Image Base as its own offering — 14 offerings, 8 families, all
`canDoNsfw: false` (Chris + community judge NSFW first). Family-first picker with
identity line, priced resolutions, latency-hinted qualities, stale-slot handling,
`lastConfigByRef`; lazy legacy-slot upgrade (no Dexie bump); generated PNGs
transcoded to JPEG at full size. **Next (Liz):** Laura pre-squash pass, run
`curation/run-tti-suite.ts` live, write the per-family Curation Records and the
curate skill's Mode 5, squash; **then Chris** runs spec §10 on device.
```

Commit:

```bash
git add obsidian/STATUS-CLIENT-ONLY.md
git commit -m "Update client STATUS for the unified image models build [skip ci]" -m "Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

- [ ] **Step 3: Hand-off — stop here**

**Do NOT merge. Do NOT push. Do NOT squash. Do NOT tag or release.** Report back, in this order:

1. The verification numbers from Step 1 (tests passed/failed per suite, typecheck, build, Biome), noting whether the 8-failure Node-localStorage baseline applied.
2. `git log --oneline master..feat/unified-image-models` (the commit list).
3. Anything you decided on your own because the plan was ambiguous, and anything you could not finish.
