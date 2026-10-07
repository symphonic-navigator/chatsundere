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
  test('there are thirteen TTI offerings', () => {
    expect(
      all()
        .map((o) => o.ref)
        .sort(),
    ).toEqual([
      'nano-gpt:black-forest-labs/flux-3/text-to-image',
      'nano-gpt:bytedance/seedream-v5.0-flash',
      'nano-gpt:bytedance/seedream-v5.0-pro',
      'nano-gpt:gpt-image-2',
      'nano-gpt:minimax-h3/text-to-image',
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

  test('a wire never sets both modelByQuality and qualityParam', () => {
    for (const { ref, meta } of all()) {
      if (meta.wire.kind !== 'aspect-resolution') continue;
      const both = meta.wire.modelByQuality !== undefined && meta.wire.qualityParam !== undefined;
      expect({ ref, both }).toEqual({ ref, both: false });
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
    const byFamily = new Map<
      string,
      Array<{ ref: string; variant: string | null; rec: boolean }>
    >();
    for (const { ref, meta } of all()) {
      const list = byFamily.get(meta.family) ?? [];
      list.push({ ref, variant: meta.variant, rec: meta.recommended === true });
      byFamily.set(meta.family, list);
    }
    for (const [family, members] of byFamily) {
      if (members.length > 1) {
        for (const m of members) {
          expect({ family, ref: m.ref, labelled: m.variant !== null }).toEqual({
            family,
            ref: m.ref,
            labelled: true,
          });
        }
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
