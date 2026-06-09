// SPDX-License-Identifier: AGPL-3.0-only
import type { GenerateImagesResult } from '@chatsundere/llm-unified';
import { describe, expect, it, vi } from 'vitest';
import {
  type ImageGenerationSlot,
  type ImageToolContext,
  computeNsfwParamAllowed,
  contributeImageTool,
} from '../../src/tools/generate-image.js';

function slot(over: Partial<ImageGenerationSlot> = {}): ImageGenerationSlot {
  return {
    ref: 'nano-gpt:z-image-turbo',
    modelLabel: 'Z-Image',
    canDoNsfw: false,
    config: { groupId: 'zimage', variant: 'turbo', size: '1024x1024' },
    ...over,
  };
}

function ctx(over: Partial<ImageToolContext> = {}): ImageToolContext {
  return {
    chatId: 'c1',
    personaId: 'p1',
    primary: slot(),
    nsfwSlot: null,
    nsfwParamAllowed: false,
    generate: vi.fn(
      async (): Promise<GenerateImagesResult> => ({
        items: [
          { kind: 'image', bytes: new Blob(['x'], { type: 'image/jpeg' }), mime: 'image/jpeg' },
        ],
        modelId: 'z-image-turbo',
      }),
    ),
    persistImage: vi.fn(async () => 'artefact-1'),
    ...over,
  };
}

function getTool(c: ImageToolContext) {
  const tools = contributeImageTool(c);
  const tool = tools[0];
  if (!tool) throw new Error('tool missing');
  return tool;
}

describe('computeNsfwParamAllowed — the three-way gate (8 combinations)', () => {
  it.each([
    [false, 'sfw', false, false],
    [false, 'sfw', true, false],
    [false, 'nsfw', false, false],
    [false, 'nsfw', true, false],
    [true, 'sfw', false, false],
    [true, 'sfw', true, false],
    [true, 'nsfw', false, false],
    [true, 'nsfw', true, true],
  ] as const)(
    'adultPersona=%s adultMode=%s nsfwCapable=%s → %s',
    (persona, mode, capable, want) => {
      expect(computeNsfwParamAllowed(persona, mode, capable)).toBe(want);
    },
  );
});

describe('contributeImageTool — schema', () => {
  it('is ALWAYS offered, even with no primary model', () => {
    const tools = contributeImageTool(ctx({ primary: null }));
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('generate_image');
  });
  it('omits the nsfw property unless nsfwParamAllowed', () => {
    const off = getTool(ctx());
    const on = getTool(ctx({ nsfwParamAllowed: true }));
    const props = (t: typeof off) =>
      Object.keys((t.parameters as { properties: Record<string, unknown> }).properties);
    expect(props(off)).toEqual(['prompt', 'count']);
    expect(props(on)).toEqual(['prompt', 'count', 'nsfw']);
  });
});

describe('contributeImageTool — execute', () => {
  it('unconfigured → constructive settings pointer, no generate call', async () => {
    const c = ctx({ primary: null });
    const r = await getTool(c).execute({ prompt: 'a fox' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('My Settings → Image generation');
    expect(c.generate).not.toHaveBeenCalled();
  });
  it('empty prompt → constructive error, no generate call', async () => {
    const c = ctx();
    const r = await getTool(c).execute({ prompt: '   ' });
    expect(r.ok).toBe(false);
    expect(c.generate).not.toHaveBeenCalled();
  });
  it('clamps count to the group maximum and persists one artefact per image', async () => {
    const seedreamSlot = slot({
      ref: 'nano-gpt:seedream-v4.5',
      modelLabel: 'Seedream 4.5',
      config: { groupId: 'seedream', aspect: '1:1', quality: 'standard' },
    });
    const c = ctx({
      primary: seedreamSlot,
      generate: vi.fn(
        async (): Promise<GenerateImagesResult> => ({
          items: [
            { kind: 'image', bytes: new Blob(['a']), mime: 'image/jpeg' },
            { kind: 'image', bytes: new Blob(['b']), mime: 'image/jpeg' },
          ],
          modelId: 'seedream-v4.5',
        }),
      ),
    });
    const r = await getTool(c).execute({ prompt: 'a fox', count: 9 });
    expect(c.generate).toHaveBeenCalledWith(seedreamSlot, 'a fox', 4, undefined);
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
    await getTool(c).execute({ prompt: 'a fox', nsfw: true });
    expect(c.generate).toHaveBeenCalledWith(nsfwSlot, 'a fox', 1, undefined);
  });
  it('nsfw:true with an nsfw-capable primary and no nsfw slot routes to the primary', async () => {
    const capablePrimary = slot({ canDoNsfw: true });
    const c = ctx({ primary: capablePrimary, nsfwParamAllowed: true });
    await getTool(c).execute({ prompt: 'a fox', nsfw: true });
    expect(c.generate).toHaveBeenCalledWith(capablePrimary, 'a fox', 1, undefined);
  });
  it('hallucinated nsfw:true without an eligible model → constructive error', async () => {
    const c = ctx();
    const r = await getTool(c).execute({ prompt: 'a fox', nsfw: true });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('non-explicit');
    expect(c.generate).not.toHaveBeenCalled();
  });
  it('moderated items are reported, successes still persist', async () => {
    const c = ctx({
      generate: vi.fn(
        async (): Promise<GenerateImagesResult> => ({
          items: [
            { kind: 'image', bytes: new Blob(['a']), mime: 'image/jpeg' },
            { kind: 'moderated', reason: 'content policy' },
          ],
          modelId: 'grok-imagine-image',
        }),
      ),
    });
    const r = await getTool(c).execute({ prompt: 'a fox', count: 2 });
    expect(r.ok).toBe(true);
    expect(r.output).toContain('1 image was blocked');
    expect(c.persistImage).toHaveBeenCalledTimes(1);
    expect(r.meta?.moderatedReasons).toEqual(['content policy']);
  });
  it('all items moderated → constructive failure', async () => {
    const c = ctx({
      generate: vi.fn(
        async (): Promise<GenerateImagesResult> => ({
          items: [{ kind: 'moderated', reason: 'blocked' }],
          modelId: 'grok-imagine-image',
        }),
      ),
    });
    const r = await getTool(c).execute({ prompt: 'a fox' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('blocked');
    expect(c.persistImage).not.toHaveBeenCalled();
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
    const r = await getTool(c).execute({ prompt: 'a fox' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('prompt rejected');
    expect(r.error).toContain('rephras');
  });
});
