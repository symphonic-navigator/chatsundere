// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { setProxyAuthSource } from '../proxy-auth.js';
import type { ProviderConfig } from '../types.js';
import { ImageGenerationError, generateImages } from './generate-images.js';

function asMockFetch(
  impl: (input: string | Request | URL, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return Object.assign(impl, { preconnect: async () => {} }) as unknown as typeof fetch;
}

const providerConfig: ProviderConfig = {
  baseUrl: 'https://nano-gpt.com/api/v1',
  routing: { kind: 'direct' },
};
const base = {
  providerConfig,
  apiKey: 'k',
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
    const fetchFn = asMockFetch(async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      calls.push({ url: req.url, hasAuth: req.headers.has('authorization') });
      if (req.url.endsWith('/images/generations')) {
        return jsonResponse({ data: [{ url: 'https://r2.example/img.jpg' }] });
      }
      return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    });
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

  // `failed`, not `moderated`: the provider drew the image, we could not collect
  // it. Reporting that as content moderation blamed the user's prompt for our
  // own transport fault — and hid the missing CORS routing for as long as it
  // existed, because "blocked by the content filter" reads like a normal day.
  test('a failed url fetch degrades that item to failed, not the whole call', async () => {
    const fetchFn = asMockFetch(async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      if (req.url.endsWith('/images/generations')) {
        return jsonResponse({
          data: [{ url: 'https://r2.example/a.jpg' }, { url: 'https://r2.example/b.jpg' }],
        });
      }
      if (req.url.endsWith('/a.jpg')) return new Response('nope', { status: 403 });
      return new Response(new Blob([new Uint8Array([1])], { type: 'image/jpeg' }), { status: 200 });
    });
    const result = await generateImages({
      ...base,
      config: { groupId: 'zimage', variant: 'turbo', size: '1024x1024' },
      prompt: 'a fox',
      count: 2,
      fetchFn,
    });
    expect(result.items.map((i) => i.kind)).toEqual(['failed', 'image']);
  });

  // The defect Chris hit in the field: nano-gpt's R2 bucket answers a
  // cross-origin GET with no CORS headers unless the Origin is localhost
  // (measured 2026-07-26), so on a deployed domain the browser cannot read the
  // bytes. The signed URL must therefore travel the same route as the call that
  // produced it — origin in `x-cors-proxy-target`, path AND signed query on the
  // request line, and no `Authorization` (it would collide with the AWS-V4 sig).
  test('fetches the signed url through the proxy when the provider is proxied', async () => {
    const seen: Request[] = [];
    const fetchFn = asMockFetch(async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      seen.push(req);
      if (req.headers.get('x-cors-proxy-target') === 'https://api.nano-gpt.com') {
        return jsonResponse({ data: [{ url: 'https://r2.example/a.jpg?X-Amz-Signature=abc' }] });
      }
      return new Response(new Blob([new Uint8Array([1])], { type: 'image/jpeg' }), { status: 200 });
    });
    setProxyAuthSource({
      getUrl: () => 'https://proxy.example',
      getToken: () => 'tok',
      refreshToken: async () => 'tok',
    });
    try {
      const result = await generateImages({
        ...base,
        providerConfig: {
          baseUrl: 'https://api.nano-gpt.com',
          routing: { kind: 'cors-proxy' },
        } as ProviderConfig,
        config: { groupId: 'zimage', variant: 'turbo', size: '1024x1024' },
        prompt: 'a fox',
        count: 1,
        fetchFn,
      });
      expect(result.items.map((i) => i.kind)).toEqual(['image']);
      const blobReq = seen[seen.length - 1] as Request;
      expect(blobReq.url).toBe('https://proxy.example/a.jpg?X-Amz-Signature=abc');
      expect(blobReq.headers.get('x-cors-proxy-target')).toBe('https://r2.example');
      expect(blobReq.headers.get('x-chatsundere-authorization')).toBe('Bearer tok');
      expect(blobReq.headers.get('authorization')).toBeNull();
    } finally {
      setProxyAuthSource(null);
    }
  });
});

describe('generateImages — xai b64 flow', () => {
  const xaiBase = {
    ...base,
    providerConfig: {
      baseUrl: 'https://api.x.ai/v1',
      routing: { kind: 'direct' },
    } as ProviderConfig,
  };
  test('decodes inline b64 into a Blob and resolves the tiered model id', async () => {
    const b64 = btoa(String.fromCharCode(9, 8, 7));
    const fetchFn = asMockFetch(async () =>
      jsonResponse({ data: [{ b64_json: b64, mime_type: 'image/png' }] }),
    );
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
    const fetchFn = asMockFetch(async () =>
      jsonResponse({
        data: [
          { b64_json: btoa('x'), mime_type: 'image/jpeg' },
          { respect_moderation: false, reason: 'blocked' },
        ],
      }),
    );
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
    const fetchFn = asMockFetch(async () =>
      jsonResponse({ error: { message: 'prompt rejected' } }, 422),
    );
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
